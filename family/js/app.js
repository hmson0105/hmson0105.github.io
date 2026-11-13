// 우리집 미니월드 — 가족 캘린더 + 층별 미니룸
import * as D from './dates.js?v=6';
import * as M from './model.js?v=7';
import { load, save, loadPref, savePref, storageAvailable, STORAGE_MODE } from './store.js?v=6';
import { buildICS, parseICS, downloadText } from './ics.js?v=6';
import { ASSETS, SPOTS, HEIGHTS, fallbackRoomSVG, avatarFigure, dadSVG, housePlanSVG, PLAN_SPOTS } from './scene.js?v=11';
import { createSync, syncConfigured } from './sync.js?v=13';
import { parseKakao } from './kakao.js?v=4';
import { APP_URL } from './config.js?v=10';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const STALE_MS = 12 * 3600e3; // 상태가 12시간 넘게 갱신되지 않으면 '확인 중'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileMQ = matchMedia('(max-width: 760px)');

// ───────────────────────── 상태 ─────────────────────────
const canStore = storageAvailable();
let S, bootNote = null, firstRun = false;
{
  const r = load();
  if (r.data) S = M.migrate(r.data);
  else {
    S = M.demoState(D.today());
    firstRun = true;
    if (r.error) bootNote = `${r.error} 예시 데이터로 다시 시작했어요.`;
  }
}
const ui = {
  view: 'world',
  floor: +(loadPref('floor') || 1),
  viewer: loadPref('viewer') || 'm_mom',
  cal: { mode: 'month', cursor: D.today(), selected: D.today(), filter: new Set(S.members.map(m => m.id)) },
  saveError: canStore ? null : '이 브라우저에서는 저장할 수 없어요(개인정보 보호 모드 등). 새로고침하면 입력한 내용이 사라져요.',
  plan: { tripId: null, filter: 'all' },
  admin: { accounts: null, accountsErr: null, picked: new Set() },
  elevating: false,
  celebrate: null,
  lastMinute: '',
};
if (![0, 1, 2, 3, 4].includes(ui.floor)) ui.floor = 1; // 0 = 집 전체(1~4층 한 화면)
if (!S.members.some(m => m.id === ui.viewer)) ui.viewer = S.members[0].id;

function persist() {
  S.meta.updatedAt = new Date().toISOString();
  if (!canStore) { renderBanner(); return false; }
  const r = save(S);
  ui.saveError = r.ok ? null : r.error;
  renderBanner();
  if (!r.ok) toast(`저장하지 못했어요 · ${r.error}`, 'err');
  if (!fromRemote) sync?.changed();
  return r.ok;
}
let fromRemote = false;
const connected = () => !!(ui.sync && ui.sync.family);
const sync = createSync({
  getState: () => S,
  onRemote() {
    fromRemote = true;
    try { persist(); } finally { fromRemote = false; }
    if (!$('#dlg').open && !ui.elevating) renderAll(); else renderHeader();
  },
  onStatus(st) {
    const firstConnect = st.family && !connected();
    ui.sync = st;
    if (st.membership && ui.viewer !== st.membership.member_id) { ui.viewer = st.membership.member_id; savePref('viewer', ui.viewer); }
    if (firstConnect) {
      const hasDemo = S.events.some(e => e.sourceId === 'src_demo') || S.issues.some(i => i.sourceId === 'src_demo');
      if (hasDemo) { M.stripDemo(S); fromRemote = true; try { persist(); } finally { fromRemote = false; } }
      renderAll();
    } else { renderHeader(); if (ui.view === 'sync' && !$('#dlg').open) renderSync(); if (ui.view === 'admin' && !$('#dlg').open) renderAdmin(); }
  },
});

// ───────────────────────── 조회 ─────────────────────────
const member = id => S.members.find(m => m.id === id);
const memberName = id => member(id)?.displayName || '가족 모두';
const memberOnFloor = n => S.members.find(m => m.floor === n);
const place = id => S.places.find(p => p.id === id);
const rule = id => (id ? S.recurrenceRules.find(r => r.id === id) : null);
const source = id => S.sources.find(s => s.id === id);
const viewerName = () => memberName(ui.viewer);

/** '본인만' 항목은 해당 구성원이 '지금 보는 사람'일 때만 보인다(계정 기능 전 임시 규칙). */
function canSee(x) {
  if (!x || x.visibility !== 'private') return true;
  return [x.ownerId, x.createdBy, x.memberId, x.roomOwnerId, x.authorId].includes(ui.viewer);
}
const involves = (ev, ids) => ids.has(ev.ownerId) || (ev.attendeeIds || []).some(i => ids.has(i));
const rank = ev => (ev.allDay ? 0 : ev.timeUnset || !ev.startTime ? 1 : 2);
const cmpInst = (a, b) => a.date.localeCompare(b.date) || rank(a.ev) - rank(b.ev) || (a.ev.startTime || '').localeCompare(b.ev.startTime || '') || a.ev.title.localeCompare(b.ev.title);

function instances(from, to, ids = null) {
  const out = [];
  for (const ev of S.events) {
    if (!canSee(ev)) continue;
    if (ids && !involves(ev, ids)) continue;
    out.push(...M.expand(ev, rule(ev.recurrenceRuleId), from, to));
  }
  return out.sort(cmpInst);
}
const onDate = (list, d) => list.filter(i => i.date <= d && i.endDate >= d);
const prioRank = { high: 0, normal: 1, low: 2 };
function issuesOn(d, ownerId = null) {
  return S.issues
    .filter(i => i.date === d && canSee(i) && (ownerId == null || i.ownerId === ownerId))
    .sort((a, b) => (a.done - b.done) || prioRank[a.priority] - prioRank[b.priority]);
}

function timeLabel(ev) {
  if (ev.allDay) return '하루 종일';
  if (ev.timeUnset || !ev.startTime) return '시간 미정';
  return ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
}

function isNow(i, now) {
  const s = `${i.date}T${i.ev.startTime}`;
  let e;
  if (i.ev.endTime) e = `${i.endDate}T${i.ev.endTime}`;
  else { const x = D.addMinutes(i.date, i.ev.startTime, 60); e = `${x.date}T${x.time}`; }
  const n = `${now.date}T${now.time}`;
  return s <= n && n < e;
}
function liveInstance(m) {
  const now = D.seoul();
  return onDate(instances(D.addDays(now.date, -1), now.date, new Set([m.id])), now.date)
    .find(i => i.ev.status !== 'cancelled' && !i.ev.allDay && !i.ev.timeUnset && i.ev.startTime && isNow(i, now));
}

/** 아바타 동작은 저장된 데이터에서만 정한다. 데이터가 없거나 오래되면 멈춘다. */
function avatarState(m) {
  const live = liveInstance(m);
  if (live) return { act: 'event', label: `일정 중 · ${live.ev.title}`, basis: '캘린더 일정 시간 기준', status: m.status };
  const st = m.status;
  if (!st || !canSee({ ...st, ownerId: m.id })) return { act: 'unset', label: '상태 미설정', basis: '아직 설정한 상태가 없어요' };
  if (!st.setAt || Date.now() - new Date(st.setAt).getTime() > STALE_MS) {
    return { act: 'stale', label: '확인 중', basis: `마지막 설정 ${D.relTime(st.setAt)} · 지금도 그런지 알 수 없어요`, status: st, stale: true };
  }
  const a = M.ACTS.find(x => x.k === st.activity);
  return { act: a ? a.k : 'still', label: a ? a.l : '상태 메시지', basis: `${memberName(st.setBy)} 설정 · ${D.relTime(st.setAt)}`, status: st };
}

// ───────────────────────── 공통 조각 ─────────────────────────
function face(m, cls = '') {
  if (!m) return '<span class="face face-all">👪</span>';
  const src = ASSETS.avatars[m.avatar];
  return src
    ? `<img class="face ${cls}" src="${src}" alt="" style="--c:${m.color}">`
    : `<span class="face face-svg ${cls}" style="--c:${m.color}">${dadSVG()}</span>`;
}
function pchip(id, extra = '') {
  const m = member(id);
  if (!m) return `<span class="pchip pchip-all">👪 가족 모두</span>`;
  return `<button type="button" class="pchip" style="--c:${m.color}" data-action="go-floor" data-floor="${m.floor}" title="${m.floor}층 ${esc(m.space.name)}로 이동">${face(m)}<span>${esc(m.displayName)}</span>${extra}</button>`;
}
function srcTag(x) {
  const s = source(x.sourceId);
  if (!s || s.kind === 'manual') return '';
  if (s.kind === 'demo') return '<span class="tag tag-demo">예시</span>';
  if (s.kind === 'ics-import') return `<span class="tag tag-src" title="${esc(s.label)}">캘린더 가져옴</span>`;
  return `<span class="tag tag-src">${esc(s.label)}</span>`;
}
function statusTag(ev) {
  if (ev.status === 'cancelled') return '<span class="tag tag-cancel">취소됨</span>';
  if (ev.status === 'tentative') return '<span class="tag tag-tent">미정</span>';
  return '';
}
function evRow(inst, { showDate = false } = {}) {
  const ev = inst.ev;
  const owner = member(ev.ownerId);
  const others = (ev.attendeeIds || []).filter(id => id !== ev.ownerId);
  const pl = place(ev.placeId);
  const rr = rule(ev.recurrenceRuleId);
  return `<li class="ev-row${ev.status === 'cancelled' ? ' is-cancel' : ''}" style="--c:${owner?.color || '#FF8FB8'}">
    <button type="button" class="ev-main" data-action="open-event" data-id="${ev.id}" data-date="${inst.date}">
      <span class="ev-time">${showDate ? `<em>${D.fmtDate(inst.date)}</em>` : ''}${timeLabel(ev)}</span>
      <span class="ev-title">${esc(ev.title)}${rr ? ' <span class="rr" title="반복 일정">🔁</span>' : ''}${ev.visibility === 'private' ? ' <span class="rr" title="본인만">🔒</span>' : ''}${ev.pinned ? ' <span class="rr" title="고정 일정">📌</span>' : ''}</span>
      <span class="ev-sub">${pl ? `<span>📍 ${esc(pl.name)}</span>` : ''}${statusTag(ev)}${srcTag(ev)}</span>
    </button>
    <div class="ev-people">${pchip(ev.ownerId, '<i class="own">담당</i>')}${others.map(id => pchip(id)).join('')}</div>
  </li>`;
}
function issueRow(is, { showDate = false } = {}) {
  const t = M.ISSUE_TYPES.find(x => x.k === is.type) || M.ISSUE_TYPES[0];
  const ev = is.eventId && S.events.find(e => e.id === is.eventId);
  return `<li class="is-row${is.done ? ' is-done' : ''} pr-${is.priority}">
    <label class="chk" title="${is.done ? '완료 취소' : '완료로 표시'}"><input type="checkbox" data-change="toggle-issue" data-id="${is.id}" ${is.done ? 'checked' : ''}><span aria-hidden="true"></span><b class="sr">${esc(is.title)} 완료</b></label>
    <button type="button" class="is-main" data-action="open-issue" data-id="${is.id}">
      <span class="is-type">${t.e} ${t.l}${showDate ? ` · ${D.fmtDate(is.date)}` : ''}</span>
      <span class="is-title">${esc(is.title)}</span>
    </button>
    <div class="is-meta">${is.priority === 'high' ? '<span class="tag tag-high">중요</span>' : ''}${srcTag(is)}${pchip(is.ownerId)}${ev && canSee(ev) ? `<button type="button" class="link-ev" data-action="open-event" data-id="${ev.id}" data-date="${is.date}">🔗 ${esc(ev.title)}</button>` : ''}</div>
  </li>`;
}
const empty = (icon, text, btn = '') => `<div class="empty"><span class="empty-ico">${icon}</span><p>${text}</p>${btn}</div>`;

// ───────────────────────── 머리말·배너 ─────────────────────────
function greeting(h) {
  if (h >= 5 && h < 11) return ['좋은 아침이에요', '☀️'];
  if (h >= 11 && h < 17) return ['즐거운 오후예요', '🌤️'];
  if (h >= 17 && h < 22) return ['편안한 저녁이에요', '🌙'];
  return ['포근한 밤이에요', '⭐'];
}
function renderHeader() {
  const now = D.seoul();
  $('#topDate').innerHTML = `${D.fmtDate(now.date, { year: true, wd: false, long: false })} <b>${D.WD[D.weekday(now.date)]}요일</b> <span class="clock">${now.time}</span>`;
  const sel = $('#viewerSel');
  sel.innerHTML = S.members.map(m => `<option value="${m.id}" ${m.id === ui.viewer ? 'selected' : ''}>${esc(m.roleLabel === m.displayName ? m.roleLabel : `${m.roleLabel} · ${m.displayName}`)}</option>`).join('');
  sel.disabled = connected();
  sel.title = connected() ? '로그인한 가족 구성원으로 고정돼요' : '로그인이 아니라 보기 전환이에요';
  const st = ui.sync || {};
  const label = {
    connected: `가족 동기화 · ${st.pending ? '올리는 중…' : st.realtime ? '실시간 연결됨' : '연결됨'}`,
    connecting: '가족 동기화 · 연결 중…', error: `가족 동기화 · ${st.error || '문제가 있어요'}`,
    'no-family': '가족 동기화 · 가족 연결 필요', 'signed-out': '가족 동기화 · 로그인 필요', off: '이 기기에만 저장',
  }[st.state || 'off'];
  const dot = st.state === 'connected' ? 'dot-on' : st.state === 'error' ? 'dot-err' : '';
  $('#syncPill').innerHTML = `<span class="dot ${dot}"></span>${esc(label)}${st.state === 'connected' && st.lastSyncAt ? ` · ${D.relTime(st.lastSyncAt)}` : ''}`;
}
function renderBanner() {
  const b = [];
  if (ui.saveError) b.push(`<div class="banner banner-err" role="alert"><b>저장 실패</b> ${esc(ui.saveError)}</div>`);
  if (bootNote) b.push(`<div class="banner banner-warn">${esc(bootNote)}</div>`);
  const hasDemo = S.events.some(e => e.sourceId === 'src_demo') || S.issues.some(i => i.sourceId === 'src_demo');
  if (hasDemo) b.push(`<div class="banner banner-demo"><span>🧸 지금 보이는 일정·이슈 중 <b>예시</b> 표시가 붙은 것은 데모 데이터예요. 다른 기기의 일정은 <b>연동 › 다른 기기로 옮기기</b> 링크로 가져올 수 있어요.</span><button type="button" class="btn-s" data-action="strip-demo">예시 지우고 시작하기</button></div>`);
  if (APP_URL && !location.href.startsWith(APP_URL) && !/localhost|127\.0\.0\.1/.test(location.hostname)) b.push(`<div class="banner banner-warn"><span>🏡 우리집 미니월드가 <b>새 주소</b>로 이사했어요. 이 기기에 저장된 일정을 그대로 가지고 갈 수 있어요.</span><button type="button" class="btn-p btn-sm" data-action="move-home">내 데이터와 함께 새 주소로 가기</button></div>`);
  if (hasUndo()) b.push(`<div class="banner banner-warn"><span>↩️ 예시를 지웠어요. 잘못 눌렀다면 되돌릴 수 있어요.</span><span class="btn-row" style="margin:0"><button type="button" class="btn-s" data-action="undo-strip">되돌리기</button><button type="button" class="btn-g" data-action="drop-undo">괜찮아요</button></span></div>`);
  $('#banner').innerHTML = b.join('');
}

// ───────────────────────── 미니월드(층) ─────────────────────────
function floorInfo(n) {
  if (n === 1) return { name: '가족 로비', who: '모두 함께' };
  const m = memberOnFloor(n);
  return { name: m.space.name, who: m.roleLabel === m.displayName ? m.roleLabel : `${m.roleLabel} ${m.displayName}`, m };
}
function renderDir() {
  const t = D.today();
  const today = instances(t, t).filter(i => i.ev.status !== 'cancelled');
  const allBtn = `<li><button type="button" class="floor-btn fl-all${ui.floor === 0 ? ' on' : ''}" data-action="go-floor" data-floor="0" ${ui.floor === 0 ? 'aria-current="page"' : ''} style="--c:#9B87D4">
      <b class="fl-n">🏠</b>
      <span class="fl-t"><span class="fl-name">집 전체</span><small>1~4층 한눈에 · 오늘 ${today.length}건</small></span>
      <span class="fl-face"><span class="face face-all">👪</span></span>
    </button></li>`;
  $('#floorList').innerHTML = allBtn + [4, 3, 2, 1].map(n => {
    const f = floorInfo(n);
    const cnt = n === 1 ? today.length : today.filter(i => involves(i.ev, new Set([f.m.id]))).length;
    return `<li><button type="button" class="floor-btn${n === ui.floor ? ' on' : ''}" data-action="go-floor" data-floor="${n}" ${n === ui.floor ? 'aria-current="page"' : ''} style="--c:${f.m?.color || '#FF8FB8'}">
      <b class="fl-n">${n}F</b>
      <span class="fl-t"><span class="fl-name">${esc(f.name)}</span><small>${esc(f.who)} · 오늘 ${cnt}건</small></span>
      <span class="fl-face">${f.m ? face(f.m) : '<span class="face face-all">🏠</span>'}</span>
    </button></li>`;
  }).join('');
  if (ui.floor >= 1) { $('#car').style.setProperty('--i', String(4 - ui.floor)); $('#car').textContent = `${ui.floor}F`; }
  else $('#car').textContent = '🏠';
}

/** 네 방을 한 도면에 담은 등각 평면도. 각자 자기 방에 서 있고, 방을 누르면 그 층으로 들어간다. */
function renderHouse() {
  const t = D.today();
  const today = instances(t, t).filter(i => i.ev.status !== 'cancelled');
  const over = [4, 3, 2, 1].map(n => {
    const f = floorInfo(n);
    const lobby = n === 1;
    const [sx, sy] = PLAN_SPOTS[n];
    const col = f.m?.color || '#FF8FB8';
    const cnt = lobby ? today.length : today.filter(i => involves(i.ev, new Set([f.m.id]))).length;
    let who = '';
    if (!lobby) {
      const m = f.m, st = avatarState(m);
      const mood = st.status && !st.stale && M.MOODS.find(k => k.k === st.status.mood);
      const say = `${mood ? mood.e + ' ' : ''}${st.status?.text && !st.stale ? st.status.text : st.label}`;
      who = `<button type="button" class="pv-av act-${st.act}" style="left:${sx}%;top:${sy}%;--h:${m.role === 'kid' ? 18 : 21}%;--c:${m.color}"
        data-action="edit-status" data-id="${m.id}" aria-label="${esc(`${m.displayName}, ${st.label}. 상태 바꾸기`)}">
        <span class="av-fig">${avatarFigure(m)}</span>${fxHTML(st.act, false)}
        <span class="pv-say"><b>${esc(m.displayName)}</b><small>${esc(say)}</small></span>
      </button>`;
    }
    return `${who}<button type="button" class="pv-tag" style="left:${sx}%;top:${sy + 7}%;--c:${col}"
      data-action="go-floor" data-floor="${n}" aria-label="${esc(`${n}층 ${f.name}로 들어가기. 오늘 ${cnt}건`)}"><b>${n}F</b> ${esc(f.name)}${cnt ? `<i>${cnt}</i>` : ''}</button>`;
  }).join('');
  $('#stageFrame').className = `stage-frame bd-${S.family.lobbyRoom.backdrop}`;
  $('#sceneWrap').innerHTML = `<div class="planv">
    <div class="planv-art">${ASSETS.housePlan ? `<img class="plan-svg" src="${ASSETS.housePlan}" alt="우리집 평면도">` : housePlanSVG()}${over}</div>
    <p class="planv-cap">우리집 평면도 · 방 이름을 누르면 그 층으로 들어가요</p>
  </div>`;
  $('#elevInd').textContent = '🏠';
}

