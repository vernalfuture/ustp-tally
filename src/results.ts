// The results file, `ustp-election-results/1` (docs/spec.md, "Results file"). When an election
// keeps its cast vote records in the auditor tier, the tally record is auditor-only and the
// public tier carries this signed file instead: the election definition, the seed, the engine,
// the results, and the ballot count. Public data can check its seed, engine, and consistency, but
// not re-run the count, so its verdict is never `verified`.
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
import type { EngineId } from './engine.js';
import { TallyInputError } from './errors.js';
import { parseRecord, type ElectionRecord } from './record.js';
import type { ElectionDefinition, ElectionResults, Seed } from './types.js';
import { expectCount, expectObject, isPlainObject, validateElection } from './validate.js';

export const RESULTS_FORMAT = 'ustp-election-results/1';

export interface ResultsFile {
  format: typeof RESULTS_FORMAT;
  election: ElectionDefinition;
  seed: { commitment: string; revealed: Seed };
  /** Ballots counted, so readers can check every contest's total without seeing a ballot. */
  ballots: number;
  tally: { engine: EngineId; results: ElectionResults };
}

export interface ResultsReport {
  verdict: Verdict;
  checks: Check[];
}

/** The public results file for a tally record whose cast vote records stay in the auditor tier. */
export function resultsFile(record: ElectionRecord): ResultsFile {
  const r = parseRecord(record);
  return JSON.parse(
    canonicalize({
      format: RESULTS_FORMAT,
      election: r.election,
      seed: r.seed,
      ballots: r.castVoteRecords.length,
      tally: r.tally,
    }),
  ) as ResultsFile;
}

/** The bytes a results file's signature covers: its RFC 8785 form, as UTF-8. */
export function resultsBytes(file: ResultsFile): Uint8Array {
  return canonicalBytes(file);
}

/** SHA-256 of the results file's RFC 8785 bytes, in hex. */
export function resultsHash(file: ResultsFile): string {
  return bytesToHex(sha256(resultsBytes(file)));
}

/** Checks a results file parsed from JSON field by field, refusing anything it doesn't know. */
export function parseResultsFile(value: unknown): ResultsFile {
  const r = expectObject(value, 'results', {
    required: ['format', 'election', 'seed', 'ballots', 'tally'],
  });
  if (r.format !== RESULTS_FORMAT) {
    throw new TallyInputError('results.format', `must be ${RESULTS_FORMAT}`);
  }
  validateElection(r.election, 'results.election');
  expectSeedPair(r.seed, 'results.seed');
  expectCount(r.ballots, 'results.ballots');
  expectTally(r.tally, 'results.tally');
  return value as ResultsFile;
}

/** The first way the results disagree with the election or the ballot count, if any. */
function inconsistency(file: ResultsFile): string | undefined {
  const results: unknown = file.tally.results;
  if (!isPlainObject(results)) return 'tally.results is not an object';
  if (results.election !== file.election.id) {
    return `tally.results.election is not the election ${file.election.id}`;
  }
  if (results.ballots !== file.ballots) {
    return `tally.results.ballots is not the ballot count ${file.ballots}`;
  }
  const contests = results.contests;
  if (!Array.isArray(contests) || contests.length !== file.election.contests.length) {
    return `tally.results.contests does not have one result per contest`;
  }
  for (const [i, contest] of file.election.contests.entries()) {
    const result: unknown = contests[i];
    const where = `tally.results.contests[${i}]`;
    if (!isPlainObject(result)) return `${where} is not an object`;
    if (result.contest !== contest.id || result.method !== contest.method) {
      return `${where} is not the ${contest.method} contest ${contest.id}`;
    }
    if (result.ballots !== file.ballots) return `${where}.ballots is not the ballot count`;
  }
  return undefined;
}

export function checkResultsFile(input: unknown, options: PublishedValues = {}): ResultsReport {
  const file = parseResultsFile(input);
  assertPublished(options);
  const problem = inconsistency(file);
  const checks: Check[] = [
    seedCheck(file.seed, options.seedCommitment),
    engineCheck(file.tally.engine),
    problem === undefined
      ? {
          name: 'consistency',
          status: 'pass',
          detail: `${file.election.contests.length} contest results match the election, each over ${file.ballots} ballots`,
        }
      : { name: 'consistency', status: 'fail', detail: problem },
    {
      name: 're-tally',
      status: 'unchecked',
      detail: 'the cast vote records are in the auditor tier; only an auditor can re-run the count',
    },
  ];
  return { verdict: verdictOf(checks), checks };
}
