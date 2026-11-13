// 가족 자동 동기화.
// 앱 상태(S)를 '종류:id' 단위 항목으로 쪼개 Supabase 의 family_items 한 줄씩 저장한다.
//  - 바뀐 항목만 올린다(마지막으로 맞춘 내용과 비교).
//  - 지운 항목은 deleted=true 로 올려 다른 기기에서도 지운다.
//  - 다른 기기의 변경은 실시간(Realtime)으로 받아 바로 반영한다.
//  - 오프라인이면 올리지 못한 변경을 남겨 두었다가 다시 연결되면 올린다.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=10';
import { clean, ID_OK } from './model.js?v=7';

const COLLECTIONS = ['events', 'issues', 'trips', 'tripComments', 'boardItems', 'places', 'recurrenceRules', 'sources', 'posts', 'guestbook', 'members', 'activity'];
const SYNCED_KEY = 'family-home:synced';
const PULL_KEY = 'family-home:pulledAt';
const FAMILY_KEY = 'family-home:family';
const isDemo = x => x && x.sourceId === 'src_demo';

export const syncConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);

function readJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간 부족 등 */ } }

/** 상태 → { 'kind:id': {kind,id,data} } (예시 데이터·기기 전용 값 제외) */
function snapshot(S) {
  const out = {};
  for (const kind of COLLECTIONS) {
    for (const x of S[kind] || []) {
      if (!x || !x.id || isDemo(x)) continue;
      let data = x;
      if (kind === 'members') data = { ...x, status: x.status && x.status.demo ? null : x.status };
      if (kind === 'sources' && (x.kind === 'demo')) continue;
      out[`${kind}:${x.id}`] = { kind, id: x.id, data };
    }
  }
  out['family:main'] = { kind: 'family', id: 'main', data: { lobbyRoom: S.family.lobbyRoom, name: S.family.name } };
  out['sync:apple'] = { kind: 'sync', id: 'apple', data: S.sync.apple };
  return out;
}

