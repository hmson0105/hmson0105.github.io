// 우리집 미니월드 — 웹 푸시 보내기 (Supabase Edge Function)
//
// 두 가지 일을 한다.
//   mode=due   : 곧 시작하는 일정을 그 일정에 엮인 가족에게. pg_cron 이 5분마다 부른다.
//   mode=item  : 가족이 뭔가 올렸을 때 나머지 가족에게. family_items 트리거가 pg_net 으로 부른다.
//
// 비밀값(함수 쪽에만 둔다. 저장소·브라우저에 절대 넣지 않는다):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SECRET
// PUSH_SECRET 은 x-push-secret 헤더로 받아 데이터베이스에서 온 호출만 받아들인다.
//
// 푸시 본문에는 제목 정도만 담는다 — 브라우저 업체 서버를 거쳐 가고 잠금 화면에도 뜬다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const TZ = 'Asia/Seoul';
const LEAD_MIN = 30;          // 일정 몇 분 전에 보낼지
const WINDOW_MIN = 6;         // cron 주기보다 살짝 넓게 잡아 놓친 건을 줄인다

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:family@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

// ───────── 서울 시각 ─────────
function seoulParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +(p.minute ?? 0) };
}
const toUTC = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toUTC(d) + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const weekday = (d: string) => new Date(toUTC(d)).getUTCDay();
const startOfWeek = (d: string) => addDays(d, -weekday(d));
const DAYCODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 일정 한 건을 [from, to] 범위로 펼친다. 앱의 model.js expand() 와 같은 규칙. */
function expand(ev: any, rule: any, from: string, to: string): string[] {
  const out: string[] = [];
  if (!rule) {
    if (ev.startDate >= from && ev.startDate <= to) out.push(ev.startDate);
    return out;
  }
  const base = ev.startDate;
  const ex = new Set<string>(ev.exDates || []);
  const interval = Math.max(1, +rule.interval || 1);
  const byDay: number[] = rule.byDay?.length
    ? rule.byDay.map((c: string) => DAYCODES.indexOf(c)).filter((i: number) => i >= 0)
    : [weekday(base)];
  const limit = rule.until && rule.until < to ? rule.until : to;
  const [by, bm, bd] = base.split('-').map(Number);
  const baseWeek = startOfWeek(base);
  let count = 0;
  for (let d = base, i = 0; d <= limit && i < 1500; d = addDays(d, 1), i++) {
    const [y, m, day] = d.split('-').map(Number);
    let hit = false;
    switch (rule.freq) {
      case 'DAILY': hit = diffDays(base, d) % interval === 0; break;
      case 'WEEKLY': hit = byDay.includes(weekday(d)) && (diffDays(baseWeek, startOfWeek(d)) / 7) % interval === 0; break;
      case 'MONTHLY': hit = day === bd && ((y - by) * 12 + (m - bm)) % interval === 0; break;
      case 'YEARLY': hit = day === bd && m === bm && (y - by) % interval === 0; break;
    }
    if (!hit) continue;
    count++;
    if (rule.count && count > rule.count) break;
    if (ex.has(d)) continue;
    if (d >= from) out.push(d);
  }
  return out;
}

// ───────── 보내기 ─────────
type Sub = { endpoint: string; p256dh: string; auth: string; member_id: string; user_id: string; fail_count: number };

async function pushTo(subs: Sub[], payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 3600 },
      );
      sent++;
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('endpoint', s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode ?? 0;
      if (code === 404 || code === 410) {
        // 기기에서 알림을 껐거나 앱을 지웠다 — 구독을 정리한다
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      } else {
        await admin.from('push_subscriptions').update({ fail_count: s.fail_count + 1 }).eq('endpoint', s.endpoint);
      }
    }
  }));
  return sent;
}

/** 같은 알림을 두 번 보내지 않게 기록해 둔다. 이미 보냈으면 false. */
async function claim(key: string, familyId: string) {
  const { error } = await admin.from('push_sent').insert({ key, family_id: familyId });
  return !error;   // 기본키 충돌 = 이미 보냄
}

