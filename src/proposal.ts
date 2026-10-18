// Proposal contests: Yes, No, Abstain (docs/spec.md, "Proposal"). Abstentions count toward the
// quorum, never toward the Yes/No ratio.
import { compareProducts } from './arith.js';
import type { ProposalChoice, ProposalContest, ProposalResult } from './types.js';

export function tallyProposal(
  contest: ProposalContest,
  selections: readonly (ProposalChoice | undefined)[],
  rollSize: number | undefined,
): ProposalResult {
  const counts = { yes: 0, no: 0, abstain: 0, noSelection: 0 };
  for (const s of selections) {
    if (s === undefined) counts.noSelection++;
    else counts[s]++;
  }
  const ballots = selections.length;
  const { yes, no } = counts;

  let ruleMet: boolean;
  switch (contest.passRule) {
    case 'simple-majority':
      ruleMet = yes > no;
      break;
    case 'two-thirds':
      // Yes ≥ 2/3 of (Yes + No), and a contest with no Yes or No votes fails.
      ruleMet = yes + no > 0 && compareProducts(3, yes, 2, yes + no) >= 0;
      break;
    case 'majority-of-roll':
      ruleMet = compareProducts(2, yes, 1, required(rollSize)) > 0;
      break;
  }

  const result: ProposalResult = {
    contest: contest.id,
    method: 'proposal',
    ballots,
    counts,
    passRule: contest.passRule,
    ...(contest.passRule === 'majority-of-roll' ? { rollSize: required(rollSize) } : {}),
    ruleMet,
    outcome: 'failed',
  };
  let quorumMet = true;
  if (contest.quorum) {
    const roll = required(rollSize);
    const { numerator, denominator } = contest.quorum;
    // Met unless fewer than numerator/denominator of the roll cast ballots.
    quorumMet = compareProducts(ballots, denominator, numerator, roll) >= 0;
    result.quorum = { required: contest.quorum, ballots, rollSize: roll, met: quorumMet };
  }
  result.outcome = ruleMet && quorumMet ? 'passed' : 'failed';
  return result;
}

function required(rollSize: number | undefined): number {
  // validateElection guarantees a roll size for contests that need one.
  if (rollSize === undefined) throw new Error('rollSize is required');
  return rollSize;
}
