// The tests run on Node but the project carries no @types/node. These are the
// only Node APIs the tests use.
declare module 'node:vm' {
  const vm: { runInNewContext(code: string, context?: object): unknown }
  export default vm
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { encoding: 'utf8'; cwd?: string; input?: string; stdio?: 'pipe' }): string
}
declare module 'node:fs' {
  export function copyFileSync(from: string, to: string): void
  export function mkdirSync(path: string, options?: { recursive: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function mkdtempSync(prefix: string): string
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
  export function rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: Uint8Array | string): { digest(encoding: 'hex'): string } }
}
declare module 'node:module' {
  export function createRequire(url: string): (id: string) => unknown
}
declare module 'node:os' {
  export function tmpdir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const process: {
  env: Record<string, string | undefined>
  execPath: string
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number }
  memoryUsage(): { heapUsed: number; arrayBuffers: number }
}
// Vitest provides import.meta.dirname on Node 20.11+.
interface ImportMeta {
  readonly dirname: string
  readonly url: string
}
