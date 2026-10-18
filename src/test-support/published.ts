// Helpers for checking the tally against results transcribed from USTP's published reports.
import { readFileSync } from 'node:fs';
import type { Ballot, ElectionDefinition, ProposalChoice } from '../types.js';

export const FIXTURES = new URL('../../fixtures/', import.meta.url);

export function readFixture<T>(id: string, file: string): T {
  return JSON.parse(readFileSync(new URL(`${id}/${file}`, FIXTURES), 'utf8')) as T;
}

/** count / denominator as a percentage to `decimals` places, rounded half up, without floats. */
export function percent(count: number, denominator: number, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const twice = 2n * BigInt(denominator);
  const scaled = (BigInt(count) * 100n * scale * 2n + BigInt(denominator)) / twice;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return decimals === 0 ? `${whole}` : `${whole}.${fraction}`;
}

export const decimalsOf = (printed: string) => printed.split('.')[1]?.length ?? 0;

export interface PublishedTally {
  candidate: string;
  votes: number;
  percent: string;
  included?: boolean;
}

export interface PublishedRound {
  round: number;
  continuing: number;
  tallies: PublishedTally[];
  eliminated?: string;
}

export type PublishedContest =
  | {
      method: 'proposal';
      question?: string;
      title?: string;
      counts: Record<ProposalChoice, number>;
      percent: Record<ProposalChoice, string>;
      outcome: 'passed' | 'failed';
    }
  | { method: 'choose-n'; question?: string; title?: string; tallies: PublishedTally[] }
  | {
      method: 'instant-runoff';
      question?: string;
      title?: string;
      rounds: PublishedRound[];
      winner: string;
      rankSummary?: Record<string, number[]>;
    };

export interface Published {
  transcribedFrom: string;
  ballots: number;
  contests: Record<string, PublishedContest>;
  pending?: Record<string, { question: string; title: string; missing: string }>;
}

/**
 * Builds anonymous ballots from published per-question counts, for votes where USTP published
 * counts but not ballots. Each method here reads only those counts (a Proposal its Yes, No, and
 * Abstain totals; Choose up to N its per-candidate totals; an instant-runoff decided in round 1 its
 * first preferences), so the expansion cannot change a result. Which selections shared a ballot is
 * not known and not used.
 */
export function ballotsFromPublishedCounts(
  election: ElectionDefinition,
  published: Published,
): Ballot[] {
  const ballots: Ballot[] = Array.from({ length: published.ballots }, () => ({ contests: {} }));
  const put = (index: number, contest: string, selection: Ballot['contests'][string]) => {
    const ballot = ballots[index];
    if (!ballot) throw new Error(`${contest}: more selections than ballots`);
    ballot.contests[contest] = selection;
  };
  for (const contest of election.contests) {
    const p = published.contests[contest.id];
    if (!p || p.method !== contest.method) throw new Error(`${contest.id}: no published counts`);
    if (p.method === 'proposal') {
      let i = 0;
      for (const choice of ['yes', 'no', 'abstain'] as const) {
        for (let k = 0; k < p.counts[choice]; k++) put(i++, contest.id, choice);
      }
    } else if (p.method === 'choose-n') {
      for (const t of p.tallies) {
        for (let i = 0; i < t.votes; i++) {
          const existing = ballots[i]?.contests[contest.id];
          put(i, contest.id, [...((existing as string[] | undefined) ?? []), t.candidate]);
        }
      }
    } else {
      const first = p.rounds[0];
      if (!first || p.rounds.length !== 1) {
        throw new Error(`${contest.id}: needs ballots, not just round totals`);
      }
      let i = 0;
      for (const t of first.tallies)
        for (let k = 0; k < t.votes; k++) put(i++, contest.id, [t.candidate]);
    }
  }
  return ballots;
}
