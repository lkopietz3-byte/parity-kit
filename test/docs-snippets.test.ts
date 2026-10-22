import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type * as Src from '../src/index.js'
import type { HandTypedMatch, MirrorResult, StampAudit } from '../src/index.js'
import { findCases, runCode } from '../bench/lib/doc-blocks.mjs'

vi.setConfig({ testTimeout: 120_000 })

// The examples run against the source. `PARITY_KIT_TARGET=dist npx vitest run test/docs-snippets.test.ts`
// runs them against the built package in dist/ instead.
const target = process.env['PARITY_KIT_TARGET'] === 'dist' ? '../dist/index.js' : '../src/index.js'
const api = (await import(target)) as typeof Src

// Every code block in README.md is run here, so a copied example cannot rot.
// Each ```ts block is type-checked in a strict project against the real
// source and executed with small stand-ins for `process`, `console` and
// `node:fs`. A block that is added to the README must be added to SNIPPETS,
// so nobody can skip the check.

const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8')
const blocks = [...readme.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1] ?? '', code: m[2] ?? '' }))
const tsBlocks = blocks.filter((b) => b.lang === 'ts')

interface Io {
  errors: unknown[]
  exits: number[]
}
interface Run {
  out: Record<string, unknown>
  io: Io
  /** What the block threw, if anything. A block that reads a file nobody provided throws on purpose. */
  thrown: unknown
}
interface Snippet {
  /** The first characters of the block, to catch blocks that moved or changed. */
  starts: string
  /** Exports the test reads back. */
  suffix: string
  /** What the block should do. `run(files)` runs it again with other files for `node:fs`. */
  check: (ctx: { first: Run; run: (files?: Record<string, string>) => Run }) => void
}

const records = (count: number, over: (i: number) => Record<string, unknown> = () => ({})): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    cpp: 1 + i / 100,
    source: `https://example.test/${i}`,
    lastReviewed: '2026-01-01',
    ...over(i),
  }))

