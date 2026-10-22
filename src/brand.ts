/**
 * Recognizing built-in objects by their internal slots, without asking the
 * object anything it can answer for itself. Where Node provides them, the
 * checks are `util.types.is*` (pure slot checks that throw nothing and look
 * nothing up). The two built-ins `util.types` does not cover (WeakRef and
 * FinalizationRegistry), and every built-in on a runtime without `util.types`,
 * are probed by calling a captured built-in method on the value, which only
 * succeeds on a real instance of its type. Nothing here reads
 * `Symbol.toStringTag`, `constructor`, `toJSON`, or any other property in a way
 * that can depend on a mutable prototype or on a getter. This is only run on an
 * object that looks empty (no own enumerable properties), and only after the
 * caller has captured the descriptors it needs, so classification never reads a
 * property twice.
 *
 * Without `util.types` two probes cannot be made pure, so each has a
 * precondition that proves it cannot run caller code, and an object that fails
 * the precondition is classified as an unsupported built-in, never as plain data:
 *   - recognizing a Promise calls `then`, which looks up `constructor`;
 *   - without `Error.isError` (Node before 24), recognizing an Error uses
 *     `Object.prototype.toString`, which looks up `Symbol.toStringTag`.
 * With `util.types` neither probe is needed, so the preconditions, and the
 * refusal of an empty object from another realm that they force, do not apply.
 */
import { isDataDescriptor } from './options.js';

type AnyFunction = (this: unknown, ...args: never[]) => unknown;

function method(proto: unknown, name: string): AnyFunction | undefined {
  if (typeof proto !== 'object' || proto === null) return undefined;
  const fn: unknown = Reflect.get(proto, name);
  return typeof fn === 'function' ? (fn as AnyFunction) : undefined;
}

function getter(proto: unknown, key: PropertyKey): AnyFunction | undefined {
  if (typeof proto !== 'object' || proto === null) return undefined;
  const desc = Object.getOwnPropertyDescriptor(proto, key);
  const get: unknown = desc === undefined ? undefined : Reflect.get(desc, 'get');
  return typeof get === 'function' ? (get as AnyFunction) : undefined;
}

function globalProto(name: string): unknown {
  const ctor: unknown = Reflect.get(globalThis, name);
  return typeof ctor === 'function' ? (ctor as { prototype: unknown }).prototype : undefined;
}

const noop = (): void => undefined;
const sentinel = {};

interface Probe {
  fn: AnyFunction;
  args: unknown[];
}

/**
 * Node's `util.types`, looked up once at load through `process.getBuiltinModule`
 * (Node 20.16 and later, 22.3 and later) instead of an import, so `src` still
 * imports no `node:` module and still loads in a browser. `undefined` where it is
 * not available.
 */
