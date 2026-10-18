// The tally: election definition, ballots, and seed in; every contest's result out. Pure and
// deterministic: the same inputs give the same result on every machine and in every browser.
import { tallyChooseN } from './choose-n.js';
import { assertSeed } from './draw.js';
import { tallyInstantRunoff } from './irv.js';
import { tallyProposal } from './proposal.js';
import type {
  Ballot,
  CandidateId,
  ContestResult,
  ElectionDefinition,
  ElectionResults,
  ProposalChoice,
  Seed,
} from './types.js';
import { validateBallots, validateElection } from './validate.js';

export function tallyElection(
  election: ElectionDefinition,
  ballots: readonly Ballot[],
  seed: Seed,
): ElectionResults {
  validateElection(election);
  validateBallots(election, ballots);
  assertSeed(seed);

  const contests: ContestResult[] = election.contests.map((contest) => {
    // Own fields only: a contest named like a built-in (constructor, toString) must not
    // inherit a value from Object.prototype.
    const selections = ballots.map((b) =>
      Object.hasOwn(b.contests, contest.id) ? b.contests[contest.id] : undefined,
    );
    switch (contest.method) {
      case 'proposal':
        return tallyProposal(
          contest,
          selections as (ProposalChoice | undefined)[],
          election.rollSize,
        );
      case 'choose-n':
        return tallyChooseN(contest, selections as (CandidateId[] | undefined)[], seed);
      case 'instant-runoff':
        return tallyInstantRunoff(contest, selections as (CandidateId[] | undefined)[], seed);
    }
  });
  return { election: election.id, ballots: ballots.length, contests };
}