const SNIPPETS: Snippet[] = [
  {
    starts: "import { compareMirror, findHandTypedConstants, auditReviewStamps } from 'parity-kit';",
    suffix: 'export { result };',
    check: ({ first }) => {
      const result = first.out['result'] as MirrorResult
      expect(result.ok).toBe(false)
      expect(first.io.exits).toEqual([1])
      expect(first.io.errors).toHaveLength(1)
      // The JSON block that follows prints this same result.
      const shown = blocks.find((b) => b.lang === 'json')
      expect(shown).toBeDefined()
      expect(JSON.parse(shown?.code ?? 'null')).toEqual(JSON.parse(JSON.stringify(result)))
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\nconst programsFile",
    suffix: 'export { result };',
    check: ({ first }) => {
      const result = first.out['result'] as MirrorResult
      expect(result.stampHidesDrift).toEqual([{ id: 'chase-ur', reviewedValue: '2026-06-08', fields: ['baselineCpp'] }])
      // The README says forgetting the copy is reported, and passing whole files is invalid.
      const forgot = api.compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], { reviewedField: 'reviewed' })
      expect(forgot.unknownFields).toEqual(['reviewed'])
      const whole = api.compareMirror({ reviewed: '2026-06-08', programs: [] }, { reviewed: '2026-06-08', programs: [] })
      expect(whole.invalid.length).toBeGreaterThan(0)
    },
  },
  {
    starts: "import { findHandTypedConstants } from 'parity-kit';\n\nconst sourceText",
    suffix: 'export { hits };',
    check: ({ first }) => {
      const hits = first.out['hits'] as HandTypedMatch[]
      // The comment under the call in the README shows exactly this hit.
      expect(hits).toEqual([{ id: 'chase-ur.baselineCpp', value: 1.25, text: '1.25', index: 26, line: 1, column: 27, kind: 'number' }])
    },
  },
  {
    starts: "import { auditReviewStamps } from 'parity-kit';\n\nconst oldSnapshot",
    suffix: 'export { audit };',
    check: ({ first }) => {
      const audit = first.out['audit'] as StampAudit
      expect(audit.status).toBe('flagged')
      expect(audit.stampOnly).toEqual([{ id: 'chase-ur', from: '2026-01-01', to: '2026-06-08' }])
      expect(audit.unknownFields).toEqual([])
    },
  },
  {
    starts: "import type { StampAudit } from 'parity-kit';",
    suffix: 'export { acceptEvidencedBulk };',
    check: ({ first }) => {
      const accept = first.out['acceptEvidencedBulk'] as (a: StampAudit) => boolean
      const options = { reviewedField: 'lastReviewed', sourceFields: ['source'] }
      const before = records(12)
      const evidenced = api.auditReviewStamps(before, records(12, (i) => ({ cpp: 2 + i, lastReviewed: '2026-06-08' })), options)
      expect(evidenced.bulkBump).toHaveLength(1)
      expect(evidenced.status).toBe('flagged')
      expect(accept(evidenced)).toBe(true)
      const stampOnly = api.auditReviewStamps(before, records(12, () => ({ lastReviewed: '2026-06-08' })), options)
      expect(accept(stampOnly)).toBe(false)
      const renamed = api.auditReviewStamps(before, records(12, (i) => ({ id: `q${i}`, cpp: 2 + i, lastReviewed: '2026-06-08' })), options)
      expect(accept(renamed)).toBe(false)
      expect(accept(api.auditReviewStamps(before, before, options))).toBe(true)
    },
  },
  {
    starts: "import { readFileSync } from 'node:fs';",
    suffix: '',
    check: ({ first, run }) => {
      // First run: no files were given, so reading throws and the block cannot pass silently.
      expect(first.io.exits).toEqual([])
      const rows = [{ id: 'a', v: 1, lastReviewed: '2026-06-08' }]
      const same = run({ 'data/programs.json': JSON.stringify(rows), 'extension/lib/valuations.json': JSON.stringify(rows) })
      expect(same.io.exits).toEqual([])
      expect(same.io.errors).toEqual([])
      const drift = run({
        'data/programs.json': JSON.stringify(rows),
        'extension/lib/valuations.json': JSON.stringify([{ id: 'a', v: 2, lastReviewed: '2026-06-08' }]),
      })
      expect(drift.io.exits).toEqual([1])
      expect(drift.io.errors).toHaveLength(1)
      // A bigint in the report (a value type the README supports) must still print: JSON.stringify alone throws on one.
      const printed = (drift.io.errors[0] as unknown[])[0] as string
      expect(JSON.parse(printed)).toMatchObject({ status: 'flagged' })
      const replacerText = /JSON\.stringify\(result, (\(_key, value\) => .*), 2\)\)/.exec(readme)?.[1]
      expect(replacerText).toBeDefined()
      const replacer = vm.runInNewContext(`(${replacerText ?? ''})`) as (key: string, value: unknown) => unknown
      const withBigint = api.compareMirror([{ id: 'a', supply: 10n }], [{ id: 'a', supply: 11n }])
      expect(() => JSON.stringify(withBigint)).toThrow()
      expect(JSON.parse(JSON.stringify(withBigint, replacer, 2))).toMatchObject({ changed: [{ canonical: '10n', mirror: '11n' }] })
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\nconst programs = [",
    suffix: 'export { result };',
    check: ({ first }) => {
      expect((first.out['result'] as MirrorResult).ok).toBe(true)
      // Without the filter the same mirror is flagged, and a lost record is still reported.
      expect(api.compareMirror([{ id: 'chase-ur' }, { id: 'amex-mr' }, { id: 'bilt' }], [{ id: 'chase-ur' }, { id: 'amex-mr' }]).missing).toEqual(['bilt'])
      expect(api.compareMirror([{ id: 'chase-ur' }, { id: 'amex-mr' }], [{ id: 'chase-ur' }]).missing).toEqual(['amex-mr'])
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\nconst tokens = (text: string)",
    suffix: 'export { result };',
    check: ({ first }) => {
      const result = first.out['result'] as MirrorResult
      expect(result.status).toBe('flagged')
      expect(result.compared).toBe(2)
      expect(result.changed).toEqual([{ id: 'greeting', field: 'tokens', change: 'different', canonical: '{name}', mirror: '' }])
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\n// A map of id to one value:",
    suffix: 'export { rates, fromMap, fromList, fromRows };',
    check: ({ first }) => {
      const rates = first.out['rates'] as MirrorResult
      expect(rates.changed).toEqual([{ id: 'chase-ur', field: 'value', change: 'different', canonical: 1.25, mirror: 1 }])
      const fromList = first.out['fromList'] as (list: string[]) => Array<Record<string, unknown>>
      expect(api.compareMirror(fromList(['USD', 'EUR']), fromList(['EUR', 'USD'])).status).toBe('ok')
      expect(api.compareMirror(fromList(['USD', 'EUR']), fromList(['USD'])).missing).toEqual(['EUR'])
      const fromRows = first.out['fromRows'] as (rows: Array<{ provider: string; code: string; rate: number }>) => Array<Record<string, unknown>>
      const rows = [{ provider: 'a|b', code: 'c', rate: 1 }, { provider: 'a', code: 'b|c', rate: 2 }]
      const same = api.compareMirror(fromRows(rows), fromRows(rows.map((r) => ({ ...r }))))
      expect(same.status).toBe('ok')
      expect(same.duplicateKeys).toEqual([])
      expect(api.compareMirror(fromRows(rows), fromRows([{ ...rows[0] as object, rate: 9 } as (typeof rows)[0], rows[1] as (typeof rows)[0]])).changed).toHaveLength(1)
      // The README says the unconverted shapes read wrongly.
      expect(api.compareMirror({ 'chase-ur': 1.25 }, { 'chase-ur': 1.25 }).invalid.map((i) => i.reason)).toEqual(['not-an-object', 'not-an-object'])
      expect(api.compareMirror(['USD'], ['USD']).invalid.map((i) => i.reason)).toEqual(['not-an-object', 'not-an-object'])
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\nconst entities = [",
    suffix: 'export { strict, entities };',
    check: ({ first }) => {
      expect((first.out['strict'] as MirrorResult).ok).toBe(true)
      const entities = first.out['entities'] as Array<Record<string, unknown>>
      const folded = api.compareMirror(entities, entities.map((e) => ({ ...e })))
      expect(folded.status).toBe('unknown')
      expect(folded.suspectKeys).toHaveLength(1)
    },
  },
  {
    starts: "import { compareMirror } from 'parity-kit';\n\nconst hearts = [",
    suffix: 'export { exact, hearts };',
    check: ({ first }) => {
      expect((first.out['exact'] as MirrorResult).ok).toBe(true)
      const hearts = first.out['hearts'] as Array<Record<string, unknown>>
      const folded = api.compareMirror(hearts, hearts.map((h) => ({ ...h })))
      expect(folded.status).toBe('unknown')
      expect(folded.suspectKeys).toHaveLength(1)
    },
  },
  {
    starts: "import type { Key, MirrorResult } from 'parity-kit';",
    suffix: 'export { acceptKnownTwins, acceptTwins };',
    check: ({ first }) => {
      const accept = first.out['acceptKnownTwins'] as (r: MirrorResult) => boolean
      const twins = [{ id: 'Saving …', v: 1 }, { id: 'Saving …', v: 2 }]
      const result = api.compareMirror(twins, twins.map((t) => ({ ...t })))
      expect(result.ok).toBe(false)
      expect(result.suspectKeys).toHaveLength(1)
      expect(result.suspectKeys[0]?.skeleton).toBe('saving ...')
      expect(accept(result)).toBe(true)
      // Any other finding still fails.
      const drift = api.compareMirror(twins, [{ id: 'Saving …', v: 1 }, { id: 'Saving …', v: 3 }])
      expect(accept(drift)).toBe(false)
      const both = [...twins, { id: 'Cafe', v: 1 }, { id: 'CAFE', v: 1 }]
      const other = api.compareMirror(both, both.map((r) => ({ ...r })))
      expect(other.suspectKeys).toHaveLength(2)
      expect(accept(other)).toBe(false)
      expect(accept(api.compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }]))).toBe(true)
      // release-review:P2: the skeleton is clipped display text. Two groups with long keys can report the same
      // skeleton, and approving one must not approve the other.
      const accepts = first.out['acceptTwins'] as (reviewed: Array<Array<string | number>>) => (r: MirrorResult) => boolean
      const long = 'x'.repeat(40)
      const pairs = [`${long}a`, `${long}A`, `${long}b`, `${long}B`].map((id) => ({ id, v: 1 }))
      const longResult = api.compareMirror(pairs, pairs.map((p) => ({ ...p })))
      expect(longResult.suspectKeys).toHaveLength(2)
      expect(longResult.suspectKeys[0]?.skeleton).toBe(longResult.suspectKeys[1]?.skeleton)
      expect(accepts([[`${long}a`, `${long}A`]])(longResult), 'release-review:P2: one reviewed group, two present').toBe(false)
      expect(accepts([[`${long}b`, `${long}B`]])(longResult), 'release-review:P2: the other group reviewed alone').toBe(false)
      expect(accepts([[`${long}A`, `${long}a`], [`${long}B`, `${long}b`]])(longResult), 'release-review:P2: both reviewed, any order').toBe(true)
      // A reviewed group that gains a third look-alike key is a new group and fails again.
      const grown = [...pairs, { id: `${long}\u200ba`, v: 1 }]
      expect(accepts([[`${long}a`, `${long}A`], [`${long}b`, `${long}B`]])(api.compareMirror(grown, grown.map((p) => ({ ...p })))), 'release-review:P2: a group that grew').toBe(false)
      // 1 and "1" are different keys.
      const mixed = [{ id: 1, v: 1 }, { id: '1', v: 1 }]
      expect(accepts([[1, '1']])(api.compareMirror(mixed, mixed.map((p) => ({ ...p }))))).toBe(true)
      expect(accepts([['1', '1']])(api.compareMirror(mixed, mixed.map((p) => ({ ...p }))))).toBe(false)
    },
  },
]

const ENV_DECLARATIONS = `
declare const process: { exit(code?: number): never };
declare const console: { error(...data: unknown[]): void };
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
`

// Every block is run exactly as the README prints it, plus one export line so the test can read results back.
function assemble(snippet: Snippet, code: string): string {
  return `${code}\n${snippet.suffix}\n`
}

function execute(source: string, files: Record<string, string>): Run {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const io: Io = { errors: [], exits: [] }
  const out: Record<string, unknown> = {}
  const fs = {
    readFileSync: (path: string): string => {
      const text = files[path]
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
  }
  const sandbox = {
    exports: out,
    require: (name: string): unknown => {
      if (name === 'parity-kit') return api
      if (name === 'node:fs') return fs
      throw new Error(`unexpected import ${name}`)
    },
    console: { error: (...args: unknown[]) => io.errors.push(args) },
    process: {
      exit: (code: number) => {
        io.exits.push(code)
      },
    },
  }
  let thrown: unknown
  try {
    vm.runInNewContext(js, sandbox)
  } catch (error) {
    // A block that reads a file nobody provided throws; its check decides if that is expected.
    thrown = error
  }
  return { out, io, thrown }
}

describe('README code blocks', () => {
  it('every block is accounted for', () => {
    expect(tsBlocks).toHaveLength(SNIPPETS.length)
    tsBlocks.forEach((block, index) => {
      expect(block.code.trimStart().startsWith((SNIPPETS[index] as Snippet).starts), `ts block ${index + 1}`).toBe(true)
    })
    // The shell blocks are install and project commands. They are listed so a new one has to be looked at.
    const shell = blocks.filter((b) => b.lang === 'sh').map((b) => b.code.trim().split('\n')[0])
    expect(shell).toEqual(['npm i parity-kit', 'cd parity-kit', 'npm ci'])
    expect(blocks.filter((b) => b.lang === 'json')).toHaveLength(1)
    // The quick start is one js block and the text block with what it prints; the test below runs it.
    expect(blocks.filter((b) => !['ts', 'sh', 'json', 'js', 'text'].includes(b.lang))).toEqual([])
    expect(blocks.filter((b) => b.lang === 'js')).toHaveLength(1)
    expect(blocks.filter((b) => b.lang === 'text')).toHaveLength(1)
  })

  it('compiles every ts block in a strict project against the real source', () => {
    const files = new Map<string, string>([['/virtual/env.d.ts', ENV_DECLARATIONS]])
    tsBlocks.forEach((block, index) => {
      files.set(`/virtual/snippet-${index + 1}.ts`, assemble(SNIPPETS[index] as Snippet, block.code))
    })
    const options: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    }
    const host = ts.createCompilerHost(options)
    const read = host.readFile.bind(host)
    const exists = host.fileExists.bind(host)
    const getSource = host.getSourceFile.bind(host)
    host.fileExists = (name) => files.has(name) || exists(name)
    host.readFile = (name) => files.get(name) ?? read(name)
    host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
      const text = files.get(name)
      return text === undefined ? getSource(name, languageVersion, onError, shouldCreate) : ts.createSourceFile(name, text, languageVersion)
    }
    const indexPath = join(import.meta.dirname, '..', 'src', 'index.ts')
    host.resolveModuleNames = (names, containingFile) =>
      names.map((name) =>
        name === 'parity-kit'
          ? { resolvedFileName: indexPath, extension: ts.Extension.Ts }
          : ts.resolveModuleName(name, containingFile, options, host).resolvedModule,
      )
    const program = ts.createProgram([...files.keys()], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file === undefined || d.file.fileName.startsWith('/virtual/'))
    const messages = diagnostics.map((d) => `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
    expect(messages).toEqual([])
  })

  it('run9:first5:F05: every block stands alone: pasted as printed, none hits an undefined name or a missing import', () => {
    tsBlocks.forEach((block, index) => {
      const { thrown } = execute(assemble(SNIPPETS[index] as Snippet, block.code), {})
      const name = thrown === undefined || thrown === null ? '' : String((thrown as { name?: unknown }).name)
      expect(name, `ts block ${index + 1}: ${String((thrown as { message?: unknown } | undefined)?.message)}`).not.toMatch(/^(ReferenceError|SyntaxError|TypeError)$/)
    })
  })

  it('run9:first5:F05: every block that uses a kit function imports it, and no block leans on an earlier one', () => {
    const exported = ['compareMirror', 'findHandTypedConstants', 'auditReviewStamps']
    tsBlocks.forEach((block, index) => {
      for (const name of exported) {
        if (!new RegExp(`\\b${name}\\(`).test(block.code)) continue
        expect(block.code, `ts block ${index + 1} calls ${name}`).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from 'parity-kit'`))
      }
    })
  })

  tsBlocks.forEach((block, index) => {
    const snippet = SNIPPETS[index] as Snippet
    it(`runs ts block ${index + 1}: ${snippet.starts.slice(0, 40)}`, () => {
      const source = assemble(snippet, block.code)
      snippet.check({ first: execute(source, {}), run: (files = {}) => execute(source, files) })
    })
  })
})

describe('README quick start', () => {
  it('prints exactly what the text block under it says', async () => {
    const cases = findCases(readme)
    expect(cases).toHaveLength(1)
    const [quick] = cases
    const printed = await runCode(quick?.code ?? '', { 'parity-kit': api })
    expect(printed.trimEnd()).toBe((quick?.expected ?? '').trimEnd())
  })
})
