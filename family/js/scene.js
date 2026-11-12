// 층별 미니룸 장면.
// 방·아바타 그림은 Higgsfield 로 만든 이미지를 쓴다. 아직 만들지 못한 그림은
// 같은 등각 구도의 SVG 대체 그림으로 보여 준다. 새 이미지를 img/ 에 넣고
// 아래 ASSETS 에 경로만 적으면 바로 바뀐다.

export const ASSETS = {
  rooms: {
    1: 'img/room-1.jpg',   // 가족 로비 (Higgsfield · Nano Banana 2)
    2: 'img/room-2.jpg',   // 딸 어린이집 (Higgsfield · Z Image)
    3: 'img/room-3.jpg',   // 엄마 방 (Higgsfield · Z Image)
    // 4: 'img/room-4.jpg', // 아빠 대학원  ← 생성 후 추가
  },
  avatars: {
    mom: 'img/avatar-mom.png', // Higgsfield · Nano Banana 2, 배경 제거
    kid: 'img/avatar-kid.png',
    dad: 'img/avatar-dad.png', // Higgsfield · Z Image, 배경 제거
  },
};

/** 아바타 발 위치(무대 %, 발끝 기준)와 키(무대 높이 %) */
export const SPOTS = {
  lobby: { m_dad: [39, 78], m_mom: [64, 71], m_kid: [54, 89] },
  single: [50, 80],
};
export const HEIGHTS = { lobby: { adult: 31, kid: 24 }, single: { adult: 46, kid: 38 } };

// ───────────────────────── SVG 대체 방 ─────────────────────────
const TW = 100, TH = 50, N = 7, WH = 230, OX = 600, OY = 300;
const iso = (x, y, z = 0) => [OX + (x - y) * TW / 2, OY + (x + y) * TH / 2 - z];
const P = (...pts) => pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
function box(x, y, w, d, h, col, z = 0) {
  const top = P(iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h));
  const left = P(iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h));
  const right = P(iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h));
  return `<polygon points="${left}" fill="${shade(col, -0.1)}"/><polygon points="${right}" fill="${shade(col, -0.22)}"/><polygon points="${top}" fill="${shade(col, 0.15)}"/>`;
}
const planeX = c => `matrix(${-TW / 2},${TH / 2},0,-1,${OX + c * TW / 2},${OY + c * TH / 2})`;
const planeY = c => `matrix(${TW / 2},${TH / 2},0,-1,${OX - c * TW / 2},${OY + c * TH / 2})`;
const onWall = (m, u, v, body) => `<g transform="${m} translate(${u},${v}) scale(${2 / TW},-1)">${body}</g>`;
const onFloor = body => `<g transform="matrix(${TW / 2},${TH / 2},${-TW / 2},${TH / 2},${OX},${OY})">${body}</g>`;
const ball = (x, y, z, r, fill) => { const [px, py] = iso(x, y, z); return `<circle cx="${px}" cy="${py}" r="${r}" fill="${fill}"/>`; };

const WALL_PATTERNS = {
  pinkDots: `<pattern id="wp" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#FFE1EC"/><circle cx="7" cy="7" r="3.5" fill="#FFF5F9"/><circle cx="20" cy="20" r="3.5" fill="#FFF5F9"/></pattern>`,
  lavStripes: `<pattern id="wp" width="22" height="10" patternUnits="userSpaceOnUse"><rect width="22" height="10" fill="#EADFFF"/><rect width="11" height="10" fill="#F6F0FF"/></pattern>`,
  skyClouds: `<pattern id="wp" width="70" height="46" patternUnits="userSpaceOnUse"><rect width="70" height="46" fill="#DDF1FF"/><ellipse cx="20" cy="14" rx="12" ry="6" fill="#fff"/><ellipse cx="28" cy="12" rx="8" ry="6" fill="#fff"/><ellipse cx="55" cy="36" rx="10" ry="5" fill="#fff"/></pattern>`,
  creamHearts: `<pattern id="wp" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="#FFF6E6"/><path d="M15 21 C6 14 9 7 15 11 C21 7 24 14 15 21Z" fill="#FFC9DA"/></pattern>`,
  mintCheck: `<pattern id="wp" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#E1F6EC"/><rect width="12" height="12" fill="#F2FBF6"/><rect x="12" y="12" width="12" height="12" fill="#F2FBF6"/></pattern>`,
};
const FLOOR_PATTERNS = {
  wood: `<pattern id="fp" width="7" height=".5" patternUnits="userSpaceOnUse"><rect width="7" height=".5" fill="#F1D3AE"/><rect y=".46" width="7" height=".04" fill="#E2BA8E"/></pattern>`,
  creamCheck: `<pattern id="fp" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#FFF3DF"/><rect width="1" height="1" fill="#FFE2EC"/><rect x="1" y="1" width="1" height="1" fill="#FFE2EC"/></pattern>`,
};

