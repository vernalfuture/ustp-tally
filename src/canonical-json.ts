// The JSON Canonicalization Scheme (RFC 8785). Every hashed or signed payload goes through
// canonicalize, so any implementation reproduces the same bytes.
import { utf8ToBytes } from '@noble/hashes/utils.js';

export function canonicalize(value: unknown): string {
  return serialize(value);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return utf8ToBytes(serialize(value));
}

function serialize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`JSON cannot carry the number ${value}`);
    // ECMAScript's Number serialization is the one RFC 8785 specifies; it also turns -0 into 0.
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return serializeString(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>);
    // Default sort compares UTF-16 code units, which is what RFC 8785 requires.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${serializeString(k)}:${serialize(v)}`).join(',')}}`;
  }
  throw new TypeError(`JSON cannot carry a value of type ${typeof value}`);
}

function serializeString(text: string): string {
  if (!text.isWellFormed()) throw new TypeError('Strings must be well-formed Unicode');
  return JSON.stringify(text);
}
