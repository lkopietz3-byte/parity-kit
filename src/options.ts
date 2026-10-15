import { ParityError, isOwnError } from './errors.js';
import type { Limits } from './types.js';

/** Internal. The counters shared by every read in one call. */
export interface Budget {
  nodes: number;
  /** Arrays and objects read so far; these are what allocate, so they get their own, lower, cap. */
  containers: number;
  readonly maxContainers: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxRecords: number;
  readonly maxKeyLength: number;
}

const DEFAULT_MAX_RECORDS = 1_000_000;
const DEFAULT_MAX_NODES = 10_000_000;
const DEFAULT_MAX_DEPTH = 64;
const HARD_MAX_DEPTH = 1000;

export function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Reflect.getPrototypeOf(value);
  return proto === null || Reflect.getPrototypeOf(proto) === null;
}

const hasOwn = Object.hasOwn;

/**
 * Is this descriptor a data descriptor? The test is for an OWN `value`, never
 * `'value' in desc`: that walks the prototype chain, so a polluted
 * `Object.prototype.value` would turn a getter into a data property.
 */
export function isDataDescriptor(desc: PropertyDescriptor): boolean {
  return hasOwn(desc, 'value');
}

/** The value a property descriptor stands for: its data value, or the result of running its getter once. */
export function descriptorValue(object: object, desc: PropertyDescriptor): unknown {
  if (isDataDescriptor(desc)) return desc.value as unknown;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the getter is called with its owner as receiver just below
  const getter = desc.get;
  return typeof getter === 'function' ? (Reflect.apply(getter, object, []) as unknown) : undefined;
}

/** Read one own property exactly once. A data property gives its value, a getter runs once. */
export function readOwn(object: object, key: string): unknown {
  const desc = Reflect.getOwnPropertyDescriptor(object, key);
  return desc === undefined ? undefined : descriptorValue(object, desc);
}

/**
 * Read an options object once. Only own properties are read. An unknown
 * option name is an error, so a misspelled option can never silently
 * disable a check; so is a symbol key or a non-enumerable property, which
 * would otherwise be skipped without a word.
 */
export function readOptions(
  options: unknown,
  allowed: readonly string[],
  what: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (options === undefined) return out;
  try {
    if (!isPlainObject(options)) {
      throw new ParityError('bad-options', `${what}: options must be a plain object`);
    }
    for (const name of Reflect.ownKeys(options)) {
      // An option that is skipped would silently turn its check off, so what
      // cannot be read as written is refused: a symbol key, a hidden property.
      if (typeof name !== 'string') {
        throw new ParityError('bad-options', `${what}: options must not have symbol keys`);
      }
      // One descriptor read per property: the value comes from this descriptor.
      const desc = Reflect.getOwnPropertyDescriptor(options, name);
      if (desc === undefined) {
        throw new ParityError('bad-options', `${what}: option "${name}" could not be read`);
      }
      if (desc.enumerable !== true) {
        throw new ParityError('bad-options', `${what}: option "${name}" is not enumerable, so it would be skipped`);
      }
      if (!allowed.includes(name)) {
        throw new ParityError('bad-options', `${what}: unknown option "${name}"`);
      }
      const value = descriptorValue(options, desc);
      if (value !== undefined) out[name] = value;
    }
  } catch (error) {
    if (isOwnError(error) && error instanceof ParityError) throw error;
    throw new ParityError('bad-options', `${what}: reading the options threw`);
  }
  return out;
}

/**
 * Refuse arguments past the documented ones. JavaScript drops them without a
 * word, so an options bag handed to a function that takes none (or a fourth
 * argument to one that takes three) would turn the check it was meant to
 * configure off. `given` is `arguments.length` of the caller.
 */
export function refuseExtraArguments(given: number, allowed: number, what: string): void {
  if (given > allowed) {
    throw new ParityError('bad-options', `${what}: takes ${allowed} argument${allowed === 1 ? '' : 's'}, got ${given}; an extra argument would be ignored, so it is refused`);
  }
}

export function optString(o: Record<string, unknown>, name: string, what: string): string | undefined {
  const v = o[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v === '') {
    throw new ParityError('bad-options', `${what}: option "${name}" must be a non-empty string`);
  }
  return v;
}

export function optBoolean(o: Record<string, unknown>, name: string, what: string): boolean | undefined {
  const v = o[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    throw new ParityError('bad-options', `${what}: option "${name}" must be true or false`);
  }
  return v;
}

/** A list of non-empty field names, read once (holes and non-strings are errors). */
export function optNames(
  o: Record<string, unknown>,
  name: string,
  what: string,
): string[] | undefined {
  const v = o[name];
  if (v === undefined) return undefined;
  const fail = (): never => {
    throw new ParityError('bad-options', `${what}: option "${name}" must be an array of non-empty strings`);
  };
  try {
    if (!Array.isArray(v)) return fail();
    const length = readOwn(v, 'length');
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 100_000) return fail();
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < length; i += 1) {
      const item = readOwn(v, String(i));
      if (typeof item !== 'string' || item === '') return fail();
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  } catch (error) {
    if (isOwnError(error) && error instanceof ParityError) throw error;
    throw new ParityError('bad-options', `${what}: reading option "${name}" threw`);
  }
}

export function makeBudget(limits: unknown, what: string): Budget {
  const o = readOptions(limits, ['maxRecords', 'maxNodes', 'maxDepth', 'maxKeyLength'], `${what} limits`);
  const int = (name: keyof Limits, fallback: number, min: number, max: number): number => {
    const v = o[name];
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new ParityError('bad-options', `${what}: limit "${name}" must be an integer from ${min} to ${max}`);
    }
    return v;
  };
  const maxNodes = int('maxNodes', DEFAULT_MAX_NODES, 1, 500_000_000);
  return {
    nodes: 0,
    containers: 0,
    maxContainers: Math.max(1000, Math.floor(maxNodes / 5)),
    maxRecords: int('maxRecords', DEFAULT_MAX_RECORDS, 1, 50_000_000),
    maxNodes,
    maxDepth: int('maxDepth', DEFAULT_MAX_DEPTH, 1, HARD_MAX_DEPTH),
    maxKeyLength: int('maxKeyLength', 4096, 1, 1_048_576),
  };
}
