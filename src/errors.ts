/**
 * Why parity-kit refused to run. Everything that is wrong with the whole
 * call (a bad option, an input that is not a dataset, an input over a size
 * limit) throws one of these. Everything that is wrong with one record is
 * reported in the result instead, so one bad record never hides the others.
 */
export type ParityErrorCode =
  | 'bad-options' // an option has the wrong type or value, or is not a known option
  | 'bad-input' // an argument is not an array of records or an object keyed by id
  | 'unreadable-input' // reading the argument itself threw (for example a Proxy trap)
  | 'too-large' // a size limit was exceeded (records, total values)
  | 'bad-registry'; // a registry entry is malformed

/**
 * Every error this package throws on purpose is registered here. Caller code
 * can throw anything (including a Proxy whose prototype lookup throws), so
 * `catch` blocks recognize our own errors by identity in this set, never by
 * `instanceof`, which would run the thrown value's traps.
 */
const ours = new WeakSet<object>();

/** True only for an error object created by this package. Never runs code on `value`. */
export function isOwnError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && ours.has(value);
}

/** Internal. Mark an error object as created by this package. */
export function registerOwnError(error: object): void {
  ours.add(error);
}

export class ParityError extends Error {
  readonly code: ParityErrorCode;

  constructor(code: ParityErrorCode, message: string) {
    super(message);
    this.name = 'ParityError';
    this.code = code;
    registerOwnError(this);
  }
}
