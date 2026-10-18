import { describe, expect, it } from 'vitest';
import { drawOrder } from './draw.js';
import { TallyInputError } from './errors.js';
import { tallyElection } from './tally.js';
import { ballotsFor, SEED } from './test-support/ballots.js';
import type { Ballot, InstantRunoffResult } from './types.js';

function tally(candidates: string[], ballots: Ballot[], maxRanks = candidates.length) {
  const results = tallyElection(
    { id: 'e1', contests: [{ id: 'chair', method: 'instant-runoff', candidates, maxRanks }] },
    ballots,
    SEED,
  );
  return results.contests[0] as InstantRunoffResult;
}

describe('Instant-runoff', () => {
  it('ends in round 1 when a candidate has more than half of the ballots', () => {
    const r = tally(
      ['a', 'b'],
      ballotsFor('chair', [
        [['a'], 3],
        [['b', 'a'], 1],
        [null, 1],
      ]),
    );
    expect(r).toEqual({
      contest: 'chair',
      method: 'instant-runoff',
      ballots: 5,
      noSelection: 1,
      rounds: [
        {
          round: 1,
          tallies: [
            { candidate: 'a', votes: 3, transfer: 0 },
            { candidate: 'b', votes: 1, transfer: 0 },
          ],
          continuing: 4,
          exhausted: 0,
          exhaustedTransfer: 0,
        },
      ],
      winner: 'a',
    });
  });

  it('needs a majority of continuing ballots, with exhausted ballots reported every round', () => {
    const r = tally(
      ['a', 'b', 'c'],
      ballotsFor('chair', [
        [['a'], 5],
        [['b'], 2],
        [['c', 'b'], 3],
        [['c'], 1],
      ]),
    );
    expect(r.rounds).toEqual([
      {
        round: 1,
        tallies: [
          { candidate: 'a', votes: 5, transfer: 0 },
          { candidate: 'b', votes: 2, transfer: 0 },
          { candidate: 'c', votes: 4, transfer: 0 },
        ],
        continuing: 11,
        exhausted: 0,
        exhaustedTransfer: 0,
        eliminated: 'b',
      },
      {
        round: 2,
        tallies: [
          { candidate: 'a', votes: 5, transfer: 0 },
          { candidate: 'c', votes: 4, transfer: 0 },
        ],
        continuing: 9,
        exhausted: 2,
        exhaustedTransfer: 2,
      },
    ]);
    expect(r.winner).toBe('a');
  });

  it('does not treat exactly half as a majority', () => {
    // Like Platform Vote 9, Question XX, where 27 of 54 in round 1 did not win.
    const r = tally(
      ['a', 'b', 'c'],
      ballotsFor('chair', [
        [['a'], 3],
        [['b'], 2],
        [['c', 'b'], 1],
      ]),
    );
    expect(r.rounds[0]?.eliminated).toBe('c');
    expect(r.rounds[1]?.tallies).toEqual([
      { candidate: 'a', votes: 3, transfer: 0 },
      { candidate: 'b', votes: 3, transfer: 1 },
    ]);
    expect(r.rounds[1]?.tieBreak).toEqual({
      tied: ['a', 'b'],
      earlierRounds: [{ round: 1, stillTied: ['b'] }],
    });
    expect(r.rounds[1]?.eliminated).toBe('b');
    expect(r.rounds[2]).toMatchObject({ continuing: 3, exhausted: 3, exhaustedTransfer: 3 });
    expect(r.winner).toBe('a');
  });

  it('breaks an elimination tie with earlier rounds, most recent first', () => {
    const r = tally(
      ['a', 'b', 'c', 'd', 'e'],
      ballotsFor('chair', [
        [['a'], 4],
        [['b'], 5],
        [['c'], 12],
        [['d', 'a'], 1],
        [['e', 'a'], 1],
        [['e', 'b'], 1],
      ]),
    );
    expect(r.rounds.map((round) => round.eliminated)).toEqual(['d', 'e', 'a', undefined]);
    expect(r.rounds[2]?.tieBreak).toEqual({
      tied: ['a', 'b'],
      earlierRounds: [
        { round: 2, stillTied: ['a', 'b'] },
        { round: 1, stillTied: ['a'] },
      ],
    });
    expect(r.rounds[3]).toMatchObject({ continuing: 18, exhausted: 6 });
    expect(r.winner).toBe('c');
  });

  it('goes to the seeded draw when earlier rounds cannot separate the tie', () => {
    const r = tally(
      ['a', 'b', 'c', 'd'],
      ballotsFor('chair', [
        [['a'], 2],
        [['b'], 1],
        [['c'], 1],
        [['d'], 2],
      ]),
    );
    const order = drawOrder(SEED, { contest: 'chair', purpose: 'eliminate', round: 1 }, ['b', 'c']);
    expect(r.rounds[0]?.tieBreak).toEqual({
      tied: ['b', 'c'],
      earlierRounds: [],
      drawOrder: order,
    });
    expect(r.rounds[0]?.eliminated).toBe(order[1]);
  });

  it('elects a lone candidate and reports no winner when no ballot ranks anyone', () => {
    expect(tally(['a'], ballotsFor('chair', [[['a'], 2]])).winner).toBe('a');
    const empty = tally(['a', 'b'], ballotsFor('chair', [[null, 3]]));
    expect(empty.winner).toBeNull();
    expect(empty.noSelection).toBe(3);
    expect(empty.rounds).toHaveLength(1);
    expect(empty.rounds[0]?.continuing).toBe(0);
  });
});

describe('Instant-runoff ballots', () => {
  it('rejects repeated, unknown, empty, or too many rankings', () => {
    for (const bad of [['a', 'a'], ['z'], [], ['a', 'b', 'c'], 'a']) {
      expect(() => tally(['a', 'b', 'c'], [{ contests: { chair: bad as never } }], 2)).toThrow(
        TallyInputError,
      );
    }
  });
});
