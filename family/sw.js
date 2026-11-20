// 우리집 미니월드 서비스 워커: 앱 화면을 기기에 저장해 두고 오프라인에서도 열리게 한다.
// 가족 데이터는 여기서 다루지 않는다(브라우저 저장소·동기화 서버가 맡음).
const CACHE = 'family-shell-v27';
const PRECACHE = ['./', './index.html', './manifest.webmanifest?v=3', './img/room-1.jpg', './img/room-2.jpg', './img/room-3.jpg', './img/room-4.jpg', './img/house-plan.jpg',
  './img/avatar-dad.png', './img/avatar-mom.png', './img/avatar-kid.png', './img/icon-192.png?v=2', './img/apple-touch-icon.png?v=2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 서버가 보낸 푸시(앱이 꺼져 있어도 옴). 보내는 쪽은 supabase/push/ 참고.
// 아직 서버를 붙이지 않았으면 이 이벤트는 오지 않는다.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: '우리집 미니월드', body: e.data ? e.data.text() : '' }; }
  const title = String(d.title || '우리집 미니월드').slice(0, 80);
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || '').slice(0, 180),
    tag: String(d.tag || 'family'),
    icon: './img/icon-192.png?v=2', badge: './img/icon-192.png?v=2', lang: 'ko',
    data: { url: typeof d.url === 'string' && d.url.startsWith('./') ? d.url : './' },
  }));
});

/*
 * 브라우저가 푸시 구독을 갈아치웠을 때.
 *
 * 아이폰은 구독을 제 사정으로 자주 바꾼다. 그때마다 서버가 가진 주소는 죽은 주소가 되고,
 * 사람이 앱을 다시 열어야(그때 registerPush 가 돈다) 알림이 되살아났다.
 * 이제 여기서 바로 다시 등록한다 — 앱을 열지 않아도 끊기지 않게.
 *
 * 아래 두 값은 공개 값이다(앱 코드 js/config.js 에도 그대로 있다).
 * 서비스 워커는 ES 모듈을 못 읽어서 여기 적어 둔다. 비밀값은 여기 두지 않는다.
 */
const PUSH_PUBLIC_KEY = 'BH4mGt4tXZ28Fi6ERbA6mVAsv4bifGpXGPx5ykwRKXr-LgngogK8-AYdS3tsJbcV1rhbwG2QhK-p0NeD8ZUXnMY';
const PUSH_SWAP_URL = 'https://awnwytdiweeciilpzhny.supabase.co/functions/v1/send-push';

const b64 = s => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};
const keyOf = (sub, name) => {
  const k = sub.getKey && sub.getKey(name);
  return k ? btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
};

self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription && e.oldSubscription.endpoint;
    if (!old) return;                    // 옛 주소를 모르면 서버가 누구인지 알 길이 없다
    let sub = e.newSubscription;
    if (!sub) {
      try {
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(PUSH_PUBLIC_KEY) });
      } catch { return; }                // 다시 구독하지 못하면 앱을 열 때 등록된다
    }
    try {
      await fetch(PUSH_SWAP_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'swap', old, endpoint: sub.endpoint, p256dh: keyOf(sub, 'p256dh'), auth: keyOf(sub, 'auth') }),
      });
    } catch { /* 다음에 앱을 열 때 등록된다 */ }
  })());
});

// 알림을 누르면 이미 열린 앱 창으로 가고, 없으면 새로 연다.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin) return;                      // 동기화 서버 요청은 건드리지 않는다
  if (req.mode === 'navigate') {                // 화면: 네트워크 우선, 안 되면 저장본
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./', c)); return r; })
      .catch(() => caches.match('./')));
    return;
  }
  // 나머지(JS·CSS·그림·폰트): 저장본을 먼저 보여 주고 뒤에서 새로 받아 둔다
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
