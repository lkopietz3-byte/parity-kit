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
}
interface Snippet {
  /** The first characters of the block, to catch blocks that moved or changed. */
  starts: string
  /** Declarations the block assumes (and any imports it does not make itself). */
  prelude: string
  /** Exports the test reads back. */
  suffix: string
  /** What the block should do. `run(files)` runs it again with other files for `node:fs`. */
  check: (ctx: { first: Run; run: (files?: Record<string, string>) => Run }) => void
}

const IMPORT_MIRROR = "import { compareMirror } from 'parity-kit';\n"

const programsFile = `const programsFile = { reviewed: '2026-06-08', programs: [
  { id: 'chase-ur', name: 'Chase Ultimate Rewards', baselineCpp: 1.25 },
  { id: 'amex-mr', name: 'Amex Membership Rewards', baselineCpp: 1.2 },
] };
const extensionFile = { reviewed: '2026-06-08', programs: [
  { id: 'chase-ur', name: 'Chase Ultimate Rewards', baselineCpp: 1.0 },
  { id: 'amex-mr', name: 'Amex Membership Rewards', baselineCpp: 1.2 },
] };
`

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
    prelude: '',
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
    starts: 'const stamp = (file:',
    prelude: IMPORT_MIRROR + programsFile,
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
    starts: "const hits = findHandTypedConstants(",
    prelude: "import { findHandTypedConstants } from 'parity-kit';\nconst sourceText = 'export const chaseUrCpp = 1.25;\\n';\n",
    suffix: 'export { hits };',
    check: ({ first }) => {
      const hits = first.out['hits'] as HandTypedMatch[]
      expect(hits[0]).toMatchObject({ id: 'chase-ur.baselineCpp', text: '1.25', line: 1, column: 27, kind: 'number' })
    },
  },
  {
    starts: 'const audit = auditReviewStamps(',
    prelude:
      "import { auditReviewStamps } from 'parity-kit';\n" +
      "const oldSnapshot = [{ id: 'chase-ur', baselineCpp: 1.25, source: 'https://example.test/a', lastReviewed: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z' }];\n" +
      "const newSnapshot = [{ id: 'chase-ur', baselineCpp: 1.25, source: 'https://example.test/a', lastReviewed: '2026-06-08', updatedAt: '2026-06-08T00:00:00Z' }];\n",
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
    prelude: '',
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
    prelude: '',
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
    },
  },
  {
    starts: "const shipped = new Set(",
    prelude:
      IMPORT_MIRROR +
      "const programs = [{ id: 'chase-ur', v: 1 }, { id: 'amex-mr', v: 2 }, { id: 'bilt', v: 3 }];\n" +
      "const extension = [{ id: 'chase-ur', v: 1 }, { id: 'amex-mr', v: 2 }];\n",
    suffix: 'export { result };',
    check: ({ first }) => {
      expect((first.out['result'] as MirrorResult).ok).toBe(true)
      // Without the filter the same mirror is flagged, and a lost record is still reported.
      expect(api.compareMirror([{ id: 'chase-ur' }, { id: 'amex-mr' }, { id: 'bilt' }], [{ id: 'chase-ur' }, { id: 'amex-mr' }]).missing).toEqual(['bilt'])
      expect(api.compareMirror([{ id: 'chase-ur' }, { id: 'amex-mr' }], [{ id: 'chase-ur' }]).missing).toEqual(['amex-mr'])
    },
  },
  {
    starts: "const tokens = (text: string)",
    prelude: IMPORT_MIRROR,
    suffix: 'export { result };',
    check: ({ first }) => {
      const result = first.out['result'] as MirrorResult
      expect(result.status).toBe('flagged')
      expect(result.compared).toBe(2)
      expect(result.changed).toEqual([{ id: 'greeting', field: 'tokens', change: 'different', canonical: '{name}', mirror: '' }])
    },
  },
  {
    starts: "const entities = [",
    prelude: IMPORT_MIRROR,
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
    starts: "import type { MirrorResult } from 'parity-kit';",
    prelude: '',
    suffix: 'export { acceptKnownTwins, knownTwins };',
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

function assemble(snippet: Snippet, code: string): string {
  return `${snippet.prelude}${code}\n${snippet.suffix}\n`
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
  try {
    vm.runInNewContext(js, sandbox)
  } catch {
    // A block that reads a file nobody provided throws; its check decides if that is expected.
  }
  return { out, io }
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
