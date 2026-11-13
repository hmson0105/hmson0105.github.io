// 음력(陰曆) ↔ 양력.
//
// 브라우저에 들어 있는 음력 달력(Intl 의 chinese 달력)을 쓴다. 표를 따로 들고 다니지 않아
// 몇십 년치가 아니라 언제든 맞는다. 설날·추석·윤달까지 한국 음력과 같게 나온다.
//
// 아주 드물게(한 세기에 며칠) 한국 음력과 하루 어긋날 수 있다. 한국은 한국 표준시,
// 이 달력은 중국 표준시로 삭(新月) 시각을 재기 때문이다. 생신·기일에는 사실상 문제가 없다.
//
// 음력을 못 쓰는 브라우저에서는 available() 이 false 가 되고, 달력에 음력 숫자가 안 보일 뿐
// 나머지는 그대로 돌아간다.

let fmt = null;
try {
  fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  // 한 번 돌려 보고 쓸 만한지 확인한다
  const t = fmt.formatToParts(new Date('2026-02-17T12:00:00Z'));
  const got = Object.fromEntries(t.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  if (String(got.month) !== '1' || String(got.day) !== '1') fmt = null;   // 2026년 설날이 음력 1월 1일
} catch { fmt = null; }

export const available = () => !!fmt;

const cache = new Map();

/**
 * 양력 'YYYY-MM-DD' → { year, month, day, leap }
 * leap 은 윤달(예: 윤6월)이면 true.
 */
export function toLunar(d) {
  if (!fmt || typeof d !== 'string') return null;
  const hit = cache.get(d);
  if (hit !== undefined) return hit;
  let out = null;
  try {
    const parts = fmt.formatToParts(new Date(`${d}T12:00:00Z`));
    const o = {};
    for (const p of parts) if (p.type !== 'literal') o[p.type] = p.value;
    const m = String(o.month ?? '');
    const num = parseInt(m, 10);
    if (Number.isFinite(num)) {
      out = { year: +o.relatedYear, month: num, day: +o.day, leap: /bis|闰|윤/i.test(m) };
    }
  } catch { out = null; }
  if (cache.size > 4000) cache.clear();
  cache.set(d, out);
  return out;
}

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * 그 해 양력에서 음력 (월, 일) 이 며칠인지 찾는다. 없으면 null.
 * 윤달이 있는 해에는 평달(윤달 아닌 달)을 쓴다 — 생신·기일의 보통 관례.
 * 그 달이 29일까지뿐인데 30일을 찾으면 29일로 당겨 준다.
 */
export function solarFromLunar(solarYear, lMonth, lDay) {
  if (!fmt) return null;
  let fallback = null;
  // 음력 설이 양력 1월 하순~2월이라, 그 해 양력 전체를 훑으면 충분히 덮인다.
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(solarYear, m, 0)).getUTCDate();
    for (let d = 1; d <= last; d++) {
      const s = iso(solarYear, m, d);
      const l = toLunar(s);
      if (!l || l.leap || l.month !== lMonth) continue;
      if (l.day === lDay) return s;
      if (l.day === 29 && lDay === 30) fallback = s;   // 작은달이면 29일로
    }
  }
  return fallback;
}

/** 달력 칸에 쓸 짧은 표기. 음력 초하루에는 '8.1' 처럼 달을 함께 보여 준다. */
export function cellLabel(d) {
  const l = toLunar(d);
  if (!l) return '';
  return l.day === 1 ? `${l.leap ? '윤' : ''}${l.month}.1` : String(l.day);
}

/** '음력 8월 2일' 같은 사람이 읽는 표기 */
export function human(d) {
  const l = toLunar(d);
  return l ? `음력 ${l.leap ? '윤' : ''}${l.month}월 ${l.day}일` : '';
}
