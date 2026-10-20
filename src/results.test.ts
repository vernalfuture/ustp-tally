// The public results file, for elections that keep cast vote records in the auditor tier
// (ADR 0016 in the USTP Hub monorepo, "Auditor-only cast vote records").
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical-json.js';
import { seedCommitment } from './draw.js';
import { ENGINE } from './engine.js';
import { TallyInputError } from './errors.js';
import { createRecord } from './record.js';
import {
  checkResultsFile,
  parseResultsFile,
  RESULTS_FORMAT,
  resultsFile,
  resultsHash,
  type ResultsFile,
} from './results.js';
import { ballotsFor, SEED } from './test-support/ballots.js';
import type { ElectionDefinition } from './types.js';

const election: ElectionDefinition = {
  id: 'e1',
  contests: [
    { id: 'p1', method: 'proposal', passRule: 'simple-majority' },
    { id: 'chair', method: 'instant-runoff', candidates: ['a', 'b', 'c'], maxRanks: 3 },
  ],
};
const ballots = [
  ...ballotsFor('chair', [
    [['a'], 5],
    [['b', 'a'], 2],
  ]),
  ...ballotsFor('p1', [
    ['yes', 3],
    ['no', 1],
  ]),
];
const COMMITMENT = seedCommitment(SEED);
const record = createRecord({ election, ballots, seed: SEED, seedCommitment: COMMITMENT });
const fresh = (): ResultsFile => JSON.parse(JSON.stringify(resultsFile(record))) as ResultsFile;
const published = { seedCommitment: COMMITMENT };

describe('resultsFile', () => {
  it('holds the election, the seed, the engine, the results, and the ballot count, with no ballots', () => {
    expect(resultsFile(record)).toEqual({
      format: RESULTS_FORMAT,
      election: record.election,
      seed: record.seed,
      ballots: 11,
      tally: record.tally,
    });
    expect(canonicalize(resultsFile(record))).not.toContain('castVoteRecords');
  });

  it('has its own hash, the SHA-256 of its RFC 8785 form', () => {
    expect(resultsHash(fresh())).toBe(
      createHash('sha256').update(canonicalize(fresh()), 'utf8').digest('hex'),
    );
  });
});

describe('checkResultsFile', () => {
  it('checks everything public data allows, and never reports verified', () => {
    const report = checkResultsFile(fresh(), published);
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ['seed', 'pass'],
      ['engine', 'pass'],
      ['consistency', 'pass'],
      ['re-tally', 'unchecked'],
    ]);
    expect(report.checks[3]?.detail).toContain('auditor tier');
    expect(report.verdict).toBe('incomplete');
  });

  it('leaves the seed unchecked without the published commitment', () => {
    expect(checkResultsFile(fresh()).checks[0]).toMatchObject({
      name: 'seed',
      status: 'unchecked',
    });
  });

  it('fails a seed that is not the published one', () => {
    const report = checkResultsFile(fresh(), { seedCommitment: seedCommitment('1'.repeat(64)) });
    expect(report.checks[0]?.status).toBe('fail');
    expect(report.verdict).toBe('failed');
  });

  it('fails a ballot count the results disagree with', () => {
    const file = fresh();
    file.ballots = 12;
    const report = checkResultsFile(file, published);
    expect(report.checks[2]).toMatchObject({ name: 'consistency', status: 'fail' });
    expect(report.verdict).toBe('failed');
  });

  it('fails results that do not match the election, contest by contest', () => {
    const edits: ((f: ResultsFile) => void)[] = [
      (f) => (f.tally.results.election = 'e2'),
      (f) => f.tally.results.contests.reverse(),
      (f) => f.tally.results.contests.pop(),
      (f) => ((f.tally.results.contests[0] as { method: string }).method = 'choose-n'),
      (f) => ((f.tally.results.contests[1] as { ballots: number }).ballots = 10),
    ];
    for (const edit of edits) {
      const file = fresh();
      edit(file);
      expect(checkResultsFile(file, published).checks[2]).toMatchObject({
        name: 'consistency',
        status: 'fail',
      });
    }
  });

  it('fails results counted by another engine version', () => {
    const file = fresh();
    file.tally.engine = { ...ENGINE, version: '0.0.9' };
    expect(checkResultsFile(file, published).checks[1]).toMatchObject({
      name: 'engine',
      status: 'fail',
    });
  });
});

describe('parseResultsFile', () => {
  it('round-trips through JSON', () => {
    expect(parseResultsFile(fresh())).toEqual(resultsFile(record));
  });

  it('refuses ballots, unknown fields, another format, or a bad engine', () => {
    const base = fresh() as unknown as Record<string, unknown>;
    for (const bad of [
      { ...base, castVoteRecords: [] },
      { ...base, format: 'ustp-election-record/1' },
      { ...base, ballots: -1 },
      { ...base, tally: { ...fresh().tally, engine: { name: 'ustp tally', version: '0.1.0' } } },
    ]) {
      expect(() => parseResultsFile(bad)).toThrow(TallyInputError);
    }
  });
});
