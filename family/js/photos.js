// 사진 보관소.
//
// 일정·글·소식 같은 기록은 모두 브라우저 저장칸 하나(localStorage, 약 5MB)에 함께 들어간다.
// 2026-11-15 에 재 보니 사진 두 장이 전체 데이터의 91% 였다. 사진 한 장이 나머지 기록 전부보다
// 크다는 뜻이다. 그래서 사진을 거기 같이 두면 수십 장에서 저장이 막히고, 한 해를 못 품는다.
//
// 그래서 사진만 따로 둔다.
//   · 이 기기 — IndexedDB. localStorage 와 달리 수백 MB를 담는다. 비워져도 서버에서 다시 받는다.
//   · 서버   — family_photos 표. 여기가 진짜다. 기기는 볼 때만 읽어 간다.
// 글에는 사진 대신 photoId 한 줄만 남는다.

const DB = 'family-photos';
const STORE = 'p';
const QUEUE_KEY = 'family-home:photoQueue';   // 아직 서버에 못 올린 사진
const CAP = 400;                              // 이 기기에 둘 최대 장수(넘으면 오래된 것부터 버린다)

/** 이번 화면에서 이미 꺼낸 사진. IndexedDB 를 못 쓰는 브라우저에서는 여기만 쓴다. */
const mem = new Map();
let fetcher = null;   // 서버에서 한 장 읽어 오는 함수(동기화 모듈이 꽂아 준다)

export function setFetcher(fn) { fetcher = fn; }

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((ok, fail) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { fail(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at');
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('blocked'));
  });
  dbp.catch(() => { dbp = null; });   // 실패하면 다음에 다시 열어 본다
  return dbp;
}

/** 한 번의 트랜잭션. 실패해도 앱은 돌아가야 하므로 호출한 쪽에서 삼킨다. */
function tx(mode, fn) {
  return open().then(d => new Promise((ok, fail) => {
    const t = d.transaction(STORE, mode);
    let out;
    try { out = fn(t.objectStore(STORE)); } catch (e) { fail(e); return; }
    t.oncomplete = () => ok(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  }));
}

/** 이 기기에 둔 장수가 너무 많으면 오래된 것부터 버린다. 서버에는 그대로 있다. */
async function trim() {
  try {
    const n = await tx('readonly', s => s.count());
    if (n <= CAP) return;
    let left = n - CAP;
    await tx('readwrite', s => {
      const cur = s.index('at').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || left <= 0) return;
        c.delete(); left--; c.continue();
      };
    });
  } catch { /* 못 비워도 괜찮다 */ }
}

/** 이 기기에 사진 한 장을 둔다. */
export async function keep(id, src) {
  mem.set(id, src);
  try {
    await tx('readwrite', s => s.put({ id, src, at: Date.now() }));
    trim();
    return true;
  } catch { return false; }   // 개인정보 보호 모드 등 — 이번 화면에서는 mem 으로 버틴다
}

/** 이미 꺼내 둔 것만 바로 돌려준다. 화면을 그릴 때 깜빡임을 줄이려고 쓴다. */
export const peek = id => (id && mem.get(id)) || null;

/** 이 기기에 있는 것만 꺼낸다(서버에 묻지 않는다). 올릴 때 쓴다. */
export async function local(id) {
  if (mem.has(id)) return mem.get(id);
  try {
    const rec = await tx('readonly', s => s.get(id));
    if (rec && rec.src) { mem.set(id, rec.src); return rec.src; }
  } catch { /* 없으면 없는 것 */ }
  return null;
}

/** 사진 한 장을 꺼낸다. 이 기기 → 서버 순서로 찾는다. 없으면 null. */
export async function get(id) {
  if (!id) return null;
  if (mem.has(id)) return mem.get(id);
  try {
    const rec = await tx('readonly', s => s.get(id));
    if (rec && rec.src) { mem.set(id, rec.src); return rec.src; }
  } catch { /* 아래에서 서버로 */ }
  if (fetcher) {
    try {
      const src = await fetcher(id);
      if (src) { keep(id, src); return src; }
    } catch { /* 연결이 없으면 지금은 못 본다 */ }
  }
  return null;
}

/** 이 기기에서만 지운다(서버는 그대로). */
export async function forget(id) {
  mem.delete(id);
  try { await tx('readwrite', s => s.delete(id)); } catch { /* 괜찮다 */ }
}

// ───────── 아직 못 올린 사진 ─────────
// 비행기 모드에서 찍어 넣을 수도 있다. 올릴 때까지 목록에 남겨 둔다.

const readQueue = () => {
  try { const v = JSON.parse(localStorage.getItem(QUEUE_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeQueue = v => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(v.slice(-200))); } catch { /* 저장칸이 가득 */ } };

export const pending = () => readQueue();
export function markPending(id) {
  const q = readQueue();
  if (!q.includes(id)) { q.push(id); writeQueue(q); }
}
export function markSent(id) {
  const q = readQueue().filter(x => x !== id);
  writeQueue(q);
}
