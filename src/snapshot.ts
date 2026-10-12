import { isBufferView, nativeKind, type ShapeFacts } from './brand.js';
import { keyProblem } from './keys.js';
import { ParityError, isOwnError, registerOwnError } from './errors.js';
import { descriptorValue, readOwn, type Budget } from './options.js';
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

/**
 * A name or value shortened for a message, so detail text never grows with
 * the input (a 5 MB id shared by many records would otherwise be copied into
 * every message). Cuts on a code point and says how long the original was.
 */
export function clip(text: string, max = 40): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}... (${text.length} units)`;
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
  /** What enumeration already learned, so classifying an empty-looking object never reads it again. */
  facts: ShapeFacts;
}

/**
 * The own properties of a plain object that will be read, as descriptors only
 * (no getter has run yet), sorted by key. With `names`, those named own
 * properties; without, every own enumerable string-keyed property. Every
 * probe, present or absent, is charged to the work budget. Each descriptor is
 * read once: `skip` names a property whose descriptor (`skipDesc`) the caller
 * already read. The `constructor` descriptor and the presence of an own
 * `Symbol.toStringTag` are remembered in `facts`.
 */
function ownSlots(object: object, names: readonly string[] | null, ctx: Ctx, skip?: string, skipDesc?: PropertyDescriptor): Slots {
  const out: Slot[] = [];
  const facts: ShapeFacts = {};
  if (skip === 'constructor') facts.constructorDesc = { desc: skipDesc };
  if (names !== null) {
    spend(ctx.budget, names.length);
    for (const name of names) {
      if (name === skip) continue;
      const desc = Reflect.getOwnPropertyDescriptor(object, name);
      if (name === 'constructor') facts.constructorDesc = { desc };
      if (desc !== undefined) out.push({ name, desc });
    }
  } else {
    const keys = Reflect.ownKeys(object);
    spend(ctx.budget, keys.length);
    facts.hasOwnTag = false;
    if (facts.constructorDesc === undefined) facts.constructorDesc = { desc: undefined };
    for (const key of keys) {
      if (typeof key !== 'string') {
        if (key === Symbol.toStringTag) facts.hasOwnTag = true;
        continue;
      }
      if (key === skip) continue; // the caller already read this descriptor
      const desc = Reflect.getOwnPropertyDescriptor(object, key);
      if (desc === undefined) continue;
      if (key === 'constructor') facts.constructorDesc = { desc };
      if (desc.enumerable === true) out.push({ name: key, desc });
    }
  }
  out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return { slots: out, facts };
}

/** Read one slot exactly once: a data property gives its value, a getter runs. */
function slotValue(object: object, slot: Slot): unknown {
  return descriptorValue(object, slot.desc);
}

/**
 * For a record read with selected fields: does it have an own enumerable
 * property that was not selected? Reads each remaining key's descriptor once
 * (the selected names and the key were already probed), fills in `facts`, and
 * runs no getter.
 */
function hasOtherEnumerable(object: object, cfg: ReadConfig, ctx: Ctx, facts: ShapeFacts): boolean {
  const keys = Reflect.ownKeys(object);
  spend(ctx.budget, keys.length);
  facts.hasOwnTag = false;
  if (facts.constructorDesc === undefined) facts.constructorDesc = { desc: undefined };
  let any = false;
  for (const key of keys) {
    if (typeof key !== 'string') {
      if (key === Symbol.toStringTag) facts.hasOwnTag = true;
      continue;
    }
    if (key === cfg.key || cfg.nameSet?.has(key) === true) continue;
    const desc = Reflect.getOwnPropertyDescriptor(object, key);
    if (desc === undefined) continue;
    if (key === 'constructor') facts.constructorDesc = { desc };
    if (desc.enumerable === true) any = true;
  }
  return any;
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
  let proto: object | null = null;
  if (!Array.isArray(object)) {
    // Classify by prototype shape and internal slots only; never by any property
    // the caller controls (no toStringTag, constructor, toJSON).
    if (isBufferView(object)) throw unsupported(ctx, 'unsupported-value', 'typed arrays and DataViews cannot be compared');
    proto = Reflect.getPrototypeOf(object);
    if (proto !== null && Reflect.getPrototypeOf(proto) !== null) {
      const time = dateTime(object);
      if (time !== undefined) return new DateSnap(time);
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
      const { slots, facts } = ownSlots(object, null, ctx);
      // An object with no own enumerable property may be a built-in whose
      // prototype was replaced (a null-prototype Map or Date). A populated object
      // is plain data.
      if (slots.length === 0) {
        const kind = nativeKind(object, proto, facts);
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
 * Two finite numbers are within `tolerance` when `|a - b| <= tolerance + 8 * EPSILON * max(|a|, |b|, tolerance)`.
 * The second term is a few units of rounding error at the size of the numbers.
 * Without it a difference that is exactly the tolerance in decimal (1.25 and
 * 1.15 at 0.1) lands a hair over it in binary and is called different. It is
 * far smaller than any real decimal step at the same size (a cent at a million
 * dollars is ten million times larger), so nothing that is really over the
 * tolerance is let through. No clock and no randomness: the same inputs give
 * the same answer.
 */
function withinTolerance(a: number, b: number, tolerance: number): boolean {
  const diff = Math.abs(a - b);
  if (!Number.isFinite(diff)) return false;
  if (diff <= tolerance) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), tolerance);
  return diff <= tolerance + 8 * Number.EPSILON * scale;
}

/**
 * Structural equality of two snapshots. Numbers: `-0` equals `0`, `NaN`
 * equals `NaN`, and with a tolerance two finite numbers are equal when they
 * differ by at most the tolerance (plus the rounding allowance in
 * `withinTolerance`). Dates compare by time value (two invalid
 * Dates are equal). A string never equals a number.
 */
export function snapEqual(a: Snap, b: Snap, tolerance: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number') {
    if (typeof b !== 'number') return false;
    if (a !== a) return b !== b;
    return tolerance > 0 && Number.isFinite(a) && Number.isFinite(b) && withinTolerance(a, b, tolerance);
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
  /** `names` as a set (filled in by `readDataset`). */
  nameSet?: ReadonlySet<string>;
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
    if (typeof raw !== 'object' || raw === null) {
      bad('not-an-object', `a record must be an object, got ${raw === null ? 'null' : typeof raw}`);
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
    const problem = typeof keyValue === 'string' ? keyProblem(keyValue, ctx.budget.maxKeyLength) : undefined;
    // A refused key is never normalized, so only a key that will be analyzed is charged.
    if (typeof keyValue === 'string' && problem === undefined) spend(ctx.budget, keyValue.length);
    if (mode === 'array' && problem === undefined && validKey(keyValue)) id = keyValue;
    if (Array.isArray(raw)) {
      // Judged after the key is read, so an array that carries a usable key keeps its identity.
      bad('not-an-object', 'a record must be an object, got an array');
      return;
    }
    if (isBufferView(raw)) {
      bad('not-a-plain-object', 'a record must be a plain object (no Date, Map, or class instance)');
      return;
    }
    const proto = Reflect.getPrototypeOf(raw);
    if (proto !== null && Reflect.getPrototypeOf(proto) !== null) {
      bad('not-a-plain-object', 'a record must be a plain object (no Date, Map, or class instance)');
      return;
    }
    if (mode === 'array') {
      if (keyValue === undefined) {
        bad('missing-key', `the key field "${clip(cfg.key)}" is missing`);
        return;
      }
      if (problem !== undefined) {
        // Refuse before any trim or whitespace scan of an oversized key.
        bad(problem, `the key is ${problem === 'key-too-long' ? `longer than ${ctx.budget.maxKeyLength} units` : 'built from a run of more than 32 combining marks'}`);
        return;
      }
      if (!validKey(keyValue)) {
        bad('bad-key', `the key field "${clip(cfg.key)}" must be a non-empty string or a finite number`);
        return;
      }
      id = keyValue;
    } else if (keyValue !== undefined) {
      if (problem !== undefined || !validKey(keyValue) || String(keyValue) !== position) {
        const shown = typeof keyValue === 'string' ? JSON.stringify(clip(keyValue)) : typeof keyValue === 'number' ? String(keyValue) : `of type ${typeof keyValue}`;
        bad('key-mismatch', `property ${JSON.stringify(clip(String(position)))} carries ${clip(cfg.key)} ${shown}, which is not the property name (the key option names the field)`);
        return;
      }
    }
    spend(ctx.budget, 1);
    const { slots, facts } = ownSlots(raw, cfg.names, ctx, cfg.key, keyDesc);
    // A record with no own enumerable property may be a built-in whose prototype
    // was replaced (a null-prototype Map or Date).
    // With selected fields the slots only cover the selection, so look at the record's
    // own keys (descriptors only; no excluded value is read and no getter runs).
    const populated =
      slots.length > 0 ||
      keyDesc?.enumerable === true ||
      (cfg.names !== null && hasOtherEnumerable(raw, cfg, ctx, facts));
    if (!populated) {
      if (nativeKind(raw, proto, facts) !== undefined) {
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
  const recordCfg: ReadConfig = cfg.names === null ? cfg : { ...cfg, nameSet: new Set(cfg.names) };
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
        readRecord(raw, i, 'array', recordCfg, ctx, entries, invalid);
      }
      return { entries, invalid, mode: 'array' };
    }
    const proto = Reflect.getPrototypeOf(input);
    if (proto !== null && Reflect.getPrototypeOf(proto) !== null) {
      throw new ParityError('bad-input', `${side} must be an array of records or a plain object keyed by id`);
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > budget.maxRecords) {
      throw new ParityError('too-large', `${side} has ${keys.length} keys; the limit is ${budget.maxRecords}`);
    }
    spend(budget, keys.length);
    const slots: Array<{ id: string; desc: PropertyDescriptor }> = [];
    const facts: ShapeFacts = { hasOwnTag: false, constructorDesc: { desc: undefined } };
    for (const key of keys) {
      if (typeof key !== 'string') {
        if (key === Symbol.toStringTag) facts.hasOwnTag = true;
        continue;
      }
      // One descriptor read per property: the record comes from this descriptor.
      const desc = Reflect.getOwnPropertyDescriptor(input, key);
      if (desc === undefined) continue;
      if (key === 'constructor') facts.constructorDesc = { desc };
      if (desc.enumerable === true) slots.push({ id: key, desc });
    }
    if (isBufferView(input) || (slots.length === 0 && nativeKind(input, proto, facts) !== undefined)) {
      throw new ParityError('bad-input', `${side} must be an array of records or a plain object keyed by id, not a built-in such as a Map or Date`);
    }
    slots.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const { id, desc } of slots) {
      // The name is judged before its getter runs, so a refused or empty name
      // costs nothing and runs no user code.
      const problem = keyProblem(id, budget.maxKeyLength);
      if (problem !== undefined) {
        invalid.push({ position: id, reason: problem, detail: `the key is ${problem === 'key-too-long' ? `longer than ${budget.maxKeyLength} units` : 'built from a run of more than 32 combining marks'}` });
        entries.push({ id: undefined, position: id, fields: undefined });
        continue;
      }
      if (id.trim() === '') {
        invalid.push({ position: id, reason: 'bad-key', detail: 'a record key must not be empty' });
        entries.push({ id: undefined, position: id, fields: undefined });
        continue;
      }
      spend(budget, id.length);
      let raw: unknown;
      try {
        raw = descriptorValue(input, desc);
      } catch (error) {
        invalid.push({ position: id, id, reason: 'unreadable', detail: `reading the property threw: ${describeError(error)}` });
        entries.push({ id, position: id, fields: undefined });
        continue;
      }
      readRecord(raw, id, 'object', recordCfg, ctx, entries, invalid);
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
