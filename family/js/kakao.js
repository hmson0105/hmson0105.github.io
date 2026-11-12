// 카카오톡에서 복사한 글 → 일정·준비 항목 '후보'.
// 카톡을 자동으로 읽지 않는다. 사용자가 붙여 넣은 글만 분석하고, 확인을 거쳐야 저장된다.
// 규칙 기반이라 틀릴 수 있으므로, 추정한 값에는 needsCheck 표시를 붙인다.
import { addDays, weekday } from './dates.js?v=6';

const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const pad = n => String(n).padStart(2, '0');

// 카톡 내보내기 머리말·시간 표시 줄 정리
function cleanLine(l) {
  return l
    .replace(/^\s*\[[^\]]+\]\s*\[[^\]]+\]\s*/, '')                       // [이름] [오후 3:12]
    .replace(/^\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*(오전|오후)\s*\d{1,2}:\d{2},\s*[^:]+:\s*/, '') // 2026. 11. 13. 오후 3:12, 이름 :
    .trim();
}

function findDate(text, today) {
  let m;
  if ((m = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?/))) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, raw: m[0] };
  if ((m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) || (m = text.match(/(?<![\d:])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d:])/))) {
    let y = +today.slice(0, 4);
    const cand = `${y}-${pad(m[1])}-${pad(m[2])}`;
    if (cand < addDays(today, -60)) y += 1;               // 지난 날짜면 내년으로 본다
    return { date: `${y}-${pad(m[1])}-${pad(m[2])}`, raw: m[0] };
  }
  if ((m = text.match(/오늘|내일|모레|글피/))) return { date: addDays(today, { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[0]]), raw: m[0] };
  if ((m = text.match(/(이번\s*주|다음\s*주|담주|다다음\s*주)?\s*([일월화수목금토])요일/))) {
    const target = WD[m[2]], cur = weekday(today);
    let diff;
    if (!m[1]) diff = (target - cur + 7) % 7;                      // 다가오는 그 요일(오늘 포함)
    else {
      const week = /다다음/.test(m[1]) ? 2 : /다음|담/.test(m[1]) ? 1 : 0;
      diff = week * 7 + (target - cur);
      if (week === 0 && diff < 0) diff += 7;
    }
    return { date: addDays(today, diff), raw: m[0], weekdayOnly: !m[1] };
  }
  if ((m = text.match(/(?<![\d월])(\d{1,2})\s*일(?![\s]*(?:동안|간))/))) {
    const d = +m[1];
    let y = +today.slice(0, 4), mo = +today.slice(5, 7);
    if (d < +today.slice(8, 10)) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    return { date: `${y}-${pad(mo)}-${pad(d)}`, raw: m[0], guessed: true };
  }
  return null;
}

function findTime(text) {
  let m;
  const re = /(오전|오후|아침|저녁|밤|낮)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?:\s*(\d{1,2})\s*분|\s*(반))?)/g;
  const found = [];
  while ((m = re.exec(text))) {
    let h = +m[2];
    const mi = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
    if (h > 24 || mi > 59) continue;
    let guessed = false;
    if (m[1] === '오후' || m[1] === '저녁' || m[1] === '밤') { if (h < 12) h += 12; }
    else if (m[1] === '오전' || m[1] === '아침') { if (h === 12) h = 0; }
    else if (m[1] === '낮') { if (h < 7) h += 12; }
    else if (!m[3] && h >= 1 && h <= 7) { h += 12; guessed = true; }   // "3시" → 보통 오후
    found.push({ time: `${pad(h % 24)}:${pad(mi)}`, raw: m[0], guessed });
  }
  if (!found.length) return null;
  const range = text.match(/(\d{1,2}(?::\d{2}|시(?:\s*\d{1,2}분|\s*반)?))\s*[~\-–부터]+\s*(?:오전|오후)?\s*(\d{1,2}(?::\d{2}|시(?:\s*\d{1,2}분|\s*반)?))/);
  return { start: found[0], end: range && found[1] ? found[1] : null };
}

