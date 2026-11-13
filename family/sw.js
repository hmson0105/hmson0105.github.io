// 우리집 미니월드 서비스 워커: 앱 화면을 기기에 저장해 두고 오프라인에서도 열리게 한다.
// 가족 데이터는 여기서 다루지 않는다(브라우저 저장소·동기화 서버가 맡음).
const CACHE = 'family-shell-v6';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './img/room-1.jpg', './img/room-2.jpg', './img/room-3.jpg', './img/room-4.jpg', './img/house-plan.jpg',
  './img/avatar-dad.png', './img/avatar-mom.png', './img/avatar-kid.png', './img/icon-192.png', './img/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
