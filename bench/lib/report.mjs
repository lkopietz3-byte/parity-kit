// Confusion matrices and the numbers derived from them. Nothing here knows about the kit.
//
// A matrix has a truth axis (what the independent label says) and a kit axis
// (what the kit's report says about the same item). Both axes use the same
// words, so a row reads directly:
//
//   truth `match`  : the label says the copies agree (or the stamp was earned).
//   truth <class>  : the label names a problem (missing, extra, drift, stampOnly, ...).
//   kit `match`    : the kit reported nothing about the item.
//   kit `unknown`  : the kit said it could not tell.
//   kit <class>    : the kit reported a problem.
//
// False pass  = truth names a problem and the kit reports `match`.
//               Denominator: every item whose truth names a problem.
// False flag  = truth is `match` and the kit reports a problem.
//               Denominator: every item whose truth is `match`.
// Abstain     = the kit says `unknown`. Counted apart: it is "can't tell",
//               which is neither a pass nor a flag.
// Wrong class = truth names a problem and the kit names a different problem.

export function wilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, round(c - h)), Math.min(1, round(c + h))];
}

function round(x) {
  return Math.round(x * 1e5) / 1e5;
}

export function createReport() {
  const matrices = new Map();
  return {
    matrices,
    /** Get (or start) the matrix with this id. `meta` is kept from the first call. */
    matrix(id, meta = {}) {
      let m = matrices.get(id);
      if (m === undefined) {
        m = { id, ...meta, counts: Object.create(null) };
        matrices.set(id, m);
      }
      return {
        add(truth, kit, n = 1) {
          const row = (m.counts[truth] ??= Object.create(null));
          row[kit] = (row[kit] ?? 0) + n;
        },
      };
    },
    /** Free-form facts that belong to a matrix (statuses, counts of look-alike keys). */
    note(id, key, value) {
      const m = matrices.get(id);
      if (m === undefined) throw new Error(`no matrix ${id}`);
      (m.facts ??= {})[key] = value;
    },
  };
}

export function sum(object) {
  let total = 0;
  for (const v of Object.values(object)) total += v;
  return total;
}

/** Rows and rollup for one matrix. */
export function summarize(m) {
  const rows = [];
  let positives = 0;
  let falsePass = 0;
  let negatives = 0;
  let falseFlag = 0;
  let abstainPositive = 0;
  let abstainNegative = 0;
  let wrongClass = 0;
  for (const truth of Object.keys(m.counts).sort()) {
    const counts = m.counts[truth];
    const n = sum(counts);
    const unknown = counts.unknown ?? 0;
    if (truth === 'match') {
      const flagged = n - (counts.match ?? 0) - unknown;
      negatives += n;
      falseFlag += flagged;
      abstainNegative += unknown;
      rows.push({ truth, n, agree: counts.match ?? 0, falseFlag: flagged, abstain: unknown });
    } else {
      const passed = counts.match ?? 0;
      const right = counts[truth] ?? 0;
      const wrong = n - passed - unknown - right;
      positives += n;
      falsePass += passed;
      abstainPositive += unknown;
      wrongClass += wrong;
      rows.push({ truth, n, agree: right, falsePass: passed, abstain: unknown, wrongClass: wrong });
    }
  }
  return {
    id: m.id,
    check: m.check,
    what: m.what,
    denominators: m.denominators,
    rows,
    positives,
    falsePass,
    falsePassRate: positives === 0 ? null : falsePass / positives,
    falsePassCi95: wilson(falsePass, positives),
    negatives,
    falseFlag,
    falseFlagRate: negatives === 0 ? null : falseFlag / negatives,
    falseFlagCi95: wilson(falseFlag, negatives),
    abstainPositive,
    abstainNegative,
    wrongClass,
    facts: m.facts,
  };
}

const pct = (x) => (x === null ? 'n/a' : `${(100 * x).toFixed(3)}%`);

/** A fixed-width text table of the rollups. */
export function formatTable(summaries) {
  const header = ['class', 'items that should flag', 'false pass', 'items that should pass', 'false flag', 'abstain'];
  const lines = [];
  for (const s of summaries) {
    const fp = `${s.falsePass}/${s.positives} ${pct(s.falsePassRate)}`;
    const ff = `${s.falseFlag}/${s.negatives} ${pct(s.falseFlagRate)}`;
    lines.push([s.id, String(s.positives), fp, String(s.negatives), ff, String(s.abstainPositive + s.abstainNegative)]);
  }
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [fmt(header), fmt(widths.map((w) => '-'.repeat(w))), ...lines.map(fmt)].join('\n');
}
