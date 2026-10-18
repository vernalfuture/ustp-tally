// Instant-runoff for one seat (docs/spec.md, "Instant-runoff"). Each round counts every continuing
// ballot for its highest-ranked continuing candidate. More than half of continuing ballots wins;
// otherwise one last-place candidate is eliminated. Elimination ties compare earlier rounds, most
// recent first, and anything still tied goes to the seeded draw.
import { drawOrder } from './draw.js';
import type {
  CandidateId,
  EliminationTieBreak,
  InstantRunoffContest,
  InstantRunoffResult,
  IrvRound,
  Seed,
} from './types.js';

export function tallyInstantRunoff(
  contest: InstantRunoffContest,
  selections: readonly (readonly CandidateId[] | undefined)[],
  seed: Seed,
): InstantRunoffResult {
  const rankings = selections.filter((s): s is readonly CandidateId[] => s !== undefined);
  const noSelection = selections.length - rankings.length;
  // Each ranking's position of its highest-ranked continuing candidate.
  const position = rankings.map(() => 0);
  const continuing = new Set(contest.candidates);
  const history: Map<CandidateId, number>[] = [];
  const rounds: IrvRound[] = [];
  let winner: CandidateId | null = null;

  for (let round = 1; ; round++) {
    const votes = new Map<CandidateId, number>();
    for (const c of contest.candidates) if (continuing.has(c)) votes.set(c, 0);
    let exhausted = 0;
    rankings.forEach((ranking, i) => {
      let p = position[i]!;
      while (p < ranking.length && !continuing.has(ranking[p]!)) p++;
      position[i] = p;
      const top = ranking[p];
      if (top === undefined) exhausted++;
      else votes.set(top, votes.get(top)! + 1);
    });
    const total = rankings.length - exhausted;
    const previous = history.at(-1);
    const previousExhausted = rounds.at(-1)?.exhausted ?? 0;
    history.push(votes);

    const result: IrvRound = {
      round,
      tallies: [...votes].map(([candidate, v]) => ({
        candidate,
        votes: v,
        transfer: previous ? v - previous.get(candidate)! : 0,
      })),
      continuing: total,
      exhausted,
      exhaustedTransfer: exhausted - previousExhausted,
    };
    rounds.push(result);

    const majority = [...votes].find(([, v]) => 2 * v > total);
    if (majority) {
      winner = majority[0];
      break;
    }
    if (total === 0) break; // No ballot ranked anyone.

    const least = Math.min(...votes.values());
    const tied = [...votes].filter(([, v]) => v === least).map(([c]) => c);
    let eliminated = tied[0]!;
    if (tied.length > 1) {
      const tieBreak = breakEliminationTie(tied, history, contest.id, round, seed);
      eliminated = tieBreak.drawOrder?.at(-1) ?? tieBreak.earlierRounds.at(-1)!.stillTied[0]!;
      result.tieBreak = tieBreak;
    }
    result.eliminated = eliminated;
    continuing.delete(eliminated);
  }

  return {
    contest: contest.id,
    method: 'instant-runoff',
    ballots: selections.length,
    noSelection,
    rounds,
    winner,
  };
}

function breakEliminationTie(
  tied: CandidateId[],
  history: Map<CandidateId, number>[],
  contest: string,
  round: number,
  seed: Seed,
): EliminationTieBreak {
  const tieBreak: EliminationTieBreak = { tied, earlierRounds: [] };
  let stillTied = tied;
  for (let earlier = round - 1; earlier >= 1 && stillTied.length > 1; earlier--) {
    const votes = history[earlier - 1]!;
    const least = Math.min(...stillTied.map((c) => votes.get(c)!));
    stillTied = stillTied.filter((c) => votes.get(c) === least);
    tieBreak.earlierRounds.push({ round: earlier, stillTied });
  }
  if (stillTied.length > 1) {
    tieBreak.drawOrder = drawOrder(seed, { contest, purpose: 'eliminate', round }, stillTied);
  }
  return tieBreak;
}
