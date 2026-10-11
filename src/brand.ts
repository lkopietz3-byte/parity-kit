/**
 * Recognizing built-in objects by their internal slots, without asking the
 * object anything it can answer for itself. Each probe calls a captured
 * built-in method on the value; the method only succeeds on a real instance
 * of its type. Nothing here reads `Symbol.toStringTag`, `constructor`,
 * `toJSON`, or any other property, so the answer cannot depend on a mutable
 * prototype or on a getter, and no caller code runs, with one exception:
 * recognizing a Promise calls `then`, which looks up `constructor` on a
 * real Promise. That lookup is only attempted after a descriptor-only check
 * (no getter runs) shows it cannot throw; when the check cannot show that, the
 * object is classified as an unsupported built-in, never as plain data.
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
const promiseThen = method(Promise.prototype, 'then');
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

/** Run `fn` with error stack capture switched off. A failed probe throws, and capturing a stack is most of its cost. */
function withoutStackTraces<T>(fn: () => T): T {
  const errorConstructor = Error as unknown as { stackTraceLimit?: unknown };
  const saved = errorConstructor.stackTraceLimit;
  if (typeof saved !== 'number') return fn();
  try {
    errorConstructor.stackTraceLimit = 0;
  } catch {
    return fn(); // a frozen Error: just pay for the stacks
  }
  try {
    return fn();
  } finally {
    try {
      errorConstructor.stackTraceLimit = saved;
    } catch {
      // nothing to restore into
    }
  }
}

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
 * Can `Promise.prototype.then` look up `object.constructor` without throwing
 * or running a getter? True when no `constructor` exists on the chain, or the
 * first one is a data property holding undefined, a function or an object that
 * has no `Symbol.species` anywhere on its own chain. Reads descriptors only.
 */
function constructorLookupIsSafe(object: object): boolean {
  try {
    let current: object | null = object;
    for (let depth = 0; current !== null; depth += 1) {
      if (depth >= 16) return false;
      const desc = Reflect.getOwnPropertyDescriptor(current, 'constructor');
      if (desc !== undefined) {
        if (!('value' in desc)) return false;
        const value: unknown = desc.value;
        if (value === undefined) return true;
        if ((typeof value !== 'function' && typeof value !== 'object') || value === null) return false;
        return !chainHasKey(value, Symbol.species);
      }
      current = Reflect.getPrototypeOf(current);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * `{ date }` for a real Date (any realm, any prototype), `'other'` for any
 * other built-in with internal state (Map, Set, RegExp, ArrayBuffer, typed
 * arrays, boxed primitives, Promise, WeakMap, Error and so on) and for any
 * object this cannot rule out being one, or `undefined` for an ordinary
 * object. Nothing is copied and no property of the object is read. A failed
 * probe throws internally, which is slow, so this is meant for objects that
 * are not the common case.
 */
export function nativeKind(object: object): NativeKind {
  return withoutStackTraces((): NativeKind => {
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
        return 'other'; // could not be ruled out
      }
    }
    for (const probe of probes) if (succeeds(probe.fn, object, probe.args)) return 'other';
    if (promiseThen !== undefined) {
      // A Promise is only recognized by calling `then`, which can fail after it has
      // recognized the brand (a bad `constructor`). So only call it when that cannot
      // happen; otherwise the object cannot be ruled out and is unsupported.
      if (!constructorLookupIsSafe(object)) return 'other';
      if (succeeds(promiseThen, object, [noop, noop])) return 'other';
    }
    return undefined;
  });
}

/** A cheap check that never throws: typed arrays and DataViews. */
export function isBufferView(object: object): boolean {
  return ArrayBuffer.isView(object);
}
