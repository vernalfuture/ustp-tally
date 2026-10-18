// Property tests: totals are conserved every round, results don't depend on ballot order, every
// tie follows the documented tie-break, and each method reads only what the spec says it reads.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawOrder } from './draw.js';
import { tallyElection } from './tally.js';
import type {
  Ballot,
  ChooseNResult,
  ElectionDefinition,
  InstantRunoffResult,
  ProposalResult,
} from './types.js';

const RUNS = { numRuns: 400 };

const seedArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString('hex'));

const candidatesArb = fc
  .integer({ min: 1, max: 6 })
  .map((n) => Array.from({ length: n }, (_, i) => `c${i}`));

/** A ranked contest with few ballots and candidates, so ties are common. */
const irvArb = candidatesArb.chain((candidates) =>
  fc.record({
    candidates: fc.constant(candidates),
    rankings: fc.array(
      fc.option(fc.shuffledSubarray(candidates, { minLength: 1 }), { nil: undefined, freq: 6 }),
      { maxLength: 30 },
    ),
    seed: seedArb,
  }),
);

function irvElection(candidates: string[]): ElectionDefinition {
  return {
    id: 'e',
    contests: [{ id: 'r', method: 'instant-runoff', candidates, maxRanks: candidates.length }],
  };
}

const irvBallots = (rankings: (string[] | undefined)[]): Ballot[] =>
  rankings.map((r) => (r ? { contests: { r } } : { contests: {} }));

function tallyIrv(candidates: string[], rankings: (string[] | undefined)[], seed: string) {
  return tallyElection(irvElection(candidates), irvBallots(rankings), seed)
    .contests[0] as InstantRunoffResult;
}

