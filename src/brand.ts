/**
 * Recognizing built-in objects by their internal slots, without asking the
 * object anything it can answer for itself. Each probe calls a captured
 * built-in method on the value; the method only succeeds on a real instance
 * of its type. Nothing here reads `Symbol.toStringTag`, `constructor`,
 * `toJSON`, or any other property, so the answer cannot depend on a mutable
 * prototype or on a getter, and no caller code runs, with one exception:
 * recognizing a Promise calls `then`, which looks up `constructor` on a
 * real Promise.
 */
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

const probes: Probe[] = [];
function add(fn: AnyFunction | undefined, args: unknown[] = []): void {
  if (fn !== undefined) probes.push({ fn, args });
}

const dateGetTime = method(Date.prototype, 'getTime');
add(getter(Map.prototype, 'size'));
add(getter(Set.prototype, 'size'));
add(method(WeakMap.prototype, 'has'), [sentinel]);
add(method(WeakSet.prototype, 'has'), [sentinel]);
add(getter(RegExp.prototype, 'source'));
add(getter(ArrayBuffer.prototype, 'byteLength'));
add(getter(globalProto('SharedArrayBuffer'), 'byteLength'));
for (const name of ['Number', 'String', 'Boolean', 'Symbol', 'BigInt']) add(method(globalProto(name), 'valueOf'));
add(method(globalProto('WeakRef'), 'deref'));
add(method(globalProto('FinalizationRegistry'), 'unregister'), [sentinel]);
add(method(Promise.prototype, 'then'), [noop, noop]);
const errorIsError: unknown = Reflect.get(Error, 'isError');

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

/**
 * `{ date }` for a real Date (any realm, any prototype), `'other'` for any
 * other built-in with internal state (Map, Set, RegExp, ArrayBuffer, typed
 * arrays, boxed primitives, Promise, WeakMap, Error and so on), or
 * `undefined` for an ordinary object. A failed probe throws internally, so
 * this is meant for objects that are not the common case.
 */
export function nativeKind(object: object): NativeKind {
  if (dateGetTime !== undefined) {
    try {
      return { date: Reflect.apply(dateGetTime, object, []) as number };
    } catch {
      // not a Date
    }
  }
  if (ArrayBuffer.isView(object)) return 'other';
  if (typeof errorIsError === 'function') {
    try {
      if (Reflect.apply(errorIsError, Error, [object]) === true) return 'other';
    } catch {
      // ignore
    }
  }
  for (const probe of probes) if (succeeds(probe.fn, object, probe.args)) return 'other';
  return undefined;
}

/** A cheap check that never throws: typed arrays and DataViews. */
export function isBufferView(object: object): boolean {
  return ArrayBuffer.isView(object);
}

const structuredCloneFn: unknown = Reflect.get(globalThis, 'structuredClone');

/**
 * Like `nativeKind`, for an object that has no enumerable own properties
 * (most often a plain `{}`), without throwing for the common case. It asks the
 * host's structured clone to copy the object: an ordinary empty object comes
 * back as an ordinary empty object, and a built-in comes back as that
 * built-in (a Map as a Map, a Date as a Date). Cloning runs no getter because
 * there is no enumerable property to read. Anything the host cannot clone (a
 * Proxy, a Promise, a WeakMap) falls back to `nativeKind`.
 */
export function emptyObjectKind(object: object): NativeKind {
  if (typeof structuredCloneFn !== 'function') return nativeKind(object);
  let clone: unknown;
  try {
    clone = Reflect.apply(structuredCloneFn, globalThis, [object]);
  } catch {
    return nativeKind(object);
  }
  if (typeof clone !== 'object' || clone === null) return nativeKind(object);
  if (Reflect.getPrototypeOf(clone) === Object.prototype && Reflect.ownKeys(clone).length === 0) return undefined;
  return nativeKind(clone);
}
