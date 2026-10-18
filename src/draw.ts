// The seeded draw that settles ties no count can (docs/spec.md, "Seeded draw"). The seed is
// committed by its SHA-256 before polls open and revealed only at tally time, so no one can pick
// it after seeing ballots. The draw depends only on the seed and the draw's context, never on
// ballots.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { canonicalBytes } from './canonical-json.js';
import { TallyInputError } from './errors.js';
import type { CandidateId, ContestId, Seed } from './types.js';

export type DrawContext =
  | { contest: ContestId; purpose: 'seat' }
  | { contest: ContestId; purpose: 'eliminate'; round: number };

const SEED_PATTERN = /^[0-9a-f]{64}$/;

export function assertSeed(seed: unknown, path = 'seed'): asserts seed is Seed {
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) {
    throw new TallyInputError(path, 'must be 32 bytes as 64 lowercase hex digits');
  }
}

/** The SHA-256 of the seed's bytes, in lowercase hex, as published before polls open. */
export function seedCommitment(seed: Seed): string {
  assertSeed(seed);
  return bytesToHex(sha256(hexToBytes(seed)));
}

/**
 * Orders tied candidates from most to least favored. Each candidate's key is
 * HMAC-SHA-256(seed, RFC 8785 JSON of the context plus the candidate), and lower keys come first.
 */
export function drawOrder(
  seed: Seed,
  context: DrawContext,
  candidates: readonly CandidateId[],
): CandidateId[] {
  assertSeed(seed);
  if (new Set(candidates).size !== candidates.length) {
    throw new TallyInputError('draw', 'tied candidates must be distinct');
  }
  const key = hexToBytes(seed);
  const keyed = candidates.map((candidate) => ({
    candidate,
    key: bytesToHex(hmac(sha256, key, canonicalBytes({ ...context, candidate }))),
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((k) => k.candidate);
}
