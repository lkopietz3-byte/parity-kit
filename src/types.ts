/** A record identifier. Strings and finite numbers are accepted; `1` and `"1"` are different keys. */
export type Key = string | number;

/** Hard limits that bound the work done on hostile input. All are optional. */
export interface Limits {
  /** Most records read from one dataset. Default 1,000,000. */
  maxRecords?: number;
  /** Most values read across one call, counting every nested value. Arrays and objects are capped at a fifth of this. Default 10,000,000. */
  maxNodes?: number;
  /** Deepest nesting inside one record (record fields are depth 1). Default 64, at most 1000. */
  maxDepth?: number;
  /** Longest string key, in UTF-16 units. Longer keys are refused as invalid records. Default 4,096, at most 1,048,576. */
  maxKeyLength?: number;
}

export type InvalidReason =
  | 'empty-dataset' // the dataset has no records and allowEmpty is not set
  | 'hole' // an array slot with no value
  | 'not-an-object' // a primitive, null or an array where a record belongs
  | 'not-a-plain-object' // a Date, Map, class instance or other non-JSON object
  | 'missing-key' // the key field is absent
  | 'bad-key' // the key is not a non-empty string or a finite number
  | 'key-too-long' // a string key longer than limits.maxKeyLength
  | 'key-unnormalizable' // a key with a run of more than 32 combining marks
  | 'key-mismatch' // an object-keyed record carries a key field that disagrees with its property name
  | 'unreadable' // a Proxy trap or getter threw while reading
  | 'unsupported-value' // a function, symbol or non-JSON object inside the record
  | 'too-deep' // nesting deeper than maxDepth
  | 'cycle'; // the record contains itself

/** A record (or a whole dataset) that could not be read. It is "can't tell", never a pass. */
export interface InvalidEntry {
  side: string;
  /** Array index, property name, or null when the whole dataset is the problem. */
  position: number | string | null;
  /** The record's key, when it could be read. */
  id?: Key;
  reason: InvalidReason;
  /** Where inside the record the problem was, for example `terms[2].rate`. */
  path?: string;
  detail?: string;
}

/** The same key appearing on more than one record in one dataset. */
export interface DuplicateKey {
  side: string;
  id: Key;
  positions: Array<number | string>;
}

/**
 * Keys that differ in the raw bytes but would look the same to a person:
 * different Unicode normalization, case, zero-width or whitespace characters,
 * dash variants, a few Cyrillic or Greek look-alike letters, or `1` versus `"1"`.
 * They are listed, never merged.
 */
export interface SuspectKeyGroup {
  /** The shared normalized form the keys collapse to. */
  skeleton: string;
  /** Keys, by dataset side name, in order of first appearance. */
  keys: Array<{ side: string; key: Key }>;
}
