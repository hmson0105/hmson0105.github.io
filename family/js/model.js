// 가족 온톨로지(데이터 모델)와 데모 데이터.
//
//  Family 1 ─ * Member            (family.memberIds, member.familyId)
//  Event  * ─ 1 Member(담당자)     (event.ownerId)
//  Event  * ─ * Member(참석자)     (event.attendeeIds)
//  Event  * ─ 0..1 Place          (event.placeId)
//  Event  * ─ 0..1 RecurrenceRule (event.recurrenceRuleId)
//  Issue  * ─ 0..1 Member / Event (issue.ownerId, issue.eventId) + 날짜(issue.date)
//  Event/Issue/Post/Guestbook * ─ 1 Source (sourceId: 직접 입력, 캘린더 가져오기, 데모 …)
//  모든 항목에 visibility: 'family'(가족 전체) | 'private'(본인만) — 나중에 권한 기능과 연결
//
// 일정(Event) = 언제·어디서 무엇을 하는지. 이슈(Issue) = 그날 기억·준비할 것.
import * as L from './lunar.js?v=1';

import { addDays, weekday, diffDays, startOfWeek, DAYCODES } from './dates.js?v=6';

export const SCHEMA_VERSION = 1;

// ───────── 들어오는 데이터 검증 ─────────
// 가져오기 링크·캘린더 파일·동기화 서버·기기 저장소에서 읽은 데이터는 화면에 쓰기 전에 clean() 을 거친다.
//  - 사람이 쓴 글(FREE_TEXT)은 그대로 두고, 화면에 넣을 때 esc() 로 처리한다.
//  - 그 밖의 값(id·날짜·시간·종류 …)에서는 HTML·속성을 깨뜨릴 수 있는 문자를 지운다.
//  - 사진은 기기에서 만든 data:image 만, 색은 #hex 만 받는다.
const FREE_TEXT = new Set(['title', 'memo', 'text', 'name', 'displayName', 'roleLabel', 'label', 'bgm', 'destination', 'changes', 'reason', 'prize',
  'place', 'location', 'qty', 'raw', 'line', 'url', 'lastImportFile', 'externalUid', 'uid', 'email', 'summary', 'description']);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UNSAFE = /[<>"'`&\\\u0000-\u001f\u007f]/;
const UNSAFE_G = new RegExp(UNSAFE.source, 'g');
const PHOTO_OK = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const COLOR_OK = /^#[0-9a-fA-F]{3,8}$/;
export const ID_OK = /^[A-Za-z0-9_:.@-]{1,80}$/;

/** 값을 제자리에서 정리해 돌려준다(객체·배열은 같은 참조 유지). */
export function clean(v, key = '', depth = 0) {
  if (v === null || v === undefined || typeof v === 'boolean') return v ?? null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (key === 'photo') return v.length <= 3e6 && PHOTO_OK.test(v) ? v : null;
    if (key === 'color') return COLOR_OK.test(v) ? v : '#FF8FB8';
    if (FREE_TEXT.has(key)) return v.length > 20000 ? v.slice(0, 20000) : v;
    const t = UNSAFE.test(v) ? v.replace(UNSAFE_G, '') : v;
    return t.length > 200 ? t.slice(0, 200) : t;
  }
  if (typeof v !== 'object' || depth > 12) return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = clean(v[i], key, depth + 1);
    return v;
  }
  for (const k of Object.keys(v)) {
    if (BAD_KEYS.has(k) || UNSAFE.test(k)) { delete v[k]; continue; }
    v[k] = clean(v[k], k, depth + 1);
  }
  return v;
}
/** 목록에서 id 가 올바른 객체만 남긴다. */
export const validItems = list => (Array.isArray(list) ? list.filter(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && ID_OK.test(x.id)) : []);

