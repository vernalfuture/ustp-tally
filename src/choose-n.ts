// Choose up to N (docs/spec.md, "Choose up to N"). N = 1 is plurality, N = seats is block voting,
// and N = candidates is approval voting. An optional support floor turns it into the goal-slate
// rule. A tie for the last seats goes to the seeded draw.
import { compareProducts } from './arith.js';
import { drawOrder } from './draw.js';
import type { CandidateId, ChooseNContest, ChooseNResult, ChooseNTally, Seed } from './types.js';

export function tallyChooseN(
  contest: ChooseNContest,
  selections: readonly (readonly CandidateId[] | undefined)[],
  seed: Seed,
): ChooseNResult {
  const votes = new Map(contest.candidates.map((c) => [c, 0]));
  let noSelection = 0;
  for (const s of selections) {
    if (s === undefined) noSelection++;
    else for (const c of s) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  const ballots = selections.length;
  const floor = contest.supportFloor;
  const meetsFloor = (v: number): boolean => {
    if (!floor) return true;
    const cmp = compareProducts(v, floor.share.denominator, floor.share.numerator, ballots);
    return floor.comparison === 'at-least' ? cmp >= 0 : cmp > 0;
  };

  // Most votes first; equal counts keep contest order.
  let ranked = contest.candidates
    .map((candidate, index) => ({ candidate, index, votes: votes.get(candidate) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.index - b.index);

  // A seat needs at least one vote: no draw hands a seat to a candidate no ballot chose.
  const eligible = ranked.filter((r) => r.votes > 0 && meetsFloor(r.votes));
  const elected = new Set<CandidateId>();
  let seatDraw: ChooseNResult['seatDraw'];
  if (eligible.length <= contest.seats) {
    for (const r of eligible) elected.add(r.candidate);
  } else {
    const cutoff = eligible[contest.seats - 1]!.votes;
    const above = eligible.filter((r) => r.votes > cutoff);
    const tied = eligible.filter((r) => r.votes === cutoff);
    const seatsLeft = contest.seats - above.length;
    for (const r of above) elected.add(r.candidate);
    if (tied.length === seatsLeft) {
      for (const r of tied) elected.add(r.candidate);
    } else {
      const tiedIds = tied.map((r) => r.candidate);
      const order = drawOrder(seed, { contest: contest.id, purpose: 'seat' }, tiedIds);
      for (const c of order.slice(0, seatsLeft)) elected.add(c);
      seatDraw = { tied: tiedIds, votes: cutoff, seats: seatsLeft, drawOrder: order };
      // The floor depends only on votes, so every candidate at the cutoff is in the tied block.
      // List that block in draw order, so the bars read in the order seats were filled.
      const byId = new Map(ranked.map((r) => [r.candidate, r]));
      ranked = [
        ...ranked.filter((r) => r.votes > cutoff),
        ...order.map((c) => byId.get(c)!),
        ...ranked.filter((r) => r.votes < cutoff),
      ];
    }
  }

  const tallies: ChooseNTally[] = ranked.map((r) => ({
    candidate: r.candidate,
    votes: r.votes,
    ...(floor ? { meetsFloor: meetsFloor(r.votes) } : {}),
    elected: elected.has(r.candidate),
  }));
  return {
    contest: contest.id,
    method: 'choose-n',
    ballots,
    noSelection,
    seats: contest.seats,
    ...(floor ? { supportFloor: floor } : {}),
    tallies,
    winners: tallies.filter((t) => t.elected).map((t) => t.candidate),
    ...(seatDraw ? { seatDraw } : {}),
  };
}