function windowSVG() {
  return `<rect x="0" y="0" width="120" height="96" rx="14" fill="#fff"/><rect x="9" y="9" width="102" height="78" rx="9" fill="#BFE6FF"/>
  <ellipse cx="40" cy="38" rx="16" ry="8" fill="#fff"/><ellipse cx="52" cy="34" rx="11" ry="9" fill="#fff"/>
  <rect x="58" y="9" width="4" height="78" fill="#fff"/><rect x="9" y="46" width="102" height="4" fill="#fff"/>
  <path d="M0 0 h30 q-8 50 4 96 h-34z" fill="#FFB8CF"/><path d="M120 0 h-30 q8 50 -4 96 h34z" fill="#FFB8CF"/>`;
}
function booksSVG(w, h, rows = 3) {
  const cols = ['#FF9EC4', '#8FD3FF', '#FFD84D', '#B9A2FF', '#9EE3C0', '#FFB38A'];
  let s = '', k = 0;
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = 6;
    while (x < w - 12) {
      const bw = 9 + (k * 7) % 7, bh = rh - 12 - (k * 5) % 9;
      s += `<rect x="${x}" y="${r * rh + rh - 4 - bh}" width="${bw}" height="${bh}" rx="2" fill="${cols[k % cols.length]}"/>`;
      x += bw + 2; k++;
    }
    s += `<rect x="0" y="${r * rh + rh - 4}" width="${w}" height="5" fill="#C99C74"/>`;
  }
  return s;
}
function plant(x, y, big = false) {
  const h = big ? 34 : 24;
  return box(x, y, 0.55, 0.55, h, '#FFC2A8') +
    ball(x + .27, y + .27, h + 26, big ? 30 : 22, '#8FD18F') + ball(x + .05, y + .4, h + 14, big ? 18 : 14, '#7CC47C') + ball(x + .5, y + .1, h + 18, big ? 18 : 14, '#9FDB9F');
}

