import { clip } from './text.js';
import type { InvalidReason, Key, SuspectKeyGroup } from './types.js';

/**
 * Characters that are invisible or purely cosmetic in a key: zero-width and
 * bidi controls, soft hyphen, word joiner, BOM, variation selectors, the
 * Mongolian free variation selectors, C0 and C1 control characters (NUL
 * included; tab, line breaks and NEL count as whitespace instead), the tag
 * block (U+E0000 to U+E007F), the object replacement and interlinear
 * annotation characters, and the musical formatting characters. Removed when
 * comparing look-alikes.
 */
function isIgnorable(cp: number): boolean {
  return (
    (cp >= 0x00 && cp <= 0x08) ||
    (cp >= 0x0e && cp <= 0x1f) ||
    cp === 0x7f ||
    (cp >= 0x80 && cp <= 0x9f && cp !== 0x85) ||
    cp === 0x00ad ||
    cp === 0x034f ||
    cp === 0x061c ||
    cp === 0x115f ||
    cp === 0x1160 ||
    (cp >= 0x17b4 && cp <= 0x17b5) ||
    (cp >= 0x180b && cp <= 0x180f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0x3164 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    cp === 0xffa0 ||
    (cp >= 0xfff9 && cp <= 0xfffc) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  );
}

function isWhitespace(cp: number): boolean {
  return (
    (cp >= 0x09 && cp <= 0x0d) ||
    cp === 0x20 ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  );
}

function isDash(cp: number): boolean {
  return (cp >= 0x2010 && cp <= 0x2015) || cp === 0x2212 || cp === 0xfe58 || cp === 0xfe63 || cp === 0xff0d;
}

/**
 * A small set of Cyrillic and Greek lowercase letters that are drawn almost
 * exactly like a Latin letter. Applied after lowercasing. This is a short
 * list on purpose; it is not the full Unicode confusables table.
 */
const CONFUSABLES: ReadonlyMap<number, string> = new Map<number, string>([
  [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'],
  [0x0443, 'y'], [0x0445, 'x'], [0x0455, 's'], [0x0456, 'i'], [0x0458, 'j'],
  [0x04bb, 'h'], [0x043a, 'k'], [0x03bf, 'o'], [0x03bd, 'v'], [0x03b9, 'i'],
  [0x03c1, 'p'], [0x0501, 'd'], [0x051b, 'q'], [0x051d, 'w'],
]);

/**
 * The form a key takes when everything a person cannot see or cannot tell
 * apart is folded away: compatibility normalization (NFKC, so NFD and NFC
 * agree, as do full-width letters and ligatures), invisible characters
 * removed, runs of whitespace (including no-break spaces) turned into one
 * space and trimmed at both ends, dash variants turned into "-", case folded
 * (unless foldCase is false), and a short list of look-alike letters mapped.
 * Linear in the length of the key.
 */
export function keySkeleton(key: Key, foldCase: boolean): string {
  let text = String(key);
  text = text.normalize('NFKC');
  if (foldCase) text = text.toLowerCase();
  const parts: string[] = [];
  let pendingSpace = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (isIgnorable(cp)) continue;
    if (isWhitespace(cp)) {
      pendingSpace = parts.length > 0;
      continue;
    }
    if (pendingSpace) {
      parts.push(' ');
      pendingSpace = false;
    }
    parts.push(isDash(cp) ? '-' : (CONFUSABLES.get(cp) ?? ch));
  }
  return parts.join('');
}

/**
 * Group the keys of several datasets by skeleton and return every group that
 * holds more than one distinct raw key. `1` and `"1"` are distinct raw keys.
 * Keys are listed in order of first appearance and are never merged.
 */
export function findSuspectKeys(
  datasets: ReadonlyArray<{ side: string; keys: Iterable<Key> }>,
  foldCase: boolean,
): SuspectKeyGroup[] {
  interface Group {
    skeleton: string;
    seen: Map<Key, Set<string>>;
    keys: Array<{ side: string; key: Key }>;
  }
  const groups = new Map<string, Group>();
  const cache = new Map<Key, string>();
  for (const { side, keys } of datasets) {
    for (const key of keys) {
      let skeleton = cache.get(key);
      if (skeleton === undefined) {
        skeleton = keySkeleton(key, foldCase);
        cache.set(key, skeleton);
      }
      let group = groups.get(skeleton);
      if (group === undefined) {
        group = { skeleton, seen: new Map(), keys: [] };
        groups.set(skeleton, group);
      }
      let sides = group.seen.get(key);
      if (sides === undefined) {
        sides = new Set();
        group.seen.set(key, sides);
      }
      if (!sides.has(side)) {
        sides.add(side);
        group.keys.push({ side, key });
      }
    }
  }
  const out: SuspectKeyGroup[] = [];
  for (const group of groups.values()) {
    // Grouping used the whole skeleton; the report carries a clipped copy so it never grows past the input.
    if (group.seen.size > 1) out.push({ skeleton: clip(group.skeleton, SKELETON_ECHO), keys: group.keys });
  }
  return out;
}

/** Longest run of combining marks a key may carry. Canonical reordering is quadratic in such a run. */
export const MAX_COMBINING_RUN = 32;

const COMBINING = /^\p{M}$/u;

/** What looking at one string key found, and what that cost in work units. */
export interface KeyAnalysis {
  problem: InvalidReason | undefined;
  /**
   * Work units for normalizing the key: one per UTF-16 unit, or one per code
   * point of its compatibility decomposition when that is more (U+FDFA is one
   * unit and eighteen code points). Charged to the node budget when the key is
   * accepted, so the budget bounds the CPU a key costs and not just its length.
   * For a refused key it is the work done up to the refusal, and is not charged.
   */
  cost: number;
}

/**
 * Can this string key be analyzed for look-alikes within a bound? A key longer
 * than `maxLength` UTF-16 units is `key-too-long`; a key with a run of more than
 * 32 combining marks is `key-unnormalizable` (Unicode normalization sorts such
 * a run, which takes quadratic time). The run is counted on the compatibility
 * decomposition of each character, because a character such as U+FF9E becomes a
 * combining mark under NFKC. Checked before any normalization, in one linear
 * pass (a decomposition is at most 18 code points). Also counts the expanded
 * size of the key (see `KeyAnalysis.cost`), up to the point a problem was found.
 */
export function analyzeKey(key: string, maxLength: number): KeyAnalysis {
  if (key.length > maxLength) return { problem: 'key-too-long', cost: 0 };
  let run = 0;
  let cost = 0;
  for (const ch of key) {
    if ((ch.codePointAt(0) as number) < 0x80) {
      run = 0;
      cost += 1;
      continue;
    }
    let parts = 0;
    for (const part of ch.normalize('NFKD')) {
      parts += 1;
      if (COMBINING.test(part)) {
        run += 1;
        if (run > MAX_COMBINING_RUN) return { problem: 'key-unnormalizable', cost: cost + parts };
      } else {
        run = 0;
      }
    }
    cost += Math.max(ch.length, parts);
  }
  return { problem: undefined, cost };
}

/** Longest skeleton echoed in `suspectKeys`; a longer one is clipped the way detail text is. */
const SKELETON_ECHO = 40;