export function createSync({ getState, onRemote, onStatus }) {
  let sb = null, user = null, family = null, membership = null, channel = null;
  let synced = readJSON(SYNCED_KEY, {});     // 'kind:id' → JSON 문자열(마지막으로 서버와 맞춘 내용)
  let pushTimer = null, pushing = false, again = false;
  const st = { state: syncConfigured() ? 'signed-out' : 'off', lastSyncAt: null, pending: 0, error: null, realtime: false };
  const emit = () => onStatus?.({ ...st, user: user && { email: user.email }, family, membership });

  async function lib() {
    if (sb) return sb;
    // 동기화 라이브러리는 외부 CDN 이 아니라 앱 안에 넣어 둔 파일(js/vendor)을 쓴다.
    if (!window.supabase) {
      await new Promise((ok, fail) => {
        const el = document.createElement('script');
        el.src = new URL('./vendor/supabase-2.49.4.js', import.meta.url).href;
        el.onload = ok; el.onerror = () => fail(new Error('load'));
        document.head.appendChild(el);
      });
    }
    const { createClient } = window.supabase;
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
    sb.auth.onAuthStateChange((_e, session) => {
      const was = user?.id;
      user = session?.user || null;
      if (user && user.id !== was) connect();
      if (!user && was) { disconnect(); st.state = 'signed-out'; emit(); }
    });
    return sb;
  }

  function dirtyItems() {
    const snap = snapshot(getState());
    const rows = [];
    for (const [k, v] of Object.entries(snap)) {
      const j = JSON.stringify(v.data);
      if (synced[k] !== j) rows.push({ key: k, row: { family_id: family.id, kind: v.kind, id: v.id, data: v.data, deleted: false }, j });
    }
    for (const k of Object.keys(synced)) {
      if (!snap[k] && synced[k] !== null) {
        const [kind, ...rest] = k.split(':');
        rows.push({ key: k, row: { family_id: family.id, kind, id: rest.join(':'), data: null, deleted: true }, j: null });
      }
    }
    return rows;
  }

  async function push() {
    if (!family || !user) return;
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const rows = dirtyItems();
      st.pending = rows.length;
      for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200);
        const { error } = await sb.from('family_items').upsert(part.map(r => r.row), { onConflict: 'family_id,kind,id' });
        if (error) throw error;
        for (const r of part) synced[r.key] = r.j;
        writeJSON(SYNCED_KEY, synced);
      }
      st.pending = 0; st.error = null; st.lastSyncAt = new Date().toISOString();
      if (st.state !== 'connected') st.state = 'connected';
    } catch (e) {
      st.error = navigator.onLine ? '서버에 저장하지 못했어요. 잠시 뒤 다시 시도해요.' : '오프라인이에요. 연결되면 자동으로 올려요.';
      st.state = 'error';
      setTimeout(schedule, 15000);
    } finally {
      pushing = false; emit();
      if (again) { again = false; schedule(); }
    }
  }
  function schedule() {
    if (!family) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 700);
    st.pending = Math.max(st.pending, 1); emit();
  }

  /** 서버 행들을 상태에 반영. 이 기기에서 아직 올리지 못한 항목은 덮지 않는다(올라가면 그쪽이 최신). */
  function applyRows(rows, { force = false } = {}) {
    if (!rows.length) return false;
    const S = getState();
    const local = force ? null : snapshot(S);
    let changed = false;
    for (const r of rows) {
      // 서버에서 온 값도 그대로 믿지 않는다: 형식이 맞는 것만 받고, 내용은 clean() 으로 정리한다.
      if (!r || typeof r.kind !== 'string' || typeof r.id !== 'string' || !ID_OK.test(r.id)) continue;
      if (!r.deleted) {
        if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) continue;
        clean(r.data);
        if (COLLECTIONS.includes(r.kind) && r.data.id !== r.id) continue;
      }
      const key = `${r.kind}:${r.id}`;
      if (!force && local) {
        const lj = local[key] ? JSON.stringify(local[key].data) : null;
        const dirty = synced[key] !== undefined ? lj !== synced[key] : false;
        if (dirty) continue;
      }
      const j = r.deleted ? null : JSON.stringify(r.data);
      synced[key] = j;
      if (r.kind === 'family') { if (r.data) { S.family.lobbyRoom = r.data.lobbyRoom || S.family.lobbyRoom; S.family.name = r.data.name || S.family.name; changed = true; } continue; }
      if (r.kind === 'sync') { if (r.data) { S.sync.apple = { ...S.sync.apple, ...r.data }; changed = true; } continue; }
      if (!COLLECTIONS.includes(r.kind)) continue;
      S[r.kind] ||= [];
      const i = S[r.kind].findIndex(x => x.id === r.id);
      if (r.deleted) { if (i >= 0) { S[r.kind].splice(i, 1); changed = true; } }
      else if (i >= 0) { S[r.kind][i] = r.data; changed = true; }
      else { S[r.kind].push(r.data); changed = true; }
    }
    writeJSON(SYNCED_KEY, synced);
    return changed;
  }

  async function pull({ full = false } = {}) {
    const since = full ? null : localStorage.getItem(PULL_KEY);
    let q = sb.from('family_items').select('kind,id,data,deleted,updated_at').eq('family_id', family.id).order('updated_at', { ascending: true }).limit(5000);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    if (data.length) localStorage.setItem(PULL_KEY, data.at(-1).updated_at);
    return data;
  }

  async function connect() {
    try {
      st.state = 'connecting'; emit();
      const { data: mem, error } = await sb.from('family_members').select('family_id,member_id,families(id,name,created_by)').eq('user_id', user.id).limit(1);
      if (error) throw error;
      if (!mem.length) { family = null; membership = null; st.state = 'no-family'; emit(); return; }
      membership = { member_id: mem[0].member_id, isAdmin: mem[0].families.created_by === user.id };
      family = mem[0].families;
      const saved = readJSON(FAMILY_KEY, null);
      const first = !saved || saved.id !== family.id;
      if (first) { synced = {}; localStorage.removeItem(PULL_KEY); writeJSON(FAMILY_KEY, { id: family.id }); }
      const rows = await pull({ full: first });
      // 처음 연결하는 기기: 서버에 있는 항목은 서버 쪽을 따르고, 이 기기에만 있는 항목은 올린다.
      const changed = applyRows(rows, { force: first });
      if (changed) onRemote?.({ first });
      st.state = 'connected'; st.lastSyncAt = new Date().toISOString(); emit();
      subscribe();
      await push();
    } catch (e) {
      st.state = 'error'; st.error = '가족 데이터를 불러오지 못했어요.'; emit();
    }
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel(`family-${family.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'family_items', filter: `family_id=eq.${family.id}` }, payload => {
        const r = payload.new;
        if (!r || !r.kind) return;
        if (applyRows([r])) onRemote?.({ first: false });
        localStorage.setItem(PULL_KEY, r.updated_at);
        st.lastSyncAt = new Date().toISOString(); emit();
      })
      .subscribe(status => { st.realtime = status === 'SUBSCRIBED'; emit(); if (status === 'SUBSCRIBED') catchUp(); });
  }
  async function catchUp() {
    if (!family) return;
    try { const rows = await pull(); if (applyRows(rows)) onRemote?.({ first: false }); } catch { /* 다음 기회에 */ }
  }
  function disconnect() {
    if (channel && sb) sb.removeChannel(channel);
    channel = null; family = null; membership = null;
  }

  window.addEventListener('online', () => { if (family) { catchUp(); schedule(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && family) catchUp(); });

  return {
    status: () => ({ ...st, user: user && { email: user.email }, family, membership }),
    async start() {
      if (!syncConfigured()) { emit(); return; }
      try {
        await lib();
        const { data } = await sb.auth.getSession();
        user = data.session?.user || null;
        if (user) await connect(); else { st.state = 'signed-out'; emit(); }
      } catch { st.state = 'error'; st.error = '동기화 도구를 불러오지 못했어요(인터넷 연결 확인).'; emit(); }
    },
    changed() { if (family) schedule(); },
    async signIn(email, password) {
      await lib();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      await lib();
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      return { needsConfirm: !data.session };
    },
    async sendLink(email) {
      await lib();
      const redirect = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      if (error) throw error;
    },
    async createFamily(name, memberId) {
      const { error } = await sb.rpc('create_family', { p_name: name, p_member_id: memberId });
      if (error) throw error;
      await connect();
    },
    async joinFamily(code, memberId) {
      const { error } = await sb.rpc('join_family', { p_code: code, p_member_id: memberId });
      if (error) throw error;
      await connect();
    },
    async listAccounts() {
      if (!family) return [];
      const { data, error } = await sb.from('family_members').select('user_id,member_id,email,joined_at').eq('family_id', family.id).order('joined_at');
      if (error) throw error;
      return data.map(x => ({ ...x, me: x.user_id === user.id, admin: x.user_id === family.created_by }));
    },
    async rotateInvite() {
      const { data, error } = await sb.rpc('rotate_invite_code');
      if (error) throw error;
      family = { ...family, invite_code: data }; emit();
      return data;
    },
    async removeAccount(uid) {
      const { error } = await sb.rpc('remove_family_member', { p_user: uid });
      if (error) throw error;
    },
    async renameFamily(name) {
      const { error } = await sb.rpc('rename_family', { p_name: name });
      if (error) throw error;
      family = { ...family, name }; emit();
    },
    async syncNow() { if (family) { await catchUp(); await push(); } },
    async signOut() {
      disconnect();
      await sb?.auth.signOut();
      synced = {}; localStorage.removeItem(SYNCED_KEY); localStorage.removeItem(PULL_KEY); localStorage.removeItem(FAMILY_KEY);
      user = null; st.state = 'signed-out'; emit();
    },
  };
}
