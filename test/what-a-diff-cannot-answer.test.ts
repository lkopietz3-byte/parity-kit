import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import microdiff from 'microdiff'
import { findCases, runCode } from '../bench/lib/doc-blocks.mjs'

// Every js block in docs/what-a-diff-cannot-answer.md is run here against the
// source, and what it prints must equal the text block under it. The page is
// rewritten from the code by `node bench/doc-cases.mjs`; this test never
// rewrites it, so an edit to the kit or a dependency that changes a result
// fails here until the page and its explanation are looked at.

const root = join(import.meta.dirname, '..')
// `PARITY_KIT_TARGET=dist` runs the page against the built package instead of the source.
const target = process.env['PARITY_KIT_TARGET'] === 'dist' ? '../dist/index.js' : '../src/index.js'
const kit = (await import(target)) as Record<string, unknown>
const require = createRequire(import.meta.url)
const page = readFileSync(join(root, 'docs', 'what-a-diff-cannot-answer.md'), 'utf8')
const modules = {
  'parity-kit': kit,
  'deep-diff': { default: require('deep-diff') },
  microdiff: { default: microdiff },
}
const cases = findCases(page)

describe('docs/what-a-diff-cannot-answer.md', () => {
  it('has twelve runnable cases', () => {
    expect(cases).toHaveLength(12)
    expect(cases.map((c) => c.title.split('.')[0])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  })

  it.each(cases.map((c) => [c.title, c] as const))('%s', async (_title, c) => {
    const printed = await runCode(c.code, modules)
    expect(printed.trimEnd()).toBe(c.expected.trimEnd())
  })

  it('names the versions it was run with', () => {
    const version = (name: string): string => (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version
    const own = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
    expect(page).toContain(`\`deep-diff\` ${version('deep-diff')}`)
    expect(page).toContain(`\`microdiff\` ${version('microdiff')}`)
    expect(page).toContain(`parity-kit ${own}`)
  })
})
