/**
 * Strict ISO 8601 / RFC 3339 parsing for review stamps. No `Date` parsing is
 * used, so the result never depends on the host's locale or time zone.
 *
 * Accepted:
 *   YYYY-MM-DD                          a calendar date (years 0001 to 9999)
 *   YYYY-MM-DDTHH:mm[:ss[.f{1,9}]]Z     a timestamp in UTC
 *   YYYY-MM-DDTHH:mm[:ss[.f{1,9}]]+HH:MM or -HH:MM
 *
 * A timestamp with no zone ("2026-06-08T10:00:00") is not guessed at; it is
 * reported as `zoneless-timestamp`. Everything else (spaces, lowercase t or z,
 * basic format, 24:00, leap seconds, impossible dates) is `unparseable-date`.
 */
export type StampProblem = 'missing' | 'not-a-string' | 'zoneless-timestamp' | 'unparseable-date';

export interface ParsedStamp {
  ok: true;
  /** Milliseconds since 1970-01-01T00:00:00Z. A bare date is midnight UTC. */
  ms: number;
  /** True for YYYY-MM-DD, which names a calendar day rather than an instant. */
  dateOnly: boolean;
}
export interface BadStamp {
  ok: false;
  reason: StampProblem;
}

const MS_PER_DAY = 86_400_000;
/** UTC+14 is the furthest-ahead civil offset, so a bare date can be "today" up to 14 hours early. */
export const DATE_ONLY_FUTURE_GRACE_MS = 14 * 3_600_000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function digits(s: string, start: number, count: number): number {
  let n = 0;
  for (let i = start; i < start + count; i += 1) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    n = n * 10 + c;
  }
  return n;
}

const BAD: BadStamp = { ok: false, reason: 'unparseable-date' };

export function parseStamp(value: unknown): ParsedStamp | BadStamp {
  if (value === undefined || value === null || value === '') return { ok: false, reason: 'missing' };
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };
  const s = value;
  if (s.length < 10 || s.length > 40) return BAD;
  const year = digits(s, 0, 4);
  const month = digits(s, 5, 2);
  const day = digits(s, 8, 2);
  if (s[4] !== '-' || s[7] !== '-' || year < 1 || month < 1 || month > 12 || day < 1) return BAD;
  if (day > daysInMonth(year, month)) return BAD;
  const dayMs = daysFromCivil(year, month, day) * MS_PER_DAY;
  if (s.length === 10) return { ok: true, ms: dayMs, dateOnly: true };
  if (s[10] !== 'T') return BAD;
  const hour = digits(s, 11, 2);
  if (s[13] !== ':' || hour < 0 || hour > 23) return BAD;
  const minute = digits(s, 14, 2);
  if (minute < 0 || minute > 59) return BAD;
  let i = 16;
  let second = 0;
  let fractionMs = 0;
  if (s[i] === ':') {
    second = digits(s, i + 1, 2);
    if (second < 0 || second > 59) return BAD;
    i += 3;
    if (s[i] === '.') {
      let j = i + 1;
      while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j += 1;
      const count = j - (i + 1);
      if (count < 1 || count > 9) return BAD;
      fractionMs = Math.floor(digits(s, i + 1, Math.min(count, 3)) * 10 ** (3 - Math.min(count, 3)));
      i = j;
    }
  }
  const base = dayMs + hour * 3_600_000 + minute * 60_000 + second * 1000 + fractionMs;
  if (i === s.length) return { ok: false, reason: 'zoneless-timestamp' };
  if (s[i] === 'Z' && i + 1 === s.length) return { ok: true, ms: base, dateOnly: false };
  if ((s[i] === '+' || s[i] === '-') && i + 6 === s.length && s[i + 3] === ':') {
    const oh = digits(s, i + 1, 2);
    const om = digits(s, i + 4, 2);
    if (oh < 0 || oh > 23 || om < 0 || om > 59) return BAD;
    const offset = (oh * 60 + om) * 60_000;
    return { ok: true, ms: s[i] === '+' ? base - offset : base + offset, dateOnly: false };
  }
  return BAD;
}

/** True when a stamp is later than `nowMs`; a bare date gets the 14-hour grace. */
export function isFuture(stamp: ParsedStamp, nowMs: number): boolean {
  return (stamp.dateOnly ? stamp.ms - DATE_ONLY_FUTURE_GRACE_MS : stamp.ms) > nowMs;
}

/** The UTC calendar day (days since 1970-01-01) that an instant falls on. */
export function utcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/** `YYYY-MM-DD` for a count of days since 1970-01-01 (Howard Hinnant's algorithm). */
export function formatDay(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
