import { isBufferView, nativeKind } from './brand.js';
import { ParityError, isOwnError, registerOwnError } from './errors.js';
import { descriptorValue, isPlainObject, readOwn, type Budget } from './options.js';
import type { InvalidReason, Key } from './types.js';

/**
 * A snapshot is a plain, inert copy of the data that was read, taken once.
 * Nothing in a snapshot can run code, so every later comparison is safe and
 * sees exactly what was validated.
 *
 *   primitives (string, number, boolean, bigint, null) stand for themselves;
 *   `undefined` only appears as an array element (an object property that is
 *   undefined is treated as absent, the way JSON treats it).
 */
export class DateSnap {
  readonly time: number;
  constructor(time: number) {
    this.time = time;
  }
}
export class ArrSnap {
  readonly items: Snap[];
  constructor(items: Snap[]) {
    this.items = items;
  }
}
export class ObjSnap {
  readonly keys: string[];
  readonly vals: Snap[];
  constructor(keys: string[], vals: Snap[]) {
    this.keys = keys;
    this.vals = vals;
  }
}
export type Snap = string | number | boolean | bigint | null | undefined | DateSnap | ArrSnap | ObjSnap;

/** Internal. A value inside one record cannot be read; the record becomes an `invalid` entry. */
export class Unsupported extends Error {
  readonly reason: InvalidReason;
  readonly path: string;
  readonly detail: string;
  constructor(reason: InvalidReason, path: string, detail: string) {
    super(detail);
    this.reason = reason;
    this.path = path;
    this.detail = detail;
    registerOwnError(this);
  }
}

/** Internal. A size limit was hit; this aborts the whole call. */
export class BudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    registerOwnError(this);
  }
}

const dateGetTime = Reflect.get(Date.prototype, 'getTime');

/** The time value of a Date from any realm, or undefined for anything that is not a real Date. */
export function dateTime(value: object): number | undefined {
  try {
    return Reflect.apply(dateGetTime, value, []);
  } catch {
    return undefined;
  }
}

/**
 * A short description of a thrown value that never runs code on it: it reads
 * only an own data property `message` that holds a string (which is what a
 * real Error has), and otherwise says that a value was thrown. No
 * `instanceof`, no coercion, no getters.
 */
export function describeError(error: unknown): string {
  try {
    if (typeof error === 'object' && error !== null) {
      const desc = Reflect.getOwnPropertyDescriptor(error, 'message');
      if (desc !== undefined && typeof desc.value === 'string') return desc.value.slice(0, 200);
    } else if (typeof error === 'string') {
      return error.slice(0, 200);
    }
  } catch {
    // fall through
  }
  return 'a value that could not be described was thrown';
}

interface Ctx {
  readonly budget: Budget;
  readonly ancestors: Set<object>;
  readonly trail: Array<string | number>;
}

export function trailToPath(trail: ReadonlyArray<string | number>): string {
  let out = '';
  for (const part of trail) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? part : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
  }
  return out.length > 200 ? `${out.slice(0, 200)}...` : out;
}

function unsupported(ctx: Ctx, reason: InvalidReason, detail: string): Unsupported {
  return new Unsupported(reason, trailToPath(ctx.trail), detail);
}

function spend(budget: Budget, count: number): void {
  budget.nodes += count;
  if (budget.nodes > budget.maxNodes) throw new BudgetExceeded('node limit');
}

interface Slot {
  name: string;
  desc: PropertyDescriptor;
}

interface Slots {
  slots: Slot[];
  /** The object has an own string-keyed property that is not enumerable (a built-in's internal bookkeeping, never JSON data). */
  hidden: boolean;
}

/**
 * The own properties of a plain object that will be read, as descriptors only
 * (no getter has run yet), sorted by key. With `names`, those named own
 * properties; without, every own enumerable string-keyed property. Every
 * probe, present or absent, is charged to the work budget.
 */
function ownSlots(object: object, names: readonly string[] | null, ctx: Ctx, skip?: string, skipDesc?: PropertyDescriptor): Slots {
  const out: Slot[] = [];
  let hidden = false;
  if (names !== null) {
    spend(ctx.budget, names.length);
    for (const name of names) {
      if (name === skip) continue;
      const desc = Reflect.getOwnPropertyDescriptor(object, name);
      if (desc !== undefined) out.push({ name, desc });
    }
  } else {
    const keys = Reflect.ownKeys(object);
    spend(ctx.budget, keys.length);
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      if (key === skip) {
        // The caller already read this descriptor; reading it again could see a different one.
        if (skipDesc !== undefined && skipDesc.enumerable !== true) hidden = true;
        continue;
      }
      const desc = Reflect.getOwnPropertyDescriptor(object, key);
      if (desc === undefined) continue;
      if (desc.enumerable !== true) hidden = true;
      else out.push({ name: key, desc });
    }
  }
  out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return { slots: out, hidden };
}

