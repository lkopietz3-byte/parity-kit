import { ParityError } from './errors.js';
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

/** The value a property descriptor stands for: its data value, or the result of running its getter once. */
export function descriptorValue(object: object, desc: PropertyDescriptor): unknown {
  if ('value' in desc) return desc.value as unknown;
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
 * disable a check.
 */
export function readOptions(
  options: unknown,
  allowed: readonly string[],
  what: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (options === undefined) return out;
  if (!isPlainObject(options)) {
    throw new ParityError('bad-options', `${what}: options must be a plain object`);
  }
  try {
    for (const name of Reflect.ownKeys(options)) {
      if (typeof name !== 'string') continue;
      const desc = Reflect.getOwnPropertyDescriptor(options, name);
      if (desc === undefined || desc.enumerable !== true) continue;
      if (!allowed.includes(name)) {
        throw new ParityError('bad-options', `${what}: unknown option "${name}"`);
      }
      const value = readOwn(options, name);
      if (value !== undefined) out[name] = value;
    }
  } catch (error) {
    if (error instanceof ParityError) throw error;
    throw new ParityError('bad-options', `${what}: reading the options threw`);
  }
  return out;
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
    for (let i = 0; i < length; i += 1) {
      const item = readOwn(v, String(i));
      if (typeof item !== 'string' || item === '') return fail();
      if (!out.includes(item)) out.push(item);
    }
    return out;
  } catch (error) {
    if (error instanceof ParityError) throw error;
    throw new ParityError('bad-options', `${what}: reading option "${name}" threw`);
  }
}

export function makeBudget(limits: unknown, what: string): Budget {
  const o = readOptions(limits, ['maxRecords', 'maxNodes', 'maxDepth'], `${what} limits`);
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
  };
}
