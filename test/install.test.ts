import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Installing from a checkout runs `prepare`. On a fresh clone there is no
// compiler and no dist/, so the step must say what to run, not die with
// "tsc: command not found".

const root = join(import.meta.dirname, '..')

describe('DR-1: installing from a fresh checkout', () => {
  it('DR-1: the prepare step is the guarded script, not a bare build', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.prepare).toBe('node scripts/prepare.mjs')
  })

  it('DR-1: with no compiler installed the script stops with the exact commands, not "command not found"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-kit-dr1-'))
    try {
      mkdirSync(join(dir, 'scripts'))
      copyFileSync(join(root, 'scripts', 'prepare.mjs'), join(dir, 'scripts', 'prepare.mjs'))
      writeFileSync(join(dir, 'package.json'), '{"name":"fresh-clone","version":"0.0.0","type":"module"}')
      let failure: { status?: number; stderr?: string } | undefined
      try {
        execFileSync(process.execPath, [join(dir, 'scripts', 'prepare.mjs')], { encoding: 'utf8', cwd: dir, stdio: 'pipe' })
      } catch (error) {
        failure = error as { status?: number; stderr?: string }
      }
      expect(failure).toBeDefined()
      expect(failure?.status).toBe(1)
      expect(failure?.stderr).toContain('npm ci && npm run build')
      expect(failure?.stderr).not.toContain('command not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('DR-1: the README Install section says to build the checkout before installing it', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Worked example'))
    expect(install.indexOf('npm ci')).toBeGreaterThan(-1)
    expect(install.indexOf('npm run build')).toBeGreaterThan(install.indexOf('npm ci'))
    expect(install.indexOf('npm install ../parity-kit')).toBeGreaterThan(install.indexOf('npm run build'))
  })
})
