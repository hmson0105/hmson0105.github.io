// iCalendar(.ics) 가져오기·내보내기. Apple 캘린더와 주고받는 현재 방식이다.
// 양방향 자동 동기화가 아니라 "파일을 주고받는" 수동 연결이다.

import { TZ, addDays, seoul, wallToUTC, addMinutes, DAYCODES } from './dates.js?v=5';

const PRODID = '-//family-home//miniworld//KO';

const escText = s => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unescText = s => String(s ?? '')
  .replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

const enc = new TextEncoder();
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  let out = '', cur = '', len = 0, first = true;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (len + b > (first ? 75 : 74)) {
      out += (first ? '' : '\r\n ') + cur;
      first = false; cur = ''; len = 0;
    }
    cur += ch; len += b;
  }
  return out + (first ? '' : '\r\n ') + cur;
}

const dDate = d => d.replace(/-/g, '');
const dTime = (d, t) => `${dDate(d)}T${t.replace(':', '')}00`;
function utcStamp(ms = Date.now()) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const VTZ = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
];

/**
 * @param events 내보낼 일정
 * @param ctx { memberName(id), placeName(id), rule(id) }
 */
export function buildICS(events, ctx) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:우리 가족 캘린더', `X-WR-TIMEZONE:${TZ}`, ...VTZ];
  for (const ev of events) {
    const allDayLike = ev.allDay || ev.timeUnset || !ev.startTime;
    L.push('BEGIN:VEVENT');
    L.push(`UID:${ev.externalUid || ev.id + '@family-home'}`);
    L.push(`DTSTAMP:${utcStamp()}`);
    if (allDayLike) {
      L.push(`DTSTART;VALUE=DATE:${dDate(ev.startDate)}`);
      L.push(`DTEND;VALUE=DATE:${dDate(addDays(ev.endDate || ev.startDate, 1))}`);
    } else {
      const endDate = ev.endDate || ev.startDate;
      let end = ev.endTime ? { date: endDate, time: ev.endTime } : addMinutes(ev.startDate, ev.startTime, 60);
      if (end.date + end.time <= ev.startDate + ev.startTime) end = addMinutes(ev.startDate, ev.startTime, 60);
      L.push(`DTSTART;TZID=${TZ}:${dTime(ev.startDate, ev.startTime)}`);
      L.push(`DTEND;TZID=${TZ}:${dTime(end.date, end.time)}`);
    }
    const title = (ev.timeUnset ? '[시간 미정] ' : '') + ev.title;
    L.push(`SUMMARY:${escText(title)}`);
    const place = ctx.placeName(ev.placeId);
    if (place) L.push(`LOCATION:${escText(place)}`);
    const who = [`담당: ${ctx.memberName(ev.ownerId)}`];
    const att = (ev.attendeeIds || []).filter(id => id !== ev.ownerId).map(ctx.memberName);
    if (att.length) who.push(`함께: ${att.join(', ')}`);
    L.push(`DESCRIPTION:${escText([ev.memo, who.join(' · ')].filter(Boolean).join('\n'))}`);
    L.push(`STATUS:${{ confirmed: 'CONFIRMED', tentative: 'TENTATIVE', cancelled: 'CANCELLED' }[ev.status] || 'CONFIRMED'}`);
    if (ev.timeUnset) L.push('X-FAMILY-TIME-UNSET:TRUE');
    // 우리 앱끼리 주고받을 때 담당자·참석자를 보존한다(이름이 아닌 역할 코드만 적는다).
    if (ctx.memberRole) {
      const r = ctx.memberRole(ev.ownerId);
      if (r) L.push(`X-FAMILY-OWNER:${r}`);
      const rs = (ev.attendeeIds || []).map(ctx.memberRole).filter(Boolean);
      if (rs.length) L.push(`X-FAMILY-ATTENDEES:${rs.join(',')}`);
    }
    const rule = ctx.rule(ev.recurrenceRuleId);
    if (rule) {
      const parts = [`FREQ=${rule.freq}`];
      if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
      if (rule.freq === 'WEEKLY' && rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
      if (rule.until) parts.push(allDayLike ? `UNTIL=${dDate(rule.until)}` : `UNTIL=${utcStamp(wallToUTC(rule.until, '23:59', TZ))}`);
      else if (rule.count) parts.push(`COUNT=${rule.count}`);
      L.push(`RRULE:${parts.join(';')}`);
      for (const x of ev.exDates || []) {
        L.push(allDayLike ? `EXDATE;VALUE=DATE:${dDate(x)}` : `EXDATE;TZID=${TZ}:${dTime(x, ev.startTime)}`);
      }
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ───────────────────────── 가져오기 ─────────────────────────

function parseDT(value, params) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}`;
  if (m[7]) { // UTC
    const s = seoul(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: s.date, time: s.time };
  }
  const tz = params.TZID && params.TZID.replace(/^"|"$/g, '');
  if (tz && tz !== TZ) {
    const s = seoul(wallToUTC(date, time, tz));
    return { date: s.date, time: s.time };
  }
  return { date, time }; // 서울 시각 또는 시간대 없는(floating) 시각
}

function parseDuration(s) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s || '');
  if (!m) return null;
  return ((+m[1] || 0) * 7 * 1440) + ((+m[2] || 0) * 1440) + ((+m[3] || 0) * 60) + (+m[4] || 0);
}

function parseRRule(v) {
  const o = Object.fromEntries(v.split(';').map(p => p.split('=')));
  const supportedFreq = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(o.FREQ);
  const byDayRaw = o.BYDAY ? o.BYDAY.split(',') : [];
  const ordinal = byDayRaw.some(d => /^[+-]?\d/.test(d));
  const unsupported = !supportedFreq || ordinal || o.BYMONTHDAY || o.BYSETPOS || o.BYMONTH || o.BYYEARDAY || o.BYWEEKNO;
  if (unsupported) return { unsupported: true };
  let until = null;
  if (o.UNTIL) { const u = parseDT(o.UNTIL, {}); until = u && u.date; }
  return {
    freq: o.FREQ, interval: +o.INTERVAL || 1,
    byDay: byDayRaw.filter(d => DAYCODES.includes(d)),
    until, count: o.COUNT ? +o.COUNT : null,
  };
}

/** .ics 텍스트 → 일정 후보 목록. 지원하지 않는 부분은 notes 에 남긴다. */
export function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null, skip = 0, skippedOverrides = 0, unsupportedRules = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { params: {}, exdates: [] }; continue; }
    if (!cur) continue;
    if (/^BEGIN:/.test(line)) { skip++; continue; }       // VALARM 등 하위 블록
    if (/^END:/.test(line) && line !== 'END:VEVENT') { skip = Math.max(0, skip - 1); continue; }
    if (skip) continue;
    if (line === 'END:VEVENT') {
      if (cur.recurrenceId) skippedOverrides++;
      else if (cur.start) out.push(cur);
      cur = null; continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const params = Object.fromEntries((m[2] || '').split(';').filter(Boolean).map(p => {
      const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1)];
    }));
    const val = m[3];
    switch (name) {
      case 'UID': cur.uid = val.trim(); break;
      case 'SUMMARY': cur.summary = unescText(val); break;
      case 'LOCATION': cur.location = unescText(val); break;
      case 'DESCRIPTION': cur.description = unescText(val); break;
      case 'STATUS': cur.status = val.trim().toUpperCase(); break;
      case 'DTSTART': cur.start = parseDT(val, params); break;
      case 'DTEND': cur.end = parseDT(val, params); break;
      case 'DURATION': cur.duration = parseDuration(val.trim()); break;
      case 'RRULE': cur.rrule = parseRRule(val.trim()); if (cur.rrule.unsupported) { unsupportedRules++; cur.rrule = null; } break;
      case 'EXDATE': for (const x of val.split(',')) { const d = parseDT(x, params); if (d) cur.exdates.push(d.date); } break;
      case 'RECURRENCE-ID': cur.recurrenceId = true; break;
      case 'X-FAMILY-TIME-UNSET': cur.timeUnset = /TRUE/i.test(val); break;
      case 'X-FAMILY-OWNER': cur.ownerRole = val.trim(); break;
      case 'X-FAMILY-ATTENDEES': cur.attendeeRoles = val.split(',').map(x => x.trim()).filter(Boolean); break;
    }
  }

  const events = out.filter(e => e.start).map(e => {
    const allDay = !e.start.time;
    let endDate = e.start.date, endTime = null;
    if (e.end) {
      if (allDay) endDate = e.end.date > e.start.date ? addDays(e.end.date, -1) : e.start.date;
      else { endDate = e.end.date; endTime = e.end.time; }
    } else if (e.duration != null) {
      if (allDay) endDate = addDays(e.start.date, Math.max(0, Math.ceil(e.duration / 1440) - 1));
      else { const x = addMinutes(e.start.date, e.start.time, e.duration); endDate = x.date; endTime = x.time; }
    }
    const timeUnset = !!e.timeUnset;
    return {
      uid: e.uid || null,
      title: (e.summary || '(제목 없음)').replace(/^\[시간 미정\]\s*/, ''),
      location: e.location || '',
      memo: e.description || '',
      status: { CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELLED: 'cancelled' }[e.status] || 'confirmed',
      startDate: e.start.date, startTime: allDay ? null : e.start.time,
      endDate, endTime: allDay ? null : endTime,
      allDay: allDay && !timeUnset, timeUnset,
      rrule: e.rrule || null, exDates: e.exdates,
      ownerRole: e.ownerRole || null, attendeeRoles: e.attendeeRoles || [],
    };
  });
  return { events, skippedOverrides, unsupportedRules };
}

export function downloadText(filename, text, type = 'text/calendar;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