function findPlace(text) {
  let m;
  if ((m = text.match(/장소\s*[:：]\s*([^\n,.!]+)/))) return m[1].trim();
  if ((m = text.match(/@\s*([^\s,.!]+)/))) return m[1].trim();
  if ((m = text.match(/([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+)?)에서/))) return m[1].trim();
  return '';
}

function findOwner(text, members, viewer) {
  for (const mm of members) {
    const names = [mm.displayName, mm.displayName.replace(/이$/, ''), mm.roleLabel].filter(Boolean);
    if (names.some(n => n.length >= 2 && text.includes(n))) return mm.id;
  }
  if (/제가|내가|저는|나는/.test(text)) return viewer;
  return null;
}

const PREP_RE = /([가-힣A-Za-z0-9 ]{1,20}?)\s*(?:을|를)?\s*(?:꼭\s*)?(챙겨|챙기기|가져와|가져오기|준비해|준비물)/;

/**
 * @returns {{events: Array, preps: Array}}
 */
export function parseKakao(raw, { today, members, viewer }) {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter(Boolean)
    .flatMap(l => l.split(/(?<=[.!?。])\s+|(?<=[!?])/).map(x => x.trim()).filter(x => x && x.length > 1));
  const events = [], preps = [];
  let lastDate = null;
  for (const line of lines) {
    const d = findDate(line, today);
    const t = findTime(line);
    if (d) lastDate = d;
    const prep = line.match(PREP_RE);
    if (prep && !t) {
      const what = prep[1].replace(/^(그리고|또|꼭|다들|모두)\s*/, '').trim();
      if (what) preps.push({ title: `${what} 챙기기`, date: (d || lastDate)?.date || null, line });
      continue;
    }
    if (!d && !t) continue;
    const dd = d || lastDate;
    let title = line;
    for (const r of [d?.raw, t?.start?.raw, t?.end?.raw]) if (r) title = title.replace(r, ' ');
    let bare = line;
    for (const r of [d?.raw, t?.start?.raw, t?.end?.raw]) if (r) bare = bare.replace(r, ' ');
    const place = findPlace(bare.replace(/(이번\s*주|다음\s*주|담주)/g, ' ').replace(/\s+/g, ' '));
    title = title
      .replace(/장소\s*[:：]\s*[^\n,.!]+/, ' ').replace(/@\s*[^\s,.!]+/, ' ')
      .replace(/(이번\s*주|다음\s*주|담주|다다음\s*주)/g, ' ')
      .replace(/[~\-–]|부터|까지/g, ' ')
      .replace(/(에|에는|엔)\s/g, ' ')
      .replace(/(예약했어요|예약했어|예약 완료|있어요|있어|있습니다|이에요|예요|입니다|해요|할게요|가요|갈게요|잡혔어요|잡았어요|입니당|ㅎㅎ+|ㅋㅋ+|!+|\?+|~+)/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    const ownerId = findOwner(line, members, viewer);
    const om = ownerId && members.find(x => x.id === ownerId);
    if (om && om.role !== 'kid') title = title.replace(new RegExp(`^(${om.displayName}|${om.roleLabel})(가|이|는|께서)?\\s*`), '');
    if (place) title = title.replace(`${place}에서`, ' ').replace(/\s+/g, ' ').trim() || title;
    events.push({
      title: title.slice(0, 40) || '새 일정',
      date: dd?.date || today,
      startTime: t?.start?.time || null,
      endTime: t?.end?.time || null,
      place,
      ownerId,
      needsCheck: !dd || !!dd.guessed || !!t?.start?.guessed || !t,
      line,
    });
  }
  // 준비 항목에 날짜가 없으면 바로 앞 일정 날짜로
  for (const p of preps) if (!p.date && events.length) p.date = events.at(-1).date;
  return { events, preps };
}
