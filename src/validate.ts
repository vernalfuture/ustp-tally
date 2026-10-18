// Structural checks on untrusted input. A record read from disk is checked field by field, and
// unknown fields are refused, so nothing in it can be silently ignored by the count.
import { TallyInputError } from './errors.js';
import type { Ballot, Contest, ElectionDefinition, Ratio } from './types.js';

type Json = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Json {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function expectObject(
  value: unknown,
  path: string,
  keys: { required: string[]; optional?: string[] },
): Json {
  if (!isPlainObject(value)) throw new TallyInputError(path, 'must be an object');
  const allowed = new Set([...keys.required, ...(keys.optional ?? [])]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TallyInputError(`${path}.${key}`, 'is not a known field');
  }
  for (const key of keys.required) {
    if (!Object.hasOwn(value, key)) throw new TallyInputError(`${path}.${key}`, 'is required');
  }
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TallyInputError(path, 'must be a non-empty string');
  }
  return value;
}

export function expectCount(
  value: unknown,
  path: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TallyInputError(path, `must be an integer from ${min} to ${max}`);
  }
  return value;
}

function expectRatio(value: unknown, path: string): Ratio {
  const r = expectObject(value, path, { required: ['numerator', 'denominator'] });
  const denominator = expectCount(r.denominator, `${path}.denominator`, 1);
  expectCount(r.numerator, `${path}.numerator`, 0, denominator);
  return value as Ratio;
}

// USTP IDs (UUIDv7) and readable slugs. The pattern keeps out __proto__, whitespace, control and
// bidirectional characters, and anything a terminal or a file name could misread.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_CANDIDATES = 1000;

export function expectId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TallyInputError(
      path,
      'must be 1 to 128 letters, digits, or . _ : -, starting with a letter or digit',
    );
  }
  return value;
}

function expectCandidates(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CANDIDATES) {
    throw new TallyInputError(path, `must list 1 to ${MAX_CANDIDATES} candidates`);
  }
  value.forEach((c, i) => expectId(c, `${path}[${i}]`));
  if (new Set(value).size !== value.length) throw new TallyInputError(path, 'must be distinct');
  return value as string[];
}

function validateContest(value: unknown, path: string): Contest {
  if (!isPlainObject(value)) throw new TallyInputError(path, 'must be an object');
  switch (value.method) {
    case 'proposal': {
      const c = expectObject(value, path, {
        required: ['id', 'method', 'passRule'],
        optional: ['quorum'],
      });
      expectId(c.id, `${path}.id`);
      if (!['simple-majority', 'two-thirds', 'majority-of-roll'].includes(c.passRule as string)) {
        throw new TallyInputError(
          `${path}.passRule`,
          'must be simple-majority, two-thirds, or majority-of-roll',
        );
      }
      if (c.quorum !== undefined) expectRatio(c.quorum, `${path}.quorum`);
      break;
    }
    case 'choose-n': {
      const c = expectObject(value, path, {
        required: ['id', 'method', 'candidates', 'seats', 'maxSelections'],
        optional: ['supportFloor'],
      });
      expectId(c.id, `${path}.id`);
      const n = expectCandidates(c.candidates, `${path}.candidates`).length;
      expectCount(c.seats, `${path}.seats`, 1, n);
      expectCount(c.maxSelections, `${path}.maxSelections`, 1, n);
      if (c.supportFloor !== undefined) {
        const f = expectObject(c.supportFloor, `${path}.supportFloor`, {
          required: ['share', 'comparison'],
        });
        expectRatio(f.share, `${path}.supportFloor.share`);
        if (f.comparison !== 'at-least' && f.comparison !== 'more-than') {
          throw new TallyInputError(
            `${path}.supportFloor.comparison`,
            'must be at-least or more-than',
          );
        }
      }
      break;
    }
    case 'instant-runoff': {
      const c = expectObject(value, path, { required: ['id', 'method', 'candidates', 'maxRanks'] });
      expectId(c.id, `${path}.id`);
      const n = expectCandidates(c.candidates, `${path}.candidates`).length;
      expectCount(c.maxRanks, `${path}.maxRanks`, 1, n);
      break;
    }
    default:
      throw new TallyInputError(`${path}.method`, 'must be proposal, choose-n, or instant-runoff');
  }
  return value as unknown as Contest;
}

export function validateElection(
  value: unknown,
  path = 'election',
): asserts value is ElectionDefinition {
  const e = expectObject(value, path, { required: ['id', 'contests'], optional: ['rollSize'] });
  expectId(e.id, `${path}.id`);
  if (e.rollSize !== undefined) expectCount(e.rollSize, `${path}.rollSize`);
  if (!Array.isArray(e.contests) || e.contests.length === 0) {
    throw new TallyInputError(`${path}.contests`, 'must be a non-empty list');
  }
  const ids = new Set<string>();
  e.contests.forEach((raw, i) => {
    const contest = validateContest(raw, `${path}.contests[${i}]`);
    if (ids.has(contest.id))
      throw new TallyInputError(`${path}.contests[${i}].id`, 'must be unique');
    ids.add(contest.id);
    const needsRoll =
      contest.method === 'proposal' && (contest.passRule === 'majority-of-roll' || contest.quorum);
    if (needsRoll && e.rollSize === undefined) {
      throw new TallyInputError(`${path}.rollSize`, `is required by contest ${contest.id}`);
    }
  });
}

function validateSelection(contest: Contest, value: unknown, path: string): void {
  if (contest.method === 'proposal') {
    if (value !== 'yes' && value !== 'no' && value !== 'abstain') {
      throw new TallyInputError(path, 'must be yes, no, or abstain');
    }
    return;
  }
  const limit = contest.method === 'choose-n' ? contest.maxSelections : contest.maxRanks;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TallyInputError(
      path,
      'must list at least one candidate; omit the contest to skip it',
    );
  }
  if (value.length > limit) throw new TallyInputError(path, `may list at most ${limit} candidates`);
  const known = new Set(contest.candidates);
  value.forEach((c, i) => {
    if (typeof c !== 'string' || !known.has(c)) {
      throw new TallyInputError(`${path}[${i}]`, 'is not a candidate in this contest');
    }
  });
  if (new Set(value).size !== value.length) {
    throw new TallyInputError(path, 'may list each candidate once');
  }
}

export function validateBallots(
  election: ElectionDefinition,
  value: unknown,
  path = 'ballots',
): asserts value is Ballot[] {
  if (!Array.isArray(value)) throw new TallyInputError(path, 'must be a list');
  if (election.rollSize !== undefined && value.length > election.rollSize) {
    throw new TallyInputError(
      path,
      `has ${value.length} ballots for a roll of ${election.rollSize}`,
    );
  }
  const contests = new Map(election.contests.map((c) => [c.id, c]));
  value.forEach((raw, i) => {
    const ballot = expectObject(raw, `${path}[${i}]`, { required: ['contests'] });
    if (!isPlainObject(ballot.contests)) {
      throw new TallyInputError(`${path}[${i}].contests`, 'must be an object');
    }
    for (const [id, selection] of Object.entries(ballot.contests)) {
      const contest = contests.get(id);
      if (!contest)
        throw new TallyInputError(
          `${path}[${i}].contests.${id}`,
          'is not a contest in this election',
        );
      validateSelection(contest, selection, `${path}[${i}].contests.${id}`);
    }
  });
}