export const newId = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const MOODS = [
  { k: 'happy', e: '😊', l: '좋아요' },
  { k: 'excited', e: '🤩', l: '신나요' },
  { k: 'calm', e: '😌', l: '평온해요' },
  { k: 'focused', e: '🧐', l: '집중 중' },
  { k: 'tired', e: '😪', l: '피곤해요' },
  { k: 'sad', e: '🥲', l: '울적해요' },
  { k: 'sick', e: '🤒', l: '아파요' },
];
export const ACTS = [
  { k: 'busy', l: '작업 중', e: '✏️' },
  { k: 'rest', l: '휴식 중', e: '☕' },
  { k: 'done', l: '오늘 할 일 끝!', e: '⭐' },
  { k: 'out', l: '외출 중', e: '👟' },
];
export const ISSUE_TYPES = [
  { k: 'prep', l: '준비', e: '🎒' },
  { k: 'notice', l: '전달 사항', e: '📢' },
  { k: 'caution', l: '주의 사항', e: '⚠️' },
  { k: 'memo', l: '가족 메모', e: '📝' },
];
export const PRIORITY = [
  { k: 'high', l: '중요' },
  { k: 'normal', l: '보통' },
  { k: 'low', l: '낮음' },
];
export const EVENT_STATUS = [
  { k: 'confirmed', l: '확정' },
  { k: 'tentative', l: '미정' },
  { k: 'cancelled', l: '취소됨' },
];
export const VISIBILITY = [
  { k: 'family', l: '가족 전체' },
  { k: 'private', l: '본인만' },
];
/** 칭찬 스티커로 고를 수 있는 그림 */
export const PRAISE = ['⭐', '🌟', '💖', '🍀', '🏅', '🌈', '🐤', '🍪'];

export const FREQS = [
  { k: '', l: '반복 안 함' },
  { k: 'DAILY', l: '매일' },
  { k: 'WEEKLY', l: '매주' },
  { k: 'MONTHLY', l: '매월' },
  { k: 'YEARLY', l: '매년' },
  { k: 'LUNAR_YEARLY', l: '음력 매년 (생신·기일)' },
];

// 방 꾸미기: 방 그림(Higgsfield 생성 이미지 또는 SVG 대체 그림) 주변 배경과 스티커.
export const BACKDROPS = [
  { k: 'pinkDots', l: '핑크 도트' },
  { k: 'lavStripes', l: '라벤더 줄무늬' },
  { k: 'skyClouds', l: '하늘 구름' },
  { k: 'creamHearts', l: '크림 하트' },
  { k: 'mintCheck', l: '민트 체크' },
];
export const STICKERS = [
  { k: 'star', e: '⭐', l: '별' }, { k: 'heart', e: '💖', l: '하트' }, { k: 'rainbow', e: '🌈', l: '무지개' },
  { k: 'cloud', e: '☁️', l: '구름' }, { k: 'ribbon', e: '🎀', l: '리본' }, { k: 'bear', e: '🧸', l: '곰인형' },
  { k: 'tulip', e: '🌷', l: '튤립' }, { k: 'note', e: '🎵', l: '음표' }, { k: 'sparkle', e: '✨', l: '반짝' },
  { k: 'cake', e: '🍰', l: '케이크' },
];
// 스티커 자리(방 그림 위 %, 고정 슬롯). 고른 순서대로 채운다.
export const STICKER_SLOTS = [[12, 14], [86, 12], [8, 52], [92, 48], [20, 86], [80, 88], [50, 6], [96, 74]];

export const BOARD_KINDS = [
  { k: 'buy', l: '살 것', e: '🛒' },
  { k: 'prep', l: '준비할 것', e: '🎒' },
];

export const SOURCES_BASE = [
  { id: 'src_manual', kind: 'manual', label: '직접 입력' },
  { id: 'src_demo', kind: 'demo', label: '데모(예시)' },
  // 확장 예정: { kind: 'ics-import' } (구현), { kind: 'kakao-paste' } (카톡 복사 텍스트 → 일정 후보, 미구현)
];

function baseMembers() {
  return [
    {
      id: 'm_dad', familyId: 'fam_1', role: 'dad', roleLabel: '아빠', displayName: '아빠',
      color: '#4FA3E3', floor: 4,
      space: { kind: 'school', name: '대학원 연구실' },
      avatar: 'dad',
      status: null,
      room: { backdrop: 'mintCheck', stickers: ['star', 'note'] },
      bgm: '',
    },
    {
      id: 'm_mom', familyId: 'fam_1', role: 'mom', roleLabel: '엄마', displayName: '엄마',
      color: '#9B7BE0', floor: 3,
      space: { kind: 'office', name: '엄마의 사무실' },
      avatar: 'mom',
      status: null,
      room: { backdrop: 'lavStripes', stickers: ['tulip', 'sparkle'] },
      bgm: '',
    },
    {
      id: 'm_kid', familyId: 'fam_1', role: 'kid', roleLabel: '딸', displayName: '콩이',
      color: '#FF6FA3', floor: 2,
      space: { kind: 'daycare', name: '콩이의 어린이집' },
      avatar: 'kid',
      status: null,
      room: { backdrop: 'skyClouds', stickers: ['rainbow', 'bear', 'star'] },
      bgm: '',
    },
  ];
}

