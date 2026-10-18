// ustp-tally: the one implementation of USTP Hub's vote counting. The voting worker, the verifier
// CLI, and the browser's Verify page all run this code, pinned to an exact version.
export { canonicalBytes, canonicalize } from './canonical-json.js';
export {
  verdictOf,
  type Check,
  type CheckStatus,
  type PublishedValues,
  type Verdict,
} from './checks.js';
export { assertSeed, drawOrder, seedCommitment, type DrawContext } from './draw.js';
export { ENGINE, type EngineId } from './engine.js';
export { TallyInputError } from './errors.js';
export {
  canonicalBallots,
  createRecord,
  diffJson,
  parseRecord,
  RECORD_FORMAT,
  recordBytes,
  retallyRecord,
  tallyHash,
  type Difference,
  type ElectionRecord,
  type RetallyOptions,
  type RetallyReport,
} from './record.js';
export {
  checkResultsFile,
  parseResultsFile,
  RESULTS_FORMAT,
  resultsBytes,
  resultsFile,
  resultsHash,
  type ResultsFile,
  type ResultsReport,
} from './results.js';
export { tallyElection } from './tally.js';
export type * from './types.js';
export { validateBallots, validateElection } from './validate.js';
