import { describe, expect, it } from 'vitest';
import { TallyInputError } from './errors.js';
import { tallyElection } from './tally.js';
import { proposalBallots, SEED } from './test-support/ballots.js';
import type { ElectionDefinition, PassRule, ProposalResult, Ratio } from './types.js';

function election(passRule: PassRule, extra: { rollSize?: number; quorum?: Ratio } = {}) {
  const definition: ElectionDefinition = {
    id: 'e1',
    contests: [
      { id: 'p1', method: 'proposal', passRule, ...(extra.quorum ? { quorum: extra.quorum } : {}) },
    ],
    ...(extra.rollSize === undefined ? {} : { rollSize: extra.rollSize }),
  };
  return definition;
}

function tally(definition: ElectionDefinition, counts: Parameters<typeof proposalBallots>[1]) {
  const results = tallyElection(definition, proposalBallots('p1', counts), SEED);
  return results.contests[0] as ProposalResult;
}

describe('Proposal: simple majority', () => {
  it('passes when Yes outnumbers No', () => {
    const r = tally(election('simple-majority'), { yes: 5, no: 3, abstain: 1 });
    expect(r).toEqual({
      contest: 'p1',
      method: 'proposal',
      ballots: 9,
      counts: { yes: 5, no: 3, abstain: 1, noSelection: 0 },
      passRule: 'simple-majority',
      ruleMet: true,
      outcome: 'passed',
    });
  });

  it('fails on a tie', () => {
    expect(tally(election('simple-majority'), { yes: 4, no: 4 }).outcome).toBe('failed');
  });

  it('never counts abstentions toward either side, even as a plurality', () => {
    // Platform Vote 9, Question XV: 13 for the current text, 27 for the amendment, 28 abstain.
    const r = tally(election('simple-majority'), { yes: 27, no: 13, abstain: 28 });
    expect(r.outcome).toBe('passed');
  });

  it('counts ballots that skipped the contest as no selection', () => {
    const r = tally(election('simple-majority'), { yes: 1, skip: 2 });
    expect(r.counts.noSelection).toBe(2);
    expect(r.ballots).toBe(3);
  });
});

describe('Proposal: two-thirds', () => {
  it('passes at exactly two-thirds of Yes and No', () => {
    expect(tally(election('two-thirds'), { yes: 6, no: 3, abstain: 9 }).outcome).toBe('passed');
  });

  it('fails just under two-thirds', () => {
    expect(tally(election('two-thirds'), { yes: 5, no: 3 }).outcome).toBe('failed');
  });

  it('fails when no one votes Yes or No', () => {
    expect(tally(election('two-thirds'), { abstain: 5 }).outcome).toBe('failed');
  });
});

describe('Proposal: majority of the roll', () => {
  it('needs more than half of all eligible voters to vote Yes', () => {
    expect(tally(election('majority-of-roll', { rollSize: 10 }), { yes: 6 }).outcome).toBe(
      'passed',
    );
    const half = tally(election('majority-of-roll', { rollSize: 10 }), { yes: 5, no: 0 });
    expect(half.outcome).toBe('failed');
    expect(half.rollSize).toBe(10);
  });

  it('requires the roll size', () => {
    expect(() => tally(election('majority-of-roll'), { yes: 1 })).toThrow(TallyInputError);
  });
});

describe('Proposal: quorum', () => {
  const tenPercent = { numerator: 10, denominator: 100 };

  it('is met at exactly the quorum, with abstentions and skips counting', () => {
    const r = tally(election('simple-majority', { rollSize: 100, quorum: tenPercent }), {
      yes: 2,
      no: 1,
      abstain: 4,
      skip: 3,
    });
    expect(r.quorum).toEqual({ required: tenPercent, ballots: 10, rollSize: 100, met: true });
    expect(r.outcome).toBe('passed');
  });

  it('fails the proposal below quorum even when the rule is met', () => {
    const r = tally(election('simple-majority', { rollSize: 100, quorum: tenPercent }), {
      yes: 9,
    });
    expect(r.quorum?.met).toBe(false);
    expect(r.ruleMet).toBe(true);
    expect(r.outcome).toBe('failed');
  });

  it('requires the roll size', () => {
    expect(() => tally(election('simple-majority', { quorum: tenPercent }), { yes: 1 })).toThrow(
      TallyInputError,
    );
  });
});

describe('Proposal ballots', () => {
  it('rejects anything but yes, no, or abstain', () => {
    const definition = election('simple-majority');
    for (const bad of ['Yes', 'maybe', ['yes'], 1, null]) {
      expect(() => tallyElection(definition, [{ contests: { p1: bad as never } }], SEED)).toThrow(
        TallyInputError,
      );
    }
  });
});
