// The tally part of a signed election record (docs/spec.md, "Election record"), and the pure half
// of the verifier: check the seed, the ballot order, and the engine, re-run the count, and diff it
// against the published result. Signature checking needs the platform's crypto and lives in
// src/cli.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalBytes, canonicalize } from './canonical-json.js';
import { assertSeed, seedCommitment } from './draw.js';
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
  /** Ballot contents only, no IDs, in canonical sorted order. */
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

export interface Check {
  name: 'seed' | 'ballot order' | 'engine' | 're-tally';
  ok: boolean;
  detail: string;
}

export interface RetallyReport {
  ok: boolean;
  checks: Check[];
  differences: Difference[];
  results: ElectionResults;
}

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;

function expectPattern(value: unknown, pattern: RegExp, path: string, what: string): void {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TallyInputError(path, `must be ${what}`);
  }
}

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

/** The record hash shown beside every result: SHA-256 of recordBytes, in hex. */
export function recordHash(record: ElectionRecord): string {
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
  const seed = expectObject(r.seed, 'record.seed', { required: ['commitment', 'revealed'] });
  assertSeed(seed.commitment, 'record.seed.commitment');
  assertSeed(seed.revealed, 'record.seed.revealed');
  validateBallots(election, r.castVoteRecords, 'record.castVoteRecords');
  r.castVoteRecords.forEach((ballot, i) => {
    if (canonicalize(inContestOrder(election, ballot)) !== canonicalize(ballot)) {
      throw new TallyInputError(
        `record.castVoteRecords[${i}]`,
        'must list Choose up to N selections in contest order',
      );
    }
  });
  const tally = expectObject(r.tally, 'record.tally', { required: ['engine', 'results'] });
  const engine = expectObject(tally.engine, 'record.tally.engine', {
    required: ['name', 'version'],
    optional: ['integrity'],
  });
  // Registry formats only, so nothing else can reach the `npm view` line the verifier prints.
  expectPattern(engine.name, NPM_NAME, 'record.tally.engine.name', 'an npm package name');
  expectPattern(engine.version, SEMVER, 'record.tally.engine.version', 'a semantic version');
  if (engine.integrity !== undefined) {
    expectPattern(engine.integrity, SHA512_SRI, 'record.tally.engine.integrity', 'sha512-<base64>');
  }
  if (!isPlainObject(tally.results)) {
    throw new TallyInputError('record.tally.results', 'must be an object');
  }
  try {
    canonicalize(tally.results);
  } catch (error) {
    throw new TallyInputError('record.tally.results', (error as Error).message);
  }
  return value as ElectionRecord;
}

export interface RetallyOptions {
  /**
   * The seed commitment published at Scheduled, from outside the record. Without it, the seed
   * check proves only that the record agrees with itself.
   */
  seedCommitment?: string;
}

export function retallyRecord(input: unknown, options: RetallyOptions = {}): RetallyReport {
  const record = parseRecord(input);
  if (options.seedCommitment !== undefined) assertSeed(options.seedCommitment, 'seedCommitment');
  const checks: Check[] = [];

  const hashed = seedCommitment(record.seed.revealed);
  const inRecord = record.seed.commitment;
  const published = options.seedCommitment;
  checks.push(
    hashed !== inRecord
      ? {
          name: 'seed',
          ok: false,
          detail: `the revealed seed hashes to ${hashed}, not the record's commitment ${inRecord}`,
        }
      : published === undefined
        ? {
            name: 'seed',
            ok: true,
            detail: `the revealed seed matches the record's commitment ${inRecord}; compare it with the commitment published before polls opened`,
          }
        : published === inRecord
          ? {
              name: 'seed',
              ok: true,
              detail: `the revealed seed matches the published commitment ${published}`,
            }
          : {
              name: 'seed',
              ok: false,
              detail: `the record's commitment ${inRecord} is not the published commitment ${published}`,
            },
  );

  const lines = record.castVoteRecords.map((b) => canonicalize(b));
  const outOfOrder = lines.findIndex((line, i) => i > 0 && byCodeUnits(lines[i - 1]!, line) > 0);
  checks.push(
    outOfOrder === -1
      ? {
          name: 'ballot order',
          ok: true,
          detail: `${lines.length} cast vote records in canonical order`,
        }
      : {
          name: 'ballot order',
          ok: false,
          detail: `cast vote record ${outOfOrder} is out of canonical order`,
        },
  );

  const { name, version } = record.tally.engine;
  checks.push(
    name === ENGINE.name && version === ENGINE.version
      ? {
          name: 'engine',
          ok: true,
          detail: `counted with ${name} ${version}, the version running here`,
        }
      : {
          name: 'engine',
          ok: false,
          detail: `counted with ${name} ${version}, but this is ${ENGINE.name} ${ENGINE.version}; verify with the version that counted it`,
        },
  );

  const results = tallyElection(record.election, record.castVoteRecords, record.seed.revealed);
  const differences = diffJson(record.tally.results, results, 'tally.results');
  checks.push(
    differences.length === 0
      ? {
          name: 're-tally',
          ok: true,
          detail: `${results.contests.length} of ${results.contests.length} contests match the published result`,
        }
      : {
          name: 're-tally',
          ok: false,
          detail: `${differences.length} difference(s) from the published result`,
        },
  );

  return { ok: checks.every((c) => c.ok), checks, differences, results };
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
