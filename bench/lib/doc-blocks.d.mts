export interface DocCase {
  title: string
  code: string
  expected: string
  textStart: number
  textEnd: number
}
export function findCases(markdown: string): DocCase[]
export function runCode(code: string, modules: Record<string, unknown>): Promise<string>
export function rewrite(markdown: string, modules: Record<string, unknown>): Promise<string>