/** Read one slot exactly once: a data property gives its value, a getter runs. */
function slotValue(object: object, slot: Slot): unknown {
  return descriptorValue(object, slot.desc);
}

function snap(value: unknown, ctx: Ctx, depth: number): Snap {
  spend(ctx.budget, 1);
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return value;
    case 'object':
      break;
    default:
      throw unsupported(ctx, 'unsupported-value', `a ${typeof value} cannot be compared`);
  }
  if (value === null) return null;
  const object = value;
  const isArray = Array.isArray(object);
  if (!isArray) {
    // Classify by prototype shape and internal slots only; never by any property
    // the caller controls (no toStringTag, constructor, toJSON).
    if (isBufferView(object)) throw unsupported(ctx, 'unsupported-value', 'typed arrays and DataViews cannot be compared');
    if (!isPlainObject(object)) {
      const kind = nativeKind(object);
      if (kind !== undefined && kind !== 'other') return new DateSnap(kind.date);
      throw unsupported(ctx, 'unsupported-value', 'only plain objects, arrays and Dates can be compared');
    }
  }
  ctx.budget.containers += 1;
  if (ctx.budget.containers > ctx.budget.maxContainers) throw new BudgetExceeded('container limit');
  if (depth > ctx.budget.maxDepth) {
    throw unsupported(ctx, 'too-deep', `nesting is deeper than ${ctx.budget.maxDepth}`);
  }
  if (ctx.ancestors.has(object)) throw unsupported(ctx, 'cycle', 'the value contains itself');
  ctx.ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const length = readOwn(object, 'length');
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
        throw unsupported(ctx, 'unreadable', 'array length is not readable');
      }
      const items: Snap[] = [];
      for (let i = 0; i < length; i += 1) {
        const desc = Reflect.getOwnPropertyDescriptor(object, i);
        ctx.trail.push(i);
        if (desc === undefined) throw unsupported(ctx, 'hole', 'array has an empty slot');
        const item: unknown = descriptorValue(object, desc);
        items.push(snap(item, ctx, depth + 1));
        ctx.trail.pop();
      }
      return new ArrSnap(items);
    }
    {
      const { slots, hidden } = ownSlots(object, null, ctx);
      // An object that looks empty, or carries hidden own properties, may be a
      // built-in whose prototype was replaced (a null-prototype Map or Date).
      if (slots.length === 0 || hidden) {
        const kind = nativeKind(object);
        if (kind !== undefined && kind !== 'other') return new DateSnap(kind.date);
        if (kind === 'other') throw unsupported(ctx, 'unsupported-value', 'a built-in object with its prototype replaced cannot be compared');
      }
      const keys: string[] = [];
      const vals: Snap[] = [];
      for (const slot of slots) {
        ctx.trail.push(slot.name);
        const raw = slotValue(object, slot);
        if (raw !== undefined) {
          keys.push(slot.name);
          vals.push(snap(raw, ctx, depth + 1));
        }
        ctx.trail.pop();
      }
      return new ObjSnap(keys, vals);
    }
  } finally {
    ctx.ancestors.delete(object);
  }
}

/**
 * Structural equality of two snapshots. Numbers: `-0` equals `0`, `NaN`
 * equals `NaN`, and with a tolerance two finite numbers are equal when they
 * differ by at most the tolerance. Dates compare by time value (two invalid
 * Dates are equal). A string never equals a number.
 */
export function snapEqual(a: Snap, b: Snap, tolerance: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number') {
    if (typeof b !== 'number') return false;
    if (a !== a) return b !== b;
    return tolerance > 0 && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (a instanceof DateSnap) return b instanceof DateSnap && (a.time === b.time || (a.time !== a.time && b.time !== b.time));
  if (a instanceof ArrSnap) {
    if (!(b instanceof ArrSnap) || a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i += 1) {
      if (!snapEqual(a.items[i], b.items[i], tolerance)) return false;
    }
    return true;
  }
  if (!(b instanceof ObjSnap) || a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i += 1) {
    if (a.keys[i] !== b.keys[i] || !snapEqual(a.vals[i], b.vals[i], tolerance)) return false;
  }
  return true;
}