function nodeTypes(): Record<string, unknown> | undefined {
  try {
    const proc: unknown = Reflect.get(globalThis, 'process');
    if (typeof proc !== 'object' || proc === null) return undefined;
    const getBuiltinModule: unknown = Reflect.get(proc, 'getBuiltinModule');
    if (typeof getBuiltinModule !== 'function') return undefined;
    const util: unknown = Reflect.apply(getBuiltinModule as AnyFunction, proc, ['util']);
    if (typeof util !== 'object' || util === null) return undefined;
    const types: unknown = Reflect.get(util, 'types');
    return typeof types === 'object' && types !== null ? (types as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const utilTypes = nodeTypes();
function typeCheck(name: string): AnyFunction | undefined {
  if (utilTypes === undefined) return undefined;
  const fn: unknown = Reflect.get(utilTypes, name);
  return typeof fn === 'function' ? (fn as AnyFunction) : undefined;
}

const dateGetTime = method(Date.prototype, 'getTime');
const errorIsError: unknown = Reflect.get(Error, 'isError');
// `Error.isError` (Node 24 and later) and `util.types.isNativeError` (Node 20 to 22) both read the
// internal slot only, so they ignore `Symbol.toStringTag`.
const isNativeError = typeof errorIsError === 'function' ? undefined : typeCheck('isNativeError');
const isDate = typeCheck('isDate');
const isPromise = typeCheck('isPromise');
/** The built-ins `util.types` can recognize by slot: the thrown probes for them are not needed when all of these exist. */
const SLOT_CHECK_NAMES = ['isMap', 'isSet', 'isWeakMap', 'isWeakSet', 'isRegExp', 'isArrayBuffer', 'isSharedArrayBuffer', 'isBoxedPrimitive'];
const slotChecks: AnyFunction[] = [];
for (const name of SLOT_CHECK_NAMES) {
  const check = typeCheck(name);
  if (check !== undefined) slotChecks.push(check);
}
/**
 * True when every brand check is a slot check that runs no caller code and reads no property. An empty
 * object on any prototype (another realm's, or a custom one) can then be classified, and a thrown
 * TypeError is paid only for WeakRef and FinalizationRegistry.
 */
const pure =
  isDate !== undefined &&
  isPromise !== undefined &&
  slotChecks.length === SLOT_CHECK_NAMES.length &&
  (typeof errorIsError === 'function' || isNativeError !== undefined);

const probes: Probe[] = [];
function add(fn: AnyFunction | undefined, args: unknown[] = []): void {
  if (fn !== undefined) probes.push({ fn, args });
}
if (!pure) {
  add(getter(Map.prototype, 'size'));
  add(getter(Set.prototype, 'size'));
  add(method(WeakMap.prototype, 'has'), [sentinel]);
  add(method(WeakSet.prototype, 'has'), [sentinel]);
  add(getter(RegExp.prototype, 'source'));
  add(getter(ArrayBuffer.prototype, 'byteLength'));
  add(getter(globalProto('SharedArrayBuffer'), 'byteLength'));
  for (const name of ['Number', 'String', 'Boolean', 'Symbol', 'BigInt']) add(method(globalProto(name), 'valueOf'));
}
// `util.types` has no check for these two: they are always probed with a call that throws on anything else.
add(method(globalProto('WeakRef'), 'deref'));
add(method(globalProto('FinalizationRegistry'), 'unregister'), [sentinel]);
const promiseThen = method(Promise.prototype, 'then');
// eslint-disable-next-line @typescript-eslint/unbound-method -- captured once; always called with a receiver
const objectToString: (this: unknown) => string = Object.prototype.toString;
const objectConstructor = Object;

function succeeds(fn: AnyFunction, receiver: object, args: unknown[]): boolean {
  try {
    Reflect.apply(fn, receiver, args);
    return true;
  } catch {
    return false;
  }
}

/** What a built-in-looking object turned out to be. */
export type NativeKind = { date: number } | 'other' | undefined;

/** Does `key` appear as an own property anywhere on the prototype chain of `value`? Reads descriptors only. */
function chainHasKey(value: object, key: PropertyKey): boolean {
  let current: object | null = value;
  for (let depth = 0; current !== null; depth += 1) {
    if (depth >= 16) return true; // too deep to be sure: treat as present
    if (Reflect.getOwnPropertyDescriptor(current, key) !== undefined) return true;
    current = Reflect.getPrototypeOf(current);
  }
  return false;
}

/**
 * Is the realm's `Object.prototype` untouched in the ways the two preconditions
 * rely on: its `constructor` is still the original `Object`, `Object` has no
 * `Symbol.species` anywhere on its chain, and it has no `Symbol.toStringTag`?
 */
function objectPrototypeIsPristine(): boolean {
  try {
    const desc = Reflect.getOwnPropertyDescriptor(Object.prototype, 'constructor');
    if (desc === undefined || !isDataDescriptor(desc) || desc.value !== objectConstructor) return false;
    return !chainHasKey(objectConstructor, Symbol.species) && Reflect.getOwnPropertyDescriptor(Object.prototype, Symbol.toStringTag) === undefined;
  } catch {
    return false;
  }
}

/** What the caller already learned about the object while enumerating it. Omitted means "not read yet". */
export interface ShapeFacts {
  /** The object's own `constructor` descriptor (`undefined` inside means it has none). */
  constructorDesc?: { desc: PropertyDescriptor | undefined };
  /** Whether the object has an own `Symbol.toStringTag`. */
  hasOwnTag?: boolean;
}

/** `{ date }` when `object` is a real Date (any realm, any prototype), `undefined` when it is not. */
function dateKind(object: object): NativeKind {
  // With util.types a non-Date costs one slot check, not a thrown TypeError.
  if (dateGetTime === undefined || (isDate !== undefined && Reflect.apply(isDate, undefined, [object]) !== true)) return undefined;
  try {
    return { date: Reflect.apply(dateGetTime, object, []) as number };
  } catch {
    return undefined; // not a Date
  }
}

/**
 * Classify an object that looks empty (no own enumerable properties) and has a
 * plain-shaped prototype chain. `proto` is the object's prototype, read once by
 * the caller.
 *
 * Returns `{ date }` for a real Date (any realm, any prototype), `'other'` for a
 * built-in with internal state (Map, Set, RegExp, ArrayBuffer, typed arrays,
 * boxed primitives, Promise, WeakMap, Error and so on) and for any object that
 * cannot be ruled out, or `undefined` for an ordinary empty object. Nothing is
 * copied.
 *
 * With `util.types` every built-in but WeakRef and FinalizationRegistry is
 * recognized by a slot check, so an empty object on any prototype, another
 * realm's included, is ordinary when none matches, and the call costs two
 * thrown TypeErrors. Without it, an empty object whose prototype is neither
 * `null` nor this realm's `Object.prototype` cannot be ruled out (a Promise
 * could hide there), so it is `'other'`, and the call costs about fifteen
 * thrown TypeErrors (about 70 microseconds of CPU on a loaded machine).
 */
export function nativeKind(object: object, proto: object | null, facts: ShapeFacts): NativeKind {
  const date = dateKind(object);
  if (date !== undefined) return date;
  if (!pure && proto !== null && proto !== Object.prototype) return 'other';
  if (ArrayBuffer.isView(object)) return 'other';
  for (const check of slotChecks) if (Reflect.apply(check, undefined, [object]) === true) return 'other';
  for (const probe of probes) if (succeeds(probe.fn, object, probe.args)) return 'other';
  try {
    if (typeof errorIsError === 'function') {
      if (Reflect.apply(errorIsError, Error, [object]) === true) return 'other';
    } else if (isNativeError !== undefined) {
      if (Reflect.apply(isNativeError, undefined, [object]) === true) return 'other';
    } else {
      // Neither Error.isError nor util.types.isNativeError (Node before 20.16, or a
      // non-Node runtime without Error.isError). Object.prototype.toString reports "Error" from
      // the internal slot, but it also reads Symbol.toStringTag, so only use it where that
      // lookup cannot find anything: no own tag, and a null or untouched Object.prototype.
      const hasOwnTag = facts.hasOwnTag ?? Reflect.getOwnPropertyDescriptor(object, Symbol.toStringTag) !== undefined;
      if (hasOwnTag) return 'other';
      if (proto !== null && !objectPrototypeIsPristine()) return 'other';
      if (Reflect.apply(objectToString, object, []) === '[object Error]') return 'other';
    }
  } catch {
    return 'other'; // could not be ruled out
  }
  if (pure) {
    if (Reflect.apply(isPromise, undefined, [object]) === true) return 'other';
    return undefined;
  }
  if (promiseThen !== undefined) {
    // A Promise is only recognized by calling `then`, which then looks up
    // `constructor`. Call it only when that lookup provably cannot run caller code:
    // no own `constructor` (or an own data one holding undefined), and a prototype
    // that is null or the untouched Object.prototype.
    let constructorDesc: PropertyDescriptor | undefined;
    try {
      constructorDesc = facts.constructorDesc !== undefined ? facts.constructorDesc.desc : Reflect.getOwnPropertyDescriptor(object, 'constructor');
    } catch {
      return 'other';
    }
    const ownConstructorIsSafe = constructorDesc === undefined || (isDataDescriptor(constructorDesc) && constructorDesc.value === undefined);
    if (!ownConstructorIsSafe) return 'other';
    if (proto !== null && !objectPrototypeIsPristine()) return 'other';
    if (succeeds(promiseThen, object, [noop, noop])) return 'other';
  }
  return undefined;
}

/** A cheap check that never throws: typed arrays and DataViews. */
export function isBufferView(object: object): boolean {
  return ArrayBuffer.isView(object);
}
