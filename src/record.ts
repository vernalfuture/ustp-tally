// The tally record, `ustp-election-record/1` (docs/spec.md, "Tally record"), and the pure half of
// the verifier: check the seed, the ballot order, and the engine, re-run the count, and diff it
// against the published result. Signature checking needs the platform's crypto and lives in
// src/cli.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalBytes, canonicalize } from './canonical-json.js';
import {
  assertPublished,
  engineCheck,
  expectSeedPair,
  expectTally,
  seedCheck,
  verdictOf,
  type Check,
  type PublishedValues,
  type Verdict,
} from './checks.js';
import { seedCommitment } from './draw.js';
import { ENGINE, type EngineId } from './engine.js';
import { TallyInputError } from './errors.js';
import { tallyElection } from './tally.js';
import type { Ballot, ElectionDefinition, ElectionResults, Seed } from './types.js';
import { expectObject, isPlainObject, validateBallots, validateElection } from './validate.js';

export const RECORD_FORMAT = 'ustp-election-record/1';

export interface ElectionRecord {
  format: typeof RECORD_FORMAT;
  election: ElectionDefinition;
  seed: { commitment: string; revealed: Seed };
  /** Ballot contents only, no IDs, in canonical form. */
  castVoteRecords: Ballot[];
  tally: { engine: EngineId; results: ElectionResults };
}

export interface Difference {
  path: string;
  /** What the record says. */
  expected: unknown;
  /** What the re-tally found. */
  found: unknown;
}

export interface RetallyReport {
  verdict: Verdict;
  checks: Check[];
  differences: Difference[];
  results: ElectionResults;
}

export type RetallyOptions = PublishedValues;

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A Choose up to N selection in contest candidate order, so the order a voter clicked in is lost. */
function inContestOrder(election: ElectionDefinition, ballot: Ballot): Ballot {
  const contests: Ballot['contests'] = {};
  for (const contest of election.contests) {
    if (!Object.hasOwn(ballot.contests, contest.id)) continue;
    const selection = ballot.contests[contest.id]!;
    if (contest.method === 'choose-n' && Array.isArray(selection)) {
      const chosen = new Set(selection);
      contests[contest.id] = contest.candidates.filter((c) => chosen.has(c));
    } else {
      contests[contest.id] = selection;
    }
  }
  return { contests };
}

/**
 * Cast vote records in canonical form: each Choose up to N selection in contest candidate order,
 * and the ballots sorted by their RFC 8785 text, compared by UTF-16 code units.
 */
export function canonicalBallots(
  election: ElectionDefinition,
  ballots: readonly Ballot[],
): Ballot[] {
  validateElection(election);
  validateBallots(election, ballots);
  return ballots
    .map((b) => canonicalize(inContestOrder(election, b)))
    .sort(byCodeUnits)
    .map((text) => JSON.parse(text) as Ballot);
}

export function createRecord(input: {
  election: ElectionDefinition;
  ballots: readonly Ballot[];
  seed: Seed;
  /** The commitment published at Scheduled. The seed must match it. */
  seedCommitment: string;
}): ElectionRecord {
  const commitment = seedCommitment(input.seed);
  if (input.seedCommitment !== commitment) {
    throw new TallyInputError('seedCommitment', 'does not match the SHA-256 of the seed');
  }
  const results = tallyElection(input.election, input.ballots, input.seed);
  return {
    format: RECORD_FORMAT,
    election: JSON.parse(canonicalize(input.election)) as ElectionDefinition,
    seed: { commitment, revealed: input.seed },
    castVoteRecords: canonicalBallots(input.election, input.ballots),
    tally: { engine: { ...ENGINE }, results },
  };
}

/** The bytes a record's signature covers: the record in RFC 8785 form, as UTF-8. */
export function recordBytes(record: ElectionRecord): Uint8Array {
  return canonicalBytes(record);
}

/**
 * The tally hash: SHA-256 of the tally record's RFC 8785 bytes, in hex. The election's record
 * hash is the hash of its public index, which names this file.
 */
export function tallyHash(record: ElectionRecord): string {
  return bytesToHex(sha256(recordBytes(record)));
}

/** Checks a record parsed from JSON field by field, refusing anything it doesn't know. */
export function parseRecord(value: unknown): ElectionRecord {
  const r = expectObject(value, 'record', {
    required: ['format', 'election', 'seed', 'castVoteRecords', 'tally'],
  });
  if (r.format !== RECORD_FORMAT) {
    throw new TallyInputError('record.format', `must be ${RECORD_FORMAT}`);
  }
  const election: unknown = r.election;
  validateElection(election, 'record.election');
  expectSeedPair(r.seed, 'record.seed');
  validateBallots(election, r.castVoteRecords, 'record.castVoteRecords');
  r.castVoteRecords.forEach((ballot, i) => {
    if (canonicalize(inContestOrder(election, ballot)) !== canonicalize(ballot)) {
      throw new TallyInputError(
        `record.castVoteRecords[${i}]`,
        'must list Choose up to N selections in contest order',
      );
    }
  });
  expectTally(r.tally, 'record.tally');
  return value as ElectionRecord;
}

/**
 * Re-runs the count from a tally record. The verdict is `verified` only when every check passes,
 * which needs the seed commitment published before polls opened: without it the seed check is
 * unchecked and the verdict at best `incomplete`.
 */
export function retallyRecord(input: unknown, options: RetallyOptions = {}): RetallyReport {
  const record = parseRecord(input);
  assertPublished(options);
  const checks: Check[] = [seedCheck(record.seed, options.seedCommitment)];

  const lines = record.castVoteRecords.map((b) => canonicalize(b));
  const outOfOrder = lines.findIndex((line, i) => i > 0 && byCodeUnits(lines[i - 1]!, line) > 0);
  checks.push(
    outOfOrder === -1
      ? {
          name: 'ballot order',
          status: 'pass',
          detail: `${lines.length} cast vote records in canonical order`,
        }
      : {
          name: 'ballot order',
          status: 'fail',
          detail: `cast vote record ${outOfOrder} is out of canonical order`,
        },
  );

  checks.push(engineCheck(record.tally.engine));

  const results = tallyElection(record.election, record.castVoteRecords, record.seed.revealed);
  const differences = diffJson(record.tally.results, results, 'tally.results');
  checks.push(
    differences.length === 0
      ? {
          name: 're-tally',
          status: 'pass',
          detail: `${results.contests.length} of ${results.contests.length} contests match the published result`,
        }
      : {
          name: 're-tally',
          status: 'fail',
          detail: `${differences.length} difference(s) from the published result`,
        },
  );

  return { verdict: verdictOf(checks), checks, differences, results };
}

/** Every leaf where `found` differs from `expected`, with its path. */
export function diffJson(expected: unknown, found: unknown, path: string): Difference[] {
  if (Array.isArray(expected) && Array.isArray(found)) {
    const length = Math.max(expected.length, found.length);
    return Array.from({ length }, (_, i) =>
      diffJson(expected[i], found[i], `${path}[${i}]`),
    ).flat();
  }
  if (isPlainObject(expected) && isPlainObject(found)) {
    // Own fields only, so a field named like a built-in (constructor) compares like any other.
    const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
    const keys = [
      ...Object.keys(expected),
      ...Object.keys(found).filter((k) => !Object.hasOwn(expected, k)),
    ];
    return keys.flatMap((k) => diffJson(own(expected, k), own(found, k), `${path}.${k}`));
  }
  return Object.is(expected, found) ? [] : [{ path, expected, found }];
}