/** A plain copy of a snapshot for reports: null-prototype objects, own-realm Dates. */
export function plainValue(s: Snap): unknown {
  if (typeof s !== 'object' || s === null) return s;
  if (s instanceof DateSnap) return new Date(s.time);
  if (s instanceof ArrSnap) return s.items.map(plainValue);
  const out = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < s.keys.length; i += 1) {
    Object.defineProperty(out, s.keys[i] as string, {
      value: plainValue(s.vals[i]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a dataset: an array of records, or an object keyed by id.
// ---------------------------------------------------------------------------

export interface DatasetEntry {
  /** The record's key when it could be read and is valid. */
  id: Key | undefined;
  position: number | string;
  /** The record's fields; undefined when the record is invalid. */
  fields: Map<string, Snap> | undefined;
}

export interface DatasetInvalid {
  position: number | string | null;
  id?: Key;
  reason: InvalidReason;
  path?: string;
  detail?: string;
}

export interface ReadConfig {
  /** The key field name (array mode only identifies records by it). */
  key: string;
  /** Fields to read, or null for every own enumerable field. */
  names: readonly string[] | null;
  /** Also keep the key field among the record's fields (when a caller asked for it by name). */
  includeKey?: boolean;
}

export interface ReadDataset {
  entries: DatasetEntry[];
  invalid: DatasetInvalid[];
  mode: 'array' | 'object';
}

function validKey(value: unknown): value is Key {
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number' && Number.isFinite(value);
}

function readRecord(
  raw: unknown,
  position: number | string,
  mode: 'array' | 'object',
  cfg: ReadConfig,
  ctx: Ctx,
  entries: DatasetEntry[],
  invalid: DatasetInvalid[],
): void {
  ctx.ancestors.clear();
  ctx.trail.length = 0;
  let id: Key | undefined = mode === 'object' ? position : undefined;
  const bad = (reason: InvalidReason, detail: string, path?: string): void => {
    const item: DatasetInvalid = { position, reason, detail };
    if (id !== undefined) item.id = id;
    if (path !== undefined && path !== '') item.path = path;
    invalid.push(item);
    entries.push({ id, position, fields: undefined });
  };
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      bad('not-an-object', `a record must be an object, got ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}`);
      return;
    }
    // The key is read first and on its own, before anything else about the
    // record is judged, so a record that turns out to be unreadable or not plain
    // (a Proxy whose prototype lookup throws, a class instance) still keeps its
    // identity and is never reported as missing.
    let keyValue: unknown;
    const keyDesc = Reflect.getOwnPropertyDescriptor(raw, cfg.key);
    if (keyDesc !== undefined) {
      ctx.trail.push(cfg.key);
      keyValue = slotValue(raw, { name: cfg.key, desc: keyDesc });
      ctx.trail.pop();
    }
    if (mode === 'array' && validKey(keyValue)) id = keyValue;
    if (!isPlainObject(raw) || isBufferView(raw)) {
      bad('not-a-plain-object', 'a record must be a plain object (no Date, Map, or class instance)');
      return;
    }
    if (mode === 'array') {
      if (keyValue === undefined) {
        bad('missing-key', `the key field "${cfg.key}" is missing`);
        return;
      }
      if (!validKey(keyValue)) {
        bad('bad-key', `the key field "${cfg.key}" must be a non-empty string or a finite number`);
        return;
      }
      id = keyValue;
    } else if (keyValue !== undefined) {
      if (!validKey(keyValue) || String(keyValue) !== position) {
        bad('key-mismatch', `property "${String(position)}" carries ${cfg.key} ${typeof keyValue === 'string' || typeof keyValue === 'number' ? JSON.stringify(keyValue) : `of type ${typeof keyValue}`}`);
        return;
      }
    }
    spend(ctx.budget, 1);
    const { slots, hidden } = ownSlots(raw, cfg.names, ctx, cfg.key, keyDesc);
    // A record with nothing in it, or with hidden own properties, may be a
    // built-in whose prototype was replaced (a null-prototype Map or Date).
    if ((slots.length === 0 && keyDesc === undefined) || hidden) {
      if (nativeKind(raw) !== undefined) {
        bad('not-a-plain-object', 'a record must be a plain object (no Date, Map, or class instance)');
        return;
      }
    }
    const fields = new Map<string, Snap>();
    if (cfg.includeKey === true && keyValue !== undefined) fields.set(cfg.key, snap(keyValue, ctx, 1));
    for (const slot of slots) {
      ctx.trail.push(slot.name);
      const value = slotValue(raw, slot);
      if (value !== undefined) fields.set(slot.name, snap(value, ctx, 1));
      ctx.trail.pop();
    }
    entries.push({ id, position, fields });
  } catch (error) {
    if (isOwnError(error) && error instanceof BudgetExceeded) throw error;
    if (isOwnError(error) && error instanceof Unsupported) bad(error.reason, error.detail, error.path);
    else bad('unreadable', `reading the record threw: ${describeError(error)}`, trailToPath(ctx.trail));
  }
}

/**
 * Read a dataset once into snapshots. An array is read by index; an object is
 * read by its own enumerable string keys, sorted, so the order a Proxy
 * reports keys in never matters. Throws `ParityError` when the argument as a
 * whole cannot be a dataset or is over a limit.
 */
export function readDataset(input: unknown, side: string, cfg: ReadConfig, budget: Budget): ReadDataset {
  const entries: DatasetEntry[] = [];
  const invalid: DatasetInvalid[] = [];
  const ctx: Ctx = { budget, ancestors: new Set(), trail: [] };
  try {
    if (typeof input !== 'object' || input === null) {
      throw new ParityError('bad-input', `${side} must be an array of records or an object keyed by id`);
    }
    if (Array.isArray(input)) {
      const length = readOwn(input, 'length');
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
        throw new ParityError('unreadable-input', `${side}: array length is not readable`);
      }
      if (length > budget.maxRecords) {
        throw new ParityError('too-large', `${side} has ${length} records; the limit is ${budget.maxRecords}`);
      }
      spend(budget, length);
      for (let i = 0; i < length; i += 1) {
        const desc = Reflect.getOwnPropertyDescriptor(input, i);
        if (desc === undefined) {
          invalid.push({ position: i, reason: 'hole', detail: 'array has an empty slot' });
          entries.push({ id: undefined, position: i, fields: undefined });
          continue;
        }
        let raw: unknown;
        try {
          raw = descriptorValue(input, desc);
        } catch (error) {
          invalid.push({ position: i, reason: 'unreadable', detail: `reading the slot threw: ${describeError(error)}` });
          entries.push({ id: undefined, position: i, fields: undefined });
          continue;
        }
        readRecord(raw, i, 'array', cfg, ctx, entries, invalid);
      }
      return { entries, invalid, mode: 'array' };
    }
    if (!isPlainObject(input)) {
      throw new ParityError('bad-input', `${side} must be an array of records or a plain object keyed by id`);
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > budget.maxRecords) {
      throw new ParityError('too-large', `${side} has ${keys.length} keys; the limit is ${budget.maxRecords}`);
    }
    spend(budget, keys.length);
    const slots: Array<{ id: string; desc: PropertyDescriptor }> = [];
    let hidden = false;
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      // One descriptor read per property: the record comes from this descriptor.
      const desc = Reflect.getOwnPropertyDescriptor(input, key);
      if (desc === undefined) continue;
      if (desc.enumerable === true) slots.push({ id: key, desc });
      else hidden = true;
    }
    if ((slots.length === 0 || hidden) && nativeKind(input) !== undefined) {
      throw new ParityError('bad-input', `${side} must be an array of records or a plain object keyed by id, not a built-in such as a Map or Date`);
    }
    slots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const { id, desc } of slots) {
      let raw: unknown;
      try {
        raw = descriptorValue(input, desc);
      } catch (error) {
        invalid.push({ position: id, id, reason: 'unreadable', detail: `reading the property threw: ${describeError(error)}` });
        entries.push({ id, position: id, fields: undefined });
        continue;
      }
      if (id.trim() === '') {
        invalid.push({ position: id, reason: 'bad-key', detail: 'a record key must not be empty' });
        entries.push({ id: undefined, position: id, fields: undefined });
        continue;
      }
      readRecord(raw, id, 'object', cfg, ctx, entries, invalid);
    }
    return { entries, invalid, mode: 'object' };
  } catch (error) {
    if (isOwnError(error) && error instanceof ParityError) throw error;
    if (isOwnError(error) && error instanceof BudgetExceeded) {
      throw new ParityError('too-large', `${side}: the total number of values read passed the limit of ${budget.maxNodes} (or arrays and objects passed ${budget.maxContainers})`);
    }
    throw new ParityError('unreadable-input', `${side}: reading the input threw: ${describeError(error)}`);
  }
}
