import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalize } from './canonical-json.js';

// Vectors from RFC 8785, the JSON Canonicalization Scheme.
describe('canonicalize (RFC 8785)', () => {
  it('serializes the example in section 3.2.2', () => {
    const input: unknown = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units, as in section 3.2.3', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      דּ: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    };
    // Read keys from the text: JSON.parse would move the integer-like key "1" to the front.
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    expect(keys.map((k) => k.codePointAt(0)?.toString(16))).toEqual([
      'd',
      '31',
      '80',
      'f6',
      '20ac',
      '1f600',
      'fb33',
    ]);
    expect(canonicalize(input).startsWith('{"\\r":"Carriage Return","1":"One"')).toBe(true);
  });

  it('serializes numbers as ECMAScript does (appendix B)', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '0'],
      [1e21, '1e+21'],
      [1e-7, '1e-7'],
      [123456789012345680000, '123456789012345680000'],
      [9007199254740992, '9007199254740992'],
      [5e-324, '5e-324'],
      [-1.7976931348623157e308, '-1.7976931348623157e+308'],
    ];
    for (const [n, text] of cases) expect(canonicalize(n)).toBe(text);
  });

  it('keeps array order and nests objects', () => {
    expect(canonicalize({ b: [3, { y: 1, x: 2 }], a: 'z' })).toBe(
      '{"a":"z","b":[3,{"x":2,"y":1}]}',
    );
  });

  it('rejects values JSON cannot carry exactly', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, 1n, Symbol('s')]) {
      expect(() => canonicalize(bad)).toThrow(TypeError);
    }
    expect(() => canonicalize({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalize([undefined])).toThrow(TypeError);
    expect(() => canonicalize(new Date(0))).toThrow(TypeError);
    expect(() => canonicalize('\ud800')).toThrow(TypeError);
    expect(() => canonicalize({ ['\udc00']: 1 })).toThrow(TypeError);
  });

  it('encodes the canonical text as UTF-8', () => {
    expect(Array.from(canonicalBytes({ e: '€' }))).toEqual([
      0x7b, 0x22, 0x65, 0x22, 0x3a, 0x22, 0xe2, 0x82, 0xac, 0x22, 0x7d,
    ]);
  });
});
