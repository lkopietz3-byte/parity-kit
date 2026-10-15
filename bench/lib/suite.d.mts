export interface Matrix {
  id: string
  counts: Record<string, Record<string, number>>
}
export interface Summary {
  id: string
  positives: number
  falsePass: number
  negatives: number
  falseFlag: number
}
export interface Report {
  matrices: Map<string, Matrix>
}
export function runSuite(kit: unknown, options?: { quick?: boolean }): Report
export function summarize(matrix: Matrix): Summary