/** A random permutation of a list, driven by fast-check. */
const permutationOf = <T>(items: T[]) =>
  fc
    .array(fc.double({ noNaN: true }), { minLength: items.length, maxLength: items.length })
    .map((keys) =>
      items
        .map((item, i) => ({ item, key: keys[i]! }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.item),
    );

describe('instant-runoff properties', () => {
  it('conserves every ballot in every round', () => {
    fc.assert(
      fc.property(irvArb, ({ candidates, rankings, seed }) => {
        const r = tallyIrv(candidates, rankings, seed);
        expect(r.ballots).toBe(rankings.length);
        expect(r.noSelection).toBe(rankings.filter((x) => x === undefined).length);
        let previous: (typeof r.rounds)[number] | undefined;
        for (const round of r.rounds) {
          const sum = round.tallies.reduce((s, t) => s + t.votes, 0);
          expect(sum).toBe(round.continuing);
          expect(round.continuing + round.exhausted + r.noSelection).toBe(r.ballots);
          if (previous) {
            expect(round.exhausted).toBeGreaterThanOrEqual(previous.exhausted);
            expect(round.exhaustedTransfer).toBe(round.exhausted - previous.exhausted);
            expect(round.tallies.map((t) => t.candidate)).not.toContain(previous.eliminated);
            for (const t of round.tallies) {
              const before = previous.tallies.find((p) => p.candidate === t.candidate)!;
              expect(t.transfer).toBe(t.votes - before.votes);
              expect(t.transfer).toBeGreaterThanOrEqual(0);
            }
          }
          previous = round;
        }
        expect(r.rounds.length).toBeLessThanOrEqual(candidates.length);
        const last = r.rounds.at(-1)!;
        if (r.winner === null) expect(last.continuing).toBe(0);
        else {
          const votes = last.tallies.find((t) => t.candidate === r.winner)!.votes;
          expect(2 * votes).toBeGreaterThan(last.continuing);
        }
      }),
      RUNS,
    );
  });

  it('breaks every elimination tie by earlier rounds, most recent first, then the draw', () => {
    fc.assert(
      fc.property(irvArb, ({ candidates, rankings, seed }) => {
        const r = tallyIrv(candidates, rankings, seed);
        r.rounds.forEach((round, index) => {
          if (round.eliminated === undefined) return;
          const least = Math.min(...round.tallies.map((t) => t.votes));
          const tied = round.tallies.filter((t) => t.votes === least).map((t) => t.candidate);
          expect(tied).toContain(round.eliminated);
          if (tied.length === 1) {
            expect(round.tieBreak).toBeUndefined();
            return;
          }
          // Recompute the documented rule from the published rounds alone.
          let stillTied = tied;
          for (let earlier = index - 1; earlier >= 0 && stillTied.length > 1; earlier--) {
            const votes = new Map(r.rounds[earlier]!.tallies.map((t) => [t.candidate, t.votes]));
            const fewest = Math.min(...stillTied.map((c) => votes.get(c)!));
            stillTied = stillTied.filter((c) => votes.get(c) === fewest);
          }
          const expected =
            stillTied.length === 1
              ? stillTied[0]
              : drawOrder(
                  seed,
                  { contest: 'r', purpose: 'eliminate', round: round.round },
                  stillTied,
                ).at(-1);
          expect(round.eliminated).toBe(expected);
          expect(round.tieBreak?.tied).toEqual(tied);
        });
      }),
      RUNS,
    );
  });

  it('gives the same result in any ballot order', () => {
    fc.assert(
      fc.property(
        irvArb.chain((x) => fc.record({ x: fc.constant(x), order: permutationOf(x.rankings) })),
        ({ x, order }) => {
          expect(tallyIrv(x.candidates, order, x.seed)).toEqual(
            tallyIrv(x.candidates, x.rankings, x.seed),
          );
        },
      ),
      RUNS,
    );
  });

  it('reads only first choices when a round-1 majority decides it', () => {
    fc.assert(
      fc.property(irvArb, ({ candidates, rankings, seed }) => {
        const r = tallyIrv(candidates, rankings, seed);
        fc.pre(r.rounds.length === 1 && r.winner !== null);
        const firstOnly = rankings.map((x) => (x ? x.slice(0, 1) : undefined));
        expect(tallyIrv(candidates, firstOnly, seed)).toEqual(r);
      }),
      RUNS,
    );
  });
});

const chooseNArb = candidatesArb.chain((candidates) =>
  fc
    .record({
      seats: fc.integer({ min: 1, max: candidates.length }),
      maxSelections: fc.integer({ min: 1, max: candidates.length }),
      floor: fc.option(
        fc.record({
          numerator: fc.integer({ min: 0, max: 4 }),
          comparison: fc.constantFrom('at-least' as const, 'more-than' as const),
        }),
        { nil: undefined },
      ),
      seed: seedArb,
    })
    .chain((config) =>
      fc.record({
        candidates: fc.constant(candidates),
        config: fc.constant(config),
        selections: fc.array(
          fc.option(
            fc.shuffledSubarray(candidates, { minLength: 1, maxLength: config.maxSelections }),
            { nil: undefined, freq: 6 },
          ),
          { maxLength: 30 },
        ),
      }),
    ),
);

function tallyChooseN(
  candidates: string[],
  config: {
    seats: number;
    maxSelections: number;
    floor: { numerator: number; comparison: 'at-least' | 'more-than' } | undefined;
    seed: string;
  },
  selections: (string[] | undefined)[],
) {
  const election: ElectionDefinition = {
    id: 'e',
    contests: [
      {
        id: 'n',
        method: 'choose-n',
        candidates,
        seats: config.seats,
        maxSelections: config.maxSelections,
        ...(config.floor
          ? {
              supportFloor: {
                share: { numerator: config.floor.numerator, denominator: 4 },
                comparison: config.floor.comparison,
              },
            }
          : {}),
      },
    ],
  };
  const ballots = selections.map((s) => (s ? { contests: { n: s } } : { contests: {} }));
  return tallyElection(election, ballots, config.seed).contests[0] as ChooseNResult;
}

describe('Choose up to N properties', () => {
  it('depends only on each candidate’s total and the number of ballots', () => {
    fc.assert(
      fc.property(chooseNArb, ({ candidates, config, selections }) => {
        const r = tallyChooseN(
          candidates,
          { ...config, maxSelections: candidates.length },
          selections,
        );
        // Rebuild ballots with the same totals but different pairings: ballot i picks every
        // candidate with more than i votes.
        const totals = new Map(r.tallies.map((t) => [t.candidate, t.votes]));
        const rebuilt = selections.map((_, i) => {
          const picked = candidates.filter((c) => totals.get(c)! > i);
          return picked.length ? picked : undefined;
        });
        const again = tallyChooseN(
          candidates,
          { ...config, maxSelections: candidates.length },
          rebuilt,
        );
        expect({ ...again, noSelection: r.noSelection }).toEqual(r);
      }),
      RUNS,
    );
  });

  it('fills at most the seats, only with voted-for candidates meeting the floor, by votes', () => {
    fc.assert(
      fc.property(chooseNArb, ({ candidates, config, selections }) => {
        const r = tallyChooseN(candidates, config, selections);
        expect(r.winners.length).toBeLessThanOrEqual(config.seats);
        const elected = r.tallies.filter((t) => t.elected);
        const lost = r.tallies.filter((t) => !t.elected && t.votes > 0 && t.meetsFloor !== false);
        for (const w of elected) {
          expect(w.meetsFloor).not.toBe(false);
          expect(w.votes).toBeGreaterThan(0);
          for (const l of lost) expect(w.votes).toBeGreaterThanOrEqual(l.votes);
        }
        if (lost.length > 0) expect(elected.length).toBe(config.seats);
        if (r.seatDraw) {
          expect(r.seatDraw.drawOrder).toEqual(
            drawOrder(config.seed, { contest: 'n', purpose: 'seat' }, r.seatDraw.tied),
          );
          expect(r.winners.filter((w) => r.seatDraw!.tied.includes(w))).toEqual(
            r.seatDraw.drawOrder.slice(0, r.seatDraw.seats),
          );
        }
      }),
      RUNS,
    );
  });

  it('gives the same result in any ballot order', () => {
    fc.assert(
      fc.property(
        chooseNArb.chain((x) =>
          fc.record({ x: fc.constant(x), order: permutationOf(x.selections) }),
        ),
        ({ x, order }) => {
          expect(tallyChooseN(x.candidates, x.config, order)).toEqual(
            tallyChooseN(x.candidates, x.config, x.selections),
          );
        },
      ),
      RUNS,
    );
  });
});

describe('Proposal properties', () => {
  const choiceArb = fc.option(fc.constantFrom('yes' as const, 'no' as const, 'abstain' as const), {
    nil: undefined,
    freq: 6,
  });

  it('applies each pass rule and the quorum to the counts, in any ballot order', () => {
    fc.assert(
      fc.property(
        fc.array(choiceArb, { maxLength: 40 }).chain((choices) =>
          fc.record({
            choices: fc.constant(choices),
            order: permutationOf(choices),
            extraRoll: fc.integer({ min: 0, max: 40 }),
            quorum: fc.integer({ min: 0, max: 100 }),
            seed: seedArb,
          }),
        ),
        ({ choices, order, extraRoll, quorum, seed }) => {
          const rollSize = choices.length + extraRoll;
          const count = (c: string) => choices.filter((x) => x === c).length;
          const [yes, no] = [count('yes'), count('no')];
          const quorumMet = choices.length * 100 >= quorum * rollSize;
          const expected = {
            'simple-majority': yes > no,
            'two-thirds': yes + no > 0 && 3 * yes >= 2 * (yes + no),
            'majority-of-roll': 2 * yes > rollSize,
          };
          for (const passRule of Object.keys(expected) as (keyof typeof expected)[]) {
            const election: ElectionDefinition = {
              id: 'e',
              rollSize,
              contests: [
                {
                  id: 'p',
                  method: 'proposal',
                  passRule,
                  quorum: { numerator: quorum, denominator: 100 },
                },
              ],
            };
            const run = (list: typeof choices) =>
              tallyElection(
                election,
                list.map((c) => (c ? { contests: { p: c } } : { contests: {} })),
                seed,
              ).contests[0] as ProposalResult;
            const r = run(choices);
            expect(r.ruleMet).toBe(expected[passRule]);
            expect(r.quorum?.met).toBe(quorumMet);
            expect(r.outcome).toBe(expected[passRule] && quorumMet ? 'passed' : 'failed');
            expect(run(order)).toEqual(r);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