function baseState() {
  const now = new Date().toISOString();
  const members = baseMembers();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: now, updatedAt: now, storage: 'local', demo: false },
    family: {
      id: 'fam_1', name: '우리 가족', timezone: 'Asia/Seoul',
      memberIds: members.map(m => m.id),
      lobbyRoom: { backdrop: 'pinkDots', stickers: ['heart', 'cloud'] },
      // 칭찬 스티커 판 — 모으면 보상을 받는다
      rewards: { goal: 10, prize: '', stickers: [], done: [] },
      // 나중에 계정·초대 기능을 붙일 자리. 지금은 비어 있다.
      accounts: [], invites: [],
    },
    members,
    places: [],
    recurrenceRules: [],
    sources: SOURCES_BASE.map(s => ({ ...s })),
    events: [],
    issues: [],
    posts: [],
    guestbook: [],
    trips: [],      // 여행 계획: { id, title, startDate, endDate, destination, memberIds, plan:[{id,date,time,title,memo}], eventId, ... }
    activity: [],   // 가족 소식(변경 내역): { id, at, by, kind, targetId, text }
    tripComments: [], // 여행 댓글: { id, tripId, authorId, text, createdAt, visibility }
    boardItems: [], // 살 것·준비할 것: { id, title, kind:'buy'|'prep', qty, ownerId, tripId, dueDate, done, ... }
    candidates: [], // 카톡 붙여넣기 등에서 만든 '일정 후보'(확인 전) 자리. 아직 생성 기능 없음.
    sync: {
      apple: { mode: 'manual-ics', lastImportAt: null, lastImportFile: null, lastImportCount: 0, lastExportAt: null },
    },
  };
}


/** 처음 상태로 되돌리되, 사용자가 고정(📌)한 일정과 그 반복 규칙·장소는 남긴다. */
export function emptyState(prev) {
  const S = baseState();
  if (prev) {
    const keep = (prev.events || []).filter(e => e.pinned && e.sourceId !== 'src_demo');
    S.events = keep;
    S.recurrenceRules = (prev.recurrenceRules || []).filter(r => keep.some(e => e.recurrenceRuleId === r.id));
    S.places = (prev.places || []).filter(p => keep.some(e => e.placeId === p.id));
  }
  return S;
}

