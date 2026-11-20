// 우리집 미니월드 — 디스코드 채널 ↔ 미니월드 (Supabase Edge Function)
//
// 두 가지 일을 한다. 1분마다 pg_cron 이 부른다.
//   ① 가져오기 — 채널에 새로 올라온 글을 그대로 '짧은 글'(kind='posts')로 넣는다.
//   ② 알리기  — 앱에서 '확인했어요'를 누른 글의 디스코드 원본에 ✅ 와 한 줄 답글을 단다.
//
// 화면에서는 디스코드에서 왔다고 따로 구분하지 않는다. 가족이 남긴 글은 어디서 썼든 한자리에 모인다.
//
// 채널 하나를 사람 하나로 본다(discord_relay.member_id).
// 데스크탑 디스코드는 어른 계정으로 로그인돼 있어도, #유안이 방에 쓴 글은 유안이가 쓴 것으로 센다.
//
// 디스코드에는 '새 글이 생기면 알려주는 웹훅'이 없다. 그래서 긁어온다.
// 마지막으로 가져온 메시지 번호만 기억해 두고 그 뒤 것만 받는다.
//
// 읽음 표시에 대해: 디스코드는 봇이 남의 '읽음'을 대신 찍을 수 없다. 읽음은 사람마다 따로이고
// 봇에게 열려 있지 않다. ✅ 반응과 '누가 확인했는지' 한 줄이 할 수 있는 가장 가까운 표시다.
//
// 비밀값은 Vault 에 있다: discord_bot_token, push_secret

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

/** 그 순간의 서울 날짜. 글은 '일어난 날'로 묶이니 여기서 맞춰 둔다. */
function seoulDate(iso: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return f.format(new Date(iso));
}

/** 디스코드 글 한 줄 → 짧은 글 한 편 */
function toPost(m: any, room: any, fallbackMember: string) {
  const files = Array.isArray(m.attachments) ? m.attachments.length : 0;
  const text = [String(m.content ?? '').slice(0, 1000), files ? `(사진 ${files}장)` : ''].filter(Boolean).join(' ');
  const at = String(m.timestamp ?? new Date().toISOString());
  const who = room.member_id || fallbackMember;
  return {
    id: `po_dc_${m.id}`,
    memberId: who,
    text: text || '(내용 없음)',
    photo: null, photoId: null, trace: null,
    at: seoulDate(at),
    url: '', tripId: null, filed: true,
    createdAt: at, createdBy: who,
    visibility: 'family',
    sourceId: 'src_discord',
    // 어디서 왔는지는 화면에 드러내지 않고, 확인 표시를 되돌려 보내는 데만 쓴다.
    relay: {
      msgId: String(m.id), channelId: room.channel_id,
      name: String(m.author?.global_name || m.author?.username || '').slice(0, 40),
      ackBy: null, ackAt: null, ackedAt: null,
    },
  };
}

/** 그 가족의 구성원 하나(채널에 주인을 안 정했을 때 쓸 기본값) */
async function firstMember(familyId: string) {
  const { data } = await admin.from('family_items').select('id').eq('family_id', familyId).eq('kind', 'members').limit(1);
  return data?.[0]?.id ?? 'm_mom';
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

    const fallback = await firstMember(room.family_id);
    // 받은 건 최신순이다. 오래된 것부터 넣는다. 봇이 쓴 글(우리 답글 포함)은 건너뛴다.
    const mine = msgs.filter((m: any) => !m.author?.bot).reverse();
    for (const m of mine) {
      const data = toPost(m, room, fallback);
      const { error } = await admin.from('family_items').upsert({
        family_id: room.family_id, kind: 'posts', id: data.id, data, deleted: false,
      }, { onConflict: 'family_id,kind,id', ignoreDuplicates: true });
      if (!error) pulled++;
    }
    const newest = msgs[0]?.id;
    if (newest) {
      await admin.from('discord_relay')
        .update({ last_message_id: String(newest), updated_at: new Date().toISOString() })
        .eq('family_id', room.family_id).eq('channel_id', room.channel_id);
    }
  }
  return { rooms: rooms.length, pulled };
}

// ───────── ② 확인했어요 → 디스코드에 표시 ─────────
async function ack() {
  const { data: rows } = await admin.from('family_items')
    .select('family_id,id,data').eq('kind', 'posts').eq('deleted', false).limit(500);
  const todo = (rows ?? []).filter(r => {
    const d: any = (r.data as any)?.relay ?? {};
    return d.ackBy && !d.ackedAt && d.msgId && d.channelId;
  });
  if (!todo.length) return { acked: 0 };

  const fams = [...new Set(todo.map(r => r.family_id))];
  const names = new Map<string, string>();
  for (const f of fams) {
    const { data: ms } = await admin.from('family_items').select('id,data').eq('family_id', f).eq('kind', 'members');
    for (const m of ms ?? []) names.set(`${f}|${m.id}`, (m.data as any)?.displayName ?? '가족');
  }

  let acked = 0;
  for (const r of todo) {
    const post: any = r.data;
    const d = post.relay;
    const who = names.get(`${r.family_id}|${d.ackBy}`) ?? '가족';
    const a = await dio(`/channels/${d.channelId}/messages/${d.msgId}/reactions/${CHECK}/@me`, { method: 'PUT' });
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
      .update({
        data: { ...post, relay: { ...d, ackedAt: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      })
      .eq('family_id', r.family_id).eq('kind', 'posts').eq('id', r.id);
    acked++;
  }
  return { acked };
}

// ───────── 입구 ─────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (!PUSH_SECRET || req.headers.get('x-push-secret') !== PUSH_SECRET) return new Response('no', { status: 401 });
  if (!BOT) return Response.json({ ok: false, error: 'no-token' });

  try {
    const got = await pull();
    const sent = await ack();
    return Response.json({ ok: true, ...got, ...sent });
  } catch (e) {
    console.error('discord-relay', e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
