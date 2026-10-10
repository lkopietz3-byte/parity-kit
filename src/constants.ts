import { ParityError } from './errors.js';
import { describeError } from './snapshot.js';
import { descriptorValue, isPlainObject, readOwn } from './options.js';

/** A constant that should live in one place. */
export interface RegisteredConstant {
  /** A name for the constant, used in reports. Must be unique. */
  id: string;
  /** A finite number (matched by numeric value, so `1.25` also finds `1.250`) or a non-empty string (matched as exact text). */
  value: number | string;
  /** Extra literal spellings to look for, for example `"1.25 cents"` or `"1,25"`. Matched as exact text. */
  forms?: readonly string[];
}

export interface HandTypedMatch {
  id: string;
  value: number | string;
  /** The text that matched, exactly as typed. */
  text: string;
  /** 0-based UTF-16 offset of the match. */
  index: number;
  /** 1-based line. A line ends at LF, CRLF or a lone CR. */
  line: number;
  /** 1-based column, counted in UTF-16 code units from the start of the line. */
  column: number;
  /** `number`: found by numeric value. `form`: found as literal text. */
  kind: 'number' | 'form';
}

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

const isDigitCode = (c: number): boolean => c >= 48 && c <= 57;
const WORD = /^[\p{L}\p{N}_]$/u;

/** The code point that ends just before `index`, as a string ('' at the start). */
function charBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1] as string;
}

/** The code point that starts at `index`, as a string ('' at the end). */
function charAt(text: string, index: number): string {
  if (index >= text.length) return '';
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return text.slice(index, index + 2);
  }
  return text[index] as string;
}

const isWord = (ch: string): boolean => ch !== '' && WORD.test(ch);

// ---------------------------------------------------------------------------
// Numeric tokens
// ---------------------------------------------------------------------------

interface NumberToken {
  start: number;
  end: number;
  value: number;
}

/** Characters before a "-" that make it a binary operator or a separator rather than a sign. */
function minusIsSign(text: string, signIndex: number): boolean {
  const before = charBefore(text, signIndex);
  if (before === '') return true;
  return !(isWord(before) || before === ')' || before === ']' || before === '}' || before === '.' || before === "'" || before === '"');
}

/**
 * Scan for numbers in one left-to-right pass. A number is digits with
 * optional "," thousands groups of exactly three digits, an optional "." and
 * fraction, and an optional exponent. A run like 1.25.3 or 3.1.4 (a version,
 * an address) is skipped whole. A number glued to a preceding letter or
 * underscore (v1.25, x_1.25) is skipped, and so is a zero-padded run such as
 * 08 or 007. Letters after a number are fine, so
 * `1.25x` and `1.25c` are found. A "-" is part of the number when it follows
 * the start of the text, a space, or an opening bracket or operator (the
 * Unicode minus sign counts too).
 */
