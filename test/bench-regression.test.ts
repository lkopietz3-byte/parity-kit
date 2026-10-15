import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as kit from '../src/index.js'
import { renderResults } from '../bench/lib/results.mjs'
import { runSuite, summarize, type Report } from '../bench/lib/suite.mjs'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

// The field corpus as a regression test. `bench/` holds labeled data derived
// from real sources (translation files, an advisory database and its OSV copy,
// entity tables, a fresh holdout) and seeded edits of them; `npm run bench`
// scores the kit on all of it. This is the small, fast subset, run against the
// source on every `npm test`, and it must produce exactly the confusion
// matrices pinned in bench/expected.json. Any wrong verdict anywhere moves a
// count and fails here, naming the class.

const bench = join(import.meta.dirname, '..', 'bench')
const expected = JSON.parse(readFileSync(join(bench, 'expected.json'), 'utf8')) as Record<string, { counts: Record<string, Record<string, number>> }>

const sorted = (x: Record<string, Record<string, number>>): string =>
  JSON.stringify(Object.fromEntries(Object.keys(x).sort().map((t) => [t, Object.fromEntries(Object.keys(x[t] ?? {}).sort().map((k) => [k, x[t]?.[k]]))])))

describe('field corpus, quick subset', () => {
  let report: Report
  beforeAll(() => {
    report = runSuite(kit, { quick: true })
  })

  it('scores every class the quick subset is meant to cover', () => {
    expect([...report.matrices.keys()].sort()).toEqual([
      'compareMirror/entities-synthetic/default',
      'compareMirror/entities-synthetic/foldCase-false',
      'compareMirror/i18n-excalidraw',
      'compareMirror/i18n-jitsi',
      'compareMirror/numberTolerance/cents-tol-0.01',
      'compareMirror/numberTolerance/cents-tol-0.01/at-the-boundary',
      'compareMirror/numberTolerance/cents-tol-0.02',
      'compareMirror/numberTolerance/cents-tol-0.02/at-the-boundary',
      'compareMirror/numberTolerance/tenths-tol-0.1',
      'compareMirror/numberTolerance/tenths-tol-0.1/at-the-boundary',
      'compareMirror/pypa-vs-osv/fields',
      'compareMirror/pypa-vs-osv/stampHidesDrift',
      'findHandTypedConstants/advisory-texts',
      'auditReviewStamps/pypa-injected/backward',
      'auditReviewStamps/pypa-injected/bulkBump',
      'auditReviewStamps/pypa-injected/future',
      'auditReviewStamps/pypa-injected/stampOnly',
      'auditReviewStamps/pypa-injected/unreadable-stamp',
      'auditReviewStamps/stamp-edge-cases/backward',
      'auditReviewStamps/stamp-edge-cases/future',
      'auditReviewStamps/stamp-edge-cases/stampOnly',
      'auditReviewStamps/stamp-edge-cases/unreadable-stamp',
      'holdout/compareMirror/http-status',
      'holdout/compareMirror/spdx',
    ].sort())
  })

  it('matches the pinned confusion matrices exactly', () => {
    for (const [id, matrix] of report.matrices) {
      const pinned = expected[id]
      expect(pinned, `${id} is not in bench/expected.json`).toBeDefined()
      expect(sorted(matrix.counts), id).toBe(sorted(pinned?.counts ?? {}))
    }
  })

  it('has no false pass and no false flag in the quick subset', () => {
    for (const matrix of report.matrices.values()) {
      const s = summarize(matrix)
      expect(s.falsePass, `${s.id} false pass (of ${s.positives})`).toBe(0)
      expect(s.falseFlag, `${s.id} false flag (of ${s.negatives})`).toBe(0)
    }
  })

  it('covers a meaningful number of verdicts', () => {
    let items = 0
    for (const matrix of report.matrices.values()) for (const row of Object.values(matrix.counts)) for (const n of Object.values(row)) items += n
    expect(items).toBeGreaterThan(150_000)
  })
})

describe('bench results page', () => {
  it('bench/RESULTS.md is what bench/expected.json renders to', () => {
    expect(readFileSync(join(bench, 'RESULTS.md'), 'utf8')).toBe(renderResults(expected))
  })
})

describe('bench data files', () => {
  const manifest = JSON.parse(readFileSync(join(bench, 'data', 'manifest.json'), 'utf8')) as { files: Record<string, { sha256: string; bytes: number }> }

  it.each(Object.entries(manifest.files))('%s matches the manifest', (path, entry) => {
    const bytes = readFileSync(join(bench, path))
    expect(bytes.length).toBe(entry.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
  })
})
