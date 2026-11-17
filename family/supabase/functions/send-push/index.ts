// 우리집 미니월드 — 웹 푸시 보내기 (Supabase Edge Function)
//
// 두 가지 일을 한다.
//   mode=due   : 곧 시작하는 일정을 그 일정에 엮인 가족에게. pg_cron 이 5분마다 부른다.
//   mode=item  : 가족이 뭔가 올렸을 때 나머지 가족에게. family_items 트리거가 pg_net 으로 부른다.
//
// 비밀값은 데이터베이스 Vault 에 있다(저장소·브라우저에 절대 넣지 않는다):
//   vapid_public, vapid_private, push_secret  ← public.push_vault_get() 으로 읽는다
// push_secret 은 x-push-secret 헤더로 받아 데이터베이스에서 온 호출만 받아들인다.
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

// 서명 키와 호출 비밀번호는 Vault 에서 읽는다 — 환경변수가 아니다.
// (2026-11-17: 저장소 파일이 환경변수를 읽는 옛 모양이라 그대로 올렸다가 함수가 죽었다.
//  실제로 돌던 건 Vault 를 읽는 쪽이었다. 저장소를 실제 배포본에 맞춰 둔다.)
const vault = async (name: string) => {
  const { data } = await admin.rpc('push_vault_get', { p_name: name });
  return typeof data === 'string' ? data : '';
};
const VAPID_PUBLIC = await vault('vapid_public');
const VAPID_PRIVATE = await vault('vapid_private');
const PUSH_SECRET = await vault('push_secret');
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:family@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.error('vapid keys missing');   // 죽지는 않는다 — 요청마다 오류로 답한다
}

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

      const who = new Set<string>([ev.ownerId, ...(ev.attendeeIds || [])].filter(Boolean));
      if (ev.visibility === 'private') { who.clear(); who.add(ev.ownerId); }

      // 아이 앞으로 온 알림은 보호자가 대신 받는다.
      // 아이에겐 기기가 없다. 이걸 빼먹으면 '몬테소리 30분 전' 같은 알림이
      // 아무에게도 도착하지 않는다 — 정작 챙겨야 할 사람이 부모인데도.
      for (const id of [...who]) {
        if (members.get(id)?.role !== 'kid') continue;
        for (const [mid, m] of members) if (m?.role && m.role !== 'kid') who.add(mid);
      }

      const targets = famSubs.filter(s => who.has(s.member_id));
      // 받을 기기가 없으면 '보냈다'고 찍지 않는다 — 찍어 두면 영영 다시 시도하지 않는다.
      if (!targets.length) continue;

      const key = `ev:${ev.id}:${now.date}:${ev.startTime}`;
      if (!await claim(key, familyId)) continue;

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

/** 최근 몇 분 안에 가족이 올린 것을 사람별로 묶어 한 통씩 */
async function sendRecent(minutes = 6) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data: rows } = await admin.from('family_items')
    .select('family_id,kind,id,data,deleted,updated_at,updated_by')
    .gt('updated_at', since)
    .in('kind', Object.keys(LABEL))
    .order('updated_at', { ascending: false })
    .limit(80);
  if (!rows?.length) return { items: 0, sent: 0 };

  const groups = new Map<string, { family_id: string; by: string; rows: any[] }>();
  for (const r of rows) {
    if (!r.updated_by) continue;
    const k = `${r.family_id}|${r.updated_by}`;
    if (!groups.has(k)) groups.set(k, { family_id: r.family_id, by: r.updated_by, rows: [] });
    groups.get(k)!.rows.push(r);
  }

  let sent = 0;
  for (const g of groups.values()) {
    const visible = g.rows.filter(r => (r.data as any)?.visibility !== 'private' && !r.deleted);
    if (!visible.length) continue;
    const newest = visible[0];
    if (!await claim(`it:${g.family_id}:${g.by}:${newest.updated_at}`, g.family_id)) continue;

    const { data: subs } = await admin.from('push_subscriptions')
      .select('endpoint,p256dh,auth,member_id,user_id,fail_count').eq('family_id', g.family_id);
    const targets = (subs ?? []).filter(s => s.user_id !== g.by) as Sub[];
    if (!targets.length) continue;

    const label = LABEL[newest.kind];
    const text = String((newest.data as any)?.title || (newest.data as any)?.text || '').slice(0, 50);
    const more = visible.length - 1;
    sent += await pushTo(targets, {
      title: `\u{1F46A} ${label}이 올라왔어요${more ? ` 외 ${more}건` : ''}`,
      body: text || '가족이 방금 올렸어요',
      tag: `peer:${g.family_id}:${g.by}`,
      url: './',
    });
  }
  return { items: rows.length, sent };
}

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

// ───────── 구독 갈아타기 ─────────
//
// 브라우저는 푸시 구독을 제 사정으로 갈아치운다(아이폰은 특히 자주).
// 그때 서비스 워커가 pushsubscriptionchange 를 받아 새 구독으로 다시 등록하는데,
// 앱이 떠 있지 않으니 로그인 정보가 없다. 비밀값을 서비스 워커에 둘 수도 없다.
//
// 그래서 '옛 구독 주소를 알고 있다'는 것으로 본인임을 확인한다.
// 그 주소는 그 기기와 푸시 업체만 아는 긴 임의 문자열이고, 이미 우리 표에 있는 것이라야 한다.
// 이걸 안 하면, 구독이 바뀐 기기는 사람이 앱을 다시 열 때까지 알림이 끊긴다.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
async function swapSub(b: Record<string, any>) {
  const oldEp = String(b.old || ''), ep = String(b.endpoint || '');
  const p256dh = String(b.p256dh || ''), auth = String(b.auth || '');
  if (!oldEp || !ep || !p256dh || !auth) return Response.json({ ok: false, error: 'bad' }, { status: 400, headers: CORS });
  const { data: row } = await admin.from('push_subscriptions')
    .select('user_id,family_id,member_id,user_agent').eq('endpoint', oldEp).maybeSingle();
  if (!row) return Response.json({ ok: false, error: 'gone' }, { status: 404, headers: CORS });
  const { error } = await admin.from('push_subscriptions').upsert({
    endpoint: ep, user_id: row.user_id, family_id: row.family_id, member_id: row.member_id,
    user_agent: row.user_agent, p256dh, auth, fail_count: 0,
  }, { onConflict: 'endpoint' });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: CORS });
  if (ep !== oldEp) await admin.from('push_subscriptions').delete().eq('endpoint', oldEp);
  return Response.json({ ok: true, swapped: ep !== oldEp }, { headers: CORS });
}

// ───────── 입구 ─────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  // 구독 갈아타기만 비밀값 없이 받는다(옛 구독 주소가 열쇠다). 나머지는 모두 비밀값이 있어야 한다.
  let pre: Record<string, any> = {};
  let raw = '';
  try { raw = await req.text(); pre = raw ? JSON.parse(raw) : {}; } catch { pre = {}; }
  if (pre.mode === 'swap') return await swapSub(pre);

  if (!PUSH_SECRET || req.headers.get('x-push-secret') !== PUSH_SECRET) return new Response('no', { status: 401 });

  const body: Record<string, any> = pre;   // 몸통은 위에서 이미 읽었다

  try {
    let out: Record<string, unknown>;
    if (body.mode === 'item') out = await sendItem(body);
    else if (body.mode === 'due') out = await sendDue();
    else if (body.mode === 'recent') out = await sendRecent();
    else out = { due: await sendDue(), recent: await sendRecent() };   // 기본: 둘 다
    return Response.json({ ok: true, ...out });
  } catch (e) {
    console.error('send-push', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