/** 오늘을 기준으로 데모 일정을 만든다. 모든 항목은 sourceId 'src_demo' 로 표시된다. */
export function demoState(T) {
  const S = baseState();
  S.meta.demo = true;
  const now = new Date().toISOString();
  const D = n => addDays(T, n);
  const place = (id, name) => (S.places.push({ id, name }), id);
  const pDay = place('pl_day', '해님어린이집');
  const pSem = place('pl_sem', '대학원 세미나실');
  const pDen = place('pl_den', '튼튼치과');
  const pGma = place('pl_gma', '할머니 댁');
  const pRes = place('pl_res', '동네 파스타집');


  const ev = (o) => S.events.push({
    id: newId('ev'), endDate: o.startDate, startTime: null, endTime: null, allDay: false, timeUnset: false,
    placeId: null, attendeeIds: [o.ownerId], memo: '', status: 'confirmed', sourceId: 'src_demo',
    externalUid: null, recurrenceRuleId: null, exDates: [], visibility: 'family',
    createdBy: o.ownerId, createdAt: now, updatedAt: now, ...o,
  }) && S.events[S.events.length - 1].id;

  // 반복 일정은 이번 주 월요일부터 시작하게 둔다.
  const eSem = ev({ title: '랩 세미나 발표', startDate: T, startTime: '10:00', endTime: '12:00', ownerId: 'm_dad', placeId: pSem, memo: '발표 20분 + 질의응답' });
  ev({ title: '콩이 하원 픽업', startDate: T, startTime: '18:30', endTime: '19:00', ownerId: 'm_mom', attendeeIds: ['m_mom', 'm_kid'], placeId: pDay });
  const eDen = ev({ title: '치과 진료', startDate: D(1), startTime: '15:00', endTime: '16:00', ownerId: 'm_mom', attendeeIds: ['m_mom', 'm_kid'], placeId: pDen, memo: '콩이 정기 검진' });
  ev({ title: '할머니 댁 방문', startDate: D(2), timeUnset: true, ownerId: 'm_dad', attendeeIds: ['m_dad', 'm_mom', 'm_kid'], placeId: pGma, status: 'tentative', memo: '시간은 토요일에 정하기' });
  ev({ title: '논문 초안 제출 마감', startDate: D(3), allDay: true, ownerId: 'm_dad' });
  ev({ title: '가족 외식', startDate: D(5), startTime: '19:00', endTime: '20:30', ownerId: 'm_mom', attendeeIds: ['m_dad', 'm_mom', 'm_kid'], placeId: pRes });
  ev({ title: '엄마 팀 워크숍', startDate: D(-2), allDay: true, ownerId: 'm_mom' });

  const iss = (o) => S.issues.push({
    id: newId('is'), type: 'prep', ownerId: '', done: false, priority: 'normal', eventId: null,
    sourceId: 'src_demo', visibility: 'family', createdBy: 'm_mom', createdAt: now, updatedAt: now, ...o,
  });
  iss({ title: '체육복 가방에 넣기', date: T, ownerId: 'm_mom', priority: 'high' });
  iss({ title: '발표 자료 USB에 백업', date: T, ownerId: 'm_dad', eventId: eSem });
  iss({ title: '저녁 미세먼지 나쁨 · 마스크 챙기기', date: T, type: 'caution', ownerId: '' });
  iss({ title: '우유 사 오기', date: T, type: 'memo', ownerId: 'm_dad', done: true, priority: 'low' });
  iss({ title: '진료카드 챙기기', date: D(1), ownerId: 'm_mom', priority: 'high', eventId: eDen });
  iss({ title: '오전에 택배 도착 예정', date: D(1), type: 'notice', ownerId: '' });

  const setSt = (id, st) => { S.members.find(m => m.id === id).status = { ...st, setAt: now, setBy: id, visibility: 'family', demo: true }; };
  setSt('m_dad', { text: '논문 마감 주간! 커피 수혈 중', mood: 'focused', activity: 'busy' });
  setSt('m_mom', { text: '오늘은 칼퇴가 목표예요', mood: 'happy', activity: 'rest' });
  // 콩이는 상태를 일부러 비워 두어 '상태 미설정' 표시를 보여 준다.

  // 예시 여행과 살 것·준비할 것
  const tStart = D(20), tEnd = D(22);
  const tripId = 'trip_demo';
  const tripEv = ev({ title: '🧳 제주 가족여행', startDate: tStart, endDate: tEnd, allDay: true, ownerId: 'm_dad', attendeeIds: ['m_dad', 'm_mom', 'm_kid'], memo: '여행 계획표에서 자세히 보기', tripId });
  S.trips.push({
    id: tripId, title: '제주 가족여행', startDate: tStart, endDate: tEnd, destination: '제주', memberIds: ['m_dad', 'm_mom', 'm_kid'],
    memo: '렌터카 카시트 꼭 확인', eventId: tripEv, visibility: 'family', sourceId: 'src_demo', createdBy: 'm_dad', createdAt: now, updatedAt: now,
    plan: [
      { id: newId('tp'), date: tStart, time: '09:30', title: '김포공항 출발', memo: '' },
      { id: newId('tp'), date: tStart, time: '12:00', title: '렌터카 받고 점심', memo: '고기국수' },
      { id: newId('tp'), date: tStart, time: '15:00', title: '숙소 체크인', memo: '' },
      { id: newId('tp'), date: addDays(tStart, 1), time: '10:00', title: '아쿠아리움', memo: '콩이 최애' },
      { id: newId('tp'), date: addDays(tStart, 1), time: '', title: '바닷가 산책', memo: '' },
      { id: newId('tp'), date: tEnd, time: '17:00', title: '제주공항 출발', memo: '' },
    ],
  });
  S.tripComments.push(
    { id: newId('tc'), tripId, authorId: 'm_mom', text: '아쿠아리움은 오전에 가면 덜 붐빈대요!', createdAt: now, visibility: 'family', sourceId: 'src_demo' },
    { id: newId('tc'), tripId, authorId: 'm_dad', text: '좋아요. 렌터카는 제가 예약할게요 🚗', createdAt: now, visibility: 'family', sourceId: 'src_demo' },
  );
  const bi = (o) => S.boardItems.push({ id: newId('bi'), kind: 'buy', qty: '', ownerId: '', tripId: null, dueDate: null, done: false, memo: '', visibility: 'family', sourceId: 'src_demo', createdBy: 'm_mom', createdAt: now, updatedAt: now, ...o });
  bi({ title: '유아용 선크림', qty: '1개', ownerId: 'm_mom', tripId });
  bi({ title: '여벌 옷 3벌 챙기기', kind: 'prep', ownerId: 'm_mom', tripId });
  bi({ title: '카시트 예약 확인', kind: 'prep', ownerId: 'm_dad', tripId, done: true });
  bi({ title: '우유', qty: '2팩', ownerId: 'm_dad' });
  bi({ title: '기저귀 · 물티슈', qty: '각 1팩', ownerId: '' });

  S.posts.push(
    { id: newId('po'), memberId: 'm_dad', text: '연구실 창밖 은행잎이 노랗게 물들었어요.', photo: null, createdAt: now, createdBy: 'm_dad', visibility: 'family', sourceId: 'src_demo' },
    { id: newId('po'), memberId: 'm_kid', text: '오늘 그린 그림: 우리 집 무지개 🌈', photo: null, createdAt: now, createdBy: 'm_mom', visibility: 'family', sourceId: 'src_demo' },
  );
  S.guestbook.push(
    { id: newId('gb'), roomOwnerId: 'm_kid', authorId: 'm_dad', text: '콩이 오늘도 씩씩하게 화이팅!', createdAt: now, visibility: 'family', sourceId: 'src_demo' },
    { id: newId('gb'), roomOwnerId: 'm_dad', authorId: 'm_mom', text: '발표 잘하고 와요 👏', createdAt: now, visibility: 'family', sourceId: 'src_demo' },
  );
  return S;
}