function* numberTokens(text: string): Generator<NumberToken> {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    const startsDot = c === 46 && i + 1 < n && isDigitCode(text.charCodeAt(i + 1));
    if (!isDigitCode(c) && !startsDot) {
      i += 1;
      continue;
    }
    const start = i;
    let j = i;
    let valid = true;
    // Integer part with optional thousands groups.
    if (!startsDot) {
      while (j < n && isDigitCode(text.charCodeAt(j))) j += 1;
      // A zero-padded run (08, 007) is a code, a date part or an id, not a typed number.
      if (j - start > 1 && text.charCodeAt(start) === 48) valid = false;
      while (
        j + 3 < n &&
        text.charCodeAt(j) === 44 &&
        isDigitCode(text.charCodeAt(j + 1)) &&
        isDigitCode(text.charCodeAt(j + 2)) &&
        isDigitCode(text.charCodeAt(j + 3)) &&
        !(j + 4 < n && isDigitCode(text.charCodeAt(j + 4)))
      ) {
        j += 4;
      }
    }
    // Fraction.
    if (j < n && text.charCodeAt(j) === 46 && j + 1 < n && isDigitCode(text.charCodeAt(j + 1))) {
      j += 1;
      while (j < n && isDigitCode(text.charCodeAt(j))) j += 1;
    }
    // A second dot-and-digit means a dotted run (1.25.3): swallow the whole run and skip it.
    if (j < n && text.charCodeAt(j) === 46 && j + 1 < n && isDigitCode(text.charCodeAt(j + 1))) {
      valid = false;
      while (j < n && (isDigitCode(text.charCodeAt(j)) || (text.charCodeAt(j) === 46 && j + 1 < n && isDigitCode(text.charCodeAt(j + 1))))) j += 1;
    } else if (j < n && (text.charCodeAt(j) === 101 || text.charCodeAt(j) === 69)) {
      // Exponent: e5, e+5, E-5.
      let k = j + 1;
      if (k < n && (text.charCodeAt(k) === 43 || text.charCodeAt(k) === 45)) k += 1;
      if (k < n && isDigitCode(text.charCodeAt(k))) {
        while (k < n && isDigitCode(text.charCodeAt(k))) k += 1;
        j = k;
      }
    }
    // Boundaries.
    const before = charBefore(text, start);
    if (isWord(before)) valid = false;
    if (j < n && text.charCodeAt(j) === 95) valid = false; // "_" glues the number to an identifier
    if (valid) {
      let tokenStart = start;
      let negative = false;
      if ((before === '-' || before === '\u2212') && minusIsSign(text, start - 1)) {
        negative = true;
        tokenStart = start - 1;
      }
      const raw = text.slice(start, j).replace(/,/g, '');
      const value = Number(raw);
      if (Number.isFinite(value)) yield { start: tokenStart, end: j, value: negative ? -value : value };
    }
    i = j > i ? j : i + 1;
  }
}

// ---------------------------------------------------------------------------
// Literal forms: Aho-Corasick, linear in the text
// ---------------------------------------------------------------------------

interface Pattern {
  entry: number;
  form: string;
}

class Automaton {
  private readonly next: Array<Map<number, number>> = [new Map<number, number>()];
  private readonly fail: number[] = [0];
  private readonly out: number[][] = [[]];
  private readonly link: number[] = [-1];

  constructor(patterns: readonly Pattern[]) {
    for (let p = 0; p < patterns.length; p += 1) {
      const form = (patterns[p] as Pattern).form;
      let node = 0;
      for (let i = 0; i < form.length; i += 1) {
        const code = form.charCodeAt(i);
        let child = (this.next[node] as Map<number, number>).get(code);
        if (child === undefined) {
          child = this.next.length;
          this.next.push(new Map<number, number>());
          this.fail.push(0);
          this.out.push([]);
          this.link.push(-1);
          (this.next[node] as Map<number, number>).set(code, child);
        }
        node = child;
      }
      (this.out[node] as number[]).push(p);
    }
    const queue: number[] = [];
    for (const child of (this.next[0] as Map<number, number>).values()) queue.push(child);
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head] as number;
      for (const [code, child] of this.next[node] as Map<number, number>) {
        let f = this.fail[node] as number;
        while (f !== 0 && !(this.next[f] as Map<number, number>).has(code)) f = this.fail[f] as number;
        const target = (this.next[f] as Map<number, number>).get(code);
        const failure = target !== undefined && target !== child ? target : 0;
        this.fail[child] = failure;
        this.link[child] = (this.out[failure] as number[]).length > 0 ? failure : (this.link[failure] as number);
        queue.push(child);
      }
    }
  }

  /** Calls `hit(patternIndex, endExclusive)` for every occurrence. */
  scan(text: string, hit: (pattern: number, end: number) => void): void {
    let node = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      while (node !== 0 && !(this.next[node] as Map<number, number>).has(code)) node = this.fail[node] as number;
      node = (this.next[node] as Map<number, number>).get(code) ?? 0;
      let at = (this.out[node] as number[]).length > 0 ? node : (this.link[node] as number);
      while (at > 0) {
        for (const p of this.out[at] as number[]) hit(p, i + 1);
        at = this.link[at] as number;
      }
    }
  }
}