function fxHTML(act, cele) {
  const fx = {
    rest: '<span class="fx fx-rest" aria-hidden="true"><i class="cup">☕</i><i class="z">z</i><i class="z z2">z</i></span>',
    busy: '<span class="fx fx-busy" aria-hidden="true"><i>✏️</i></span>',
    event: '<span class="fx fx-event" aria-hidden="true"><i>📅</i></span>',
    done: '<span class="fx fx-done" aria-hidden="true"><i>⭐</i><i>✨</i><i>⭐</i></span>',
    out: '<span class="fx fx-out" aria-hidden="true"><i>👟</i></span>',
    unset: '<span class="fx fx-q" aria-hidden="true"><i>?</i></span>',
    stale: '<span class="fx fx-q" aria-hidden="true"><i>…</i></span>',
  }[act] || '';
  const conf = cele ? `<span class="confetti" aria-hidden="true">${[...Array(16)].map((_, i) => `<i style="--a:${i * 22.5}deg;--d:${(i % 4) * 60}ms;--k:${i % 5}"></i>`).join('')}</span>` : '';
  return fx + conf;
}
function avatarHTML(m, mode) {
  const st = avatarState(m);
  const [x, y] = mode === 'lobby' ? (SPOTS.lobby[m.id] || [50, 80]) : SPOTS.single;
  const h = HEIGHTS[mode][m.role === 'kid' ? 'kid' : 'adult'];
  const cele = !!(ui.celebrate && ui.celebrate.id === m.id && Date.now() < ui.celebrate.until);
  const mood = st.status && !st.stale && M.MOODS.find(k => k.k === st.status.mood);
  const action = mode === 'lobby' ? `data-action="go-floor" data-floor="${m.floor}"` : `data-action="edit-status" data-id="${m.id}"`;
  const aria = `${m.displayName}, ${st.label}. ${mode === 'lobby' ? `${m.floor}층 방으로 이동` : '상태 바꾸기'}`;
  return `<button type="button" class="av act-${st.act}${cele ? ' celebrate' : ''}" style="left:${x}%;top:${y}%;--h:${h}%;--c:${m.color}" ${action} aria-label="${esc(aria)}">
    <span class="av-fig">${avatarFigure(m)}</span>${fxHTML(st.act, cele)}
    <span class="av-tag"><b>${esc(m.displayName)}</b><small>${mood ? mood.e + ' ' : ''}${esc(st.label)}</small></span>
    ${mode === 'single' && st.status?.text && !st.stale ? `<span class="av-bubble">${esc(st.status.text)}</span>` : ''}
  </button>`;
}
function renderStage() {
  const n = ui.floor;
  $('#stage').classList.toggle('house-on', n === 0);
  if (n === 0) return renderHouse();
  const room = n === 1 ? S.family.lobbyRoom : memberOnFloor(n).room;
  const img = ASSETS.rooms[n];
  const art = img
    ? `<img class="room-img" src="${img}" alt="${n}층 ${esc(floorInfo(n).name)} 미니룸 그림">`
    : fallbackRoomSVG(n, room.backdrop);
  const people = n === 1 ? S.members : [memberOnFloor(n)];
  const stickers = (room.stickers || []).slice(0, M.STICKER_SLOTS.length).map((k, i) => {
    const st = M.STICKERS.find(s => s.k === k);
    if (!st) return '';
    const [sx, sy] = M.STICKER_SLOTS[i];
    return `<span class="sticker" style="left:${sx}%;top:${sy}%;--r:${(i % 2 ? 1 : -1) * (6 + i * 3)}deg" aria-hidden="true">${st.e}</span>`;
  }).join('');
  $('#stageFrame').className = `stage-frame bd-${room.backdrop}`;
  $('#sceneWrap').innerHTML = art + stickers + people.map(m => avatarHTML(m, n === 1 ? 'lobby' : 'single')).join('') +
    (img ? '' : '<span class="art-note">임시 그림 · Higgsfield 이미지 준비 중</span>');
  $('#elevInd').textContent = `${n}F`;
}

function lobbyHead() {
  const now = D.seoul();
  const [g, ic] = greeting(now.hour);
  const ev = instances(now.date, now.date).filter(i => i.ev.status !== 'cancelled');
  const left = issuesOn(now.date).filter(i => !i.done).length;
  return `<div class="hello">
    <p class="hello-date">${D.fmtDate(now.date, { year: true, long: true })}</p>
    <h1 class="hello-title">${g}, 우리 가족! <span aria-hidden="true">${ic}</span></h1>
    <p class="hello-sub">오늘 가족 일정 <b>${ev.length}</b>개 · 챙길 일 <b>${left}</b>개 남았어요</p>
  </div>`;
}
function memberHead(m) {
  return `<div class="hello" style="--c:${m.color}">
    <p class="hello-date">${m.floor}F · ${esc(m.space.name)}</p>
    <h1 class="hello-title">${esc(m.displayName)}의 미니룸 <span aria-hidden="true">🎀</span></h1>
    <p class="hello-sub">${ui.viewer === m.id ? '내 방이에요.' : `${esc(viewerName())}(으)로 방문 중 · 가족 전체 공개 항목만 보여요.`}</p>
    <div class="hello-btns"><button type="button" class="btn-s" data-action="go-floor" data-floor="1">← 1층 로비</button><button type="button" class="btn-s" data-action="decorate" data-id="${m.id}">🎀 방 꾸미기</button></div>
  </div>`;
}

function statusCard(m) {
  const st = avatarState(m);
  const s = st.status;
  const mood = s && M.MOODS.find(x => x.k === s.mood);
  return `<article class="st-card" style="--c:${m.color}" title="${esc(st.basis)}">
    <button type="button" class="st-ava" data-action="go-floor" data-floor="${m.floor}" aria-label="${m.floor}층 ${esc(m.space.name)}로 이동">${face(m, 'face-l')}</button>
    <div class="st-body">
      <p class="st-name">${esc(m.displayName)} <small>${m.floor}F ${esc(m.space.name)}</small></p>
      <p class="st-text">${s?.text && canSee({ ...s, ownerId: m.id }) ? esc(s.text) : '<span class="muted">상태 메시지 없음</span>'}</p>
      <p class="st-meta"><span class="pill act-${st.act}">${esc(st.label)}</span>${mood && !st.stale ? `<span class="mood">${mood.e} ${mood.l}</span>` : ''}</p>
      <p class="st-basis">${esc(st.basis)}</p>
      <div class="st-actions"><button type="button" class="btn-s" data-action="edit-status" data-id="${m.id}">상태 바꾸기</button><button type="button" class="btn-g" data-action="go-floor" data-floor="${m.floor}">방 가기 →</button></div>
    </div>
  </article>`;
}

function lobbyPanels() {
  const t = D.today();
  const today = instances(t, t);
  const iss = issuesOn(t);
  const up = instances(D.addDays(t, 1), D.addDays(t, 7)).filter(i => i.ev.status !== 'cancelled').slice(0, 6);
  const main = `<section class="card o-5"><header class="card-h"><h2>가족 상태</h2><span class="hint">각자 직접 설정한 상태예요</span></header>
    <div class="status-grid">${S.members.map(statusCard).join('')}</div></section>`;
  const side = `
  <section class="card card-today o-3"><header class="card-h"><h2>오늘의 가족 일정</h2><button type="button" class="btn-p btn-sm" data-action="new-event" data-date="${t}">+ 일정</button></header>
    ${today.length ? `<ul class="ev-list">${today.map(i => evRow(i)).join('')}</ul>` : empty('☁️', '오늘은 등록된 가족 일정이 없어요.', `<button type="button" class="btn-s" data-action="new-event" data-date="${t}">일정 추가하기</button>`)}
  </section>
  <section class="card card-issue o-4"><header class="card-h"><h2>오늘의 이슈 · 준비할 일</h2><button type="button" class="btn-p btn-sm" data-action="new-issue" data-date="${t}">+ 이슈</button></header>
    ${iss.length ? `<ul class="is-list">${iss.map(i => issueRow(i)).join('')}</ul>` : empty('🎒', '오늘 챙길 일이 없어요.', `<button type="button" class="btn-s" data-action="new-issue" data-date="${t}">준비할 일 추가</button>`)}
  </section>
  <section class="card o-7"><header class="card-h"><h2>다가오는 일정</h2><button type="button" class="btn-g" data-action="view" data-view="cal">캘린더 →</button></header>
    ${up.length ? `<ul class="ev-list ev-compact">${up.map(i => evRow(i, { showDate: true })).join('')}</ul>` : empty('📭', '앞으로 7일 동안 예정된 일정이 없어요.')}
  </section>
  ${activityCard()}
  ${planSummaryCard()}`;
  return { main, side };
}

