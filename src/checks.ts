// Checks shared by the tally record and the results file, and how their outcomes combine into a
// verdict. A check that needs something from outside the document, such as the seed commitment
// published before polls opened, is unchecked without it, and an unchecked check never verifies.
import { canonicalize } from './canonical-json.js';
import { assertSeed, seedCommitment } from './draw.js';
import { ENGINE, type EngineId } from './engine.js';
import { TallyInputError } from './errors.js';
import { expectObject, isPlainObject } from './validate.js';

export type CheckStatus = 'pass' | 'fail' | 'unchecked';

export interface Check {
  name: 'seed' | 'ballot order' | 'engine' | 'consistency' | 're-tally';
  status: CheckStatus;
  detail: string;
}

/**
 * `verified` when every check passed, `failed` when any failed, and `incomplete` when none failed
 * but at least one couldn't be made.
 */
export type Verdict = 'verified' | 'failed' | 'incomplete';

export function verdictOf(checks: readonly Check[]): Verdict {
  if (checks.some((c) => c.status === 'fail')) return 'failed';
  if (checks.some((c) => c.status === 'unchecked')) return 'incomplete';
  return 'verified';
}

/** Values the verifier takes from outside the document it checks. */
export interface PublishedValues {
  /** The seed commitment published at Scheduled. */
  seedCommitment?: string;
}

export function assertPublished(published: PublishedValues): void {
  if (published.seedCommitment !== undefined) {
    assertSeed(published.seedCommitment, 'seedCommitment');
  }
}

export function seedCheck(
  seed: { commitment: string; revealed: string },
  published?: string,
): Check {
  const hashed = seedCommitment(seed.revealed);
  if (hashed !== seed.commitment) {
    return {
      name: 'seed',
      status: 'fail',
      detail: `the revealed seed hashes to ${hashed}, not the document's commitment ${seed.commitment}`,
    };
  }
  if (published === undefined) {
    return {
      name: 'seed',
      status: 'unchecked',
      detail: `the revealed seed matches the document's own commitment ${seed.commitment}, so it only agrees with itself; give the commitment published before polls opened`,
    };
  }
  return published === seed.commitment
    ? {
        name: 'seed',
        status: 'pass',
        detail: `the revealed seed matches the published commitment ${published}`,
      }
    : {
        name: 'seed',
        status: 'fail',
        detail: `the document's commitment ${seed.commitment} is not the published commitment ${published}`,
      };
}

export function engineCheck({ name, version }: EngineId): Check {
  return name === ENGINE.name && version === ENGINE.version
    ? {
        name: 'engine',
        status: 'pass',
        detail: `counted with ${name} ${version}, the version running here`,
      }
    : {
        name: 'engine',
        status: 'fail',
        detail: `counted with ${name} ${version}, but this is ${ENGINE.name} ${ENGINE.version}; verify with the version that counted it`,
      };
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;

function expectPattern(value: unknown, pattern: RegExp, path: string, what: string): void {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TallyInputError(path, `must be ${what}`);
  }
}

export function expectSeedPair(value: unknown, path: string): void {
  const seed = expectObject(value, path, { required: ['commitment', 'revealed'] });
  assertSeed(seed.commitment, `${path}.commitment`);
  assertSeed(seed.revealed, `${path}.revealed`);
}

/** The engine and results under `tally`. Results are only compared, so they need only be JSON. */
export function expectTally(value: unknown, path: string): void {
  const tally = expectObject(value, path, { required: ['engine', 'results'] });
  const engine = expectObject(tally.engine, `${path}.engine`, {
    required: ['name', 'version'],
    optional: ['integrity'],
  });
  // Registry formats only, so nothing else can reach the `npm view` line the verifier prints.
  expectPattern(engine.name, NPM_NAME, `${path}.engine.name`, 'an npm package name');
  expectPattern(engine.version, SEMVER, `${path}.engine.version`, 'a semantic version');
  if (engine.integrity !== undefined) {
    expectPattern(engine.integrity, SHA512_SRI, `${path}.engine.integrity`, 'sha512-<base64>');
  }
  if (!isPlainObject(tally.results)) {
    throw new TallyInputError(`${path}.results`, 'must be an object');
  }
  try {
    canonicalize(tally.results);
  } catch (error) {
    throw new TallyInputError(`${path}.results`, (error as Error).message);
  }
}
