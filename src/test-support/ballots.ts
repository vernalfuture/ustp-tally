import type { Ballot, CandidateId, ContestId, ProposalChoice } from '../types.js';

export const SEED = '3a7f0c9e14b2d85f6e0a1c3b5d7f9e2a4c6e8a0b2d4f6a8c0e2a4c6e8b0d2f41';

type Selection = ProposalChoice | CandidateId[] | null;

/** Ballots for one contest: each entry is a selection (null skips the contest) and a count. */
export function ballotsFor(contest: ContestId, entries: [Selection, number][]): Ballot[] {
  return entries.flatMap(([selection, count]) =>
    Array.from({ length: count }, () =>
      selection === null
        ? { contests: {} }
        : { contests: { [contest]: structuredClone(selection) } },
    ),
  );
}

export function proposalBallots(
  contest: ContestId,
  counts: { yes?: number; no?: number; abstain?: number; skip?: number },
): Ballot[] {
  return ballotsFor(contest, [
    ['yes', counts.yes ?? 0],
    ['no', counts.no ?? 0],
    ['abstain', counts.abstain ?? 0],
    [null, counts.skip ?? 0],
  ]);
}