function memberPanels(m) {
  const t = D.today();
  const st = avatarState(m);
  const s = st.status;
  const mood = s && M.MOODS.find(x => x.k === s.mood);
  const mine = new Set([m.id]);
  const today = instances(t, t, mine);
  const memos = S.issues
    .filter(i => canSee(i) && i.ownerId === m.id && i.date >= t && i.date <= D.addDays(t, 7) && (!i.done || i.date === t))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.done - b.done) || prioRank[a.priority] - prioRank[b.priority]);
  const posts = S.posts.filter(p => p.memberId === m.id && canSee(p)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  const gb = S.guestbook.filter(g => g.roomOwnerId === m.id && canSee(g)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const side = `
  <section class="card me-status o-3" style="--c:${m.color}"><header class="card-h"><h2>오늘의 상태</h2><button type="button" class="btn-s" data-action="edit-status" data-id="${m.id}">바꾸기</button></header>
    <div class="speech${st.stale ? ' is-stale' : ''}">${s?.text && canSee({ ...s, ownerId: m.id }) ? esc(s.text) : '<span class="muted">아직 상태 메시지가 없어요</span>'}</div>
    <dl class="kv">
      <div><dt>지금</dt><dd><span class="pill act-${st.act}">${esc(st.label)}</span></dd></div>
      <div><dt>기분</dt><dd>${mood && !st.stale ? `${mood.e} ${mood.l}` : '<span class="muted">—</span>'}</dd></div>
      <div><dt>기준</dt><dd class="small">${esc(st.basis)}</dd></div>
    </dl>
    <div class="bgm" title="장식용입니다. 음악은 재생되지 않아요.">
      <span class="bgm-ico" aria-hidden="true">♫</span>
      <span class="bgm-t">${m.bgm ? esc(m.bgm) : '오늘의 노래를 정해 보세요'}</span>
      <span class="bgm-note">장식 · 재생 안 됨</span>
    </div>
  </section>
  <section class="card o-4"><header class="card-h"><h2>오늘 일정</h2><button type="button" class="btn-p btn-sm" data-action="new-event" data-date="${t}" data-owner="${m.id}">+ 일정</button></header>
    ${today.length ? `<ul class="ev-list">${today.map(i => evRow(i)).join('')}</ul>` : empty('🌷', `오늘 ${esc(m.displayName)}의 일정은 없어요.`)}
  </section>
  <section class="card o-5"><header class="card-h"><h2>관련 메모 · 준비</h2><button type="button" class="btn-p btn-sm" data-action="new-issue" data-date="${t}" data-owner="${m.id}">+ 메모</button></header>
    ${memos.length ? `<ul class="is-list">${memos.map(i => issueRow(i, { showDate: i.date !== t })).join('')}</ul>` : empty('📝', '이번 주에 챙길 메모가 없어요.')}
  </section>`;
  const main = `
  <section class="card o-7"><header class="card-h"><h2>짧은 글 · 사진</h2><button type="button" class="btn-p btn-sm" data-action="new-post" data-id="${m.id}">+ 글 쓰기</button></header>
    ${posts.length ? `<ul class="posts">${posts.map(p => `<li class="post">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(memberName(m.id))}의 사진">` : ''}
        <p>${esc(p.text)}</p>
        <footer><span>${D.fmtStamp(p.createdAt)} · ${esc(memberName(p.createdBy))} 씀${p.visibility === 'private' ? ' · 🔒' : ''}</span>${srcTag(p)}<button type="button" class="btn-x" data-action="del-post" data-id="${p.id}" aria-label="글 삭제">삭제</button></footer>
      </li>`).join('')}</ul>` : empty('📷', '아직 남긴 글이나 사진이 없어요.')}
  </section>
  <section class="card guest o-8"><header class="card-h"><h2>방명록</h2><span class="hint">${gb.length}개</span></header>
    <form class="gb-form" data-submit="guestbook" data-id="${m.id}">
      <span class="gb-me">${face(member(ui.viewer))}</span>
      <input name="text" maxlength="100" required placeholder="${esc(m.displayName)}에게 짧은 응원 한마디" aria-label="방명록 내용">
      <select name="visibility" aria-label="공개 범위"><option value="family">가족 전체</option><option value="private">비밀글</option></select>
      <button class="btn-p btn-sm">남기기</button>
    </form>
    ${gb.length ? `<ul class="gb-list">${gb.map(g => `<li style="--c:${member(g.authorId)?.color || '#FF8FB8'}">${face(member(g.authorId))}<div><p><b>${esc(memberName(g.authorId))}</b> ${esc(g.text)}</p><small>${D.relTime(g.createdAt)}${g.visibility === 'private' ? ' · 🔒 비밀글' : ''}</small></div>${g.authorId === ui.viewer || m.id === ui.viewer ? `<button type="button" class="btn-x" data-action="del-gb" data-id="${g.id}" aria-label="방명록 삭제">✕</button>` : ''}</li>`).join('')}</ul>` : empty('💌', '첫 방명록을 남겨 보세요.')}
  </section>`;
  return { main, side };
}

function renderWorld() {
  renderDir();
  const n = ui.floor;
  document.body.classList.toggle('fit', n === 1);
  if (n === 0) {
    $('#floorHead').innerHTML = lobbyHead();
    const p = lobbyPanels();
    $('#panelMain').innerHTML = p.main; $('#panelSide').innerHTML = p.side;
    $('#stageTitle').innerHTML = '<h2>🏠 집 전체</h2><span class="hint">층을 누르면 그 방으로 들어가요</span>';
  } else if (n === 1) {
    $('#floorHead').innerHTML = lobbyHead();
    const p = lobbyPanels();
    $('#panelMain').innerHTML = p.main; $('#panelSide').innerHTML = p.side;
    $('#stageTitle').innerHTML = `<h2>1F 가족 로비</h2><span class="hint stage-hint" title="캐릭터 동작은 캘린더 일정이나 직접 설정한 상태로만 정해져요. 상태가 없으면 멈추고, 12시간이 지나면 '확인 중'이에요.">ⓘ 움직임 기준</span><button type="button" class="btn-g" data-action="decorate" data-id="lobby">🎀 꾸미기</button>`;
  } else {
    const m = memberOnFloor(n);
    $('#floorHead').innerHTML = memberHead(m);
    const p = memberPanels(m);
    $('#panelMain').innerHTML = p.main; $('#panelSide').innerHTML = p.side;
    $('#stageTitle').innerHTML = `<h2>${n}F ${esc(m.space.name)}</h2><span class="hint">캐릭터를 누르면 상태를 바꿀 수 있어요</span>`;
  }
  renderStage();
}

async function goFloor(n) {
  n = +n;
  if (![0, 1, 2, 3, 4].includes(n) || ui.elevating) return;
  const wasWorld = ui.view === 'world';
  if (!wasWorld) setView('world');
  if (n === ui.floor) { if (wasWorld) renderWorld(); scrollTopIfMobile(); return; }
  const from = ui.floor;
  savePref('floor', String(n));
  scrollTopIfMobile();
  // 집 전체 보기는 엘리베이터로 오르내리는 층이 아니라 건물 바깥에서 보는 화면이라 연출 없이 바꾼다.
  if (reduceMotion.matches || !wasWorld || n === 0 || from === 0) { ui.floor = n; renderWorld(); return; }
  ui.elevating = true;
  const stage = $('#stage'), ind = $('#elevInd');
  $('#car').style.setProperty('--i', String(4 - n));
  $$('.floor-btn').forEach(b => b.classList.toggle('on', +b.dataset.floor === n));
  ind.textContent = `${from}F`;
  stage.classList.add('closing');
  await wait(420);
  const step = n > from ? 1 : -1;
  for (let f = from; f !== n;) { f += step; await wait(230); ind.textContent = `${f}F ${step > 0 ? '▲' : '▼'}`; }
  ui.floor = n;
  renderWorld();
  ind.textContent = `${n}F`;
  await wait(180);
  stage.classList.remove('closing');
  stage.classList.add('arrive');
  await wait(520);
  stage.classList.remove('arrive');
  ui.elevating = false;
}
function scrollTopIfMobile() {
  if (mobileMQ.matches) window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

// ───────────────────────── 캘린더 ─────────────────────────
function renderCal() {
  const c = ui.cal;
  const title = c.mode === 'month' ? D.fmtMonth(c.cursor)
    : c.mode === 'week' ? `${D.fmtDate(D.startOfWeek(c.cursor), { wd: false })} – ${D.fmtDate(D.addDays(D.startOfWeek(c.cursor), 6), { wd: false })}`
      : D.fmtDate(c.cursor, { year: true, long: true });
  $('#calTitle').textContent = title;
  $$('#calModes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === c.mode)));
  $('#calFilter').innerHTML = S.members.map(m => `<button type="button" class="fchip${c.filter.has(m.id) ? ' on' : ''}" style="--c:${m.color}" data-action="cal-filter" data-id="${m.id}" aria-pressed="${c.filter.has(m.id)}">${face(m)}${esc(m.displayName)}</button>`).join('');
  const grid = $('#calGrid');
  if (c.mode === 'month') grid.innerHTML = monthHTML();
  else if (c.mode === 'week') grid.innerHTML = mobileMQ.matches ? weekListHTML() : weekHTML();
  else grid.innerHTML = dayHTML(c.cursor);
  grid.dataset.mode = c.mode;
  const side = $('#calDay');
  side.hidden = c.mode === 'day';
  if (c.mode !== 'day') side.innerHTML = dayPanelHTML(c.selected);
}
function monthHTML() {
  const c = ui.cal, t = D.today();
  const first = D.startOfMonth(c.cursor);
  const start = D.startOfWeek(first);
  const list = instances(start, D.addDays(start, 41), c.filter);
  const month = first.slice(0, 7);
  let cells = '';
  for (let k = 0; k < 42; k++) {
    const d = D.addDays(start, k);
    const evs = onDate(list, d);
    const open = issuesOn(d).filter(i => !i.done).length;
    const wd = D.weekday(d);
    cells += `<div class="mcell${d.slice(0, 7) !== month ? ' out' : ''}${d === t ? ' today' : ''}${d === c.selected ? ' sel' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" role="gridcell" tabindex="0" data-action="cal-select" data-date="${d}" aria-label="${D.fmtDate(d)} 일정 ${evs.length}개${open ? `, 챙길 일 ${open}개` : ''}">
      <span class="mnum">${+d.slice(8)}</span>${open ? `<span class="mpin" title="챙길 일 ${open}개">📌${open}</span>` : ''}
      <span class="mchips">${evs.slice(0, 3).map(i => `<span class="mchip${i.ev.status === 'cancelled' ? ' is-cancel' : ''}${rank(i.ev) < 2 ? ' allday' : ''}" style="--c:${member(i.ev.ownerId)?.color || '#FF8FB8'}">${rank(i.ev) === 2 ? `<em>${i.ev.startTime}</em>` : ''}${esc(i.ev.title)}</span>`).join('')}${evs.length > 3 ? `<span class="mmore">+${evs.length - 3}</span>` : ''}</span>
      <span class="mdots" aria-hidden="true">${evs.slice(0, 4).map(i => `<i style="--c:${member(i.ev.ownerId)?.color || '#FF8FB8'}"></i>`).join('')}</span>
    </div>`;
  }
  return `<div class="month" role="grid"><div class="mhead" role="row">${D.WD.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}" role="columnheader">${w}</span>`).join('')}</div><div class="mgrid">${cells}</div></div>`;
}
const HOUR_PX = 42, H0 = 6;
function weekHTML() {
  const c = ui.cal, t = D.today();
  const start = D.startOfWeek(c.cursor);
  const list = instances(start, D.addDays(start, 6), c.filter);
  const days = [...Array(7)].map((_, k) => D.addDays(start, k));
  const head = days.map(d => `<button type="button" class="wh${d === t ? ' today' : ''}${d === c.selected ? ' sel' : ''}" data-action="cal-select" data-date="${d}"><small>${D.WD[D.weekday(d)]}</small><b>${+d.slice(8)}</b></button>`).join('');
  const allRow = days.map(d => `<div class="wall">${onDate(list, d).filter(i => rank(i.ev) < 2).map(i => `<button type="button" class="wchip${i.ev.status === 'cancelled' ? ' is-cancel' : ''}" style="--c:${member(i.ev.ownerId)?.color}" data-action="open-event" data-id="${i.ev.id}" data-date="${i.date}">${i.ev.timeUnset ? '⏳ ' : ''}${esc(i.ev.title)}</button>`).join('')}</div>`).join('');
  const hours = [...Array(24 - H0)].map((_, k) => `<span style="top:${k * HOUR_PX}px">${H0 + k}:00</span>`).join('');
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const cols = days.map(d => {
    const timed = onDate(list, d).filter(i => rank(i.ev) === 2 && i.date === d);
    const lanes = [];
    const blocks = timed.map(i => {
      const s = Math.max(toMin(i.ev.startTime), H0 * 60);
      let e = i.ev.endTime && i.endDate === d ? toMin(i.ev.endTime) : (i.endDate > d ? 24 * 60 : toMin(i.ev.startTime) + 60);
      if (e <= s) e = s + 30;
      let lane = lanes.findIndex(end => end <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      return { i, s, e, lane };
    });
    const n = Math.max(1, lanes.length);
    return `<div class="wcol${d === t ? ' today' : ''}">${blocks.map(b => `<button type="button" class="wblk${b.i.ev.status === 'cancelled' ? ' is-cancel' : ''}" style="--c:${member(b.i.ev.ownerId)?.color};top:${(b.s - H0 * 60) / 60 * HOUR_PX}px;height:${Math.max(22, (b.e - b.s) / 60 * HOUR_PX - 2)}px;left:${b.lane / n * 100}%;width:${100 / n}%" data-action="open-event" data-id="${b.i.ev.id}" data-date="${b.i.date}"><em>${b.i.ev.startTime}</em> ${esc(b.i.ev.title)}</button>`).join('')}</div>`;
  }).join('');
  return `<div class="week"><div class="wrow whead"><span></span>${head}</div>
    <div class="wrow wallrow"><span class="wlab">종일·미정</span>${allRow}</div>
    <div class="wbody"><div class="whours">${hours}</div><div class="wcols" style="height:${(24 - H0) * HOUR_PX}px">${cols}</div></div></div>`;
}
function weekListHTML() {
  const c = ui.cal, start = D.startOfWeek(c.cursor);
  const list = instances(start, D.addDays(start, 6), c.filter);
  return `<div class="wlist">${[...Array(7)].map((_, k) => {
    const d = D.addDays(start, k), evs = onDate(list, d), iss = issuesOn(d).filter(i => !i.done);
    return `<section class="wl-day${d === D.today() ? ' today' : ''}"><button type="button" class="wl-h" data-action="cal-goday" data-date="${d}">${D.fmtDate(d)}${iss.length ? ` <span class="mpin">📌${iss.length}</span>` : ''}</button>
      ${evs.length ? `<ul class="ev-list ev-compact">${evs.map(i => evRow(i)).join('')}</ul>` : '<p class="muted small">일정 없음</p>'}</section>`;
  }).join('')}</div>`;
}
function dayHTML(d) {
  const list = onDate(instances(d, d, ui.cal.filter), d);
  const flex = list.filter(i => rank(i.ev) < 2), timed = list.filter(i => rank(i.ev) === 2);
  const iss = issuesOn(d);
  return `<div class="dayv">
    <section><h3 class="sub-h">하루 종일 · 시간 미정</h3>${flex.length ? `<ul class="ev-list">${flex.map(i => evRow(i)).join('')}</ul>` : '<p class="muted small">없음</p>'}</section>
    <section><h3 class="sub-h">시간별 일정</h3>${timed.length ? `<ul class="ev-list timeline">${timed.map(i => evRow(i)).join('')}</ul>` : empty('☁️', '시간이 정해진 일정이 없어요.')}</section>
    <section><h3 class="sub-h">이 날의 이슈 · 준비할 일</h3>${iss.length ? `<ul class="is-list">${iss.map(i => issueRow(i)).join('')}</ul>` : '<p class="muted small">없음</p>'}</section>
    <div class="day-add"><button type="button" class="btn-p" data-action="new-event" data-date="${d}">+ 일정</button><button type="button" class="btn-s" data-action="new-issue" data-date="${d}">+ 이슈</button></div>
  </div>`;
}
function dayPanelHTML(d) {
  const list = onDate(instances(d, d, ui.cal.filter), d);
  const iss = issuesOn(d);
  return `<header class="card-h"><h2>${D.fmtDate(d)}${d === D.today() ? ' <span class="tag tag-today">오늘</span>' : ''}</h2><button type="button" class="btn-g" data-action="cal-goday" data-date="${d}">하루 보기</button></header>
    <h3 class="sub-h">일정</h3>${list.length ? `<ul class="ev-list">${list.map(i => evRow(i)).join('')}</ul>` : empty('☁️', '이 날은 일정이 없어요.')}
    <h3 class="sub-h">이슈 · 준비할 일</h3>${iss.length ? `<ul class="is-list">${iss.map(i => issueRow(i)).join('')}</ul>` : '<p class="muted small">이 날 챙길 일이 없어요.</p>'}
    <div class="day-add"><button type="button" class="btn-p" data-action="new-event" data-date="${d}">+ 일정</button><button type="button" class="btn-s" data-action="new-issue" data-date="${d}">+ 이슈</button></div>`;
}
function calMove(dir) {
  const c = ui.cal;
  if (c.mode === 'month') c.cursor = D.addMonths(c.cursor, dir);
  else if (c.mode === 'week') c.cursor = D.addDays(c.cursor, 7 * dir);
  else c.cursor = D.addDays(c.cursor, dir);
  if (c.mode !== 'month') c.selected = c.mode === 'day' ? c.cursor : D.startOfWeek(c.cursor) <= c.selected && c.selected <= D.addDays(D.startOfWeek(c.cursor), 6) ? c.selected : c.cursor;
  else if (c.selected.slice(0, 7) !== c.cursor.slice(0, 7)) c.selected = c.cursor.slice(0, 7) === D.today().slice(0, 7) ? D.today() : c.cursor;
  renderCal();
}

// ───────────────────────── 연동·데이터 ─────────────────────────
function renderSync() {
  const a = S.sync.apple;
  const srcs = S.sources.filter(s => s.kind === 'ics-import');
  const counts = { 일정: S.events.length, 이슈: S.issues.length, 글: S.posts.length, 방명록: S.guestbook.length, 장소: S.places.length };
  const hasDemo = S.events.some(e => e.sourceId === 'src_demo') || S.issues.some(i => i.sourceId === 'src_demo');
  const photoBytes = S.posts.reduce((n, p) => n + (p.photo ? p.photo.length : 0), 0);
  $('#syncBody').innerHTML = `
  ${installCardHTML()}
  <section class="card card-sync"><header class="card-h"><h2>👪 가족 자동 동기화</h2>${syncPill()}</header>
    ${syncCardBody()}
  </section>
  <section class="card"><header class="card-h"><h2>🍎 Apple 캘린더 연결 상태</h2></header>
    <dl class="kv kv-wide">
      <div><dt>현재 연결 방식</dt><dd><b>.ics 파일로 주고받기 (수동)</b></dd></div>
      <div><dt>양방향 자동 동기화</dt><dd><span class="pill pill-off">지원하지 않음</span> <span class="small muted">아래 검토 결과 참고</span></dd></div>
      <div><dt>마지막 가져오기</dt><dd>${a.lastImportAt ? `${D.fmtStamp(a.lastImportAt)} · ${esc(a.lastImportFile || '')} · ${a.lastImportCount}건` : '<span class="muted">아직 가져온 적 없음</span>'}</dd></div>
      <div><dt>마지막 내보내기</dt><dd>${a.lastExportAt ? D.fmtStamp(a.lastExportAt) : '<span class="muted">아직 내보낸 적 없음</span>'}</dd></div>
      <div><dt>가져온 파일</dt><dd>${srcs.length ? srcs.map(s => `${esc(s.label)} <span class="muted small">(${D.fmtStamp(s.importedAt)})</span>`).join('<br>') : '<span class="muted">없음</span>'}</dd></div>
    </dl>
  </section>
  <div class="sync-grid">
    <section class="card"><header class="card-h"><h2>가져오기 · .ics → 가족 캘린더</h2></header>
      <ol class="steps">
        <li>Mac <b>캘린더</b> 앱에서 가져올 캘린더를 고른 뒤 <b>파일 › 내보내기 › 내보내기…</b>로 .ics 파일을 저장해요.</li>
        <li>아래에서 파일을 고르면 미리 보기 후 가족 캘린더에 넣어요. 같은 일정(UID)은 새로 만들지 않고 갱신해요.</li>
      </ol>
      <label class="file-btn btn-p"><input type="file" accept=".ics,text/calendar" data-change="import-ics" hidden>📂 .ics 파일 고르기</label>
      <p class="small muted">반복 예외(특정 회차만 바뀐 일정)와 일부 복잡한 반복 규칙은 아직 가져오지 않고, 몇 건 건너뛰었는지 알려 드려요.</p>
    </section>
    <section class="card"><header class="card-h"><h2>내보내기 · 가족 캘린더 → Apple 캘린더</h2></header>
      <p>가족 전체 공개 일정(과 지금 보는 사람의 '본인만' 일정)을 .ics 파일 하나로 받아요. 아이폰 Safari에서는 받은 파일을 열면 <b>캘린더에 추가</b> 화면이 떠요.</p>
      <button type="button" class="btn-p" data-action="export-ics">⬇️ 전체 일정 .ics 받기</button>
      <p class="small muted">일정 하나만 보내려면 일정 창의 <b>Apple 캘린더에 추가</b> 버튼을 쓰세요. 같은 파일을 여러 번 추가하면 Apple 캘린더에 중복으로 들어갈 수 있어요.</p>
    </section>
  </div>
  <section class="card"><header class="card-h"><h2>🔍 양방향 자동 동기화가 가능한지 검토했어요</h2></header>
    <ul class="check">
      <li><b>이 앱은 GitHub Pages의 정적 페이지예요.</b> 서버가 없어서 백그라운드로 주기적 동기화를 돌릴 수 없어요.</li>
      <li><b>iCloud 캘린더는 공개 웹 API가 없고 CalDAV만 있어요.</b> CalDAV에는 Apple ID 앱 전용 암호가 필요하고, 브라우저에서 바로 호출하면 교차 출처(CORS) 정책에 막혀요.</li>
      <li><b>앱 전용 암호를 브라우저나 공개 저장소에 두는 것은 위험해요.</b> 그래서 이 앱은 암호를 받지 않아요.</li>
      <li><b>가능한 다음 단계:</b> ① 인증이 있는 가족 전용 서버(DB)를 두고 그 서버가 CalDAV로 동기화, ② 아이폰 앱(EventKit)으로 직접 연동, ③ 서버가 구독용 캘린더 주소(.ics, 읽기 전용)를 제공.</li>
      <li>그 전까지는 <b>파일로 주고받는 수동 방식</b>만 제공하고, 화면 어디에도 '자동 동기화 중'이라고 표시하지 않아요.</li>
    </ul>
  </section>
  <section class="card"><header class="card-h"><h2>💬 카톡 글로 일정 만들기</h2></header>
    <p>단톡방에서 복사한 글을 붙여 넣으면 날짜·시간·장소·담당자를 찾아 <b>일정 후보</b>를 보여 줘요. 확인하고 저장한 것만 캘린더에 들어가요. 카톡을 자동으로 읽지는 않아요.</p>
    <button type="button" class="btn-p" data-action="kakao">💬 카톡 글 붙여 넣기</button>
  </section>
  <section class="card"><header class="card-h"><h2>📲 다른 기기로 옮기기</h2></header>
    <p>가족 데이터는 기기마다 따로 저장돼요. 이 기기의 일정·이슈·여행·살 것 목록을 <b>링크 하나</b>에 담아 다른 기기(아이폰 등)에서 열면 합쳐져요. 예시와 '본인만' 항목, 사진은 빠져요.</p>
    <button type="button" class="btn-p" data-action="make-share">🔗 옮기기 링크 만들기</button>
    <div id="shareOut" hidden><input class="share-url" readonly aria-label="옮기기 링크"></div>
    <p class="small muted">링크에는 일정 내용이 들어 있어요. 주소의 # 뒤 부분은 웹사이트 서버로 전송되지 않지만, 메신저로 보내면 그 메신저에는 남을 수 있으니 AirDrop이나 나에게 보내기처럼 가족만 보는 곳으로 보내 주세요. 아직 자동 공유는 아니라서, 한쪽에서 고친 뒤 다시 옮겨야 해요.</p>
  </section>
  <section class="card"><header class="card-h"><h2>💾 데이터 저장 범위</h2><span class="pill ${ui.saveError ? 'pill-err' : 'pill-on'}">${ui.saveError ? '저장 실패' : '저장됨'}</span></header>
    <dl class="kv kv-wide">
      <div><dt>저장 위치</dt><dd><b>${STORAGE_MODE.label}</b><br><span class="small muted">${STORAGE_MODE.detail}</span></dd></div>
      <div><dt>마지막 저장</dt><dd>${S.meta.updatedAt ? D.fmtStamp(S.meta.updatedAt) : '—'}</dd></div>
      <div><dt>담긴 항목</dt><dd>${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}${photoBytes ? ` · 사진 약 ${Math.round(photoBytes / 1024)}KB` : ''}</dd></div>
      <div><dt>가족 계정</dt><dd><span class="muted">아직 없음 · 나중에 가족 계정과 초대 기능을 붙일 수 있게 자리를 만들어 두었어요.</span></dd></div>
    </dl>
    <div class="btn-row">
      <button type="button" class="btn-s" data-action="backup">백업 파일(JSON) 받기</button>
      <label class="btn-s file-btn"><input type="file" accept="application/json,.json" data-change="restore" hidden>백업 불러오기</label>
      ${hasDemo ? '<button type="button" class="btn-s" data-action="strip-demo">예시 데이터 지우기</button>' : ''}
      ${connected() ? '<span class="small muted">가족 동기화 중에는 전체 초기화를 막아 두었어요(다른 가족 기기까지 지워지지 않도록).</span>' : `<button type="button" class="btn-g" data-action="reset-demo">예시로 되돌리기</button>
      <button type="button" class="btn-g danger" data-action="reset-empty">모두 지우기</button>`}
    </div>
  </section>
  <section class="card"><header class="card-h"><h2>🔒 개인정보 · 공개 범위</h2></header>
    <ul class="check">
      <li>이 페이지 주소는 공개 웹에 있지만, <b>가족 데이터는 이 기기 브라우저에만</b> 있어요. 저장소(GitHub)에는 올라가지 않아요.</li>
      <li>검색엔진 색인을 막아 두었고, 사이트 메뉴에도 연결하지 않았어요.</li>
      <li>필요한 정보만 받아요: 호칭·일정·장소 이름 정도이고, 주소·연락처·주민번호 같은 정보는 받지 않아요. 사진은 작게 줄여 이 기기에만 보관해요.</li>
      <li><b>'본인만' 공개는 아직 잠금이 아니에요.</b> 위쪽 '지금 보는 사람'을 바꾸면 누구나 볼 수 있어요. 가족 계정이 생기면 실제 권한으로 바뀌도록 모든 항목에 공개 범위를 저장해요.</li>
    </ul>
  </section>`;
}


function tripCommentsHTML(t) {
  const list = (S.tripComments || []).filter(c => c.tripId === t.id && canSee(c)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `<section class="t-comments"><h3 class="sub-h">💬 여행 이야기 <small class="muted">${list.length}개</small></h3>
    ${list.length ? `<ul class="gb-list">${list.map(c => `<li style="--c:${member(c.authorId)?.color || '#FF8FB8'}">${face(member(c.authorId))}<div><p><b>${esc(memberName(c.authorId))}</b> ${esc(c.text)}</p><small>${D.fmtStamp(c.createdAt)}${c.visibility === 'private' ? ' · 🔒' : ''}${srcTag(c)}</small></div>${c.authorId === ui.viewer ? `<button type="button" class="btn-x" data-action="del-tcomment" data-id="${c.id}" aria-label="댓글 삭제">✕</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">가고 싶은 곳, 먹고 싶은 것, 걱정되는 것을 편하게 남겨 보세요.</p>'}
    <form class="gb-form" data-submit="trip-comment" data-id="${t.id}">
      <span class="gb-me">${face(member(ui.viewer))}</span>
      <input name="text" maxlength="200" required placeholder="${esc(memberName(ui.viewer))}(으)로 댓글 남기기" aria-label="여행 댓글">
      <button class="btn-p btn-sm">남기기</button>
    </form>
  </section>`;
}
// ───────────────────────── 앱으로 설치(PWA) ─────────────────────────
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (ui.view === 'sync') renderSync(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('앱으로 설치했어요 🏠'); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installCardHTML() {
  if (isStandalone()) return `<section class="card"><header class="card-h"><h2>📱 앱으로 쓰는 중</h2><span class="pill pill-on">설치됨</span></header><p class="small muted">홈 화면 아이콘으로 열었어요. 인터넷이 끊겨도 화면은 열리고, 입력한 내용은 이 기기에 저장돼요.</p></section>`;
  const how = isIOS()
    ? `<ol class="steps"><li><b>Safari</b>로 이 페이지를 열어요. (카톡 안 브라우저에서는 안 돼요 → 오른쪽 아래 메뉴에서 'Safari로 열기')</li><li>아래쪽 <b>공유 버튼(□↑)</b>을 눌러요.</li><li><b>홈 화면에 추가</b>를 누르고 '추가'를 눌러요.</li></ol>`
    : deferredInstall
      ? `<button type="button" class="btn-p" data-action="install-app">📲 앱으로 설치하기</button>`
      : `<ol class="steps"><li>Chrome 메뉴(⋮)를 열어요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.</li></ol>`;
  return `<section class="card card-install"><header class="card-h"><h2>📱 휴대폰 앱으로 설치하기</h2></header>
    <div class="install-row"><img src="img/icon-192.png" alt="" class="app-ico"><div><p>홈 화면에 <b>우리집</b> 아이콘이 생기고, 주소창 없이 앱처럼 전체 화면으로 열려요. 인터넷이 끊겨도 화면은 열려요.</p>${how}</div></div>
  </section>`;
}
function syncPill() {
  const s = ui.sync || {};
  if (s.state === 'connected') return `<span class="pill pill-on">${s.realtime ? '실시간 연결됨' : '연결됨'}</span>`;
  if (s.state === 'error') return '<span class="pill pill-err">문제 있음</span>';
  if (s.state === 'off') return '<span class="pill pill-off">준비 중</span>';
  return '<span class="pill pill-off">연결 안 됨</span>';
}
function memberPick(name = 'memberId') {
  return `<fieldset class="fld chips"><legend>나는 누구인가요?</legend>${S.members.map((m, i) => `<label style="--c:${m.color}"><input type="radio" name="${name}" value="${m.id}" ${m.id === ui.viewer ? 'checked' : ''} required><span>${face(m)}${esc(m.displayName)}</span></label>`).join('')}</fieldset>`;
}
function syncCardBody() {
  const s = ui.sync || { state: 'off' };
  if (!syncConfigured() || s.state === 'off') return `<p>가족 서버가 아직 연결되지 않았어요. 연결되면 가족 계정으로 로그인해 일정·이슈·여행·살 것 목록이 모든 기기에 자동으로 맞춰져요.</p>`;
  if (s.state === 'signed-out') return `<p>가족 각자 <b>이메일과 비밀번호</b>로 로그인하면, 한 사람이 고친 내용이 다른 가족의 폰·컴퓨터에도 바로 반영돼요. 처음이면 '처음이에요'로 계정을 만들어요.</p>
    <form class="sync-form sync-col" data-submit="sync-login">
      <input type="email" name="email" required autocomplete="email" placeholder="이메일 주소" aria-label="이메일 주소">
      <input type="password" name="password" required minlength="8" autocomplete="current-password" placeholder="비밀번호 (8자 이상)" aria-label="비밀번호">
      <div class="sync-row"><button class="btn-p" name="how" value="up">🌱 처음이에요 · 계정 만들기</button><button class="btn-s" name="how" value="in">이미 계정이 있어요 · 로그인</button></div>
    </form>
    <p class="small muted">비밀번호는 이 앱이 아니라 가족 서버(Supabase)의 로그인 기능이 안전하게 보관해요. 다른 곳과 같은 비밀번호는 쓰지 마세요.</p>`;
  if (s.state === 'connecting') return '<p>연결하는 중이에요…</p>';
  if (s.state === 'no-family') return `<p><b>${esc(s.user?.email || '')}</b>(으)로 로그인했어요. 처음이면 가족을 만들고, 이미 가족이 만들었다면 초대 코드로 참여하세요.</p>
    <form class="sync-form sync-col" data-submit="sync-join">${memberPick()}
      <div class="sync-row"><input name="code" maxlength="20" placeholder="초대 코드 (예: 3f9a1c2b7d4e)" aria-label="초대 코드" autocapitalize="off"><button class="btn-p" name="how" value="join">초대 코드로 참여</button></div>
      <div class="sync-row"><span class="muted small">또는</span><button class="btn-s" name="how" value="create">우리 가족 새로 만들기</button></div>
    </form>
    <button type="button" class="btn-g btn-sm" data-action="sync-signout">로그아웃</button>`;
  const me = member(s.membership?.member_id);
  return `<dl class="kv kv-wide">
      <div><dt>로그인</dt><dd>${esc(s.user?.email || '')} · <b>${esc(me?.displayName || '')}</b>(으)로 사용 중</dd></div>
      <div><dt>가족 초대</dt><dd class="small muted">초대 코드는 관리자가 🛠 관리자 탭에서 필요할 때만 만들어요(한 번만 쓸 수 있고 24시간 뒤 사라져요).</dd></div>
      <div><dt>동기화 상태</dt><dd>${s.error ? `<span class="pill pill-err">${esc(s.error)}</span>` : s.pending ? '올리는 중…' : '모두 맞춰져 있어요'}${s.lastSyncAt ? ` · 마지막 동기화 ${D.fmtStamp(s.lastSyncAt)}` : ''}${s.realtime ? ' · 실시간 수신 중' : ''}</dd></div>
    </dl>
    <div class="btn-row"><button type="button" class="btn-s" data-action="sync-now">지금 동기화</button><button type="button" class="btn-g" data-action="sync-signout">로그아웃</button></div>
    <p class="small muted">일정·이슈·여행·댓글·살 것 목록·상태·방 꾸미기가 함께 맞춰져요. 예시 데이터는 올라가지 않아요. 로그아웃해도 이 기기의 데이터는 남아요.</p>`;
}


// ───────────────────────── 변경 내역 · 가족 소식 ─────────────────────────
const FIELD_LABEL = { title: '제목', startDate: '날짜', endDate: '끝나는 날', startTime: '시작 시간', endTime: '종료 시간', allDay: '하루 종일', timeUnset: '시간 미정', placeId: '장소', ownerId: '담당자', attendeeIds: '참석자', status: '상태', visibility: '공개 범위', memo: '메모', pinned: '고정', rr: '반복' };
function diffEvent(a, b) {
  if (!a) return [];
  const out = [];
  const bb = { ...b, rr: JSON.stringify(rule(b.recurrenceRuleId) || null) };
  for (const k of Object.keys(FIELD_LABEL)) {
    if (JSON.stringify(a[k] ?? null) === JSON.stringify(bb[k] ?? null)) continue;
    if (k === 'ownerId') out.push(`담당자 ${memberName(a.ownerId)} → ${memberName(b.ownerId)}`);
    else if (k === 'startDate') out.push(`날짜 ${D.fmtDate(a.startDate)} → ${D.fmtDate(b.startDate)}`);
    else if (k === 'startTime' && a.startTime && b.startTime) out.push(`시간 ${a.startTime} → ${b.startTime}`);
    else if (k === 'status') out.push(`상태 ${M.EVENT_STATUS.find(x => x.k === b.status)?.l}`);
    else out.push(`${FIELD_LABEL[k]} 변경`);
  }
  return [...new Set(out)];
}
function addHistory(ev, changes) {
  ev.history ||= [];
  ev.history.push({ at: new Date().toISOString(), by: ui.viewer, changes });
  if (ev.history.length > 20) ev.history = ev.history.slice(-20);
}
function historyHTML(ev) {
  const h = (ev.history || []).slice().reverse();
  if (!h.length) return ev.createdAt ? `<p class="meta-line">만든 사람: ${esc(memberName(ev.createdBy))} · ${D.fmtStamp(ev.createdAt)}</p>` : '';
  return `<details class="history"><summary>🕘 변경 내역 ${h.length}건</summary><ul>${h.map(x => `<li><b>${esc(memberName(x.by))}</b> · ${D.fmtStamp(x.at)}<br>${x.changes.map(esc).join(', ')}</li>`).join('')}</ul></details>`;
}
/** 가족 소식: 항목 하나씩 저장해 동기화 때 서로 덮어쓰지 않는다. 최근 150개만 둔다. */
function logActivity(kind, targetId, text) {
  S.activity ||= [];
  S.activity.push({ id: M.newId('ac'), at: new Date().toISOString(), by: ui.viewer, kind, targetId, text, sourceId: 'src_manual' });
  if (S.activity.length > 150) S.activity = S.activity.slice(-150);
}
function activityCard() {
  const seen = loadPref(`seen:${ui.viewer}`) || '';
  const list = (S.activity || []).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const fresh = list.filter(a => a.by !== ui.viewer && a.at > seen).length;
  return `<section class="card o-7"><header class="card-h"><h2>🔔 가족 소식 ${fresh ? `<span class="tag tag-high">새 소식 ${fresh}</span>` : ''}</h2>${fresh ? '<button type="button" class="btn-g btn-sm" data-action="seen-activity">다 읽음</button>' : ''}</header>
    ${list.length ? `<ul class="act-list">${list.map(a => `<li class="${a.by !== ui.viewer && a.at > seen ? 'new' : ''}" style="--c:${member(a.by)?.color || '#FF8FB8'}">${face(member(a.by))}<div><p>${esc(a.text)}</p><small>${esc(memberName(a.by))} · ${D.relTime(a.at)}</small></div>${a.kind === 'event' && S.events.some(e => e.id === a.targetId) ? `<button type="button" class="btn-g btn-sm" data-action="open-event" data-id="${a.targetId}">보기</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">일정을 추가하거나 고치면 누가 언제 바꿨는지 여기에 쌓여요. 가족 동기화를 켜면 다른 가족의 변경도 보여요.</p>'}
  </section>`;
}

// ───────────────────────── 카톡 붙여넣기 → 일정 후보 ─────────────────────────
function kakaoDialog() {
  openDialog({
    title: '💬 카톡 글로 일정 만들기', cls: 'dlg-kakao',
    body: `<p class="small muted">카톡을 자동으로 읽지 않아요. 단톡방에서 <b>직접 복사한 글</b>을 붙여 넣으면 날짜·시간·장소·담당자를 찾아 <b>후보</b>로 보여 드려요. 확인하고 저장하기 전에는 캘린더에 들어가지 않아요.</p>
      <label class="fld"><span>복사한 카톡 글</span><textarea name="raw" rows="6" placeholder="예) 토요일 3시 치과 예약했어요. 진료카드 챙겨주세요!"></textarea></label>
      <div class="kk-out"></div>`,
    actions: '<button type="submit" value="parse" class="btn-s" formnovalidate>후보 찾기</button><span class="sp"></span><button type="submit" value="save" class="btn-p" disabled>선택한 후보 저장</button>',
    onMount(f) { f.raw.focus(); },
    onSubmit(f, sub) {
      if (sub === 'parse') {
        const res = parseKakao(f.raw.value, { today: D.today(), members: S.members, viewer: ui.viewer });
        const out = f.querySelector('.kk-out');
        if (!res.events.length && !res.preps.length) { out.innerHTML = '<p class="form-err">날짜나 시간을 찾지 못했어요. "11월 20일 3시 …"처럼 날짜와 시간이 들어간 글을 붙여 넣어 주세요.</p>'; return false; }
        out.innerHTML = `<h3 class="sub-h">찾은 일정 후보 ${res.events.length}개</h3>
          ${res.events.map((c, i) => `<div class="kk-cand${c.needsCheck ? ' check' : ''}">
            <label class="kk-pick"><input type="checkbox" name="pick" value="${i}" checked> 저장${c.needsCheck ? ' <span class="tag tag-tent">확인 필요</span>' : ''}</label>
            <p class="kk-src">“${esc(c.line)}”</p>
            <div class="fld-row"><label class="fld"><span>제목</span><input name="t${i}" value="${esc(c.title)}" maxlength="60"></label><label class="fld"><span>장소</span><input name="p${i}" value="${esc(c.place)}" maxlength="40"></label></div>
            <div class="fld-row kk-3"><label class="fld"><span>날짜</span><input type="date" name="d${i}" value="${c.date}"></label><label class="fld"><span>시작</span><input type="time" name="s${i}" value="${c.startTime || ''}"></label><label class="fld"><span>종료</span><input type="time" name="e${i}" value="${c.endTime || ''}"></label></div>
            <label class="fld"><span>담당자</span><select name="o${i}">${memberOpts(c.ownerId || ui.viewer)}</select></label>
          </div>`).join('')}
          ${res.preps.length ? `<h3 class="sub-h">찾은 준비 항목 ${res.preps.length}개</h3>${res.preps.map((p, i) => `<label class="kk-prep"><input type="checkbox" name="prep" value="${i}" checked> 🎒 <input name="pt${i}" value="${esc(p.title)}" maxlength="50"> <input type="date" name="pd${i}" value="${p.date || D.today()}"></label>`).join('')}` : ''}
          <p class="small muted">시간을 비워 두면 '시간 미정'으로 저장돼요. 저장한 항목의 출처는 '카톡 붙여넣기'로 남아요.</p>`;
        f._kk = res;
        f.querySelector('button[value=save]').disabled = false;
        return false;
      }
      const res = f._kk;
      if (!res) return '먼저 후보 찾기를 눌러 주세요.';
      const now = new Date().toISOString();
      if (!S.sources.some(x => x.id === 'src_kakao')) S.sources.push({ id: 'src_kakao', kind: 'kakao-paste', label: '카톡 붙여넣기' });
      const picks = $$('input[name=pick]:checked', f).map(x => +x.value);
      const made = [];
      for (const i of picks) {
        const title = f[`t${i}`].value.trim() || '새 일정';
        const date = f[`d${i}`].value || D.today();
        const st = f[`s${i}`].value || null, et = f[`e${i}`].value || null;
        if (st && et && et <= st) return `'${title}' 종료 시간이 시작 시간보다 늦어야 해요.`;
        const placeName = f[`p${i}`].value.trim();
        let placeId = null;
        if (placeName) { let p = S.places.find(x => x.name === placeName); if (!p) { p = { id: M.newId('pl'), name: placeName }; S.places.push(p); } placeId = p.id; }
        const owner = f[`o${i}`].value;
        const ev = { id: M.newId('ev'), title, startDate: date, endDate: date, startTime: st, endTime: st ? et : null, allDay: false, timeUnset: !st, placeId, ownerId: owner, attendeeIds: [owner], memo: res.events[i].line.slice(0, 300), status: 'confirmed', sourceId: 'src_kakao', externalUid: null, recurrenceRuleId: null, exDates: [], visibility: 'family', createdBy: ui.viewer, createdAt: now, updatedAt: now };
        addHistory(ev, ['카톡 글에서 만듦']);
        S.events.push(ev); made.push(ev);
        logActivity('event', ev.id, `'${title}' 일정을 카톡 글에서 추가했어요 (${D.fmtDate(date)})`);
      }
      let preps = 0;
      for (const x of $$('input[name=prep]:checked', f).map(x => +x.value)) {
        const title = f[`pt${x}`].value.trim();
        if (!title) continue;
        const date = f[`pd${x}`].value || D.today();
        const ev = made.find(e => e.startDate === date);
        S.issues.push({ id: M.newId('is'), title, date, type: 'prep', ownerId: ev?.ownerId || '', done: false, priority: 'normal', eventId: ev?.id || null, sourceId: 'src_kakao', visibility: 'family', createdBy: ui.viewer, createdAt: now, updatedAt: now });
        preps++;
      }
      if (!made.length && !preps) return '저장할 후보를 하나 이상 골라 주세요.';
      persist(); renderAll(); toast(`카톡 글에서 일정 ${made.length}개${preps ? `, 준비 항목 ${preps}개` : ''}를 저장했어요.`);
      return true;
    },
  });
}


// ───────────────────────── 관리자 모드 ─────────────────────────
// 관리자 = 가족을 처음 만든 사람. 동기화 전(이 기기 전용)에는 이 기기 사용자가 관리자다.
// 계정 내보내기·초대 코드·가족 이름은 서버(RPC)에서도 관리자만 할 수 있게 막혀 있다.
const isAdmin = () => !connected() || !!ui.sync?.membership?.isAdmin;
async function loadAccounts() {
  if (!connected()) { ui.admin.accounts = null; return; }
  try { ui.admin.accounts = await sync.listAccounts(); ui.admin.accountsErr = null; }
  catch { ui.admin.accountsErr = '가족 계정 목록을 불러오지 못했어요.'; }
  if (ui.view === 'admin') renderAdmin();
}
function renderAdmin() {
  const box = $('#adminBody');
  const s = ui.sync || {};
  if (connected() && !isAdmin()) {
    box.innerHTML = `<section class="card"><header class="card-h"><h2>🛠 관리자 모드</h2><span class="pill pill-off">보기 전용</span></header>
      <p>관리자는 <b>가족을 처음 만든 사람</b>이에요. 구성원 이름·방 꾸미기는 각자 방에서 바꿀 수 있고, 계정·초대 코드 관리는 관리자에게 부탁해 주세요.</p></section>`;
    return;
  }
  if (connected() && !ui.admin.accounts && !ui.admin.accountsErr) loadAccounts();
  const counts = [['일정', S.events], ['이슈', S.issues], ['여행', S.trips || []], ['여행 댓글', S.tripComments || []], ['살 것·준비할 것', S.boardItems || []], ['글', S.posts], ['방명록', S.guestbook], ['가족 소식', S.activity || []]]
    .map(([l, a]) => [l, a.filter(x => x.sourceId !== 'src_demo').length, a.filter(x => x.sourceId === 'src_demo').length]);
  const evs = S.events.filter(e => e.sourceId !== 'src_demo').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const today = D.today();
  const oldEvents = S.events.filter(e => e.sourceId !== 'src_demo' && !e.recurrenceRuleId && !e.pinned && (e.endDate || e.startDate) < D.addDays(today, -60)).length;
  const doneIssues = S.issues.filter(i => i.done && i.date < today).length;
  const acc = ui.admin.accounts;
  box.innerHTML = `
  <section class="card"><header class="card-h"><h2>🛠 관리자 모드</h2><span class="pill pill-on">${connected() ? '가족 관리자' : '이 기기 관리자'}</span></header>
    <p class="small muted">${connected() ? `${esc(s.user?.email || '')} 계정이 이 가족을 만들어서 관리자예요.` : '아직 가족 동기화 전이라, 이 기기에서 쓰는 사람이 관리자예요. 동기화를 켜면 가족을 만든 사람이 관리자가 돼요.'}</p>
  </section>

  <section class="card"><header class="card-h"><h2>👪 가족 정보</h2></header>
    <form class="adm-form" data-submit="adm-family">
      <label class="fld"><span>가족 이름</span><input name="name" maxlength="20" value="${esc(s.family?.name || S.family.name || '우리 가족')}"></label>
      <button class="btn-p btn-sm">저장</button>
    </form>
  </section>

  <section class="card"><header class="card-h"><h2>🧑‍🤝‍🧑 구성원 프로필</h2><span class="hint">이름·역할·방 이름·색</span></header>
    <form data-submit="adm-members" class="adm-members">
      ${S.members.map(m => `<fieldset class="adm-mem" style="--c:${m.color}"><legend>${face(m)} ${m.floor}F</legend>
        <label class="fld"><span>부르는 이름</span><input name="dn_${m.id}" maxlength="10" value="${esc(m.displayName)}" required></label>
        <label class="fld"><span>역할</span><input name="rl_${m.id}" maxlength="6" value="${esc(m.roleLabel)}" required></label>
        <label class="fld"><span>방 이름</span><input name="sp_${m.id}" maxlength="16" value="${esc(m.space.name)}" required></label>
        <label class="fld adm-color"><span>색</span><input type="color" name="co_${m.id}" value="${m.color}"></label>
      </fieldset>`).join('')}
      <div class="btn-row"><button class="btn-p">프로필 저장</button></div>
    </form>
  </section>

  ${connected() ? `<section class="card"><header class="card-h"><h2>🔑 가족 계정</h2><button type="button" class="btn-g btn-sm" data-action="adm-reload">새로고침</button></header>
    ${ui.admin.accountsErr ? `<p class="form-err">${esc(ui.admin.accountsErr)}</p>` : !acc ? '<p class="muted small">불러오는 중…</p>' : `<ul class="adm-acc">${acc.map(a => `<li style="--c:${member(a.member_id)?.color || '#FF8FB8'}">${face(member(a.member_id))}<div><b>${esc(memberName(a.member_id))}</b>${a.admin ? ' <span class="tag tag-today">관리자</span>' : ''}${a.me ? ' <span class="tag tag-src">나</span>' : ''}<br><small>${esc(a.email || '이메일 정보 없음')} · ${D.fmtStamp(a.joined_at)} 참여</small></div>${a.me ? '' : `<button type="button" class="btn-g danger btn-sm" data-action="adm-remove" data-id="${a.user_id}" data-name="${esc(a.email || memberName(a.member_id))}">내보내기</button>`}</li>`).join('')}</ul>`}
    <dl class="kv kv-wide"><div><dt>초대 코드</dt><dd>${ui.admin.invite ? `<code class="invite">${esc(ui.admin.invite)}</code> <button type="button" class="btn-s btn-sm" data-action="copy-invite">복사</button> ` : '<span class="muted">지금은 닫혀 있어요.</span> '}<button type="button" class="btn-g btn-sm" data-action="adm-rotate">${ui.admin.invite ? '새 코드 만들기' : '초대 코드 만들기'}</button><br><span class="small muted">코드는 <b>한 사람이 한 번만</b> 쓸 수 있고 <b>24시간</b> 뒤 사라져요. 가족이 참여하면 바로 닫혀요. 이미 참여한 가족은 그대로예요.</span></dd></div></dl>
  </section>` : ''}

  <section class="card"><header class="card-h"><h2>📊 데이터 한눈에</h2></header>
    <table class="adm-table"><thead><tr><th>종류</th><th>우리 데이터</th><th>예시</th></tr></thead><tbody>${counts.map(([l, n, d]) => `<tr><td>${l}</td><td><b>${n}</b></td><td class="muted">${d || '-'}</td></tr>`).join('')}</tbody></table>
    <div class="btn-row">
      <button type="button" class="btn-s" data-action="adm-clean-old" ${oldEvents ? '' : 'disabled'}>60일 지난 일정 정리 (${oldEvents})</button>
      <button type="button" class="btn-s" data-action="adm-clean-done" ${doneIssues ? '' : 'disabled'}>지난 완료 이슈 정리 (${doneIssues})</button>
      <button type="button" class="btn-s" data-action="backup">백업(JSON) 받기</button>
    </div>
    <p class="small muted">📌 고정 일정과 반복 일정은 정리 대상에서 빠져요.</p>
  </section>

  <section class="card"><header class="card-h"><h2>📅 일정 관리</h2><span class="hint">${evs.length}개</span></header>
    ${evs.length ? `<div class="adm-ev-wrap"><table class="adm-table adm-ev"><thead><tr><th><input type="checkbox" data-change="adm-pick-all" aria-label="모두 선택"></th><th>날짜</th><th>제목</th><th>담당</th><th>표시</th></tr></thead><tbody>
      ${evs.map(e => `<tr><td><input type="checkbox" data-change="adm-pick" value="${e.id}" ${ui.admin.picked.has(e.id) ? 'checked' : ''} aria-label="${esc(e.title)} 선택"></td><td>${D.fmtDate(e.startDate, { wd: false })}${e.recurrenceRuleId ? ' 🔁' : ''}</td><td><button type="button" class="link-ev" data-action="open-event" data-id="${e.id}" data-date="${e.startDate}">${esc(e.title)}</button></td><td>${esc(memberName(e.ownerId))}</td><td>${e.pinned ? '📌' : ''}${e.status === 'cancelled' ? ' 취소' : ''}${e.visibility === 'private' ? ' 🔒' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="btn-row"><button type="button" class="btn-g danger" data-action="adm-delete-picked" ${ui.admin.picked.size ? '' : 'disabled'}>🗑️ 선택한 ${ui.admin.picked.size}개 삭제</button></div>` : '<p class="muted small">아직 직접 넣은 일정이 없어요.</p>'}
  </section>

  <section class="card"><header class="card-h"><h2>🕘 전체 활동 기록</h2><span class="hint">최근 ${Math.min(30, (S.activity || []).length)}건</span></header>
    ${(S.activity || []).length ? `<ul class="act-list">${(S.activity || []).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map(a => `<li style="--c:${member(a.by)?.color || '#FF8FB8'}">${face(member(a.by))}<div><p>${esc(a.text)}</p><small>${esc(memberName(a.by))} · ${D.fmtStamp(a.at)}</small></div></li>`).join('')}</ul>` : '<p class="muted small">아직 기록이 없어요.</p>'}
  </section>`;
}

// ───────────────────────── 대화상자 ─────────────────────────
function openDialog({ title, body, actions, onSubmit, onMount, cls = '' }) {
  const d = $('#dlg');
  d.className = cls;
  d.innerHTML = `<form class="dlg-form" novalidate>
    <header class="dlg-h"><h2>${title}</h2><button type="button" class="x" data-close aria-label="닫기">✕</button></header>
    <div class="dlg-b">${body}<p class="form-err" role="alert" hidden></p></div>
    <footer class="dlg-f">${actions}</footer></form>`;
  const f = d.querySelector('form');
  const err = f.querySelector('.form-err');
  f.addEventListener('submit', e => {
    e.preventDefault();
    const sub = e.submitter?.value || 'save';
    if (sub === 'save' && !f.checkValidity()) { f.reportValidity(); return; }
    err.hidden = true;
    const r = onSubmit?.(f, sub);
    if (typeof r === 'string') { err.textContent = r; err.hidden = false; return; }
    if (r !== false) d.close();
  });
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.showModal();
  onMount?.(f);
}
const opt = (list, val, lk = 'l') => list.map(o => `<option value="${o.k}" ${o.k === val ? 'selected' : ''}>${o[lk]}</option>`).join('');
const memberOpts = (val, allowAll = false) => (allowAll ? `<option value="" ${!val ? 'selected' : ''}>👪 가족 모두</option>` : '') + S.members.map(m => `<option value="${m.id}" ${m.id === val ? 'selected' : ''}>${esc(m.displayName)}${m.roleLabel !== m.displayName ? ` (${m.roleLabel})` : ''}</option>`).join('');

function openEvent(id, occDate) {
  const ev = S.events.find(e => e.id === id);
  if (!ev) return toast('일정을 찾을 수 없어요.', 'err');
  eventDialog(ev, occDate);
}
function newEvent(date, ownerId) {
  const owner = ownerId || ui.viewer;
  eventDialog({ title: '', startDate: date || D.today(), endDate: date || D.today(), startTime: '10:00', endTime: '11:00', allDay: false, timeUnset: false, placeId: null, ownerId: owner, attendeeIds: [owner], memo: '', status: 'confirmed', sourceId: 'src_manual', recurrenceRuleId: null, exDates: [], visibility: 'family' }, null);
}
function eventDialog(ev, occDate) {
  const isNew = !ev.id;
  const kind = ev.allDay ? 'allday' : ev.timeUnset || !ev.startTime ? 'unset' : 'timed';
  const rr = rule(ev.recurrenceRuleId);
  const src = source(ev.sourceId);
  const linked = isNew ? [] : S.issues.filter(i => i.eventId === ev.id && canSee(i)).sort((a, b) => a.date.localeCompare(b.date));
  const places = S.places.map(p => `<option value="${esc(p.name)}">`).join('');
  const byDay = rr?.byDay?.length ? rr.byDay : [D.DAYCODES[D.weekday(ev.startDate)]];
  const body = `
    <label class="fld"><span>제목</span><input name="title" required maxlength="60" value="${esc(ev.title)}" placeholder="예) 치과 진료"></label>
    <div class="fld-row">
      <label class="fld"><span>날짜</span><input type="date" name="startDate" required value="${ev.startDate}"></label>
      <label class="fld"><span>끝나는 날</span><input type="date" name="endDate" value="${ev.endDate || ev.startDate}"></label>
    </div>
    <fieldset class="fld seg-radio"><legend>시간</legend>
      ${[['timed', '시간 지정'], ['allday', '하루 종일'], ['unset', '시간 미정']].map(([k, l]) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </fieldset>
    <div class="fld-row times">
      <label class="fld"><span>시작</span><input type="time" name="startTime" value="${ev.startTime || '10:00'}"></label>
      <label class="fld"><span>종료</span><input type="time" name="endTime" value="${ev.endTime || ''}"></label>
    </div>
    <label class="fld"><span>장소</span><input name="place" maxlength="40" list="placeList" value="${esc(place(ev.placeId)?.name || '')}" placeholder="장소 이름만 적어요 (주소 불필요)"><datalist id="placeList">${places}</datalist></label>
    <div class="fld-row">
      <label class="fld"><span>담당자</span><select name="ownerId">${memberOpts(ev.ownerId)}</select></label>
      <label class="fld"><span>상태</span><select name="status">${opt(M.EVENT_STATUS, ev.status)}</select></label>
    </div>
    <fieldset class="fld chips"><legend>참석자</legend>${S.members.map(m => `<label style="--c:${m.color}"><input type="checkbox" name="att" value="${m.id}" ${(ev.attendeeIds || []).includes(m.id) ? 'checked' : ''}><span>${face(m)}${esc(m.displayName)}</span></label>`).join('')}</fieldset>
    <div class="fld-row">
      <label class="fld"><span>반복</span><select name="freq">${opt(M.FREQS, rr?.freq || '')}</select></label>
      <label class="fld rr-only"><span>반복 끝나는 날</span><input type="date" name="until" value="${rr?.until || ''}"></label>
    </div>
    <p class="muted small rr-hint">💡 위의 <b>끝나는 날</b>은 그 회차가 끝나는 날이에요. 하루짜리면 시작 날짜와 같게 두세요. 반복을 언제까지 할지는 <b>반복 끝나는 날</b>에 넣어요.</p>
    <fieldset class="fld chips rr-week"><legend>반복 요일</legend>${D.DAYCODES.map((c, i) => `<label><input type="checkbox" name="byday" value="${c}" ${byDay.includes(c) ? 'checked' : ''}><span>${D.WD[i]}</span></label>`).join('')}</fieldset>
    <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, ev.visibility)}</select></label>
    <label class="fld fld-check pin-check"><input type="checkbox" name="pinned" ${ev.pinned ? 'checked' : ''}><span>📌 고정 일정 <small class="muted">(예시 지우기·모두 지우기로 지워지지 않아요)</small></span></label>
    <label class="fld"><span>메모</span><textarea name="memo" rows="2" maxlength="300">${esc(ev.memo)}</textarea></label>
    <p class="meta-line">출처: <b>${esc(src?.label || '직접 입력')}</b>${ev.updatedAt ? ` · 마지막 수정 ${D.fmtStamp(ev.updatedAt)}` : ''}${rr && occDate ? ` · 반복 일정은 전체가 함께 수정돼요` : ''}</p>
    ${ev.tripId ? `<p class="trip-note">🧳 여행 계획과 연결된 일정이에요. 날짜·참여자는 <button type="button" class="btn-s btn-sm" data-action="open-trip" data-id="${ev.tripId}">여행 계획표</button>에서 바꾸면 함께 바뀌어요.</p>` : ''}
    ${historyHTML(ev)}
    ${isNew ? '' : `<div class="linked"><h3 class="sub-h">연결된 준비 항목</h3>${linked.length ? `<ul class="is-list">${linked.map(i => issueRow(i, { showDate: true })).join('')}</ul>` : '<p class="muted small">아직 없어요.</p>'}<button type="button" class="btn-s btn-sm" data-action="new-issue" data-date="${occDate || ev.startDate}" data-event="${ev.id}" data-owner="${ev.ownerId}">+ 준비 항목 추가</button></div>`}`;
  const actions = `${isNew ? '' : `<button type="submit" value="apple" class="btn-g" formnovalidate>🍎 Apple 캘린더에 추가</button>`}
    ${!isNew && rr && occDate ? `<button type="submit" value="skip" class="btn-g" formnovalidate>이 날만 취소</button><button type="submit" value="from-here" class="btn-g danger" formnovalidate>✂️ 이 날부터 모두 삭제</button>` : ''}
    ${!isNew ? `<button type="submit" value="cancel" class="btn-g" formnovalidate>${ev.status === 'cancelled' ? '취소 되돌리기' : '일정 취소'}</button><button type="submit" value="delete" class="btn-g danger" formnovalidate>🗑️ 삭제</button>` : ''}
    <span class="sp"></span><button type="submit" value="save" class="btn-p">${isNew ? '추가' : '저장'}</button>`;

  openDialog({
    title: isNew ? '새 일정' : '일정',
    body, actions, cls: 'dlg-event',
    onMount(f) {
      const sync = () => {
        const k = f.kind.value, fr = f.freq.value;
        f.querySelector('.times').hidden = k !== 'timed';
        f.querySelector('.rr-only').hidden = !fr;
        f.querySelector('.rr-hint').hidden = !fr;
        f.querySelector('.rr-week').hidden = fr !== 'WEEKLY';
      };
      f.addEventListener('change', e => {
        if (e.target.name === 'startDate' && f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value;
        if (e.target.name === 'startDate' && f.startDate.value) {
          // 반복 요일이 하나만 골라져 있으면 새 날짜의 요일로 따라간다
          const boxes = [...f.querySelectorAll('input[name=byday]')];
          if (boxes.filter(x => x.checked).length <= 1) boxes.forEach(x => { x.checked = x.value === D.DAYCODES[D.weekday(f.startDate.value)]; });
        }
        if (e.target.name === 'ownerId') { const c = f.querySelector(`input[name=att][value="${f.ownerId.value}"]`); if (c) c.checked = true; }
        sync();
      });
      sync();
      if (isNew) f.title.focus();
    },
    onSubmit(f, sub) {
      if (sub === 'apple') { exportEvents([ev], `${ev.title}.ics`); return false; }
      if (sub === 'delete') {
        const pinNote = ev.pinned ? '📌 고정 일정이에요. 고정을 풀고 삭제할까요?\n' : '';
        if (!confirm(`${pinNote}'${ev.title}' 일정을 삭제할까요? 되돌릴 수 없어요.${rr ? '\n반복 일정 전체(매주 반복 포함)가 삭제돼요. 하루만 빼려면 \'이 날만 취소\'를 눌러 주세요.' : ''}`)) return false;
        S.events = S.events.filter(e => e.id !== ev.id);
        if (rr) S.recurrenceRules = S.recurrenceRules.filter(r => r.id !== rr.id);
        S.issues.forEach(i => { if (i.eventId === ev.id) i.eventId = null; });
        (S.trips || []).forEach(t => { if (t.eventId === ev.id) t.eventId = null; });
        logActivity('event', ev.id, `'${ev.title}' 일정을 삭제했어요`);
        persist(); renderAll(); toast('일정을 삭제했어요.');
        return true;
      }
      if (sub === 'cancel') {
        ev.status = ev.status === 'cancelled' ? 'confirmed' : 'cancelled';
        ev.updatedAt = new Date().toISOString();
        addHistory(ev, [ev.status === 'cancelled' ? '일정 취소' : '취소 되돌림']);
        logActivity('event', ev.id, `'${ev.title}' ${ev.status === 'cancelled' ? '일정을 취소했어요' : '취소를 되돌렸어요'}`);
        persist(); renderAll(); toast(ev.status === 'cancelled' ? '일정을 취소로 표시했어요.' : '취소를 되돌렸어요.');
        return true;
      }
      if (sub === 'from-here') {
        // 이 회차부터 뒤는 모두 지우고, 앞 회차는 남긴다: 반복 끝나는 날을 전날로.
        if (occDate <= ev.startDate) {
          if (!confirm(`'${ev.title}'의 첫 회차예요. 반복 일정 전체를 삭제할까요?`)) return false;
          S.events = S.events.filter(e => e.id !== ev.id);
          S.recurrenceRules = S.recurrenceRules.filter(r => r.id !== rr.id);
          S.issues.forEach(i => { if (i.eventId === ev.id) i.eventId = null; });
          logActivity('event', ev.id, `'${ev.title}' 반복 일정을 모두 삭제했어요`);
          persist(); renderAll(); toast('반복 일정을 모두 삭제했어요.');
          return true;
        }
        if (!confirm(`'${ev.title}'을(를) ${D.fmtDate(occDate)}부터 모두 삭제할까요?\n그 전 회차는 그대로 남아요.`)) return false;
        const until = D.addDays(occDate, -1);
        rr.until = rr.until && rr.until < until ? rr.until : until;
        rr.count = null;
        ev.exDates = (ev.exDates || []).filter(x => x < occDate);
        ev.updatedAt = new Date().toISOString();
        addHistory(ev, [`${D.fmtDate(occDate)}부터 반복 끝`]);
        logActivity('event', ev.id, `'${ev.title}' ${D.fmtDate(occDate)}부터 모두 삭제했어요`);
        persist(); renderAll(); toast(`${D.fmtDate(occDate)}부터 모두 삭제했어요.`);
        return true;
      }
      if (sub === 'skip') {
        ev.exDates = [...new Set([...(ev.exDates || []), occDate])];
        ev.updatedAt = new Date().toISOString();
        addHistory(ev, [`${D.fmtDate(occDate)} 하루 빠짐`]);
        logActivity('event', ev.id, `'${ev.title}' ${D.fmtDate(occDate)} 하루를 뺐어요`);
        persist(); renderAll(); toast(`${D.fmtDate(occDate)} 하루만 뺐어요.`);
        return true;
      }
      // 저장
      const fd = new FormData(f);
      const title = String(fd.get('title')).trim();
      if (!title) return '제목을 적어 주세요.';
      const kindV = fd.get('kind');
      const startDate = fd.get('startDate');
      let endDate = fd.get('endDate') || startDate;
      if (endDate < startDate) endDate = startDate;
      let startTime = null, endTime = null;
      if (kindV === 'timed') {
        startTime = fd.get('startTime');
        endTime = fd.get('endTime') || null;
        if (!startTime) return '시작 시간을 정하거나 "시간 미정"을 골라 주세요.';
        if (endTime && endDate === startDate && endTime <= startTime) return '종료 시간이 시작 시간보다 늦어야 해요.';
      }
      const freq = fd.get('freq');
      const until = fd.get('until') || null;
      if (freq && until && until < startDate) return '반복 끝나는 날이 시작 날짜보다 빨라요.';
      // 한 회차가 다음 회차까지 이어지면 달력이 매일 채워진다. 「끝나는 날」과 「반복 끝나는 날」을 헷갈린 경우.
      if (freq && D.diffDays(startDate, endDate) >= ({ DAILY: 1, WEEKLY: 7, MONTHLY: 28, YEARLY: 365 }[freq] || 1))
        return '한 회차가 다음 회차까지 이어져서 달력이 매일 채워져요. 「끝나는 날」은 그 회차가 끝나는 날이에요. 반복을 언제까지 할지는 「반복 끝나는 날」에 넣어 주세요.';
      const now = new Date().toISOString();
      const target = isNew ? { id: M.newId('ev'), sourceId: 'src_manual', externalUid: null, exDates: [], createdBy: ui.viewer, createdAt: now } : ev;
      const placeName = String(fd.get('place') || '').trim();
      let placeId = null;
      if (placeName) {
        let p = S.places.find(x => x.name === placeName);
        if (!p) { p = { id: M.newId('pl'), name: placeName }; S.places.push(p); }
        placeId = p.id;
      }
      const ownerId = fd.get('ownerId');
      const att = new Set(fd.getAll('att')); att.add(ownerId);
      const before = isNew ? null : { ...target, rr: JSON.stringify(rule(target.recurrenceRuleId) || null) };
      Object.assign(target, {
        title, startDate, endDate, startTime, endTime,
        allDay: kindV === 'allday', timeUnset: kindV === 'unset',
        placeId, ownerId, attendeeIds: S.members.map(m => m.id).filter(id => att.has(id)),
        status: fd.get('status'), visibility: fd.get('visibility'), memo: String(fd.get('memo') || '').trim(),
        pinned: fd.get('pinned') === 'on',
        updatedAt: now,
      });
      if (freq) {
        let r = rule(target.recurrenceRuleId);
        if (!r) { r = { id: M.newId('rr') }; S.recurrenceRules.push(r); target.recurrenceRuleId = r.id; }
        const days = fd.getAll('byday');
        Object.assign(r, { freq, interval: 1, byDay: freq === 'WEEKLY' ? (days.length ? days : [D.DAYCODES[D.weekday(startDate)]]) : [], until, count: null });
      } else if (target.recurrenceRuleId) {
        S.recurrenceRules = S.recurrenceRules.filter(r => r.id !== target.recurrenceRuleId);
        target.recurrenceRuleId = null; target.exDates = [];
      } else target.recurrenceRuleId = null;
      if (isNew) { S.events.push(target); addHistory(target, ['새로 만듦']); logActivity('event', target.id, `'${target.title}' 일정을 추가했어요 (${D.fmtDate(target.startDate)})`); }
      else {
        const ch = diffEvent(before, target);
        if (ch.length) { addHistory(target, ch); logActivity('event', target.id, `'${target.title}' ${ch.join(', ')}`); }
      }
      persist(); renderAll(); toast(isNew ? '일정을 추가했어요.' : '일정을 저장했어요.');
      return true;
    },
  });
}

function issueDialog(is, preset = {}) {
  const isNew = !is;
  const x = is || { title: '', date: preset.date || D.today(), type: preset.eventId ? 'prep' : 'prep', ownerId: preset.ownerId ?? ui.viewer, priority: 'normal', eventId: preset.eventId || null, done: false, visibility: 'family', sourceId: 'src_manual' };
  const evOpts = d => {
    const list = onDate(instances(D.addDays(d, -7), D.addDays(d, 7)), d);
    const ids = new Set(list.map(i => i.ev.id));
    const extra = x.eventId && !ids.has(x.eventId) ? S.events.filter(e => e.id === x.eventId) : [];
    return `<option value="">연결 안 함</option>` + [...list.map(i => i.ev), ...extra].filter((e, i, a) => a.indexOf(e) === i)
      .map(e => `<option value="${e.id}" ${e.id === x.eventId ? 'selected' : ''}>${esc(timeLabel(e))} · ${esc(e.title)}</option>`).join('');
  };
  const body = `
    <label class="fld"><span>내용</span><input name="title" required maxlength="60" value="${esc(x.title)}" placeholder="예) 진료카드 챙기기"></label>
    <div class="fld-row">
      <label class="fld"><span>날짜</span><input type="date" name="date" required value="${x.date}"></label>
      <label class="fld"><span>유형</span><select name="type">${M.ISSUE_TYPES.map(t => `<option value="${t.k}" ${t.k === x.type ? 'selected' : ''}>${t.e} ${t.l}</option>`).join('')}</select></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>담당자</span><select name="ownerId">${memberOpts(x.ownerId, true)}</select></label>
      <label class="fld"><span>중요도</span><select name="priority">${opt(M.PRIORITY, x.priority)}</select></label>
    </div>
    <label class="fld"><span>관련 일정</span><select name="eventId">${evOpts(x.date)}</select></label>
    <div class="fld-row">
      <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, x.visibility)}</select></label>
      <label class="fld fld-check"><input type="checkbox" name="done" ${x.done ? 'checked' : ''}><span>완료했어요</span></label>
    </div>
    <p class="meta-line">일정은 '언제·어디서 무엇을', 이슈는 '그날 기억하거나 준비할 것'이에요.${!isNew ? ` · 출처: ${esc(source(x.sourceId)?.label || '직접 입력')}` : ''}</p>`;
  const actions = `${isNew ? '' : '<button type="submit" value="delete" class="btn-g danger" formnovalidate>삭제</button>'}<span class="sp"></span><button type="submit" value="save" class="btn-p">${isNew ? '추가' : '저장'}</button>`;
  openDialog({
    title: isNew ? '새 이슈 · 준비할 일' : '이슈 · 준비할 일', body, actions, cls: 'dlg-issue',
    onMount(f) {
      f.date.addEventListener('change', () => { x.date = f.date.value; f.eventId.innerHTML = evOpts(f.date.value); });
      if (isNew) f.title.focus();
    },
    onSubmit(f, sub) {
      if (sub === 'delete') {
        if (!confirm(`'${x.title}' 항목을 삭제할까요?`)) return false;
        S.issues = S.issues.filter(i => i.id !== x.id);
        persist(); renderAll(); toast('삭제했어요.');
        return true;
      }
      const fd = new FormData(f);
      const title = String(fd.get('title')).trim();
      if (!title) return '내용을 적어 주세요.';
      const now = new Date().toISOString();
      const wasDone = !!x.done;
      const target = isNew ? { id: M.newId('is'), sourceId: 'src_manual', createdBy: ui.viewer, createdAt: now } : x;
      Object.assign(target, {
        title, date: fd.get('date'), type: fd.get('type'), ownerId: fd.get('ownerId'),
        priority: fd.get('priority'), eventId: fd.get('eventId') || null, visibility: fd.get('visibility'),
        done: fd.get('done') === 'on', updatedAt: now,
      });
      if (isNew) { S.issues.push(target); logActivity('issue', target.id, `이슈 '${target.title}' (${D.fmtDate(target.date)})를 추가했어요`); }
      persist();
      if (target.done && !wasDone) celebrate(target); else renderAll();
      toast(isNew ? '이슈를 추가했어요.' : '저장했어요.');
      return true;
    },
  });
}

function statusDialog(m) {
  const s = m.status || {};
  const body = `
    <div class="st-preview" style="--c:${m.color}">${face(m, 'face-l')}<div><b>${esc(m.displayName)}</b><p class="small muted">설정하는 사람: ${esc(viewerName())} · 설정 시각이 함께 저장돼요. 12시간이 지나면 '확인 중'으로 바뀌어요.</p></div></div>
    <label class="fld"><span>상태 메시지</span><input name="text" maxlength="40" value="${esc(s.text || '')}" placeholder="예) 오늘은 칼퇴가 목표예요"></label>
    <fieldset class="fld chips"><legend>오늘의 기분</legend>${M.MOODS.map(o => `<label><input type="radio" name="mood" value="${o.k}" ${o.k === s.mood ? 'checked' : ''}><span>${o.e} ${o.l}</span></label>`).join('')}</fieldset>
    <fieldset class="fld chips"><legend>지금 하는 일 <small>(캐릭터 동작에 반영돼요)</small></legend>
      <label><input type="radio" name="activity" value="" ${!s.activity ? 'checked' : ''}><span>고르지 않음</span></label>
      ${M.ACTS.map(o => `<label><input type="radio" name="activity" value="${o.k}" ${o.k === s.activity ? 'checked' : ''}><span>${o.e} ${o.l}</span></label>`).join('')}</fieldset>
    <div class="fld-row">
      <label class="fld"><span>미니홈피 노래 제목 <small>(장식)</small></span><input name="bgm" maxlength="40" value="${esc(m.bgm || '')}" placeholder="재생되지 않아요"></label>
      <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, s.visibility || 'family')}</select></label>
    </div>`;
  const actions = `${m.status ? '<button type="submit" value="clear" class="btn-g" formnovalidate>상태 비우기</button>' : ''}<span class="sp"></span><button type="submit" value="save" class="btn-p">저장</button>`;
  openDialog({
    title: `${esc(m.displayName)}의 상태`, body, actions, cls: 'dlg-status',
    onSubmit(f, sub) {
      const fd = new FormData(f);
      m.bgm = String(fd.get('bgm') || '').trim();
      if (sub === 'clear') { m.status = null; persist(); renderAll(); toast('상태를 비웠어요.'); return true; }
      const text = String(fd.get('text') || '').trim();
      const mood = fd.get('mood') || null, activity = fd.get('activity') || null;
      if (!text && !mood && !activity) { m.status = null; persist(); renderAll(); toast('상태가 비어 있어 미설정으로 둘게요.'); return true; }
      m.status = { text, mood, activity, setAt: new Date().toISOString(), setBy: ui.viewer, visibility: fd.get('visibility') };
      if (fd.get('visibility') !== 'private') logActivity('status', m.id, `${m.displayName} 상태: ${text || M.ACTS.find(a => a.k === activity)?.l || '바뀜'}`);
      persist();
      if (activity === 'done') { ui.celebrate = { id: m.id, until: Date.now() + 2600 }; setTimeout(() => ui.view === 'world' && renderStage(), 2700); }
      renderAll(); toast('상태를 저장했어요.');
      return true;
    },
  });
}

async function resizeImage(file, max = 560) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}
function postDialog(m) {
  let photo = null;
  const body = `
    <label class="fld"><span>짧은 글</span><textarea name="text" rows="3" maxlength="140" required placeholder="오늘 있었던 일을 한두 줄로"></textarea></label>
    <label class="fld"><span>사진 <small>(선택 · 작게 줄여 이 기기에만 저장)</small></span><input type="file" name="photo" accept="image/*"></label>
    <img class="photo-prev" alt="" hidden>
    <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, 'family')}</select></label>`;
  openDialog({
    title: `${esc(m.displayName)}의 미니룸에 글 쓰기`, body, cls: 'dlg-post',
    actions: '<span class="sp"></span><button type="submit" value="save" class="btn-p">올리기</button>',
    onMount(f) {
      f.photo.addEventListener('change', async () => {
        const file = f.photo.files[0];
        const prev = f.querySelector('.photo-prev');
        if (!file) { photo = null; prev.hidden = true; return; }
        try { photo = await resizeImage(file); prev.src = photo; prev.hidden = false; }
        catch { photo = null; toast('사진을 읽지 못했어요.', 'err'); }
      });
      f.text.focus();
    },
    onSubmit(f) {
      const text = f.text.value.trim();
      if (!text) return '글을 적어 주세요.';
      const p = { id: M.newId('po'), memberId: m.id, text, photo, createdAt: new Date().toISOString(), createdBy: ui.viewer, visibility: f.visibility.value, sourceId: 'src_manual' };
      S.posts.push(p);
      if (!persist()) { S.posts.pop(); renderAll(); return '저장하지 못했어요. 사진이 너무 크면 빼고 올려 주세요.'; }
      renderAll(); toast('글을 올렸어요.');
      return true;
    },
  });
}

function decorateDialog(id) {
  const lobby = id === 'lobby';
  const m = lobby ? null : member(id);
  const room = lobby ? S.family.lobbyRoom : m.room;
  const body = `
    <p class="small muted">방 그림 둘레의 배경 무늬와 스티커를 고를 수 있어요. 스티커는 최대 ${M.STICKER_SLOTS.length}개까지 붙어요.</p>
    <fieldset class="fld swatches"><legend>배경 무늬</legend>${M.BACKDROPS.map(b => `<label><input type="radio" name="backdrop" value="${b.k}" ${b.k === room.backdrop ? 'checked' : ''}><span class="sw bd-${b.k}"></span><small>${b.l}</small></label>`).join('')}</fieldset>
    <fieldset class="fld chips"><legend>스티커</legend>${M.STICKERS.map(s => `<label><input type="checkbox" name="st" value="${s.k}" ${(room.stickers || []).includes(s.k) ? 'checked' : ''}><span>${s.e} ${s.l}</span></label>`).join('')}</fieldset>`;
  openDialog({
    title: lobby ? '1층 로비 꾸미기' : `${esc(m.displayName)}의 방 꾸미기`, body, cls: 'dlg-deco',
    actions: '<span class="sp"></span><button type="submit" value="save" class="btn-p">적용</button>',
    onMount(f) {
      f.addEventListener('change', () => {
        const picked = $$('input[name=st]:checked', f);
        if (picked.length > M.STICKER_SLOTS.length) { picked.at(-1).checked = false; toast(`스티커는 ${M.STICKER_SLOTS.length}개까지예요.`); }
      });
    },
    onSubmit(f) {
      room.backdrop = f.backdrop.value;
      const prev = room.stickers || [];
      const now = $$('input[name=st]:checked', f).map(i => i.value);
      room.stickers = [...prev.filter(k => now.includes(k)), ...now.filter(k => !prev.includes(k))];
      persist(); renderAll(); toast('방을 꾸몄어요 🎀');
      return true;
    },
  });
}


// ───────────────────────── 여행 계획 · 살 것/준비할 것 ─────────────────────────
const trips = () => (S.trips || []).filter(canSee).sort((a, b) => a.startDate.localeCompare(b.startDate));
const boardItems = () => (S.boardItems || []).filter(canSee);
const tripById = id => (S.trips || []).find(t => t.id === id);
function dday(d) {
  const n = D.diffDays(D.today(), d);
  return n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : null;
}
function tripStatus(t) {
  const today = D.today();
  if (t.endDate < today) return '다녀왔어요';
  if (t.startDate <= today) return '여행 중';
  return dday(t.startDate);
}
function pickTrip() {
  const list = trips();
  if (ui.plan.tripId && list.some(t => t.id === ui.plan.tripId)) return tripById(ui.plan.tripId);
  const t = list.find(x => x.endDate >= D.today()) || list.at(-1) || null;
  ui.plan.tripId = t?.id || null;
  return t;
}
function planSummaryCard() {
  const next = trips().find(t => t.endDate >= D.today());
  const open = boardItems().filter(b => !b.done);
  const buy = open.filter(b => b.kind === 'buy').length, prep = open.length - buy;
  return `<section class="card o-8"><header class="card-h"><h2>🧳 여행 · 🛒 살 것</h2><button type="button" class="btn-g" data-action="view" data-view="plan">보드 →</button></header>
    ${next ? `<button type="button" class="trip-mini" data-action="open-trip" data-id="${next.id}"><b>${esc(next.title)}</b><span>${D.fmtDate(next.startDate, { wd: false })} – ${D.fmtDate(next.endDate, { wd: false })}</span><em>${tripStatus(next)}</em></button>` : '<p class="muted small">예정된 여행이 없어요.</p>'}
    <p class="board-count">🛒 살 것 <b>${buy}</b> · 🎒 준비할 것 <b>${prep}</b> 남았어요</p>
  </section>`;
}
function boardRow(b, { showTrip = true } = {}) {
  const k = M.BOARD_KINDS.find(x => x.k === b.kind) || M.BOARD_KINDS[0];
  const t = b.tripId && tripById(b.tripId);
  return `<li class="bd-row${b.done ? ' is-done' : ''} k-${b.kind}">
    <label class="chk" title="${b.done ? '되돌리기' : '완료'}"><input type="checkbox" data-change="toggle-board" data-id="${b.id}" ${b.done ? 'checked' : ''}><span aria-hidden="true"></span><b class="sr">${esc(b.title)} 완료</b></label>
    <button type="button" class="is-main" data-action="open-board" data-id="${b.id}">
      <span class="is-type">${k.e} ${k.l}${b.qty ? ` · ${esc(b.qty)}` : ''}${b.dueDate ? ` · ${D.fmtDate(b.dueDate)}까지` : ''}</span>
      <span class="is-title">${esc(b.title)}</span>
    </button>
    <div class="is-meta">${srcTag(b)}${pchip(b.ownerId)}${showTrip && t ? `<button type="button" class="link-ev" data-action="open-trip" data-id="${t.id}">🧳 ${esc(t.title)}</button>` : ''}</div>
  </li>`;
}
function boardAddForm(tripId = '') {
  return `<form class="bd-add" data-submit="board-add">
    <select name="kind" aria-label="종류">${M.BOARD_KINDS.map(k => `<option value="${k.k}">${k.e} ${k.l}</option>`).join('')}</select>
    <input name="title" maxlength="50" required placeholder="예) 선크림, 여권 챙기기" aria-label="내용">
    <input name="qty" maxlength="12" placeholder="수량" aria-label="수량" class="bd-qty">
    <select name="ownerId" aria-label="담당자">${memberOpts('', true)}</select>
    <input type="hidden" name="tripId" value="${tripId}">
    <button class="btn-p btn-sm">추가</button>
  </form>`;
}
function renderPlan() {
  const list = trips();
  const t = pickTrip();
  const today = D.today();
  const tripCards = list.length ? list.map(x => `<li><button type="button" class="trip-card${x.id === t?.id ? ' on' : ''}${x.endDate < today ? ' past' : ''}" data-action="select-trip" data-id="${x.id}">
      <b>${esc(x.title)}</b>
      <span>${D.fmtDate(x.startDate, { wd: false })} – ${D.fmtDate(x.endDate, { wd: false })}${x.destination ? ` · 📍${esc(x.destination)}` : ''}</span>
      <em>${tripStatus(x) || ''}</em>
    </button></li>`).join('') : '';
  let detail;
  if (!t) detail = empty('🧳', '아직 여행 계획이 없어요. 여행을 만들면 날짜별 계획표와 준비물 목록이 함께 생겨요.', '<button type="button" class="btn-p" data-action="new-trip">+ 여행 만들기</button>');
  else {
    const n = Math.min(30, D.diffDays(t.startDate, t.endDate) + 1);
    const days = [...Array(n)].map((_, k) => D.addDays(t.startDate, k));
    const items = boardItems().filter(b => b.tripId === t.id).sort((a, b) => a.done - b.done);
    const doneN = items.filter(b => b.done).length;
    detail = `<header class="trip-h">
        <div><p class="hello-date">${D.fmtDate(t.startDate, { year: true })} – ${D.fmtDate(t.endDate)} · ${n - 1}박 ${n}일${t.destination ? ` · 📍 ${esc(t.destination)}` : ''}</p>
        <h2 class="trip-title">${esc(t.title)} <span class="tag tag-today">${tripStatus(t) || ''}</span>${srcTag(t)}</h2>
        <div class="ev-people">${(t.memberIds || []).map(id => pchip(id)).join('')}</div>
        ${t.memo ? `<p class="trip-memo">📝 ${esc(t.memo)}</p>` : ''}</div>
        <div class="trip-btns"><button type="button" class="btn-s btn-sm" data-action="edit-trip" data-id="${t.id}">여행 정보 수정</button>${t.eventId ? `<button type="button" class="btn-g btn-sm" data-action="open-event" data-id="${t.eventId}" data-date="${t.startDate}">📅 캘린더에서 보기</button>` : ''}</div>
      </header>
      <div class="trip-grid">
        <section><h3 class="sub-h">🗺️ 여행 계획표</h3>
          ${days.map((d, k) => {
            const its = (t.plan || []).filter(p => p.date === d).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
            return `<div class="tday"><div class="tday-h"><b>${k + 1}일차</b> ${D.fmtDate(d)}<button type="button" class="btn-g btn-sm" data-action="new-plan" data-id="${t.id}" data-date="${d}">+ 추가</button></div>
              ${its.length ? `<ol class="tplan">${its.map(p => `<li><button type="button" data-action="edit-plan" data-id="${t.id}" data-item="${p.id}"><em>${p.time || '시간 미정'}</em><span>${esc(p.title)}${p.memo ? `<small>${esc(p.memo)}</small>` : ''}</span></button></li>`).join('')}</ol>` : '<p class="muted small tday-empty">아직 계획이 없어요</p>'}
            </div>`;
          }).join('')}
        </section>
        <section><h3 class="sub-h">🎒 이 여행 준비물 · 살 것 <small class="muted">${doneN}/${items.length} 완료</small></h3>
          <div class="prog" aria-hidden="true"><i style="width:${items.length ? doneN / items.length * 100 : 0}%"></i></div>
          ${boardAddForm(t.id)}
          ${items.length ? `<ul class="is-list">${items.map(b => boardRow(b, { showTrip: false })).join('')}</ul>` : '<p class="muted small">준비물을 추가해 보세요.</p>'}
        </section>
      </div>
      ${tripCommentsHTML(t)}`;
  }
  const f = ui.plan.filter;
  const all = boardItems().filter(b => f === 'all' || b.kind === f).sort((a, b) => (a.done - b.done) || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  const doneCount = boardItems().filter(b => b.done).length;
  $('#planBody').innerHTML = `
    <div class="plan-trips card">
      <header class="card-h"><h2>🧳 여행 계획</h2><button type="button" class="btn-p btn-sm" data-action="new-trip">+ 여행 만들기</button></header>
      ${list.length ? `<ul class="trip-list">${tripCards}</ul>` : ''}
      <div class="trip-detail">${detail}</div>
    </div>
    <aside class="card plan-board">
      <header class="card-h"><h2>🛒 살 것 · 준비할 것</h2>${doneCount ? `<button type="button" class="btn-g btn-sm" data-action="clear-board">완료 ${doneCount}개 정리</button>` : ''}</header>
      <div class="seg" role="group" aria-label="종류">${[['all', '전체'], ['buy', '🛒 살 것'], ['prep', '🎒 준비할 것']].map(([k, l]) => `<button type="button" data-action="board-filter" data-k="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${boardAddForm('')}
      ${all.length ? `<ul class="is-list">${all.map(b => boardRow(b)).join('')}</ul>` : empty('🛍️', '적어 둔 살 것·준비할 것이 없어요.')}
      <p class="small muted">가족 누구나 추가하고 체크할 수 있어요. 여행과 연결한 항목은 여행 계획표에도 함께 보여요.</p>
    </aside>`;
}
function syncTripEvent(t) {
  const now = new Date().toISOString();
  let ev = t.eventId && S.events.find(e => e.id === t.eventId);
  if (!ev) {
    ev = { id: M.newId('ev'), sourceId: 'src_manual', externalUid: null, exDates: [], recurrenceRuleId: null, createdBy: ui.viewer, createdAt: now, status: 'confirmed' };
    S.events.push(ev); t.eventId = ev.id;
  }
  let placeId = null;
  if (t.destination) {
    let p = S.places.find(x => x.name === t.destination);
    if (!p) { p = { id: M.newId('pl'), name: t.destination }; S.places.push(p); }
    placeId = p.id;
  }
  const members = t.memberIds?.length ? t.memberIds : [ui.viewer];
  Object.assign(ev, {
    title: `🧳 ${t.title}`, startDate: t.startDate, endDate: t.endDate, startTime: null, endTime: null, allDay: true, timeUnset: false,
    placeId, ownerId: members[0], attendeeIds: members, memo: '여행 계획표에서 자세히 보기', visibility: t.visibility, tripId: t.id, updatedAt: now,
  });
}
function tripDialog(t) {
  const isNew = !t;
  const x = t || { title: '', startDate: D.today(), endDate: D.addDays(D.today(), 1), destination: '', memberIds: S.members.map(m => m.id), memo: '', visibility: 'family' };
  openDialog({
    title: isNew ? '새 여행 만들기' : '여행 정보', cls: 'dlg-trip',
    body: `<label class="fld"><span>여행 이름</span><input name="title" required maxlength="40" value="${esc(x.title)}" placeholder="예) 제주 가족여행"></label>
      <div class="fld-row">
        <label class="fld"><span>가는 날</span><input type="date" name="startDate" required value="${x.startDate}"></label>
        <label class="fld"><span>오는 날</span><input type="date" name="endDate" required value="${x.endDate}"></label>
      </div>
      <label class="fld"><span>여행지</span><input name="destination" maxlength="40" value="${esc(x.destination || '')}" placeholder="도시·지역 이름만"></label>
      <fieldset class="fld chips"><legend>함께 가는 가족</legend>${S.members.map(m => `<label style="--c:${m.color}"><input type="checkbox" name="mem" value="${m.id}" ${(x.memberIds || []).includes(m.id) ? 'checked' : ''}><span>${face(m)}${esc(m.displayName)}</span></label>`).join('')}</fieldset>
      <label class="fld"><span>메모</span><textarea name="memo" rows="2" maxlength="200">${esc(x.memo || '')}</textarea></label>
      <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, x.visibility)}</select></label>
      <p class="meta-line">저장하면 가족 캘린더에 여행 기간이 하루 종일 일정으로 함께 표시돼요.</p>`,
    actions: `${isNew ? '' : '<button type="submit" value="delete" class="btn-g danger" formnovalidate>여행 삭제</button>'}<span class="sp"></span><button type="submit" value="save" class="btn-p">${isNew ? '만들기' : '저장'}</button>`,
    onMount(f) { f.startDate.addEventListener('change', () => { if (f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value; }); if (isNew) f.title.focus(); },
    onSubmit(f, sub) {
      if (sub === 'delete') {
        if (!confirm(`'${x.title}' 여행을 삭제할까요? 계획표와 캘린더 일정도 함께 지워져요. 준비물은 남겨 둘게요.`)) return false;
        S.trips = S.trips.filter(tt => tt.id !== x.id);
        S.events = S.events.filter(e => e.id !== x.eventId);
        S.boardItems.forEach(b => { if (b.tripId === x.id) b.tripId = null; });
        ui.plan.tripId = null;
        persist(); renderAll(); toast('여행을 삭제했어요.');
        return true;
      }
      const fd = new FormData(f);
      const title = String(fd.get('title')).trim();
      if (!title) return '여행 이름을 적어 주세요.';
      const startDate = fd.get('startDate'), endDate = fd.get('endDate');
      if (endDate < startDate) return '오는 날이 가는 날보다 빨라요.';
      if (D.diffDays(startDate, endDate) > 30) return '여행 기간은 31일까지 만들 수 있어요.';
      const now = new Date().toISOString();
      const target = isNew ? { id: M.newId('trip'), plan: [], sourceId: 'src_manual', createdBy: ui.viewer, createdAt: now } : x;
      Object.assign(target, {
        title, startDate, endDate, destination: String(fd.get('destination') || '').trim(),
        memberIds: S.members.map(m => m.id).filter(id => fd.getAll('mem').includes(id)),
        memo: String(fd.get('memo') || '').trim(), visibility: fd.get('visibility'), updatedAt: now,
      });
      if (isNew) { S.trips ||= []; S.trips.push(target); logActivity('trip', target.id, `여행 '${target.title}'을 만들었어요`); }
      syncTripEvent(target);
      ui.plan.tripId = target.id;
      persist();
      if (ui.view !== 'plan') setView('plan'); else renderAll();
      toast(isNew ? '여행을 만들었어요 🧳' : '여행 정보를 저장했어요.');
      return true;
    },
  });
}
function planItemDialog(t, itemId, date) {
  const it = itemId ? (t.plan || []).find(p => p.id === itemId) : null;
  const n = Math.min(30, D.diffDays(t.startDate, t.endDate) + 1);
  const days = [...Array(n)].map((_, k) => D.addDays(t.startDate, k));
  const cur = it?.date || date || t.startDate;
  openDialog({
    title: it ? '계획 수정' : '계획 추가', cls: 'dlg-plan',
    body: `<label class="fld"><span>할 일 · 갈 곳</span><input name="title" required maxlength="50" value="${esc(it?.title || '')}" placeholder="예) 아쿠아리움"></label>
      <div class="fld-row">
        <label class="fld"><span>날짜</span><select name="date">${days.map((d, k) => `<option value="${d}" ${d === cur ? 'selected' : ''}>${k + 1}일차 · ${D.fmtDate(d)}</option>`).join('')}</select></label>
        <label class="fld"><span>시간 <small>(비워 두면 시간 미정)</small></span><input type="time" name="time" value="${it?.time || ''}"></label>
      </div>
      <label class="fld"><span>메모</span><input name="memo" maxlength="80" value="${esc(it?.memo || '')}"></label>`,
    actions: `${it ? '<button type="submit" value="delete" class="btn-g danger" formnovalidate>삭제</button>' : ''}<span class="sp"></span><button type="submit" value="save" class="btn-p">${it ? '저장' : '추가'}</button>`,
    onMount(f) { if (!it) f.title.focus(); },
    onSubmit(f, sub) {
      t.plan ||= [];
      if (sub === 'delete') { t.plan = t.plan.filter(p => p.id !== it.id); persist(); renderAll(); return true; }
      const title = f.title.value.trim();
      if (!title) return '내용을 적어 주세요.';
      const v = { date: f.date.value, time: f.time.value || '', title, memo: f.memo.value.trim() };
      if (it) Object.assign(it, v); else t.plan.push({ id: M.newId('tp'), ...v });
      t.updatedAt = new Date().toISOString();
      persist(); renderAll(); toast('계획표에 담았어요.');
      return true;
    },
  });
}
function boardDialog(b) {
  openDialog({
    title: '살 것 · 준비할 것', cls: 'dlg-board',
    body: `<label class="fld"><span>내용</span><input name="title" required maxlength="50" value="${esc(b.title)}"></label>
      <div class="fld-row">
        <label class="fld"><span>종류</span><select name="kind">${M.BOARD_KINDS.map(k => `<option value="${k.k}" ${k.k === b.kind ? 'selected' : ''}>${k.e} ${k.l}</option>`).join('')}</select></label>
        <label class="fld"><span>수량</span><input name="qty" maxlength="12" value="${esc(b.qty || '')}"></label>
      </div>
      <div class="fld-row">
        <label class="fld"><span>담당자</span><select name="ownerId">${memberOpts(b.ownerId, true)}</select></label>
        <label class="fld"><span>언제까지</span><input type="date" name="dueDate" value="${b.dueDate || ''}"></label>
      </div>
      <label class="fld"><span>연결된 여행</span><select name="tripId"><option value="">없음</option>${trips().map(t => `<option value="${t.id}" ${t.id === b.tripId ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
      <label class="fld"><span>메모</span><input name="memo" maxlength="80" value="${esc(b.memo || '')}"></label>
      <label class="fld fld-check"><input type="checkbox" name="done" ${b.done ? 'checked' : ''}><span>완료했어요</span></label>`,
    actions: '<button type="submit" value="delete" class="btn-g danger" formnovalidate>삭제</button><span class="sp"></span><button type="submit" value="save" class="btn-p">저장</button>',
    onSubmit(f, sub) {
      if (sub === 'delete') { S.boardItems = S.boardItems.filter(x => x.id !== b.id); persist(); renderAll(); return true; }
      const title = f.title.value.trim();
      if (!title) return '내용을 적어 주세요.';
      Object.assign(b, { title, kind: f.kind.value, qty: f.qty.value.trim(), ownerId: f.ownerId.value, dueDate: f.dueDate.value || null, tripId: f.tripId.value || null, memo: f.memo.value.trim(), done: f.done.checked, updatedAt: new Date().toISOString() });
      persist(); renderAll(); toast('저장했어요.');
      return true;
    },
  });
}

// ───────────────────────── 동작 ─────────────────────────
function celebrate(issue) {
  const m = member(issue.ownerId);
  if (m) {
    ui.celebrate = { id: m.id, until: Date.now() + 2600 };
    setTimeout(() => { if (ui.view === 'world') renderStage(); }, 2700);
  }
  renderAll();
  toast(`🎉 ${m ? m.displayName : '가족'} · '${issue.title}' 완료!`);
}
function toggleIssue(id, checked) {
  const is = S.issues.find(i => i.id === id);
  if (!is) return;
  is.done = checked; is.updatedAt = new Date().toISOString();
  if (checked) logActivity('issue', is.id, `'${is.title}' 완료!`);
  persist();
  if (checked) celebrate(is); else renderAll();
}
function exportEvents(events, filename) {
  const ctx = { memberName, memberRole: id => member(id)?.role || '', placeName: id => place(id)?.name || '', rule };
  downloadText(filename.replace(/[\\/:*?"<>|]/g, '_'), buildICS(events, ctx));
  S.sync.apple.lastExportAt = new Date().toISOString();
  persist(); renderHeader();
  if (ui.view === 'sync') renderSync();
  toast('.ics 파일을 만들었어요. 열면 Apple 캘린더에 추가할 수 있어요.');
}
async function importICS(file) {
  let text;
  try { text = await file.text(); } catch { return toast('파일을 읽지 못했어요.', 'err'); }
  const res = M.clean(parseICS(text));
  if (!res.events.length) return toast('이 파일에서 일정을 찾지 못했어요.', 'err');
  const dates = res.events.map(e => e.startDate).sort();
  const known = new Set(S.events.filter(e => e.externalUid).map(e => e.externalUid));
  const upd = res.events.filter(e => e.uid && known.has(e.uid)).length;
  openDialog({
    title: '.ics 가져오기 미리 보기', cls: 'dlg-import',
    body: `<p><b>${esc(file.name)}</b>에서 일정 <b>${res.events.length}</b>건을 찾았어요 (${D.fmtDate(dates[0], { year: true })} ~ ${D.fmtDate(dates.at(-1), { year: true })}).</p>
      <ul class="check small">
        <li>새로 추가 ${res.events.length - upd}건 · 이미 있는 일정 갱신 ${upd}건</li>
        ${res.skippedOverrides ? `<li>반복 일정의 예외 회차 ${res.skippedOverrides}건은 건너뛰어요.</li>` : ''}
        ${res.unsupportedRules ? `<li>복잡한 반복 규칙 ${res.unsupportedRules}건은 첫 회차만 가져와요.</li>` : ''}
      </ul>
      <ul class="imp-prev">${res.events.slice(0, 8).map(e => `<li><em>${D.fmtDate(e.startDate)} ${e.allDay ? '하루 종일' : e.timeUnset ? '시간 미정' : e.startTime}</em> ${esc(e.title)}</li>`).join('')}${res.events.length > 8 ? `<li class="muted">… 외 ${res.events.length - 8}건</li>` : ''}</ul>
      <div class="fld-row">
        <label class="fld"><span>담당자가 적혀 있지 않은 일정의 담당자</span><select name="ownerId">${memberOpts(ui.viewer)}</select></label>
        <label class="fld"><span>공개 범위</span><select name="visibility">${opt(M.VISIBILITY, 'family')}</select></label>
      </div>`,
    actions: '<span class="sp"></span><button type="submit" value="save" class="btn-p">가져오기</button>',
    onSubmit(f) {
      const now = new Date().toISOString();
      const src = { id: M.newId('src'), kind: 'ics-import', label: file.name, importedAt: now };
      S.sources.push(src);
      let added = 0, updated = 0;
      for (const x of res.events) {
        let placeId = null;
        if (x.location) {
          let p = S.places.find(pp => pp.name === x.location);
          if (!p) { p = { id: M.newId('pl'), name: x.location.slice(0, 60) }; S.places.push(p); }
          placeId = p.id;
        }
        let ev = x.uid ? S.events.find(e => e.externalUid === x.uid) : null;
        const fields = {
          title: x.title.slice(0, 80), startDate: x.startDate, endDate: x.endDate, startTime: x.startTime, endTime: x.endTime,
          allDay: x.allDay, timeUnset: x.timeUnset, placeId, memo: x.memo.slice(0, 300), status: x.status,
          exDates: x.exDates, sourceId: src.id, updatedAt: now,
        };
        if (ev) { Object.assign(ev, fields); updated++; }
        else {
          const byRole = r => S.members.find(m => m.role === r)?.id;
          const ownerId = byRole(x.ownerRole) || f.ownerId.value;
          const att = [...new Set([ownerId, ...x.attendeeRoles.map(byRole).filter(Boolean)])];
          ev = { id: M.newId('ev'), externalUid: x.uid, ownerId, attendeeIds: att, visibility: f.visibility.value, recurrenceRuleId: null, createdBy: ui.viewer, createdAt: now, ...fields };
          S.events.push(ev); added++;
        }
        if (x.rrule) {
          let r = rule(ev.recurrenceRuleId);
          if (!r) { r = { id: M.newId('rr') }; S.recurrenceRules.push(r); ev.recurrenceRuleId = r.id; }
          Object.assign(r, x.rrule);
        }
      }
      Object.assign(S.sync.apple, { lastImportAt: now, lastImportFile: file.name, lastImportCount: added + updated });
      if (!persist()) return '저장하지 못했어요.';
      renderAll(); toast(`가져왔어요 · 추가 ${added}건, 갱신 ${updated}건`);
      return true;
    },
  });
}
function backup() {
  downloadText(`family-backup-${D.today()}.json`, JSON.stringify(S, null, 2), 'application/json');
  toast('백업 파일을 만들었어요. 가족 정보가 들어 있으니 안전한 곳에 보관하세요.');
}
async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.members) || !Array.isArray(data.events)) throw new Error('형식');
    if (!confirm('지금 데이터를 백업 파일 내용으로 바꿀까요? 현재 내용은 사라져요.')) return;
    S = M.migrate(data);
    persist(); renderAll(); toast('백업을 불러왔어요.');
  } catch { toast('백업 파일 형식이 아니에요.', 'err'); }
}

function setView(v) {
  ui.view = v;
  if (v !== 'world') document.body.classList.remove('fit');
  $$('.view').forEach(s => { s.hidden = s.dataset.view !== v; });
  $$('[data-action=view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
  renderView();
}
function renderView() {
  if (ui.view === 'world') renderWorld();
  else if (ui.view === 'cal') renderCal();
  else if (ui.view === 'plan') renderPlan();
  else if (ui.view === 'admin') renderAdmin();
  else renderSync();
}
// ── 카드 접기 ── 카드 제목 옆 ▾ 로 내용을 접는다. 접은 카드는 이 기기에 기억된다.
let foldSet = new Set();
try { foldSet = new Set(JSON.parse(loadPref('folded') || '[]')); } catch { foldSet = new Set(); }
const foldKey = h2 => h2.textContent.replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
function setupFolds() {
  $$('.card').forEach(card => {
    if (card.classList.contains('stage-card')) return; // 미니월드 그림은 접지 않는다
    const head = card.querySelector(':scope > .card-h');
    const h2 = head?.querySelector('h2');
    if (!h2 || head.querySelector('.fold-btn')) return;
    const key = foldKey(h2);
    if (!key) return;
    card.dataset.fold = key;
    const on = foldSet.has(key);
    card.classList.toggle('folded', on);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fold-btn';
    b.dataset.action = 'fold-card';
    b.setAttribute('aria-expanded', String(!on));
    b.setAttribute('aria-label', `${h2.textContent.trim()} 접기/펼치기`);
    b.innerHTML = '<span aria-hidden="true">▾</span>';
    head.appendChild(b);
  });
}
function renderAll() { renderHeader(); renderBanner(); renderView(); setupFolds(); }

let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = 'toast'; }, 3200);
}

const ACTIONS = {
  'go-floor': b => goFloor(b.dataset.floor),
  'fold-card': b => {
    const card = b.closest('.card'), key = card.dataset.fold;
    const on = !card.classList.contains('folded');
    card.classList.toggle('folded', on);
    b.setAttribute('aria-expanded', String(!on));
    if (on) foldSet.add(key); else foldSet.delete(key);
    savePref('folded', JSON.stringify([...foldSet]));
  },
  view: b => { setView(b.dataset.view); scrollTopIfMobile(); },
  'open-event': b => { if ($('#dlg').open) $('#dlg').close(); openEvent(b.dataset.id, b.dataset.date); },
  'new-event': b => { if ($('#dlg').open) $('#dlg').close(); newEvent(b.dataset.date, b.dataset.owner); },
  'open-issue': b => { const is = S.issues.find(i => i.id === b.dataset.id); if (is) { if ($('#dlg').open) $('#dlg').close(); issueDialog(is); } },
  'new-issue': b => { if ($('#dlg').open) $('#dlg').close(); issueDialog(null, { date: b.dataset.date, eventId: b.dataset.event, ownerId: b.dataset.owner }); },
  'edit-status': b => statusDialog(member(b.dataset.id)),
  'new-post': b => postDialog(member(b.dataset.id)),
  'del-post': b => { if (confirm('이 글을 삭제할까요?')) { S.posts = S.posts.filter(p => p.id !== b.dataset.id); persist(); renderAll(); } },
  'del-gb': b => { if (confirm('이 방명록을 삭제할까요?')) { S.guestbook = S.guestbook.filter(g => g.id !== b.dataset.id); persist(); renderAll(); } },
  decorate: b => decorateDialog(b.dataset.id),
  'new-trip': () => { if ($('#dlg').open) $('#dlg').close(); tripDialog(null); },
  'edit-trip': b => tripDialog(tripById(b.dataset.id)),
  'select-trip': b => { ui.plan.tripId = b.dataset.id; renderPlan(); },
  'open-trip': b => { if ($('#dlg').open) $('#dlg').close(); ui.plan.tripId = b.dataset.id; setView('plan'); scrollTopIfMobile(); },
  'new-plan': b => planItemDialog(tripById(b.dataset.id), null, b.dataset.date),
  'edit-plan': b => planItemDialog(tripById(b.dataset.id), b.dataset.item),
  'open-board': b => { const it = (S.boardItems || []).find(x => x.id === b.dataset.id); if (it) boardDialog(it); },
  'board-filter': b => { ui.plan.filter = b.dataset.k; renderPlan(); },
  'clear-board': () => {
    const n = S.boardItems.filter(b => b.done && canSee(b)).length;
    if (!confirm(`완료한 ${n}개를 목록에서 지울까요?`)) return;
    S.boardItems = S.boardItems.filter(b => !(b.done && canSee(b))); persist(); renderAll(); toast('정리했어요.');
  },
  'cal-prev': () => calMove(-1),
  'cal-next': () => calMove(1),
  'cal-today': () => { ui.cal.cursor = ui.cal.selected = D.today(); renderCal(); },
  'cal-mode': b => { ui.cal.mode = b.dataset.mode; if (b.dataset.mode === 'day') ui.cal.cursor = ui.cal.selected; else ui.cal.cursor = ui.cal.selected; renderCal(); },
  'cal-select': b => { ui.cal.selected = b.dataset.date; renderCal(); if (mobileMQ.matches) $('#calDay').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }); },
  'cal-goday': b => { ui.cal.mode = 'day'; ui.cal.cursor = ui.cal.selected = b.dataset.date; renderCal(); },
  'cal-filter': b => {
    const f = ui.cal.filter, id = b.dataset.id;
    if (f.has(id) && f.size === 1) { S.members.forEach(m => f.add(m.id)); }
    else if (f.has(id)) f.delete(id); else f.add(id);
    renderCal();
  },
  'export-ics': () => {
    const evs = S.events.filter(e => canSee(e));
    if (!evs.length) return toast('내보낼 일정이 없어요.');
    exportEvents(evs, `family-calendar-${D.today()}.ics`);
  },
  backup,
  'strip-demo': () => {
    const mine = S.events.filter(e => e.sourceId !== 'src_demo').length;
    const msg = mine
      ? `'예시' 표시가 붙은 항목만 지워요. 직접 넣거나 가져온 일정 ${mine}개는 그대로 남아요.\n계속할까요? (지운 뒤 되돌릴 수 있어요)`
      : `이 기기에는 직접 넣은 일정이 아직 없어서, 예시를 지우면 캘린더가 비어요.\n다른 기기에 넣은 일정은 '연동 › 다른 기기로 옮기기' 링크로 가져올 수 있어요.\n그래도 지울까요? (지운 뒤 되돌릴 수 있어요)`;
    if (!confirm(msg)) return;
    try { localStorage.setItem(UNDO_KEY, JSON.stringify(S)); } catch { /* 되돌리기 없이 진행 */ }
    M.stripDemo(S); persist(); renderAll(); toast('예시 데이터를 지웠어요.');
  },
  'undo-strip': () => {
    try {
      const snap = JSON.parse(localStorage.getItem(UNDO_KEY));
      if (snap && Array.isArray(snap.members)) { S = M.migrate(snap); localStorage.removeItem(UNDO_KEY); persist(); renderAll(); toast('되돌렸어요.'); }
    } catch { toast('되돌리기 정보를 찾지 못했어요.', 'err'); }
  },
  'drop-undo': () => { try { localStorage.removeItem(UNDO_KEY); } catch { /* 무시 */ } renderBanner(); },
  'make-share': async () => {
    try {
      const url = await makeShareLink();
      const box = $('#shareOut');
      box.hidden = false;
      const inp = box.querySelector('input');
      inp.value = url; inp.onclick = () => inp.select();
      try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요. 다른 기기에서 열어 주세요.'); }
      catch { toast('아래 링크를 길게 눌러 복사해 주세요.'); }
    } catch { toast('이 브라우저에서는 링크를 만들 수 없어요.', 'err'); }
  },
  'del-tcomment': b => { if (confirm('이 댓글을 지울까요?')) { S.tripComments = S.tripComments.filter(c => c.id !== b.dataset.id); persist(); renderAll(); } },
  'sync-now': async () => { await sync.syncNow(); toast('동기화했어요.'); },
  'sync-signout': async () => { if (!confirm('이 기기에서 로그아웃할까요? 이 기기의 데이터는 남아 있어요.')) return; await sync.signOut(); renderAll(); toast('로그아웃했어요.'); },
  'copy-invite': async () => { try { await navigator.clipboard.writeText(ui.admin.invite || ''); toast('초대 코드를 복사했어요.'); } catch { toast('코드를 길게 눌러 복사해 주세요.'); } },
  kakao: () => kakaoDialog(),
  'adm-reload': () => { ui.admin.accounts = null; ui.admin.accountsErr = null; renderAdmin(); },
  'adm-rotate': async () => {
    if (!confirm('초대 코드를 만들까요? 한 번만 쓸 수 있고 24시간 뒤 사라져요. 예전 코드는 못 쓰게 돼요.')) return;
    try { ui.admin.invite = await sync.rotateInvite(); toast('초대 코드를 만들었어요. 가족에게만 알려 주세요.'); renderAdmin(); } catch { toast('관리자만 바꿀 수 있어요.', 'err'); }
  },
  'adm-remove': async b => {
    if (!confirm(`${b.dataset.name} 계정을 가족에서 내보낼까요? 그 사람은 더 이상 가족 데이터를 볼 수 없어요.`)) return;
    try { await sync.removeAccount(b.dataset.id); toast('내보냈어요.'); ui.admin.accounts = null; renderAdmin(); } catch { toast('내보내지 못했어요.', 'err'); }
  },
  'adm-clean-old': () => {
    const cut = D.addDays(D.today(), -60);
    const ids = new Set(S.events.filter(e => e.sourceId !== 'src_demo' && !e.recurrenceRuleId && !e.pinned && (e.endDate || e.startDate) < cut).map(e => e.id));
    if (!ids.size || !confirm(`60일 지난 일정 ${ids.size}개를 지울까요?`)) return;
    S.events = S.events.filter(e => !ids.has(e.id));
    S.issues.forEach(i => { if (ids.has(i.eventId)) i.eventId = null; });
    logActivity('event', '', `관리자가 지난 일정 ${ids.size}개를 정리했어요`);
    persist(); renderAll(); toast('정리했어요.');
  },
  'adm-clean-done': () => {
    const n = S.issues.filter(i => i.done && i.date < D.today()).length;
    if (!n || !confirm(`지난 완료 이슈 ${n}개를 지울까요?`)) return;
    S.issues = S.issues.filter(i => !(i.done && i.date < D.today()));
    persist(); renderAll(); toast('정리했어요.');
  },
  'adm-delete-picked': () => {
    const ids = ui.admin.picked;
    if (!ids.size) return;
    const pinned = S.events.filter(e => ids.has(e.id) && e.pinned).length;
    if (!confirm(`선택한 일정 ${ids.size}개를 삭제할까요?${pinned ? `\n📌 고정 일정 ${pinned}개도 함께 지워져요.` : ''}\n반복 일정은 모든 회차가 지워져요.`)) return;
    const rr = new Set(S.events.filter(e => ids.has(e.id)).map(e => e.recurrenceRuleId).filter(Boolean));
    S.events = S.events.filter(e => !ids.has(e.id));
    S.recurrenceRules = S.recurrenceRules.filter(r => !rr.has(r.id));
    S.issues.forEach(i => { if (ids.has(i.eventId)) i.eventId = null; });
    (S.trips || []).forEach(t => { if (ids.has(t.eventId)) t.eventId = null; });
    logActivity('event', '', `관리자가 일정 ${ids.size}개를 삭제했어요`);
    ui.admin.picked = new Set();
    persist(); renderAll(); toast('삭제했어요.');
  },
  'move-home': async () => {
    try { location.href = await makeShareLink(APP_URL); }
    catch { location.href = APP_URL; }
  },
  'install-app': async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null; if (ui.view === 'sync') renderSync();
  },
  'seen-activity': () => { savePref(`seen:${ui.viewer}`, new Date().toISOString()); renderView(); },
  'reset-demo': () => {
    if (!confirm('모든 데이터를 지우고 예시 데이터로 되돌릴까요? 되돌릴 수 없어요.')) return;
    const keep = M.emptyState(S); S = M.demoState(D.today()); S.events.push(...keep.events); S.recurrenceRules.push(...keep.recurrenceRules); S.places.push(...keep.places.filter(p => !S.places.some(x => x.id === p.id))); persist(); renderAll(); toast('예시 데이터로 되돌렸어요. 📌 고정 일정은 남겨 두었어요.');
  },
  'reset-empty': () => {
    if (!confirm('이 브라우저에 저장된 가족 데이터를 모두 지울까요? 백업이 없으면 되돌릴 수 없어요.')) return;
    S = M.emptyState(S); persist(); renderAll(); toast('모두 지웠어요. 📌 고정 일정은 남겨 두었어요.');
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.action];
  if (fn) { e.preventDefault(); fn(b, e); }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.mcell[data-action]')) { e.preventDefault(); ACTIONS['cal-select'](e.target); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'viewerSel') { ui.viewer = t.value; savePref('viewer', t.value); renderAll(); toast(`${viewerName()}(으)로 보고 있어요. (로그인이 아니라 보기 전환이에요)`); return; }
  const a = t.dataset.change;
  if (a === 'toggle-issue') toggleIssue(t.dataset.id, t.checked);
  if (a === 'adm-pick') { t.checked ? ui.admin.picked.add(t.value) : ui.admin.picked.delete(t.value); renderAdmin(); }
  if (a === 'adm-pick-all') { ui.admin.picked = t.checked ? new Set(S.events.filter(e => e.sourceId !== 'src_demo').map(e => e.id)) : new Set(); renderAdmin(); }
  if (a === 'toggle-board') {
    const b = (S.boardItems || []).find(x => x.id === t.dataset.id);
    if (b) { b.done = t.checked; b.updatedAt = new Date().toISOString(); persist(); renderAll(); if (t.checked) toast(`✅ '${b.title}' 완료!`); }
  }
  if (a === 'import-ics' && t.files[0]) { importICS(t.files[0]); t.value = ''; }
  if (a === 'restore' && t.files[0]) { restore(t.files[0]); t.value = ''; }
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.submit === 'adm-family') {
    e.preventDefault();
    const name = f.name.value.trim() || '우리 가족';
    S.family.name = name;
    persist();
    if (connected()) sync.renameFamily(name).catch(() => toast('서버의 가족 이름은 관리자만 바꿀 수 있어요.', 'err'));
    toast('가족 이름을 저장했어요.'); renderAll();
    return;
  }
  if (f.dataset.submit === 'adm-members') {
    e.preventDefault();
    for (const m of S.members) {
      m.displayName = f[`dn_${m.id}`].value.trim() || m.displayName;
      m.roleLabel = f[`rl_${m.id}`].value.trim() || m.roleLabel;
      m.space.name = f[`sp_${m.id}`].value.trim() || m.space.name;
      m.color = f[`co_${m.id}`].value || m.color;
    }
    logActivity('status', '', '관리자가 구성원 프로필을 바꿨어요');
    persist(); renderAll(); toast('프로필을 저장했어요.');
    return;
  }
  if (f.dataset.submit === 'trip-comment') {
    e.preventDefault();
    const text = f.text.value.trim();
    if (!text) return;
    S.tripComments ||= [];
    S.tripComments.push({ id: M.newId('tc'), tripId: f.dataset.id, authorId: ui.viewer, text, createdAt: new Date().toISOString(), visibility: 'family', sourceId: 'src_manual' });
    persist(); renderAll(); toast('댓글을 남겼어요 💬');
    return;
  }
  if (f.dataset.submit === 'sync-login') {
    e.preventDefault();
    const how = e.submitter?.value, email = f.email.value.trim(), pw = f.password.value;
    if (pw.length < 8) return toast('비밀번호는 8자 이상이에요.');
    const btns = [...f.querySelectorAll('button')];
    btns.forEach(x => { x.disabled = true; });
    const done = () => btns.forEach(x => { x.disabled = false; });
    (how === 'up' ? sync.signUp(email, pw) : sync.signIn(email, pw).then(() => ({})))
      .then(r => { if (r.needsConfirm) { done(); toast('메일 확인이 필요해요. 받은 메일의 링크를 누르거나 가족 서버 설정에서 메일 확인을 꺼 주세요.'); } else toast('로그인했어요 👪'); })
      .catch(err => {
        done();
        const m = err?.message || '';
        toast(/Invalid login/i.test(m) ? '로그인하지 못했어요. 처음이면 「처음이에요 · 계정 만들기」를 눌러 주세요. 계정이 있다면 이메일·비밀번호를 확인해 주세요.' : /already registered/i.test(m) ? '이미 있는 계정이에요. 로그인을 눌러 주세요.' : /rate|too many/i.test(m) ? '잠시 뒤 다시 시도해 주세요.' : /confirm/i.test(m) ? '메일 확인이 아직 안 됐어요.' : '로그인하지 못했어요.', 'err');
      });
    return;
  }
  if (f.dataset.submit === 'sync-email') {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    sync.sendLink(f.email.value.trim())
      .then(() => { f.outerHTML = `<p class="sync-sent">📬 <b>${esc(f.email.value)}</b>로 로그인 링크를 보냈어요. 메일의 링크를 이 기기에서 열어 주세요.</p>`; })
      .catch(err => { btn.disabled = false; toast(/rate/i.test(err?.message || '') ? '메일을 너무 자주 보냈어요. 잠시 뒤 다시 시도해 주세요.' : '메일을 보내지 못했어요.', 'err'); });
    return;
  }
  if (f.dataset.submit === 'sync-join') {
    e.preventDefault();
    const how = e.submitter?.value, mid = f.memberId.value;
    if (!mid) return toast('나는 누구인지 골라 주세요.');
    const p = how === 'create' ? sync.createFamily('우리 가족', mid) : (f.code.value.trim() ? sync.joinFamily(f.code.value.trim(), mid) : Promise.reject(new Error('code')));
    p.then(() => toast(how === 'create' ? '가족을 만들었어요! 초대 코드를 가족에게 알려 주세요.' : '가족과 연결됐어요 👪'))
      .catch(err => toast(err?.message === 'code' ? '초대 코드를 넣어 주세요.' : /invalid invite/.test(err?.message || '') ? '초대 코드가 맞지 않거나 이미 쓴 코드예요. 관리자에게 새 코드를 받아 주세요.' : /family is full/.test(err?.message || '') ? '가족 정원이 다 찼어요.' : '연결하지 못했어요.', 'err'));
    return;
  }
  if (f.dataset.submit === 'board-add') {
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) return;
    const now = new Date().toISOString();
    S.boardItems ||= [];
    S.boardItems.push({ id: M.newId('bi'), title, kind: f.kind.value, qty: f.qty.value.trim(), ownerId: f.ownerId.value, tripId: f.tripId.value || null, dueDate: null, done: false, memo: '', visibility: 'family', sourceId: 'src_manual', createdBy: ui.viewer, createdAt: now, updatedAt: now });
    persist(); renderAll(); toast('목록에 추가했어요.');
    setTimeout(() => $(`form[data-submit=board-add] input[name=title]`)?.focus(), 0);
    return;
  }
  if (f.dataset.submit !== 'guestbook') return;
  e.preventDefault();
  const text = f.text.value.trim();
  if (!text) return;
  S.guestbook.push({ id: M.newId('gb'), roomOwnerId: f.dataset.id, authorId: ui.viewer, text, createdAt: new Date().toISOString(), visibility: f.visibility.value, sourceId: 'src_manual' });
  persist(); renderAll(); toast('방명록을 남겼어요 💌');
});

mobileMQ.addEventListener('change', () => { if (ui.view === 'cal') renderCal(); });

// 1분마다 시계·진행 중 일정·오래된 상태를 다시 계산한다(대화상자가 열려 있으면 건너뜀).
setInterval(() => {
  const now = D.seoul();
  if (now.time === ui.lastMinute) return;
  ui.lastMinute = now.time;
  renderHeader();
  if (!$('#dlg').open && !ui.elevating && document.visibilityState === 'visible') renderView();
}, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#dlg').open) renderAll(); });

// ───────────────────────── 다른 기기로 옮기기 ─────────────────────────
// 데이터를 gzip+base64url 로 압축해 주소의 # 뒤(fragment)에 담는다.
// fragment 는 브라우저가 서버로 보내지 않으므로 GitHub 서버에도 남지 않는다.
const UNDO_KEY = 'family-home:undo';
function hasUndo() { try { return !!localStorage.getItem(UNDO_KEY); } catch { return false; } }
const SHARE_KEYS = ['events', 'issues', 'trips', 'tripComments', 'boardItems', 'places', 'recurrenceRules', 'sources', 'activity'];
const b64url = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
async function makeShareLink(base = APP_URL || `${location.origin}${location.pathname}`) {
  const pick = arr => (arr || []).filter(x => x.sourceId !== 'src_demo' && x.visibility !== 'private');
  const payload = { kind: 'family-share', v: 1, at: new Date().toISOString() };
  for (const k of SHARE_KEYS) payload[k] = k === 'places' || k === 'recurrenceRules' || k === 'sources' ? (S[k] || []) : pick(S[k]);
  payload.statuses = S.members.map(m => ({ id: m.id, status: m.status && !m.status.demo && m.status.visibility !== 'private' ? m.status : null }));
  const gz = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'));
  return `${base}#import=${b64url(await new Response(gz).arrayBuffer())}`;
}
async function readShareLink() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let data;
  try {
    const st = new Blob([unb64url(m[1])]).stream().pipeThrough(new DecompressionStream('gzip'));
    data = JSON.parse(await new Response(st).text());
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== 'family-share') throw new Error('kind');
    M.clean(data);
    for (const k of SHARE_KEYS) data[k] = M.validItems(data[k]);
    data.statuses = M.validItems(data.statuses);
  } catch { toast('링크에 담긴 데이터를 읽지 못했어요.', 'err'); return; }
  const n = (data.events || []).length, t = (data.trips || []).length, b = (data.boardItems || []).length;
  openDialog({
    title: '다른 기기에서 보낸 가족 데이터', cls: 'dlg-import',
    body: `<p>일정 <b>${n}</b>개 · 이슈 ${(data.issues || []).length}개 · 여행 ${t}개 · 살 것/준비할 것 ${b}개가 들어 있어요.</p>
      <ul class="imp-prev">${(data.events || []).slice(0, 8).map(e => `<li><em>${esc(D.fmtDate(e.startDate))} ${esc(e.startTime || '')}</em> ${esc(e.title)}${e.recurrenceRuleId ? ' 🔁' : ''}</li>`).join('')}</ul>
      <p class="small muted"><b>합치기</b>는 이 기기 데이터를 지우지 않고 없는 항목만 더하고, 같은 항목은 더 최근에 고친 쪽으로 맞춰요.</p>`,
    actions: '<span class="sp"></span><button type="submit" value="save" class="btn-p">합치기</button>',
    onSubmit() {
      let added = 0;
      for (const k of SHARE_KEYS) {
        S[k] ||= [];
        for (const x of data[k] || []) {
          const i = S[k].findIndex(y => y.id === x.id);
          if (i < 0) { S[k].push(x); if (k === 'events') added++; }
          else if ((x.updatedAt || '') > (S[k][i].updatedAt || '')) S[k][i] = x;
        }
      }
      for (const s of data.statuses || []) {
        const mm = member(s.id);
        if (mm && s.status && (!mm.status || (s.status.setAt || '') > (mm.status.setAt || ''))) mm.status = s.status;
      }
      persist(); renderAll(); toast(`가져왔어요 · 새 일정 ${added}개`);
      return true;
    },
  });
}

// 시작
persist(); // 첫 실행·이전 데이터 변환(migrate) 결과를 바로 저장
ui.lastMinute = D.seoul().time;
setView('world');
renderHeader();
renderBanner();
readShareLink();
sync.start();
window.addEventListener('hashchange', readShareLink);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
