// 알림 — 다가오는 일정 미리알림과, 가족이 뭔가 올렸을 때 알려 주기.
//
// 브라우저 알림 권한만 쓰고 서버는 쓰지 않는다. 그래서 알림은 앱이 열려 있거나
// 방금까지 열려 있던 동안에만 뜬다. 앱을 완전히 닫아도 오게 하려면 웹 푸시가
// 필요하고, 그건 supabase/push/ 에 준비해 두었다.
//
// 휴대폰에서는 new Notification(...) 이 막혀 있어서 서비스 워커로 띄워야 한다.
// 같은 알림을 두 번 띄우지 않도록 보낸 기록을 이 기기에 남긴다.

const SEEN_KEY = 'family-home:notified';
const MAX_SEEN = 400;

export const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export const granted = () => permission() === 'granted';

/** 권한을 묻는다. 사용자가 버튼을 눌렀을 때만 불러야 한다(브라우저 규칙). */
export async function ask() {
  if (!supported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { seen = new Set(); }
function remember(key) {
  seen.add(key);
  if (seen.size > MAX_SEEN) seen = new Set([...seen].slice(-MAX_SEEN));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* 저장 못 해도 알림은 떴다 */ }
}
export const alreadySent = key => seen.has(key);

/**
 * 알림 하나를 띄운다. key 를 주면 그 key 로 한 번만 뜬다.
 * 제목·내용은 그대로 글자로만 쓰이므로 HTML 이 실행될 일은 없다.
 */
export async function show(title, body, { key, tag, silent = false } = {}) {
  if (!granted()) return false;
  if (key && seen.has(key)) return false;
  const opts = {
    body: String(body || '').slice(0, 180),
    tag: tag || key || 'family',
    icon: './img/icon-192.png',
    badge: './img/icon-192.png',
    lang: 'ko',
    silent,
    renotify: false,
    data: { url: location.pathname + location.search },
  };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.showNotification) await reg.showNotification(String(title).slice(0, 80), opts);
    else new Notification(String(title).slice(0, 80), opts);
    if (key) remember(key);
    return true;
  } catch {
    return false;
  }
}

/** 설정 화면에서 "지금 보내 보기" 용 */
export async function test() {
  const ok = await show('🔔 알림이 켜졌어요', '다가오는 일정과 가족이 올린 소식을 여기로 알려 드릴게요.', { tag: 'test' });
  return ok;
}
