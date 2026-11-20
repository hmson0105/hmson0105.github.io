// 우리집 미니월드 — 디스코드 전용 채널 ↔ 미니월드 (Supabase Edge Function)
//
// 두 가지 일을 한다. 1분마다 pg_cron 이 부른다.
//   ① 가져오기 — 채널에 새로 올라온 글을 family_items(kind='relays') 로 넣는다.
//   ② 알리기  — 앱에서 '확인했어요'를 누른 줄에 ✅ 반응과 한 줄 답글을 단다.
//
// 디스코드에는 '새 글이 생기면 알려주는 웹훅'이 없다. 그래서 긁어온다.
// 마지막으로 가져온 메시지 번호만 기억해 두고 그 뒤 것만 받는다(public.discord_relay).
//
// 읽음 표시에 대해: 디스코드는 봇이 남의 '읽음'을 대신 찍을 수 없다. 읽음은 사람마다
// 따로이고 봇에게 열려 있지 않다. 그래서 ✅ 반응과 '누가 확인했는지' 한 줄로 대신한다.
//
// 비밀값은 Vault 에 있다(저장소·브라우저에 절대 넣지 않는다):
//   discord_bot_token, push_secret

import { createClient } from 'jsr:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const vault = async (name: string) => {
  const { data } = await admin.rpc('push_vault_get', { p_name: name });
  return typeof data === 'string' ? data : '';
};
const BOT = await vault('discord_bot_token');
const PUSH_SECRET = await vault('push_secret');

const API = 'https://discord.com/api/v10';
const CHECK = '%E2%9C%85';   // ✅

function dio(path: string, init: RequestInit = {}) {
  return fetch(API + path, {
    ...init,
    headers: { authorization: `Bot ${BOT}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** 디스코드 글 한 줄 → 우리 기록 한 줄 */
function toRelay(m: any, channelId: string) {
  const files = Array.isArray(m.attachments) ? m.attachments.length : 0;
  const text = [String(m.content ?? '').slice(0, 1000), files ? `(사진 ${files}장)` : ''].filter(Boolean).join(' ');
  return {
    id: `dc_${m.id}`,
    msgId: String(m.id),
    channelId,
    // name 은 사람이 쓴 글로 다뤄 그대로 둔다(화면에 넣을 때 esc 한다)
    name: String(m.author?.global_name || m.author?.username || '누군가').slice(0, 40),
    discordId: String(m.author?.id ?? ''),
    text: text || '(내용 없음)',
    at: String(m.timestamp ?? new Date().toISOString()),
    ackBy: null, ackAt: null, ackedAt: null,
    sourceId: 'src_discord',
  };
}

// ───────── ① 채널에서 가져오기 ─────────
async function pull() {
  const { data: rooms } = await admin.from('discord_relay').select('*').eq('enabled', true);
  if (!rooms?.length) return { rooms: 0, pulled: 0 };

  let pulled = 0;
  for (const room of rooms) {
    const q = room.last_message_id ? `?after=${room.last_message_id}&limit=50` : '?limit=5';
    const res = await dio(`/channels/${room.channel_id}/messages${q}`);
    if (!res.ok) { console.error('discord pull', res.status, await res.text()); continue; }
    const msgs = await res.json();
    if (!Array.isArray(msgs) || !msgs.length) continue;

    // 받은 건 최신순이다. 오래된 것부터 넣는다. 봇이 쓴 글(우리 답글 포함)은 건너뛴다.
    const mine = msgs.filter((m: any) => !m.author?.bot).reverse();
    for (const m of mine) {
      const data = toRelay(m, room.channel_id);
      const { error } = await admin.from('family_items').upsert({
        family_id: room.family_id, kind: 'relays', id: data.id, data, deleted: false,
      }, { onConflict: 'family_id,kind,id', ignoreDuplicates: true });
      if (!error) pulled++;
    }
    // 커서는 봇 글까지 포함해 가장 큰 번호로 민다(안 그러면 같은 봇 글을 계속 다시 본다)
    const newest = msgs[0]?.id;
    if (newest) {
      await admin.from('discord_relay')
        .update({ last_message_id: String(newest), updated_at: new Date().toISOString() })
        .eq('family_id', room.family_id);
    }
  }
  return { rooms: rooms.length, pulled };
}

// ───────── ② 확인했어요 → 디스코드에 표시 ─────────
async function ack() {
  const { data: rows } = await admin.from('family_items')
    .select('family_id,id,data').eq('kind', 'relays').eq('deleted', false).limit(200);
  const todo = (rows ?? []).filter(r => {
    const d: any = r.data ?? {};
    return d.ackBy && !d.ackedAt && d.msgId && d.channelId;
  });
  if (!todo.length) return { acked: 0 };

  // 누가 확인했는지 이름을 붙이려고 구성원을 읽어 둔다
  const fams = [...new Set(todo.map(r => r.family_id))];
  const names = new Map<string, string>();
  for (const f of fams) {
    const { data: ms } = await admin.from('family_items').select('id,data').eq('family_id', f).eq('kind', 'members');
    for (const m of ms ?? []) names.set(`${f}|${m.id}`, (m.data as any)?.displayName ?? '가족');
  }

  let acked = 0;
  for (const r of todo) {
    const d: any = r.data;
    const who = names.get(`${r.family_id}|${d.ackBy}`) ?? '가족';
    const a = await dio(`/channels/${d.channelId}/messages/${d.msgId}/reactions/${CHECK}/@me`, { method: 'PUT' });
    // 이미 달려 있으면 그것도 성공으로 본다
    if (!a.ok && a.status !== 204 && a.status !== 409) { console.error('discord react', a.status, await a.text()); continue; }
    await dio(`/channels/${d.channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: `✅ ${who}가 확인했어요`,
        message_reference: { message_id: d.msgId, fail_if_not_exists: false },
        allowed_mentions: { parse: [] },
      }),
    });
    await admin.from('family_items')
      .update({ data: { ...d, ackedAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
      .eq('family_id', r.family_id).eq('kind', 'relays').eq('id', r.id);
    acked++;
  }
  return { acked };
}

// ───────── 입구 ─────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (!PUSH_SECRET || req.headers.get('x-push-secret') !== PUSH_SECRET) return new Response('no', { status: 401 });
  if (!BOT) return Response.json({ ok: false, error: 'no-token' });   // 아직 봇 토큰을 안 넣었다 — 조용히 쉰다

  try {
    const got = await pull();
    const sent = await ack();
    return Response.json({ ok: true, ...got, ...sent });
  } catch (e) {
    console.error('discord-relay', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