function propsFor(floor) {
  const back = [], front = [];
  if (floor === 2) {
    back.push(onWall(planeY(0), 2.6, 205, `${['#FF9EC4', '#FFD84D', '#9EE3C0', '#8FD3FF', '#B9A2FF'].map((c, i) => `<path d="M${10 + i * 12} 110 A ${80 - i * 12} ${80 - i * 12} 0 0 1 ${170 - i * 12} 110" stroke="${c}" stroke-width="11" fill="none"/>`).join('')}<ellipse cx="18" cy="110" rx="20" ry="11" fill="#fff"/><ellipse cx="162" cy="110" rx="20" ry="11" fill="#fff"/>`));
    back.push(onWall(planeX(0), 3.4, 195, windowSVG()));
    back.push(onWall(planeY(0), 0.2, 222, `${[...Array(9)].map((_, i) => `<path d="M${i * 30} 6 l15 22 l15 -22z" fill="${['#FF9EC4', '#FFD84D', '#8FD3FF'][i % 3]}"/>`).join('')}<path d="M0 6 Q135 18 270 6" stroke="#C99C74" stroke-width="2" fill="none"/>`));
    front.push([1, onFloor(`<ellipse cx="3.7" cy="3.7" rx="1.7" ry="1.5" fill="#FFD1E0"/><ellipse cx="3.7" cy="3.7" rx="1.3" ry="1.1" fill="#FFE8F0"/>`)]);
    front.push([1.5, box(5.2, 0.08, 1.6, 0.6, 92, '#FFE1EC') + onWall(planeY(0.68), 5.25, 86, `${[0, 1, 2].map(c => [0, 1].map(r => `<rect x="${6 + c * 26}" y="${6 + r * 40}" width="22" height="34" rx="5" fill="#fff"/><circle cx="${17 + c * 26}" cy="${28 + r * 40}" r="7" fill="${['#FFD84D', '#8FD3FF', '#FF9EC4'][(c + r) % 3]}"/>`).join('')).join('')}`)]);
    front.push([3, box(0.55, 2.0, 0.12, 1.3, 105, '#FFFFFF', 28) + onWall(planeX(0.67), 2.08, 128, `<rect width="58" height="96" rx="4" fill="#fff"/><circle cx="40" cy="20" r="10" fill="#FFD84D"/><path d="M12 80 v-26 l18 -14 l18 14 v26z" fill="#FF9EC4"/><rect x="24" y="62" width="10" height="18" fill="#8FD3FF"/>`) + box(0.62, 2.1, 0.08, 0.08, 30, '#C99C74') + box(0.62, 3.2, 0.08, 0.08, 30, '#C99C74')]);
    front.push([6, box(3.4, 3.0, 1.1, 1.1, 34, '#FFD59E')]);
    front.push([8, box(1.0, 5.2, 0.5, 0.5, 26, '#FFD84D') + box(1.55, 5.2, 0.5, 0.5, 26, '#8FD3FF') + box(1.25, 5.25, 0.45, 0.45, 24, '#FF9EC4', 26)]);
    front.push([9.5, ball(5.4, 4.6, 26, 26, '#D9A47A') + ball(5.4, 4.6, 64, 21, '#E3B48C') + ball(5.25, 4.5, 84, 8, '#D9A47A') + ball(5.55, 4.7, 84, 8, '#D9A47A') + ball(5.45, 4.65, 30, 10, '#F3D2B5')]);
    front.push([12, plant(6.2, 5.9, true)]);
  } else if (floor === 3) {
    back.push(onWall(planeX(0), 3.6, 195, windowSVG()));
    back.push(onWall(planeY(0), 0.9, 200, `<rect width="130" height="86" rx="10" fill="#E6B887"/><rect x="7" y="7" width="116" height="72" rx="6" fill="#F1CDA0"/>${[[16, 14, '#FFD84D'], [52, 20, '#FF9EC4'], [88, 12, '#8FD3FF'], [26, 46, '#B9A2FF'], [70, 48, '#9EE3C0']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="26" height="24" rx="3" fill="${c}"/><circle cx="${x + 13}" cy="${y + 3}" r="3" fill="#E5484D"/>`).join('')}`));
    back.push(onWall(planeY(0), 5.7, 205, `<circle cx="22" cy="22" r="22" fill="#fff"/><circle cx="22" cy="22" r="17" fill="#FFF3F8"/><path d="M22 22 V10 M22 22 L31 26" stroke="#4A3546" stroke-width="3" stroke-linecap="round"/>`));
    front.push([1, onFloor(`<ellipse cx="3.6" cy="3.4" rx="1.6" ry="1.4" fill="#E2D5FF"/><ellipse cx="3.6" cy="3.4" rx="1.2" ry="1" fill="#F1EBFF"/>`)]);
    front.push([2, box(2.3, 0.15, 2.3, 1.05, 70, '#FFF1DE') + box(3.0, 0.4, 0.9, 0.6, 4, '#D9CCFF', 70) + box(3.0, 0.32, 0.9, 0.08, 48, '#CBB8FF', 74) + onWall(planeY(0.4), 3.06, 118, `<rect width="70" height="38" rx="4" fill="#F3EEFF"/><path d="M28 22 c-6 -5 -3 -11 2 -8 c5 -3 8 3 2 8z" fill="#FF9EC4"/>`) + box(4.1, 0.6, 0.22, 0.22, 16, '#FF9EC4', 70)]);
    front.push([3, box(0.05, 4.0, 0.6, 1.9, 150, '#F4D9C2') + onWall(planeX(0.65), 4.05, 146, booksSVG(90, 140))]);
    front.push([4, box(5.4, 0.1, 1.0, 0.8, 62, '#FFE7EF') + box(5.6, 0.2, 0.5, 0.5, 40, '#FF9EC4', 62)]);
    front.push([9, plant(6.1, 1.6, true)]);
    front.push([10, plant(0.3, 6.2)]);
  } else {
    back.push(onWall(planeX(0), 3.8, 195, windowSVG()));
    back.push(onWall(planeY(0), 0.7, 210, `<rect width="170" height="100" rx="8" fill="#C99C74"/><rect x="8" y="8" width="154" height="84" rx="4" fill="#3F6E5A"/><path d="M22 70 l18 -26 l18 16 l22 -30" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/><path d="M110 30 l4 9 l10 1 l-7 7 l2 10 l-9 -5 l-9 5 l2 -10 l-7 -7 l10 -1z" fill="#FFD84D"/><circle cx="140" cy="66" r="8" stroke="#BFE6FF" stroke-width="3" fill="none"/>`));
    back.push(onWall(planeY(0), 5.8, 205, `<circle cx="22" cy="22" r="22" fill="#fff"/><circle cx="22" cy="22" r="17" fill="#EFFBF6"/><path d="M22 22 V10 M22 22 L31 26" stroke="#4A3546" stroke-width="3" stroke-linecap="round"/>`));
    front.push([1, onFloor(`<ellipse cx="3.6" cy="3.5" rx="1.6" ry="1.4" fill="#CFEAFF"/><ellipse cx="3.6" cy="3.5" rx="1.2" ry="1" fill="#E8F5FF"/>`)]);
    front.push([2, box(2.5, 0.15, 2.4, 1.05, 70, '#F2DFC6') + box(3.4, 0.45, 0.25, 0.25, 14, '#9BA3B8', 70) + box(3.1, 0.35, 0.95, 0.1, 58, '#7D86A3', 84) + onWall(planeY(0.45), 3.15, 138, `<rect width="80" height="48" rx="4" fill="#BFE6FF"/><rect x="8" y="10" width="40" height="5" rx="2" fill="#fff"/><rect x="8" y="21" width="56" height="5" rx="2" fill="#fff"/><rect x="8" y="32" width="30" height="5" rx="2" fill="#fff"/>`) + box(4.5, 0.35, 0.12, 0.12, 50, '#FFD84D', 70) + ball(4.56, 0.41, 124, 13, '#FFE89A')]);
    front.push([3, box(0.05, 3.5, 0.6, 2.5, 185, '#E7C9A8') + onWall(planeX(0.65), 3.55, 180, booksSVG(120, 174, 4))]);
    front.push([4, box(5.8, 1.5, 0.5, 0.5, 34, '#E7C9A8') + ball(6.05, 1.75, 72, 30, '#8FD3FF') + ball(5.95, 1.7, 80, 10, '#9EE3C0') + ball(6.15, 1.85, 64, 8, '#9EE3C0')]);
    front.push([8, box(5.5, 4.5, 0.7, 0.55, 22, '#FFFFFF') + box(5.55, 4.5, 0.65, 0.5, 18, '#FFF7E8', 22) + box(6.3, 4.8, 0.6, 0.5, 30, '#FFFFFF')]);
    front.push([10, plant(0.4, 6.2, true)]);
  }
  front.sort((a, b) => a[0] - b[0]);
  return back.join('') + front.map(f => f[1]).join('');
}

export function fallbackRoomSVG(floor, backdrop) {
  const floorPat = floor === 2 ? 'creamCheck' : 'wood';
  const wall = `<rect width="${N * TW / 2}" height="${WH}" fill="url(#wp)"/><rect y="${WH - 18}" width="${N * TW / 2}" height="18" fill="#FFFFFF" opacity=".7"/>`;
  return `<svg class="room-svg" viewBox="0 0 1200 900" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${floor}층 방 그림(대체 그림)">
  <defs>${WALL_PATTERNS[backdrop] || WALL_PATTERNS.pinkDots}${FLOOR_PATTERNS[floorPat]}</defs>
  <ellipse cx="600" cy="735" rx="420" ry="70" fill="#E9CBD2" opacity=".55"/>
  ${box(-0.3, -0.3, N + 0.3, N + 0.3, 40, '#EBCFB4', -40)}
  ${onFloor(`<rect width="${N}" height="${N}" fill="url(#fp)"/>`)}
  ${box(-0.3, -0.3, 0.3, N + 0.3, WH, '#F2DCC4')}
  ${box(-0.3, -0.3, N + 0.3, 0.3, WH, '#F2DCC4')}
  ${onWall(planeX(0), 0, WH, wall)}
  ${onWall(planeY(0), 0, WH, wall)}
  ${propsFor(floor)}
</svg>`;
}

// ───────────────────────── 아빠 SVG 아바타(대체) ─────────────────────────
export function dadSVG() {
  return `<svg class="av-svg" viewBox="0 0 260 440" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="dSkin" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#FFE6D6"/><stop offset="1" stop-color="#F6CDB4"/></radialGradient>
    <linearGradient id="dShirt" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#C9E6FB"/><stop offset="1" stop-color="#9ACDF0"/></linearGradient>
  </defs>
  <rect x="88" y="330" width="34" height="78" rx="14" fill="#3E4A6B"/><rect x="138" y="330" width="34" height="78" rx="14" fill="#36415F"/>
  <ellipse cx="103" cy="412" rx="26" ry="14" fill="#8A5A3C"/><ellipse cx="157" cy="412" rx="26" ry="14" fill="#7C5034"/>
  <path d="M70 252 Q72 212 130 208 Q188 212 190 252 L196 342 Q130 356 64 342 Z" fill="url(#dShirt)"/>
  <path d="M112 212 L130 236 L148 212" fill="#fff"/>
  <ellipse cx="62" cy="290" rx="18" ry="44" fill="#A9D5F3" transform="rotate(10 62 290)"/><ellipse cx="198" cy="290" rx="18" ry="44" fill="#93C8EE" transform="rotate(-10 198 290)"/>
  <circle cx="58" cy="334" r="15" fill="url(#dSkin)"/><circle cx="202" cy="334" r="15" fill="url(#dSkin)"/>
  <circle cx="130" cy="130" r="92" fill="url(#dSkin)"/>
  <circle cx="40" cy="138" r="16" fill="#F6CDB4"/><circle cx="220" cy="138" r="16" fill="#F6CDB4"/>
  <path d="M40 126 Q30 34 130 32 Q232 34 220 126 Q206 84 168 78 Q150 96 112 90 Q72 88 56 116 Z" fill="#3B2A26"/>
  <path d="M96 52 Q130 30 170 54" stroke="#5A4038" stroke-width="6" fill="none" stroke-linecap="round" opacity=".6"/>
  <ellipse cx="96" cy="140" rx="10" ry="13" fill="#2E2226"/><ellipse cx="164" cy="140" rx="10" ry="13" fill="#2E2226"/>
  <circle cx="99" cy="135" r="3.5" fill="#fff"/><circle cx="167" cy="135" r="3.5" fill="#fff"/>
  <circle cx="96" cy="140" r="27" fill="none" stroke="#5C4A52" stroke-width="5"/><circle cx="164" cy="140" r="27" fill="none" stroke="#5C4A52" stroke-width="5"/>
  <path d="M123 138 Q130 132 137 138" stroke="#5C4A52" stroke-width="5" fill="none"/>
  <ellipse cx="74" cy="176" rx="15" ry="9" fill="#FFAFC2" opacity=".75"/><ellipse cx="186" cy="176" rx="15" ry="9" fill="#FFAFC2" opacity=".75"/>
  <path d="M116 182 Q130 196 144 182" stroke="#8A4A4A" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`;
}

export function avatarFigure(member) {
  const src = ASSETS.avatars[member.avatar];
  return src ? `<img src="${src}" alt="" draggable="false">` : dadSVG();
}
export const hasImage = member => !!ASSETS.avatars[member.avatar];
