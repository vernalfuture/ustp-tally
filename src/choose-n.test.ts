import { describe, expect, it } from 'vitest';
import { drawOrder } from './draw.js';
import { TallyInputError } from './errors.js';
import { tallyElection } from './tally.js';
import { ballotsFor, SEED } from './test-support/ballots.js';
import type { Ballot, ChooseNContest, ChooseNResult } from './types.js';

function contest(extra: Partial<ChooseNContest> = {}): ChooseNContest {
  return {
    id: 'board',
    method: 'choose-n',
    candidates: ['a', 'b', 'c', 'd'],
    seats: 1,
    maxSelections: 1,
    ...extra,
  };
}

function tally(c: ChooseNContest, ballots: Ballot[]) {
  return tallyElection({ id: 'e1', contests: [c] }, ballots, SEED).contests[0] as ChooseNResult;
}

describe('Choose up to N', () => {
  it('elects the plurality winner when N is 1', () => {
    const r = tally(
      contest(),
      ballotsFor('board', [
        [['b'], 3],
        [['a'], 5],
        [['c'], 1],
        [null, 2],
      ]),
    );
    expect(r).toEqual({
      contest: 'board',
      method: 'choose-n',
      ballots: 11,
      noSelection: 2,
      seats: 1,
      tallies: [
        { candidate: 'a', votes: 5, elected: true },
        { candidate: 'b', votes: 3, elected: false },
        { candidate: 'c', votes: 1, elected: false },
        { candidate: 'd', votes: 0, elected: false },
      ],
      winners: ['a'],
    });
  });

  it('fills every seat by votes when N equals the seats (block voting)', () => {
    const r = tally(
      contest({ seats: 2, maxSelections: 2 }),
      ballotsFor('board', [
        [['a', 'b'], 4],
        [['c', 'b'], 3],
        [['d'], 2],
      ]),
    );
    expect(r.winners).toEqual(['b', 'a']);
  });

  it('keeps contest order for equal counts away from the last seat', () => {
    const r = tally(
      contest({ seats: 2, maxSelections: 2 }),
      ballotsFor('board', [
        [['b', 'a'], 3],
        [['c'], 1],
      ]),
    );
    expect(r.winners).toEqual(['a', 'b']);
    expect(r.seatDraw).toBeUndefined();
  });

  it('settles a tie for the last seat with the seeded draw', () => {
    const r = tally(
      contest({ seats: 2, maxSelections: 2 }),
      ballotsFor('board', [
        [['a', 'b'], 3],
        [['a', 'c'], 3],
        [['a', 'd'], 1],
      ]),
    );
    const order = drawOrder(SEED, { contest: 'board', purpose: 'seat' }, ['b', 'c']);
    expect(r.seatDraw).toEqual({ tied: ['b', 'c'], votes: 3, seats: 1, drawOrder: order });
    expect(r.winners).toEqual(['a', order[0]]);
    expect(r.tallies.map((t) => t.candidate)).toEqual(['a', ...order, 'd']);
  });

  it('elects every candidate when N equals the candidates (approval voting) and seats allow', () => {
    const r = tally(
      contest({ seats: 4, maxSelections: 4 }),
      ballotsFor('board', [[['a', 'b', 'c', 'd'], 1]]),
    );
    expect(r.winners).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Choose up to N with seats no one voted for', () => {
  it('leaves a seat empty rather than draw a candidate no ballot chose', () => {
    const r = tally(
      contest({ seats: 2 }),
      ballotsFor('board', [
        [['a'], 1],
        [null, 2],
      ]),
    );
    expect(r.winners).toEqual(['a']);
    expect(r.seatDraw).toBeUndefined();
  });

  it('elects no one when every ballot skips the contest', () => {
    const r = tally(contest({ seats: 2 }), ballotsFor('board', [[null, 3]]));
    expect(r.winners).toEqual([]);
    expect(r.seatDraw).toBeUndefined();
  });
});

describe('Choose up to N with a support floor', () => {
  const half = { numerator: 1, denominator: 2 };
  // Ten ballots in all, two of them skipping the contest: the floor counts all ten.
  const ballots = ballotsFor('board', [
    [['a', 'b'], 4],
    [['a'], 1],
    [['c'], 3],
    [null, 2],
  ]);

  it('at least the floor share of all ballots cast', () => {
    const r = tally(
      contest({
        seats: 3,
        maxSelections: 2,
        supportFloor: { share: half, comparison: 'at-least' },
      }),
      ballots,
    );
    expect(r.tallies).toEqual([
      { candidate: 'a', votes: 5, meetsFloor: true, elected: true },
      { candidate: 'b', votes: 4, meetsFloor: false, elected: false },
      { candidate: 'c', votes: 3, meetsFloor: false, elected: false },
      { candidate: 'd', votes: 0, meetsFloor: false, elected: false },
    ]);
    expect(r.winners).toEqual(['a']);
  });

  it('more than the floor share, as in "a majority of votes cast"', () => {
    const r = tally(
      contest({
        seats: 3,
        maxSelections: 2,
        supportFloor: { share: half, comparison: 'more-than' },
      }),
      ballots,
    );
    expect(r.winners).toEqual([]);
    expect(r.tallies[0]).toEqual({ candidate: 'a', votes: 5, meetsFloor: false, elected: false });
  });

  it('draws only among tied candidates that meet the floor', () => {
    const r = tally(
      contest({
        seats: 1,
        maxSelections: 3,
        supportFloor: { share: { numerator: 1, denominator: 3 }, comparison: 'at-least' },
      }),
      ballotsFor('board', [
        [['a', 'b', 'c'], 2],
        [['a', 'b'], 1],
      ]),
    );
    const order = drawOrder(SEED, { contest: 'board', purpose: 'seat' }, ['a', 'b']);
    expect(r.seatDraw?.tied).toEqual(['a', 'b']);
    expect(r.winners).toEqual([order[0]]);
  });
});

describe('Choose up to N ballots', () => {
  it('rejects too many, repeated, unknown, or empty selections', () => {
    const c = contest({ maxSelections: 2 });
    for (const bad of [['a', 'b', 'c'], ['a', 'a'], ['z'], [], 'a', [1]]) {
      expect(() =>
        tallyElection({ id: 'e1', contests: [c] }, [{ contests: { board: bad as never } }], SEED),
      ).toThrow(TallyInputError);
    }
  });

  it('rejects contests whose seats or N do not fit the candidates', () => {
    for (const bad of [
      { seats: 0 },
      { seats: 5 },
      { maxSelections: 0 },
      { maxSelections: 5 },
      { candidates: ['a', 'a'] },
      { candidates: [] },
    ]) {
      expect(() => tallyElection({ id: 'e1', contests: [contest(bad)] }, [], SEED)).toThrow(
        TallyInputError,
      );
    }
  });
});
