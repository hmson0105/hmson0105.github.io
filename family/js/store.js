// 저장소 어댑터.
// 지금은 이 브라우저의 localStorage 에만 저장한다. 공개 저장소(GitHub Pages)에는
// 가족 데이터가 올라가지 않는다. 나중에 가족 계정·초대 기능을 붙일 때는 같은
// 인터페이스(load/save)를 가진 원격 어댑터(예: 인증이 있는 DB)로 교체하면 된다.

export const KEY = 'family-home:v1';
const PREF = 'family-home:pref:';

export const STORAGE_MODE = {
  id: 'local',
  label: '이 브라우저에만 저장',
  detail: '다른 기기·다른 브라우저와 공유되지 않아요. 브라우저 데이터를 지우면 함께 지워져요.',
};

export function storageAvailable() {
  try {
    const k = PREF + '__t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: null };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.members)) {
      return { data: null, error: '저장된 데이터 형식이 올바르지 않아요.' };
    }
    return { data };
  } catch (e) {
    return { data: null, error: '저장된 데이터를 읽지 못했어요.' };
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return {
      ok: false,
      error: quota ? '저장 공간이 가득 찼어요. 사진을 몇 장 지워 주세요.' : '이 브라우저에서 저장할 수 없어요.',
    };
  }
}

export function loadPref(k) {
  try { return localStorage.getItem(PREF + k); } catch { return null; }
}
export function savePref(k, v) {
  try { localStorage.setItem(PREF + k, v); } catch { /* 선호값은 없어도 동작 */ }
}
