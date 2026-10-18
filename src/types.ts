// Inputs and outputs of the tally. Every value is plain JSON, so a result can be serialized with
// RFC 8785, hashed, signed, and compared byte for byte by anyone who re-runs the count.

export type CandidateId = string;
export type ContestId = string;

/** An exact fraction of non-negative integers, used for floors and quorums. No floats. */
export interface Ratio {
  numerator: number;
  denominator: number;
}

export type PassRule = 'simple-majority' | 'two-thirds' | 'majority-of-roll';

export interface ProposalContest {
  id: ContestId;
  method: 'proposal';
  passRule: PassRule;
  /** The share of the roll that must cast ballots for the proposal to pass. */
  quorum?: Ratio;
}

export interface SupportFloor {
  /** The share of all ballots cast, including ballots that skipped this contest. */
  share: Ratio;
  /** 'at-least' is the design's default; 'more-than' is a strict majority when share is 1/2. */
  comparison: 'at-least' | 'more-than';
}

export interface ChooseNContest {
  id: ContestId;
  method: 'choose-n';
  candidates: CandidateId[];
  seats: number;
  maxSelections: number;
  supportFloor?: SupportFloor;
}

export interface InstantRunoffContest {
  id: ContestId;
  method: 'instant-runoff';
  candidates: CandidateId[];
  maxRanks: number;
}

export type Contest = ProposalContest | ChooseNContest | InstantRunoffContest;

export interface ElectionDefinition {
  id: string;
  /** Eligible voters. Required when a contest uses majority-of-roll or a quorum. */
  rollSize?: number;
  contests: Contest[];
}

export type ProposalChoice = 'yes' | 'no' | 'abstain';

/**
 * One anonymous cast vote record. A contest the voter skipped is absent. A proposal holds one
 * choice, Choose up to N a set of candidates, and instant-runoff candidates from first to last.
 */
export interface Ballot {
  contests: Record<ContestId, ProposalChoice | CandidateId[]>;
}

/** 32 random bytes as 64 lowercase hex digits, revealed at tally time. */
export type Seed = string;

export interface ProposalResult {
  contest: ContestId;
  method: 'proposal';
  ballots: number;
  counts: { yes: number; no: number; abstain: number; noSelection: number };
  passRule: PassRule;
  rollSize?: number;
  quorum?: { required: Ratio; ballots: number; rollSize: number; met: boolean };
  ruleMet: boolean;
  outcome: 'passed' | 'failed';
}

export interface CandidateVotes {
  candidate: CandidateId;
  votes: number;
}

export interface ChooseNTally extends CandidateVotes {
  meetsFloor?: boolean;
  elected: boolean;
}

export interface SeatDraw {
  /** Candidates tied for the last seats, in contest order. */
  tied: CandidateId[];
  votes: number;
  seats: number;
  /** The tied candidates from most to least favored by the seeded draw. */
  drawOrder: CandidateId[];
}

export interface ChooseNResult {
  contest: ContestId;
  method: 'choose-n';
  ballots: number;
  noSelection: number;
  seats: number;
  supportFloor?: SupportFloor;
  /** Every candidate, most votes first; equal counts keep contest order unless a draw ordered them. */
  tallies: ChooseNTally[];
  winners: CandidateId[];
  seatDraw?: SeatDraw;
}

export interface EliminationTieBreak {
  /** Candidates tied for last place in this round, in contest order. */
  tied: CandidateId[];
  /** Each earlier round compared, most recent first, and who was still tied after it. */
  earlierRounds: { round: number; stillTied: CandidateId[] }[];
  /** Present when earlier rounds left a tie: the candidates from most to least favored. */
  drawOrder?: CandidateId[];
}

export interface IrvRound {
  round: number;
  /** Continuing candidates in contest order. Transfer is the change from the previous round. */
  tallies: (CandidateVotes & { transfer: number })[];
  continuing: number;
  /** Ballots that ranked someone but have no continuing candidate, cumulative. */
  exhausted: number;
  exhaustedTransfer: number;
  eliminated?: CandidateId;
  tieBreak?: EliminationTieBreak;
}

export interface InstantRunoffResult {
  contest: ContestId;
  method: 'instant-runoff';
  ballots: number;
  noSelection: number;
  rounds: IrvRound[];
  /** Null only when no ballot ranked anyone. */
  winner: CandidateId | null;
}

export type ContestResult = ProposalResult | ChooseNResult | InstantRunoffResult;

export interface ElectionResults {
  election: string;
  ballots: number;
  contests: ContestResult[];
}
