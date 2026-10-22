import { ParityError, isOwnError } from './errors.js';
import { describeError } from './snapshot.js';
import { descriptorValue, isPlainObject, readOwn, refuseExtraArguments } from './options.js';

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
/** Letters, combining marks, digits and underscore: a mark glues like the letter it sits on, so NFC and NFD spellings agree. */
const WORD = /^[\p{L}\p{M}\p{N}_]$/u;

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

const DECIMAL_DIGIT = /^\p{Nd}$/u;
/** Scripts written without spaces between words, so a letter of one next to a number or a word is not "glued" to it. */
const UNSPACED = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]$/u;

/**
 * Do two touching characters read as one word? Both must be letters, digits or
 * underscore, and neither may be a letter of an unspaced script (Han,
 * Hiragana, Katakana, Hangul, Thai, Lao, Khmer, Myanmar), because those texts
 * put a number right next to the words around it. A decimal digit of any
 * script always glues: it makes a longer number.
 */
function gluesTo(ch: string, other: string): boolean {
  if (!isWord(ch) || !isWord(other)) return false;
  return !(isUnspacedLetter(ch) || isUnspacedLetter(other));
}

function isUnspacedLetter(ch: string): boolean {
  return UNSPACED.test(ch) && !DECIMAL_DIGIT.test(ch);
}

// ---------------------------------------------------------------------------
// Numeric tokens
// ---------------------------------------------------------------------------

interface NumberToken {
  start: number;
  end: number;
  value: number;
}

/** A run the number lexer found, whether or not it counts as a typed number. */
interface LexedRun {
  /** Index of the first digit (or of the "." of a leading-dot number). */
  start: number;
  end: number;
  /** False for a zero-padded run, a dotted run, or one glued to letters, "_" or other digits. */
  valid: boolean;
  /** A letter, digit or underscore touches the start. */
  leftGlued: boolean;
  /** An underscore or a non-ASCII decimal digit touches the end. */
  rightGlued: boolean;
}

/** Characters before a "-" that make it a binary operator or a separator rather than a sign. */
function minusIsSign(text: string, signIndex: number): boolean {
  const before = charBefore(text, signIndex);
  if (before === '') return true;
  return !(isWord(before) || before === ')' || before === ']' || before === '}' || before === '.' || before === "'" || before === '"');
}

/** Characters that may follow a `%` in a printf conversion before the precision: the flags. */
const isPrintfFlag = (c: number): boolean => c === 43 || c === 45 || c === 32 || c === 35;

/**
 * Is a ".5" that starts at `dot` (and ends at `end`) not a number typed on its
 * own? Four shapes read the same but are not a literal: a printf precision
 * (`%.1f`, `%+.2f`, `% .3f`), a format-spec precision after a colon or comma
 * and before the closing brace (`{:.2f}`, `{score:.1f}`, `{:,.2f}`, `{:.1}`), a
 * regular-expression escape (`1\.1`), and a dot after a closing bracket
 * (`${version}.1`, `f(x).5`). Looks back over at most five flag characters, so it
 * costs a constant per number.
 */
function notALeadingDotNumber(text: string, dot: number, before: string, end: number): boolean {
  if (before === '%' || before === ')' || before === ']' || before === '}' || before === '\\') return true;
  if (before === ':' || before === ',') {
    let close = end;
    const c = text.charCodeAt(close);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 37) close += 1;
    return text.charCodeAt(close) === 125;
  }
  if (isPrintfFlag(dot === 0 ? 0 : text.charCodeAt(dot - 1))) {
    let k = dot - 1;
    for (let steps = 0; steps < 5 && k >= 0 && isPrintfFlag(text.charCodeAt(k)); steps += 1) k -= 1;
    return k >= 0 && text.charCodeAt(k) === 37;
  }
  return false;
}

/** Does this digit run have a nonzero digit in its mantissa? (`1e-999` does, and still reads as 0.) */
function mantissaIsNonzero(text: string, start: number, end: number): boolean {
  for (let k = start; k < end; k += 1) {
    const c = text.charCodeAt(k);
    if (c === 101 || c === 69) return false;
    if (c >= 49 && c <= 57) return true;
  }
  return false;
}

/**
 * Does a Rust numeric type name start at `at`, as a whole word? Rust spells a literal's type after an
 * underscore (`1.25_f64`, `1_000_000_u64`, `8_usize`), so that underscore ends the number instead of gluing
 * it to an identifier. Only the fourteen built-in numeric types count, so `1.25_x`, `1.25_f64x` and `8_u` stay
 * glued. A constant number of comparisons, never a scan.
 */
