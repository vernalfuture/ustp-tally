import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical-json.js';
import { seedCommitment } from './draw.js';
import { ENGINE } from './engine.js';
import { TallyInputError } from './errors.js';
import {
  canonicalBallots,
  createRecord,
  diffJson,
  parseRecord,
  RECORD_FORMAT,
  retallyRecord,
  tallyHash,
  type ElectionRecord,
} from './record.js';
import { tallyElection } from './tally.js';
import { ballotsFor, SEED } from './test-support/ballots.js';
import type { Ballot, ElectionDefinition } from './types.js';

const election: ElectionDefinition = {
  id: 'e1',
  contests: [
    { id: 'p1', method: 'proposal', passRule: 'simple-majority' },
    { id: 'chair', method: 'instant-runoff', candidates: ['a', 'b', 'c'], maxRanks: 3 },
    { id: 'board', method: 'choose-n', candidates: ['x', 'y', 'z'], seats: 2, maxSelections: 3 },
  ],
};
const ballots: Ballot[] = [
  ...ballotsFor('chair', [
    [['c', 'b'], 3],
    [['a'], 5],
    [['b'], 2],
    [['c'], 1],
  ]),
  { contests: { p1: 'yes', chair: ['b', 'a'], board: ['z', 'x'] } },
  { contests: { p1: 'no', board: ['y'] } },
];
const COMMITMENT = seedCommitment(SEED);

function fresh(): ElectionRecord {
  return createRecord({ election, ballots, seed: SEED, seedCommitment: COMMITMENT });
}

describe('createRecord', () => {
  it('holds the cast vote records in canonical order, the seed, the engine, and the tally', () => {
    const record = fresh();
    expect(record.format).toBe(RECORD_FORMAT);
    expect(record.seed).toEqual({ commitment: COMMITMENT, revealed: SEED });
    expect(record.castVoteRecords).toEqual(canonicalBallots(election, ballots));
    const lines = record.castVoteRecords.map(canonicalize);
    expect(lines).toEqual([...lines].sort());
    expect(record.tally).toEqual({
      engine: ENGINE,
      results: tallyElection(election, ballots, SEED),
    });
  });

  it('lists Choose up to N selections in contest order, so click order is never published', () => {
    const record = fresh();
    const boards = record.castVoteRecords.map((b) => b.contests.board).filter(Boolean);
    expect(boards).toContainEqual(['x', 'z']);
    expect(boards).not.toContainEqual(['z', 'x']);
  });

  it('requires the published seed commitment, and refuses a seed that does not match it', () => {
    expect(() => createRecord({ election, ballots, seed: SEED } as never)).toThrow(TallyInputError);
    expect(() =>
      createRecord({
        election,
        ballots,
        seed: SEED,
        seedCommitment: seedCommitment('0'.repeat(64)),
      }),
    ).toThrow(TallyInputError);
  });
});

describe('tallyHash', () => {
  it('is the SHA-256 of the tally record in RFC 8785 form', () => {
    const record = fresh();
    expect(tallyHash(record)).toBe(
      createHash('sha256').update(canonicalize(record), 'utf8').digest('hex'),
    );
  });
});

describe('retallyRecord', () => {
  const published = { seedCommitment: COMMITMENT };

  it('verifies an untouched record against the published seed commitment', () => {
    const report = retallyRecord(fresh(), published);
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ['seed', 'pass'],
      ['ballot order', 'pass'],
      ['engine', 'pass'],
      ['re-tally', 'pass'],
    ]);
    expect(report.verdict).toBe('verified');
    expect(report.differences).toEqual([]);
  });

  it('never reports verified without the published seed commitment', () => {
    const report = retallyRecord(fresh());
    expect(report.checks[0]).toMatchObject({
      name: 'seed',
      status: 'unchecked',
      detail: expect.stringContaining('agrees with itself') as string,
    });
    expect(report.checks.slice(1).every((c) => c.status === 'pass')).toBe(true);
    expect(report.verdict).toBe('incomplete');
  });

  it('fails a seed picked after the published commitment', () => {
    // An operator who picked a seed after seeing ballots can write its own hash into the record.
    const regenerated = createRecord({
      election,
      ballots,
      seed: 'a'.repeat(64),
      seedCommitment: seedCommitment('a'.repeat(64)),
    });
    expect(retallyRecord(regenerated).verdict).toBe('incomplete');
    const report = retallyRecord(regenerated, published);
    expect(report.checks[0]).toMatchObject({ name: 'seed', status: 'fail' });
    expect(report.verdict).toBe('failed');
  });

  it('finds a ballot changed after the count', () => {
    const record = fresh();
    const changed = record.castVoteRecords.find((b) => b.contests.p1 === 'no')!;
    changed.contests.p1 = 'yes';
    record.castVoteRecords = canonicalBallots(election, record.castVoteRecords);
    const report = retallyRecord(record, published);
    expect(report.verdict).toBe('failed');
    expect(report.checks.find((c) => c.name === 're-tally')?.status).toBe('fail');
    expect(report.differences).toContainEqual({
      path: 'tally.results.contests[0].counts.yes',
      expected: 1,
      found: 2,
    });
  });

  it('finds an edited published result', () => {
    const record = fresh();
    const chair = record.tally.results.contests[1]!;
    if (chair.method !== 'instant-runoff') throw new Error();
    chair.winner = 'c';
    const report = retallyRecord(record, published);
    expect(report.verdict).toBe('failed');
    expect(report.differences).toEqual([
      { path: 'tally.results.contests[1].winner', expected: 'c', found: 'a' },
    ]);
  });

  it('finds a seed swapped after the commitment, with or without the published one', () => {
    const record = fresh();
    record.seed.revealed = 'f'.repeat(64);
    for (const report of [retallyRecord(record), retallyRecord(record, published)]) {
      expect(report.checks[0]).toMatchObject({ name: 'seed', status: 'fail' });
      expect(report.verdict).toBe('failed');
    }
  });

  it('finds cast vote records out of canonical order', () => {
    const record = fresh();
    record.castVoteRecords.reverse();
    expect(retallyRecord(record, published).checks[1]).toMatchObject({
      name: 'ballot order',
      status: 'fail',
    });
  });

  it('finds a record counted by another engine version', () => {
    const record = fresh();
    record.tally.engine = { name: 'ustp-tally', version: '0.0.9' };
    const engine = retallyRecord(record, published).checks[2]!;
    expect(engine).toMatchObject({ name: 'engine', status: 'fail' });
    expect(engine.detail).toContain('0.0.9');
  });
});

