import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical-json.js';
import { drawOrder, seedCommitment } from './draw.js';
import { TallyInputError } from './errors.js';

const seed = '3a7f0c9e14b2d85f6e0a1c3b5d7f9e2a4c6e8a0b2d4f6a8c0e2a4c6e8b0d2f41';

// An independent implementation of the documented draw, using Node's own HMAC.
function referenceOrder(
  context: { contest: string; purpose: string; round?: number },
  candidates: string[],
): string[] {
  const key = (candidate: string) =>
    createHmac('sha256', Buffer.from(seed, 'hex'))
      .update(canonicalize({ ...context, candidate }), 'utf8')
      .digest('hex');
  return [...candidates].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

describe('seedCommitment', () => {
  it('is the SHA-256 of the seed bytes, in hex', () => {
    expect(seedCommitment(seed)).toBe(
      createHash('sha256').update(Buffer.from(seed, 'hex')).digest('hex'),
    );
  });

  it('rejects anything but 64 lowercase hex digits', () => {
    for (const bad of ['', 'ab', seed.toUpperCase(), `${seed}00`, `${seed.slice(0, 63)}g`]) {
      expect(() => seedCommitment(bad)).toThrow(TallyInputError);
    }
  });
});

describe('drawOrder', () => {
  it('orders candidates by HMAC-SHA-256 of the canonical draw message, keyed by the seed', () => {
    const candidates = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    expect(drawOrder(seed, { contest: 'c1', purpose: 'eliminate', round: 3 }, candidates)).toEqual(
      referenceOrder({ contest: 'c1', purpose: 'eliminate', round: 3 }, candidates),
    );
    expect(drawOrder(seed, { contest: 'c1', purpose: 'seat' }, candidates)).toEqual(
      referenceOrder({ contest: 'c1', purpose: 'seat' }, candidates),
    );
  });

  it('does not depend on the order the tied candidates arrive in', () => {
    const context = { contest: 'board', purpose: 'seat' } as const;
    expect(drawOrder(seed, context, ['x', 'y', 'z'])).toEqual(
      drawOrder(seed, context, ['z', 'x', 'y']),
    );
  });

  it('gives each round and contest its own draw', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => `c${i}`);
    const orders = new Set(
      [1, 2, 3, 4].map((round) =>
        drawOrder(seed, { contest: 'chair', purpose: 'eliminate', round }, candidates).join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('rejects a bad seed or a duplicate candidate', () => {
    expect(() => drawOrder('00', { contest: 'c', purpose: 'seat' }, ['a', 'b'])).toThrow(
      TallyInputError,
    );
    expect(() => drawOrder(seed, { contest: 'c', purpose: 'seat' }, ['a', 'a'])).toThrow(
      TallyInputError,
    );
  });
});
