/** Thrown when an election definition, ballot, seed, or record is malformed. */
export class TallyInputError extends Error {
  override readonly name = 'TallyInputError';

  constructor(
    /** Where the problem is, such as `ballots[12].contests.chair[1]`. */
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}