/** Is a literal match at [start, end) a whole token, judged by its first and last characters? */
function literalBoundariesOk(text: string, start: number, end: number): boolean {
  const first = charAt(text, start);
  const before = charBefore(text, start);
  if (isDigitCode(first.charCodeAt(0)) || first === '.') {
    if (isDigitCode(before.charCodeAt(0))) return false;
    if (isDigitCode(first.charCodeAt(0)) && isWord(before)) return false;
    if (before === '.' && isDigitCode(charBefore(text, start - 1).charCodeAt(0))) return false;
  } else if (isWord(first) && isWord(before)) {
    return false;
  }
  const last = charBefore(text, end);
  const after = charAt(text, end);
  if (isDigitCode(last.charCodeAt(0))) {
    if (isDigitCode(after.charCodeAt(0))) return false;
    if ((after === '.' || after === ',') && isDigitCode(charAt(text, end + 1).charCodeAt(0))) return false;
    if (after === '_') return false;
    if (after === 'e' || after === 'E') {
      const a = text.charCodeAt(end + 1);
      if (isDigitCode(a) || ((a === 43 || a === 45) && isDigitCode(text.charCodeAt(end + 2)))) return false;
    }
  } else if (isWord(last) && isWord(after)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Registry reading
// ---------------------------------------------------------------------------

interface Entry {
  id: string;
  value: number | string;
  forms: string[];
}

function readRegistry(registry: unknown): Entry[] {
  const bad = (message: string): never => {
    throw new ParityError('bad-registry', `findHandTypedConstants: ${message}`);
  };
  let length: unknown;
  try {
    if (!Array.isArray(registry)) return bad('the registry must be an array');
    length = readOwn(registry, 'length');
  } catch (error) {
    if (error instanceof ParityError) throw error;
    return bad(`reading the registry threw: ${describeError(error)}`);
  }
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 1_000_000) {
    return bad('the registry length is not readable or is over 1,000,000 entries');
  }
  const out: Entry[] = [];
  const ids = new Set<string>();
  try {
    for (let i = 0; i < length; i += 1) {
      const desc = Reflect.getOwnPropertyDescriptor(registry as object, i);
      if (desc === undefined) return bad(`registry[${i}] is an empty slot`);
      const item: unknown = descriptorValue(registry as object, desc);
      if (!isPlainObject(item) || Array.isArray(item)) return bad(`registry[${i}] must be a plain object`);
      const id = readOwn(item, 'id');
      const value = readOwn(item, 'value');
      const formsRaw = readOwn(item, 'forms');
      if (typeof id !== 'string' || id === '') return bad(`registry[${i}].id must be a non-empty string`);
      if (ids.has(id)) return bad(`registry has two entries with id "${id}"`);
      ids.add(id);
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return bad(`registry "${id}": a numeric value must be finite`);
      } else if (typeof value !== 'string' || value === '') {
        return bad(`registry "${id}": value must be a finite number or a non-empty string`);
      }
      const forms: string[] = [];
      if (formsRaw !== undefined) {
        if (!Array.isArray(formsRaw)) return bad(`registry "${id}": forms must be an array of non-empty strings`);
        const count = readOwn(formsRaw, 'length');
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 10_000) {
          return bad(`registry "${id}": forms is too long or unreadable`);
        }
        for (let f = 0; f < count; f += 1) {
          const form = readOwn(formsRaw, String(f));
          if (typeof form !== 'string' || form === '') return bad(`registry "${id}": forms[${f}] must be a non-empty string`);
          forms.push(form);
        }
      }
      out.push({ id, value: value, forms });
    }
  } catch (error) {
    if (error instanceof ParityError) throw error;
    return bad(`reading the registry threw: ${describeError(error)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The public function
// ---------------------------------------------------------------------------

interface RawHit {
  entry: number;
  start: number;
  end: number;
  kind: 'number' | 'form';
}

/**
 * Find places where a registered constant is typed by hand into text or
 * code, so the caller can import the value instead.
 *
 * - A numeric `value` is found by numeric value at token boundaries: `1.25`
 *   is found in `rate 1.25 per point` and `1.250`, and not in `11.256`,
 *   `21.25`, `1.25.3` or `v1.25`.
 * - A string `value` and every entry in `forms` is found as exact text, with
 *   a boundary check on its first and last character.
 * - If a numeric hit and a literal hit for the same constant overlap, the
 *   longer one is kept.
 *
 * Time is linear in the length of the text for a fixed registry. Throws
 * `ParityError` when `text` is not a string or the registry is malformed.
 * Results are ordered by position, then by registry order.
 */
export function findHandTypedConstants(text: string, registry: readonly RegisteredConstant[]): HandTypedMatch[] {
  if (typeof text !== 'string') {
    throw new ParityError('bad-input', 'findHandTypedConstants: text must be a string');
  }
  const entries = readRegistry(registry);
  const hits: RawHit[] = [];

  const byNumber = new Map<number, number[]>();
  const patterns: Pattern[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry.value === 'number') {
      const list = byNumber.get(entry.value);
      if (list === undefined) byNumber.set(entry.value, [index]);
      else list.push(index);
    } else {
      patterns.push({ entry: index, form: entry.value });
    }
    for (const form of entry.forms) patterns.push({ entry: index, form });
  });

  if (byNumber.size > 0) {
    for (const token of numberTokens(text)) {
      const list = byNumber.get(token.value);
      if (list === undefined) continue;
      for (const entry of list) hits.push({ entry, start: token.start, end: token.end, kind: 'number' });
    }
  }
  if (patterns.length > 0) {
    new Automaton(patterns).scan(text, (p, end) => {
      const pattern = patterns[p] as Pattern;
      const start = end - pattern.form.length;
      if (literalBoundariesOk(text, start, end)) hits.push({ entry: pattern.entry, start, end, kind: 'form' });
    });
  }

  // Per constant, drop exact repeats and keep the longer of two overlapping hits.
  const perEntry = new Map<number, RawHit[]>();
  for (const hit of hits) {
    const list = perEntry.get(hit.entry);
    if (list === undefined) perEntry.set(hit.entry, [hit]);
    else list.push(hit);
  }
  const kept: RawHit[] = [];
  for (const list of perEntry.values()) {
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    const result: RawHit[] = [];
    for (const hit of list) {
      const last = result[result.length - 1];
      if (last !== undefined && hit.start < last.end) {
        if (hit.end - hit.start > last.end - last.start) result[result.length - 1] = hit;
        continue;
      }
      result.push(hit);
    }
    for (const hit of result) kept.push(hit);
  }
  kept.sort((a, b) => a.start - b.start || a.entry - b.entry);

  // Line and column in one pass over the text.
  const out: HandTypedMatch[] = [];
  let line = 1;
  let lineStart = 0;
  let cursor = 0;
  for (const hit of kept) {
    while (cursor < hit.start) {
      const c = text.charCodeAt(cursor);
      if (c === 10 || (c === 13 && text.charCodeAt(cursor + 1) !== 10)) {
        line += 1;
        lineStart = cursor + 1;
      }
      cursor += 1;
    }
    const entry = entries[hit.entry] as Entry;
    out.push({
      id: entry.id,
      value: entry.value,
      text: text.slice(hit.start, hit.end),
      index: hit.start,
      line,
      column: hit.start - lineStart + 1,
      kind: hit.kind,
    });
  }
  return out;
}