// ───────── mode=due : 곧 시작하는 일정 ─────────
async function sendDue() {
  const now = seoulParts();
  const nowMin = now.hour * 60 + now.minute;
  const lo = nowMin + LEAD_MIN;                 // 지금부터 LEAD 분 뒤
  const hi = lo + WINDOW_MIN;

  const { data: subs } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth,member_id,user_id,family_id,fail_count');
  if (!subs?.length) return { families: 0, sent: 0 };

  const byFamily = new Map<string, Sub[]>();
  for (const s of subs) {
    if (!byFamily.has(s.family_id)) byFamily.set(s.family_id, []);
    byFamily.get(s.family_id)!.push(s as Sub);
  }

  let sent = 0;
  for (const [familyId, famSubs] of byFamily) {
    const { data: rows } = await admin.from('family_items')
      .select('kind,id,data')
      .eq('family_id', familyId).eq('deleted', false)
      .in('kind', ['events', 'recurrenceRules', 'members', 'places']);
    if (!rows?.length) continue;

    const rules = new Map(rows.filter(r => r.kind === 'recurrenceRules').map(r => [r.id, r.data]));
    const places = new Map(rows.filter(r => r.kind === 'places').map(r => [r.id, r.data]));
    const members = new Map(rows.filter(r => r.kind === 'members').map(r => [r.id, r.data]));

    for (const r of rows.filter(x => x.kind === 'events')) {
      const ev: any = r.data;
      if (!ev || ev.status === 'cancelled') continue;
      if (ev.allDay || ev.timeUnset || !ev.startTime) continue;    // 시각이 있어야 미리 알릴 수 있다
      const [eh, em] = String(ev.startTime).split(':').map(Number);
      const startMin = eh * 60 + em;
      if (startMin < lo || startMin >= hi) continue;               // 지금 보낼 시간대가 아니다
      if (!expand(ev, rules.get(ev.recurrenceRuleId) ?? null, now.date, now.date).length) continue;

      const key = `ev:${ev.id}:${now.date}:${ev.startTime}`;
      if (!await claim(key, familyId)) continue;

      const who = new Set<string>([ev.ownerId, ...(ev.attendeeIds || [])].filter(Boolean));
      let targets = famSubs.filter(s => who.has(s.member_id));
      if (ev.visibility === 'private') targets = targets.filter(s => s.member_id === ev.ownerId);
      if (!targets.length) continue;

      const place = ev.placeId ? places.get(ev.placeId)?.name : '';
      const owner = members.get(ev.ownerId)?.displayName ?? '';
      sent += await pushTo(targets, {
        title: `⏰ ${LEAD_MIN}분 뒤 · ${String(ev.title).slice(0, 40)}`,
        body: [owner, place].filter(Boolean).join(' · ') || '우리집 미니월드',
        tag: key,
        url: './',
      });
    }
  }
  return { families: byFamily.size, sent };
}

// ───────── mode=item : 가족이 뭔가 올렸을 때 ─────────
const LABEL: Record<string, string> = {
  events: '일정', issues: '준비할 일', trips: '여행 계획', tripComments: '여행 메모',
  boardItems: '살 것', posts: '가족 글', guestbook: '방명록',
};

async function sendItem(b: Record<string, any>) {
  const { family_id, kind, id, updated_by, updated_at, deleted } = b;
  const label = LABEL[kind];
  if (!family_id || !label) return { sent: 0, skipped: 'kind' };

  const key = `it:${kind}:${id}:${updated_at}`;
  if (!await claim(key, family_id)) return { sent: 0, skipped: 'dup' };

  const { data: subs } = await admin.from('push_subscriptions')
    .select('endpoint,p256dh,auth,member_id,user_id,fail_count')
    .eq('family_id', family_id);
  // 바꾼 사람 본인에게는 보내지 않는다
  const targets = (subs ?? []).filter(s => s.user_id !== updated_by) as Sub[];
  if (!targets.length) return { sent: 0, skipped: 'no-targets' };

  const { data: row } = await admin.from('family_items')
    .select('data').eq('family_id', family_id).eq('kind', kind).eq('id', id).maybeSingle();
  const d: any = row?.data ?? {};
  if (d.visibility === 'private') return { sent: 0, skipped: 'private' };
  const text = String(d.title || d.text || '').slice(0, 50);

  const sent = await pushTo(targets, {
    title: `👪 ${label}${deleted ? '이 지워졌어요' : '이 올라왔어요'}`,
    body: text || '가족이 방금 바꿨어요',
    tag: `peer:${kind}:${id}`,
    url: './',
  });
  return { sent };
}

// ───────── 입구 ─────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const secret = env('PUSH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) return new Response('no', { status: 401 });

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* 빈 몸통이면 due 로 본다 */ }

  try {
    const out = body.mode === 'item' ? await sendItem(body) : await sendDue();
    return Response.json({ ok: true, ...out });
  } catch (e) {
    console.error('send-push', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