function isNumericTypeSuffix(text: string, at: number): boolean {
  const first = text.charCodeAt(at);
  let end = at + 1;
  if (first === 102) {
    // f32, f64
    if (!(text.startsWith('32', end) || text.startsWith('64', end))) return false;
    end += 2;
  } else if (first === 105 || first === 117) {
    // i or u: 8, 16, 32, 64, 128 or size
    if (text.startsWith('size', end)) end += 4;
    else if (text.startsWith('128', end)) end += 3;
    else if (text.startsWith('16', end) || text.startsWith('32', end) || text.startsWith('64', end)) end += 2;
    else if (text.charCodeAt(end) === 56) end += 1;
    else return false;
  } else {
    return false;
  }
  return !gluesTo(charAt(text, end), '0');
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
function* lexNumbers(text: string): Generator<LexedRun> {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    // ".5" is a number, but not after another dot: in "1..5" or "wait...5" the dots are a range or an ellipsis and the 5 is a whole number.
    const startsDot = c === 46 && i + 1 < n && isDigitCode(text.charCodeAt(i + 1)) && !(i > 0 && text.charCodeAt(i - 1) === 46);
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
      // Groups of exactly three digits after "," or "_" (1,250 and 1_250); the separator must not change within a number.
      // A comma group also needs a leading group of one to three digits that does not start with 0:
      // "2024,100" and "[1000,250]" hold two numbers each.
      const separator = text.charCodeAt(j);
      const groupable = separator === 95 || (j - start <= 3 && text.charCodeAt(start) !== 48);
      // "0,500" is the decimal-comma spelling of 0.5, not a 0 and a 500: skip the run whole.
      if (
        separator === 44 &&
        j - start === 1 &&
        text.charCodeAt(start) === 48 &&
        j + 3 < n &&
        isDigitCode(text.charCodeAt(j + 1)) &&
        isDigitCode(text.charCodeAt(j + 2)) &&
        isDigitCode(text.charCodeAt(j + 3)) &&
        !(j + 4 < n && isDigitCode(text.charCodeAt(j + 4)))
      ) {
        valid = false;
        j += 4;
      }
      while (
        j + 3 < n &&
        groupable &&
        (separator === 44 || separator === 95) &&
        text.charCodeAt(j) === separator &&
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
    const leftGlued =
      (before !== '' && gluesTo(before, '0')) || (startsDot && notALeadingDotNumber(text, start, before, j));
    const after = j < n ? charAt(text, j) : '';
    // "_" glues the number to an identifier, unless what follows is a Rust type suffix (1.25_f64, 8_usize); a
    // non-ASCII digit makes it part of a longer number.
    const rightGlued = (after === '_' && !isNumericTypeSuffix(text, j + 1)) || (after !== '' && DECIMAL_DIGIT.test(after));
    yield { start, end: j, valid: valid && !leftGlued && !rightGlued, leftGlued, rightGlued };
    i = j > i ? j : i + 1;
  }
}

/** The numbers a text spells, with their sign and value. */
function* numberTokens(text: string): Generator<NumberToken> {
  for (const run of lexNumbers(text)) {
    if (!run.valid) continue;
    let tokenStart = run.start;
    let negative = false;
    const before = charBefore(text, run.start);
    if ((before === '-' || before === '\u2212') && minusIsSign(text, run.start - 1)) {
      negative = true;
      tokenStart = run.start - 1;
    }
    const value = Number(text.slice(run.start, run.end).replace(/[,_]/g, ''));
    // A number that underflowed to zero (1e-999) is not the number zero.
    if (value === 0 && mantissaIsNonzero(text, run.start, run.end)) continue;
    if (Number.isFinite(value)) yield { start: tokenStart, end: run.end, value: negative ? -value : value };
  }
}

const RUN_START = 1;
const RUN_END = 2;
const RUN_LEFT_GLUED = 4;
const RUN_RIGHT_GLUED = 8;
const RUN_INSIDE = 16;

/** One byte per text position marking where the number lexer's runs start, end, and what lies strictly inside them. */
function runFlags(text: string): Uint8Array {
  const flags = new Uint8Array(text.length + 1);
  for (const run of lexNumbers(text)) {
    flags[run.start] = (flags[run.start] as number) | RUN_START | (run.leftGlued ? RUN_LEFT_GLUED : 0);
    flags[run.end] = (flags[run.end] as number) | RUN_END | (run.rightGlued ? RUN_RIGHT_GLUED : 0);
    for (let k = run.start + 1; k < run.end; k += 1) flags[k] = (flags[k] as number) | RUN_INSIDE;
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Literal forms: Aho-Corasick, linear in the text
// ---------------------------------------------------------------------------

interface Pattern {
  /** Every constant (by registry index) that lists this exact text. */
  entries: number[];
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

/** Does a literal form begin with a digit, or with "." followed by a digit? */
function startsWithNumber(form: string): boolean {
  const c = form.charCodeAt(0);
  return isDigitCode(c) || (c === 46 && isDigitCode(form.charCodeAt(1)));
}

/**
 * Is a literal match at [start, end) a whole token? A match must not begin or
 * end strictly inside a number the lexer found, so `250` is not in `1,250`,
 * `8` and `1e` are not in `1e+8`, and `1.25` is in `1.25,0.5`. A form that
 * starts (or ends) with a digit must also sit exactly at the start (or end) of
 * a run that no letter, digit or underscore is glued to, so forms and values
 * share one boundary rule. Any other first or last character only has to not
 * touch another letter, digit or underscore.
 */
function literalBoundariesOk(text: string, start: number, end: number, flags: Uint8Array): boolean {
  if (((flags[start] as number) & RUN_INSIDE) !== 0 || ((flags[end] as number) & RUN_INSIDE) !== 0) return false;
  const first = charAt(text, start);
  if (startsWithNumber(first + charAt(text, start + first.length))) {
    const f = flags[start] as number;
    if ((f & RUN_START) === 0 || (f & RUN_LEFT_GLUED) !== 0) return false;
  } else if (gluesTo(first, charBefore(text, start))) {
    return false;
  }
  const last = charBefore(text, end);
  if (isDigitCode(last.charCodeAt(0))) {
    const f = flags[end] as number;
    if ((f & RUN_END) === 0 || (f & RUN_RIGHT_GLUED) !== 0) return false;
  } else if (gluesTo(last, charAt(text, end))) {
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

/** A key name kept short enough to put in a message. */
function shortName(name: string): string {
  return name.length <= 40 ? name : `${name.slice(0, 40)}...`;
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
    if (isOwnError(error) && error instanceof ParityError) throw error;
    return bad(`reading the registry threw: ${describeError(error)}`);
  }
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 1_000_000) {
    return bad('the registry length is not readable or is over 1,000,000 entries');
  }
  if (length === 0) {
    return bad('the registry is empty; an empty registry checks nothing, so it is refused (a registry file that failed to load would otherwise pass)');
  }
  const out: Entry[] = [];
  const ids = new Set<string>();
  try {
    for (let i = 0; i < length; i += 1) {
      const desc = Reflect.getOwnPropertyDescriptor(registry as object, i);
      if (desc === undefined) return bad(`registry[${i}] is an empty slot`);
      const item: unknown = descriptorValue(registry as object, desc);
      if (!isPlainObject(item) || Array.isArray(item)) return bad(`registry[${i}] must be a plain object`);
      // One descriptor read per own property, all of them before any getter
      // runs, so the order a Proxy lists its keys in cannot change what a
      // getter sees. Any other enumerable string key is a refusal (a
      // misspelled `forms` must never silently drop the forms), and it is
      // refused before user code runs. The getters then run in a fixed order:
      // id, value, forms.
      let idDesc: PropertyDescriptor | undefined;
      let valueDesc: PropertyDescriptor | undefined;
      let formsDesc: PropertyDescriptor | undefined;
      for (const name of Reflect.ownKeys(item)) {
        if (typeof name !== 'string') continue;
        const desc = Reflect.getOwnPropertyDescriptor(item, name);
        if (desc === undefined) continue;
        if (name === 'id') idDesc = desc;
        else if (name === 'value') valueDesc = desc;
        else if (name === 'forms') formsDesc = desc;
        else if (desc.enumerable === true) {
          return bad(`registry[${i}] has an unknown key ${JSON.stringify(shortName(name))}; an entry has only id, value and forms`);
        }
      }
      const id: unknown = idDesc === undefined ? undefined : descriptorValue(item, idDesc);
      const value: unknown = valueDesc === undefined ? undefined : descriptorValue(item, valueDesc);
      const formsRaw: unknown = formsDesc === undefined ? undefined : descriptorValue(item, formsDesc);
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
    if (isOwnError(error) && error instanceof ParityError) throw error;
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
 *   longer one is kept (the number wins a tie). Literal hits never suppress
 *   each other.
 *
 * Time is linear in the length of the text for a fixed registry. Throws
 * `ParityError` when `text` is not a string or the registry is malformed.
 * Results are ordered by position, then by registry order.
 */
export function findHandTypedConstants(text: string, registry: readonly RegisteredConstant[]): HandTypedMatch[] {
  // The count of arguments given is the point, so this reads `arguments` rather than a rest parameter.
  refuseExtraArguments(arguments.length, 2, 'findHandTypedConstants');
  if (typeof text !== 'string') {
    throw new ParityError('bad-input', 'findHandTypedConstants: text must be a string');
  }
  const entries = readRegistry(registry);

  const byNumber = new Map<number, number[]>();
  // Each distinct text is one pattern, however many times or under however
  // many constants it is listed, so repeated forms cannot multiply the work.
  const byForm = new Map<string, number[]>();
  const addForm = (form: string, entry: number): void => {
    const list = byForm.get(form);
    if (list === undefined) byForm.set(form, [entry]);
    else if (list[list.length - 1] !== entry) list.push(entry);
  };
  entries.forEach((entry, index) => {
    if (typeof entry.value === 'number') {
      const list = byNumber.get(entry.value);
      if (list === undefined) byNumber.set(entry.value, [index]);
      else list.push(index);
    } else {
      addForm(entry.value, index);
    }
    for (const form of entry.forms) addForm(form, index);
  });
  const patterns: Pattern[] = [];
  for (const [form, owners] of byForm) patterns.push({ entries: [...new Set(owners)], form });

  const numberHits = new Map<number, RawHit[]>();
  const literalHits = new Map<number, RawHit[]>();
  const push = (into: Map<number, RawHit[]>, hit: RawHit): void => {
    const list = into.get(hit.entry);
    if (list === undefined) into.set(hit.entry, [hit]);
    else list.push(hit);
  };

  if (byNumber.size > 0) {
    for (const token of numberTokens(text)) {
      const list = byNumber.get(token.value);
      if (list === undefined) continue;
      for (const entry of list) push(numberHits, { entry, start: token.start, end: token.end, kind: 'number' });
    }
  }
  if (patterns.length > 0) {
    const flags = runFlags(text);
    new Automaton(patterns).scan(text, (p, end) => {
      const pattern = patterns[p] as Pattern;
      const start = end - pattern.form.length;
      if (!literalBoundariesOk(text, start, end, flags)) return;
      for (const entry of pattern.entries) push(literalHits, { entry, start, end, kind: 'form' });
    });
  }

  // Overlaps are only resolved between a number hit and a literal hit of the
  // same constant: the longer one is kept, and the number wins a tie. Literal
  // hits never suppress each other, and each text is one pattern, so there
  // are no repeats to remove.
  const kept: RawHit[] = [];
  for (const [entry, literals] of literalHits) {
    const numbers = numberHits.get(entry);
    if (numbers === undefined) {
      for (const hit of literals) kept.push(hit);
      continue;
    }
    const droppedLiterals = new Set<RawHit>();
    const droppedNumbers = new Set<RawHit>();
    for (const literal of literals) {
      // First number hit that ends after this literal starts (number hits are disjoint and sorted).
      let lo = 0;
      let hi = numbers.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((numbers[mid] as RawHit).end > literal.start) hi = mid;
        else lo = mid + 1;
      }
      for (let k = lo; k < numbers.length && (numbers[k] as RawHit).start < literal.end; k += 1) {
        const number = numbers[k] as RawHit;
        if (number.end - number.start >= literal.end - literal.start) droppedLiterals.add(literal);
        else droppedNumbers.add(number);
      }
    }
    for (const hit of literals) if (!droppedLiterals.has(hit)) kept.push(hit);
    for (const hit of numbers) if (!droppedNumbers.has(hit)) kept.push(hit);
  }
  for (const [entry, numbers] of numberHits) {
    if (!literalHits.has(entry)) for (const hit of numbers) kept.push(hit);
  }
  kept.sort((a, b) => a.start - b.start || a.entry - b.entry || b.end - a.end);

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
