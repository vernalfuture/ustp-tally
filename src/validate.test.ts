import { describe, expect, it } from 'vitest';
import { TallyInputError } from './errors.js';
import { tallyElection } from './tally.js';
import { SEED } from './test-support/ballots.js';
import type { ElectionDefinition, InstantRunoffResult, ProposalResult } from './types.js';

describe('contest IDs named like built-in object properties', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`counts a skipped "${id}" contest as no selection`, () => {
      const election: ElectionDefinition = {
        id: 'e',
        contests: [
          { id, method: 'instant-runoff', candidates: ['a', 'b'], maxRanks: 2 },
          { id: `${id}-p`, method: 'proposal', passRule: 'simple-majority' },
        ],
      };
      const results = tallyElection(
        election,
        [{ contests: {} }, { contests: {} }, { contests: { [id]: ['a'] } }],
        SEED,
      );
      const irv = results.contests[0] as InstantRunoffResult;
      expect(irv.noSelection).toBe(2);
      expect(irv.rounds[0]).toMatchObject({ continuing: 1, exhausted: 0 });
      expect((results.contests[1] as ProposalResult).counts.noSelection).toBe(3);
    });
  }
});

describe('IDs', () => {
  const control = String.fromCharCode(0);
  const bidi = String.fromCodePoint(0x202e);
  const bad = ['__proto__', '_x', 'a b', '', 'x'.repeat(129), 'é', `a${control}`, `a${bidi}`];

  it('refuse anything but letters, digits, and . _ : - after a letter or digit', () => {
    for (const id of bad) {
      const asElection = {
        id,
        contests: [{ id: 'p', method: 'proposal', passRule: 'simple-majority' }],
      };
      const asContest = {
        id: 'e',
        contests: [{ id, method: 'proposal', passRule: 'simple-majority' }],
      };
      const asCandidate = {
        id: 'e',
        contests: [{ id: 'c', method: 'instant-runoff', candidates: ['a', id], maxRanks: 1 }],
      };
      for (const election of [asElection, asContest, asCandidate]) {
        expect(() => tallyElection(election as ElectionDefinition, [], SEED)).toThrow(
          TallyInputError,
        );
      }
    }
  });

  it('accept USTP IDs and readable slugs', () => {
    for (const id of [
      '019a3f7e-4b2c-7d1e-9f0a-1b2c3d4e5f60',
      'ben-zion',
      'q01',
      'e9-a-iii',
      'a.b:c_d',
    ]) {
      const election = {
        id: 'e',
        contests: [{ id, method: 'proposal', passRule: 'simple-majority' }],
      };
      expect(() => tallyElection(election as ElectionDefinition, [], SEED)).not.toThrow();
    }
  });
});

describe('limits', () => {
  it('refuse a contest with more than 1000 candidates', () => {
    const candidates = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const election: ElectionDefinition = {
      id: 'e',
      contests: [{ id: 'r', method: 'instant-runoff', candidates, maxRanks: 3 }],
    };
    expect(() => tallyElection(election, [], SEED)).toThrow(TallyInputError);
  });
});