/** 데모 표시가 붙은 항목만 걷어낸다. 사용자가 직접 넣은 항목은 남는다. */
export function stripDemo(S) {
  const isDemo = x => x.sourceId === 'src_demo';
  const keepEv = S.events.filter(e => !isDemo(e));
  const keepIds = new Set(keepEv.map(e => e.id));
  S.events = keepEv;
  S.issues = S.issues.filter(i => !isDemo(i)).map(i => (i.eventId && !keepIds.has(i.eventId) ? { ...i, eventId: null } : i));
  S.posts = S.posts.filter(p => !isDemo(p));
  S.trips = (S.trips || []).filter(t => !isDemo(t));
  S.boardItems = (S.boardItems || []).filter(b => !isDemo(b));
  S.tripComments = (S.tripComments || []).filter(c => !isDemo(c) && S.trips.some(t => t.id === c.tripId));
  S.guestbook = S.guestbook.filter(g => !isDemo(g));
  for (const m of S.members) if (m.status && m.status.demo) m.status = null;
  const usedRules = new Set(S.events.map(e => e.recurrenceRuleId).filter(Boolean));
  S.recurrenceRules = S.recurrenceRules.filter(r => usedRules.has(r.id));
  const usedPlaces = new Set(S.events.map(e => e.placeId).filter(Boolean));
  S.places = S.places.filter(p => usedPlaces.has(p.id));
  S.meta.demo = false;
  return S;
}

/** 이전 버전 데이터나 빠진 필드를 채운다. */
export function migrate(S) {
  clean(S);
  const base = baseState();
  for (const k of Object.keys(base)) if (S[k] === undefined) S[k] = base[k];
  S.sync.apple = { ...base.sync.apple, ...(S.sync.apple || {}) };
  for (const s of SOURCES_BASE) if (!S.sources.some(x => x.id === s.id)) S.sources.push({ ...s });
  for (const e of S.events) { e.exDates ||= []; e.attendeeIds ||= []; e.visibility ||= 'family'; }
  // 어린이집은 매일 가므로 데모 '어린이집 등원' 반복 일정을 지운다.
  const daycare = S.events.filter(e => e.sourceId === 'src_demo' && e.title === '어린이집 등원');
  if (daycare.length) {
    const ids = new Set(daycare.map(e => e.id));
    S.events = S.events.filter(e => !ids.has(e.id));
    S.recurrenceRules = S.recurrenceRules.filter(r => !daycare.some(e => e.recurrenceRuleId === r.id));
    S.issues.forEach(i => { if (ids.has(i.eventId)) i.eventId = null; });
  }
  // 기록(짧은 글·사진)에 '언제 있었던 일인지'와 '정리했는지'를 붙인다.
  // at 은 올린 날이 아니라 일어난 날이다 — 반년 뒤에 몰아 올려도 제자리에 꽂히라고.
  // 예전 글은 이미 제자리에 있으니 정리 끝난 것으로 둔다.
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const x of S.posts) {
    if (typeof x.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.at)) {
      x.at = typeof x.createdAt === 'string' && x.createdAt.length >= 10 ? x.createdAt.slice(0, 10) : todayISO;
    }
    if (typeof x.url !== 'string') x.url = '';
    if (x.tripId === undefined) x.tripId = null;
    if (typeof x.filed !== 'boolean') x.filed = true;
  }

  // 칭찬 스티커 판이 없던 예전 데이터에 빈 판을 만들어 준다.
  const rw = S.family.rewards && typeof S.family.rewards === 'object' ? S.family.rewards : {};
  S.family.rewards = {
    goal: Number.isFinite(+rw.goal) && +rw.goal > 0 ? Math.min(100, Math.round(+rw.goal)) : 10,
    prize: typeof rw.prize === 'string' ? rw.prize.slice(0, 60) : '',
    stickers: Array.isArray(rw.stickers) ? rw.stickers.filter(x => x && typeof x === 'object' && typeof x.id === 'string').slice(-200) : [],
    done: Array.isArray(rw.done) ? rw.done.filter(x => x && typeof x === 'object' && typeof x.id === 'string').slice(-50) : [],
  };
  S.schemaVersion = SCHEMA_VERSION;
  return S;
}

