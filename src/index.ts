// ustp-tally: the one implementation of USTP Hub's vote counting. The voting worker, the verifier
// CLI, and the browser's Verify page all run this code, pinned to an exact version.
export { canonicalBytes, canonicalize } from './canonical-json.js';
export { assertSeed, drawOrder, seedCommitment, type DrawContext } from './draw.js';
export { ENGINE, type EngineId } from './engine.js';
export { TallyInputError } from './errors.js';
export {
  createRecord,
  diffJson,
  parseRecord,
  RECORD_FORMAT,
  recordBytes,
  recordHash,
  retallyRecord,
  canonicalBallots,
  type Check,
  type Difference,
  type ElectionRecord,
  type RetallyOptions,
  type RetallyReport,
} from './record.js';
export { tallyElection } from './tally.js';
export type * from './types.js';
export { validateBallots, validateElection } from './validate.js';