describe('parseRecord', () => {
  it('round-trips a record through JSON', () => {
    const record = fresh();
    expect(parseRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it('refuses unknown fields, another format, or a malformed ballot', () => {
    const base = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    for (const bad of [
      { ...base, extra: 1 },
      { ...base, format: 'ustp-election-record/2' },
      { ...base, castVoteRecords: [{ contests: { p1: 'maybe' } }] },
      { ...base, seed: { commitment: 'x', revealed: SEED } },
      { ...base, tally: { engine: ENGINE } },
    ]) {
      expect(() => parseRecord(bad)).toThrow(TallyInputError);
    }
  });

  it('refuses Choose up to N selections that are not in contest order', () => {
    const record = JSON.parse(JSON.stringify(fresh())) as ElectionRecord;
    record.castVoteRecords = [{ contests: { board: ['z', 'x'] } }];
    expect(() => parseRecord(record)).toThrow(/contest order/);
  });

  it('refuses an engine name, version, or build hash that is not in its registry format', () => {
    const integrity = `sha512-${'A'.repeat(86)}==`;
    expect(() =>
      parseRecord({ ...fresh(), tally: { ...fresh().tally, engine: { ...ENGINE, integrity } } }),
    ).not.toThrow();
    for (const engine of [
      { ...ENGINE, version: '0.1.0; sh' },
      { ...ENGINE, version: '01.0.0' },
      { ...ENGINE, name: 'ustp tally' },
      { ...ENGINE, name: 'Ustp-Tally' },
      { ...ENGINE, integrity: 'sha512-AAAA' },
      { ...ENGINE, integrity: `sha256-${'A'.repeat(43)}=` },
    ]) {
      const record = fresh();
      record.tally.engine = engine;
      expect(() => parseRecord(record)).toThrow(TallyInputError);
    }
  });

  it('refuses results that JSON cannot carry exactly', () => {
    const record = JSON.parse(JSON.stringify(fresh())) as ElectionRecord;
    (record.tally.results.contests[0] as { ballots: number }).ballots = Infinity;
    expect(() => parseRecord(record)).toThrow(TallyInputError);
  });
});

describe('diffJson', () => {
  it('reports each differing leaf with its path', () => {
    expect(diffJson({ a: [1, { b: 2 }], c: 'x' }, { a: [1, { b: 3 }], d: true }, 'r')).toEqual([
      { path: 'r.a[1].b', expected: 2, found: 3 },
      { path: 'r.c', expected: 'x', found: undefined },
      { path: 'r.d', expected: undefined, found: true },
    ]);
    expect(diffJson([1, 2], [1], 'r')).toEqual([{ path: 'r[1]', expected: 2, found: undefined }]);
  });

  it('compares only own fields, even ones named like built-ins', () => {
    expect(diffJson({}, { constructor: 1 }, 'r')).toEqual([
      { path: 'r.constructor', expected: undefined, found: 1 },
    ]);
    expect(diffJson({ toString: 1 }, {}, 'r')).toEqual([
      { path: 'r.toString', expected: 1, found: undefined },
    ]);
  });
});

describe('ENGINE', () => {
  it('names this package and its version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(ENGINE).toEqual({ name: pkg.name, version: pkg.version });
  });
});