/**
 * 반복 규칙을 펼쳐 [from, to] 범위의 발생(occurrence) 목록을 만든다.
 * 지원: DAILY / WEEKLY(BYDAY) / MONTHLY(같은 날짜) / YEARLY, INTERVAL, UNTIL, COUNT, EXDATE.
 */
export function expand(ev, rule, from, to) {
  const span = Math.max(0, diffDays(ev.startDate, ev.endDate || ev.startDate));
  const out = [];
  if (!rule) {
    const e = addDays(ev.startDate, span);
    if (e >= from && ev.startDate <= to) out.push({ ev, date: ev.startDate, endDate: e });
    return out;
  }
  const base = ev.startDate;
  const ex = new Set(ev.exDates || []);
  // 음력 매년 — 해마다 양력 날짜가 바뀐다. 기준일의 음력 월·일을 해마다 다시 양력으로 옮긴다.
  if (rule.freq === 'LUNAR_YEARLY') {
    const lb = L.toLunar(base);
    if (!lb) {   // 음력을 못 쓰는 브라우저: 기준일 하나만 보여 준다
      const e0 = addDays(base, span);
      if (e0 >= from && base <= to) out.push({ ev, date: base, endDate: e0 });
      return out;
    }
    const limitY = rule.until && rule.until < to ? +rule.until.slice(0, 4) : +to.slice(0, 4);
    for (let y = +from.slice(0, 4) - 1; y <= limitY; y++) {
      const d = L.solarFromLunar(y, lb.month, lb.day);
      if (!d || d < base || ex.has(d)) continue;
      if (rule.until && d > rule.until) continue;
      const e = addDays(d, span);
      if (e >= from && d <= to) out.push({ ev, date: d, endDate: e });
    }
    return out;
  }
  const interval = Math.max(1, +rule.interval || 1);
  const byDay = rule.byDay && rule.byDay.length ? rule.byDay.map(c => DAYCODES.indexOf(c)).filter(i => i >= 0) : [weekday(base)];
  const limit = rule.until && rule.until < to ? rule.until : to;
  const [by, bm, bd] = base.split('-').map(Number);
  const baseWeek = startOfWeek(base);
  let count = 0;
  for (let d = base, i = 0; d <= limit && i < 5000; d = addDays(d, 1), i++) {
    let hit = false;
    const [y, m, day] = d.split('-').map(Number);
    switch (rule.freq) {
      case 'DAILY': hit = diffDays(base, d) % interval === 0; break;
      case 'WEEKLY': hit = byDay.includes(weekday(d)) && (diffDays(baseWeek, startOfWeek(d)) / 7) % interval === 0; break;
      case 'MONTHLY': hit = day === bd && ((y - by) * 12 + (m - bm)) % interval === 0; break;
      case 'YEARLY': hit = day === bd && m === bm && (y - by) % interval === 0; break;
    }
    if (!hit) continue;
    count++;
    if (rule.count && count > rule.count) break;
    if (ex.has(d)) continue;
    const e = addDays(d, span);
    if (e >= from && d <= to) out.push({ ev, date: d, endDate: e });
  }
  return out;
}
