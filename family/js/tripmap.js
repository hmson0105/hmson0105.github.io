// 여행 동선 지도 — 계획표 항목에 적힌 좌표를 날짜별로 이어서 지도에 그린다.
//
// 지도 라이브러리(Leaflet 1.9.4)는 외부 CDN 이 아니라 앱 안 js/vendor 에 넣어 둔 파일을 쓴다.
// 바탕 지도 그림(타일)만 OpenStreetMap 타일 서버에서 받는다. CSP 의 img-src 에 그 주소 하나만 열어 두었다.
// 타일 주소에는 지도 칸 번호만 들어가고, 장소 이름이나 일정 글은 밖으로 나가지 않는다.
// OSM 타일 사용 규칙은 Referer 를 요구하므로, 타일에만 사이트 주소(origin)를 보낸다(경로·# 뒤는 안 보냄).
// CARTO 는 2026년 현재 API 키 없이는 'API KEY REQUIRED' 그림만 돌려줘서 쓰지 않는다.

const DAY_COLORS = ['#F06292', '#42A5F5', '#FFA726', '#66BB6A', '#AB47BC', '#EF5350', '#26A69A'];
export const dayColor = k => DAY_COLORS[((k % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];

export const hasPoint = p => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/** '35.1709, 136.8815' 같은 글을 좌표로. 구글 지도에서 복사한 좌표·주소(@35.1,136.8)도 받는다. */
export function parseLatLng(s) {
  const m = String(s || '').match(/(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const p = { lat: +m[1], lng: +m[2] };
  return hasPoint(p) ? p : null;
}
export const fmtLatLng = p => (hasPoint(p) ? `${(+p.lat).toFixed(5)}, ${(+p.lng).toFixed(5)}` : '');

const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
/** 연달아 같은 곳(호텔에 들렀다 다시 나가는 등)은 한 번만 센다. */
export function dedupe(points) {
  return points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
}

/**
 * 구글 지도 길찾기 주소. 좌표만 담는다(장소 이름·메모는 넣지 않는다).
 * 구글은 출발·도착 사이 경유지를 9곳까지만 받으므로, 길면 여러 개로 나눠 이어 붙인다.
 */
export function directionsURLs(points) {
  const pts = dedupe(points.filter(hasPoint));
  const c = p => `${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;
  if (pts.length === 0) return [];
  if (pts.length === 1) return [`https://www.google.com/maps/search/?api=1&query=${c(pts[0])}`];
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 10) {
    const seg = pts.slice(i, i + 11);
    const u = new URL('https://www.google.com/maps/dir/');
    u.searchParams.set('api', '1');
    u.searchParams.set('origin', c(seg[0]));
    u.searchParams.set('destination', c(seg.at(-1)));
    if (seg.length > 2) u.searchParams.set('waypoints', seg.slice(1, -1).map(c).join('|'));
    out.push(u.href);
  }
  return out;
}

let libP = null;
function lib() {
  if (window.L) return Promise.resolve(window.L);
  libP ||= new Promise((ok, fail) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('./vendor/leaflet-1.9.4.css', import.meta.url).href;
    document.head.appendChild(css);
    const el = document.createElement('script');
    el.src = new URL('./vendor/leaflet-1.9.4.js', import.meta.url).href;
    el.onload = () => ok(window.L);
    el.onerror = () => { libP = null; fail(new Error('load')); };
    document.head.appendChild(el);
  });
  return libP;
}

// 화면은 15초마다 다시 그려진다. 그때마다 지도를 새로 만들면 확대·이동한 상태가 풀리므로,
// 같은 내용이면 만들어 둔 지도 칸을 새 자리로 옮겨 끼운다.
const st = { map: null, el: null, key: '' };

/**
 * slot 자리에 지도를 그린다.
 * routes: [{ color, points: [{ lat, lng, n, label }] , numbered }]
 * label 은 이미 esc() 를 거친 글이어야 한다(말풍선에 HTML 로 들어간다).
 */
export async function mountTripMap(slot, routes, key) {
  if (!slot) return;
  if (st.el && st.key === key) {
    slot.replaceWith(st.el);
    st.map.invalidateSize();
    return;
  }
  let L;
  try { L = await lib(); } catch { slot.innerHTML = '<p class="map-fail">지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>'; return; }
  if (!slot.isConnected) return;
  if (st.map) { st.map.remove(); st.map = null; st.el = null; }
  const el = document.createElement('div');
  el.className = 'trip-map';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '여행 동선 지도');
  slot.replaceWith(el);
  const map = L.map(el, { scrollWheelZoom: false, tap: true, zoomSnap: 0.5 });
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors', referrerPolicy: 'strict-origin',
  }).addTo(map);
  const all = [];
  for (const r of routes) {
    const pts = r.points.filter(hasPoint);
    if (!pts.length) continue;
    const line = dedupe(pts).map(p => [p.lat, p.lng]);
    if (line.length > 1) L.polyline(line, { color: r.color, weight: 4, opacity: 0.85, dashArray: r.numbered ? null : '6 6' }).addTo(map);
    for (const p of pts) {
      const html = r.numbered ? `<span style="background:${r.color}">${p.n}</span>` : `<span class="dot" style="background:${r.color}"></span>`;
      const size = r.numbered ? 26 : 12;
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'tm-pin', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        keyboard: false,
      }).bindTooltip(p.label, { direction: 'top', offset: [0, -size / 2] }).addTo(map);
      all.push([p.lat, p.lng]);
    }
  }
  if (all.length === 1) map.setView(all[0], 15);
  else if (all.length) map.fitBounds(all, { padding: [28, 28], maxZoom: 16 });
  else map.setView([35.0, 136.0], 6);
  st.map = map; st.el = el; st.key = key;
}

/** 지도가 화면에서 빠질 때(다른 여행·다른 화면) 정리한다. */
export function dropTripMap() {
  if (st.map) st.map.remove();
  st.map = null; st.el = null; st.key = '';
}
