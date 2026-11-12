// 날짜·시간 유틸. 모든 "벽시계" 값은 Asia/Seoul 기준 문자열로 다룬다.
//   날짜: 'YYYY-MM-DD'   시각: 'HH:mm'
// 한국은 서머타임이 없어 +09:00 고정이지만, .ics 가져오기에서 다른 시간대를
// 만날 수 있으므로 Intl 로 오프셋을 계산하는 함수도 둔다.

export const TZ = 'Asia/Seoul';
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const DAYCODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const pad = n => String(n).padStart(2, '0');

function partsIn(tz, ms) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}

/** 서울 기준 현재(또는 주어진 순간)의 날짜·시각 */
export function seoul(ms = Date.now()) {
  const p = partsIn(TZ, ms);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    hour: +p.hour,
  };
}
export const today = () => seoul().date;

export function toUTC(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
}
export function fromUTC(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const addDays = (d, n) => fromUTC(toUTC(d) + n * 864e5);
export const weekday = d => new Date(toUTC(d)).getUTCDay();
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const startOfMonth = d => d.slice(0, 8) + '01';
export const startOfWeek = d => addDays(d, -weekday(d));
export function addMonths(d, n) {
  const [y, m] = d.split('-').map(Number);
  return fromUTC(Date.UTC(y, m - 1 + n, 1));
}
export function addMinutes(date, time, mins) {
  const [h, m] = time.split(':').map(Number);
  const t = toUTC(date) + (h * 60 + m + mins) * 6e4;
  const x = new Date(t);
  return { date: fromUTC(t), time: `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}` };
}

export function fmtDate(d, { year = false, wd = true, long = false } = {}) {
  const [y, m, dd] = d.split('-').map(Number);
  const w = long ? ` ${WD[weekday(d)]}요일` : wd ? ` (${WD[weekday(d)]})` : '';
  return `${year ? y + '년 ' : ''}${m}월 ${dd}일${w}`;
}
export function fmtMonth(d) {
  const [y, m] = d.split('-').map(Number);
  return `${y}년 ${m}월`;
}

export function relTime(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export function fmtStamp(iso) {
  if (!iso) return '';
  const s = seoul(new Date(iso).getTime());
  return `${fmtDate(s.date, { year: true, wd: false })} ${s.time}`;
}

/** 시간대 tz 의 순간 ms 에서의 UTC 오프셋(분). 잘못된 tz 면 서울로 본다. */
export function tzOffsetMin(tz, ms) {
  let p;
  try { p = partsIn(tz, ms); } catch { p = partsIn(TZ, ms); }
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - ms) / 6e4);
}
/** tz 의 벽시계 날짜·시각 → UTC ms */
export function wallToUTC(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - tzOffsetMin(tz, guess) * 6e4;
  ms = guess - tzOffsetMin(tz, ms) * 6e4;
  return ms;
}
