// The verifier CLI: `ustp-tally verify <signed-record.json> --public-key <key.pem>`. It checks that
// the file is exactly RFC 8785 text, checks the signature, the seed, the ballot order, and the
// engine, re-runs the tally, and diffs it against the published result. This is the only code in
// the package that reads files or uses Node's crypto. Merkle roots, chains, anchors, and the count
// invariant arrive with runbook step P2.A2.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { canonicalBytes, canonicalize } from '../canonical-json.js';
import { assertSeed } from '../draw.js';
import { ENGINE } from '../engine.js';
import { TallyInputError } from '../errors.js';
import {
  parseRecord,
  recordHash,
  retallyRecord,
  type ElectionRecord,
  type RetallyOptions,
} from '../record.js';

export interface Io {
  readFile(path: string): string;
  out(line: string): void;
  err(line: string): void;
}

export const SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256';
const MAX_DIFFERENCES = 20;

const USAGE = [
  'Usage: ustp-tally verify <signed-record.json> --public-key <key.pem> [--seed-commitment <hex>]',
  '       ustp-tally --version',
  '',
  'Checks the signature on a USTP election record with the given ECDSA P-256 public key',
  '(SPKI PEM), re-runs the tally from its cast vote records and seed, and compares the result',
  'with the one the record publishes. --seed-commitment checks the seed against the commitment',
  'published before polls opened. Exit status: 0 verified, 1 a check failed, 2 bad input.',
];

class InputError extends Error {}

interface VerifyArgs {
  file: string;
  keyFile: string;
  seedCommitment?: string;
}

export function main(argv: readonly string[], io: Io): number {
  try {
    const [command, ...rest] = argv;
    if (command === '--version' || command === '-v') {
      io.out(`${ENGINE.name} ${ENGINE.version}`);
      return 0;
    }
    if (command === '--help' || command === '-h') {
      USAGE.forEach((line) => io.out(line));
      return 0;
    }
    if (command !== 'verify') throw new InputError('Expected a command.');
    return verifyCommand(parseVerifyArgs(rest), io);
  } catch (error) {
    if (error instanceof InputError) {
      io.err(printable(error.message));
      io.err('');
      USAGE.forEach((line) => io.err(line));
    } else {
      // Anything unexpected (input too deep or too large, for example) is a refusal, never a pass.
      io.err(printable(`Could not process the record: ${(error as Error).message}`));
      io.err('NOT verified.');
    }
    return 2;
  }
}

function parseVerifyArgs(args: readonly string[]): VerifyArgs {
  let file: string | undefined;
  let keyFile: string | undefined;
  let seedCommitment: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = () => inline ?? args[++i];
    if (flag === '--public-key') keyFile = value();
    else if (flag === '--seed-commitment') seedCommitment = value();
    else if (arg.startsWith('-')) throw new InputError(`Unknown option ${arg}.`);
    else if (file === undefined) file = arg;
    else throw new InputError(`Unexpected argument ${arg}.`);
  }
  if (!file) throw new InputError('Name the signed record to verify.');
  if (!keyFile) {
    throw new InputError('Give the public key to check its signature with --public-key.');
  }
  if (seedCommitment !== undefined) {
    try {
      assertSeed(seedCommitment, '--seed-commitment');
    } catch {
      throw new InputError('--seed-commitment must be 64 lowercase hex digits.');
    }
  }
  return { file, keyFile, ...(seedCommitment === undefined ? {} : { seedCommitment }) };
}

function read(io: Io, path: string): string {
  try {
    return io.readFile(path);
  } catch (error) {
    throw new InputError(`Could not read ${path}: ${(error as Error).message}`);
  }
}

function readPublicKey(io: Io, path: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(read(io, path));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`Could not read a public key from ${path}.`);
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new InputError(`${path} must be an ECDSA P-256 public key.`);
  }
  return key;
}

interface Envelope {
  text: string;
  parsed: unknown;
  record: unknown;
  signature: Buffer;
}

function readEnvelope(io: Io, path: string): Envelope {
  const text = read(io, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InputError(`${path} is not JSON.`);
  }
  const e = parsed as { record?: unknown; signature?: { algorithm?: unknown; value?: unknown } };
  const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : [];
  const sigKeys =
    typeof e.signature === 'object' && e.signature !== null ? Object.keys(e.signature) : [];
  if (
    keys.sort().join() !== 'record,signature' ||
    sigKeys.sort().join() !== 'algorithm,value' ||
    e.signature?.algorithm !== SIGNATURE_ALGORITHM ||
    typeof e.signature.value !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(e.signature.value)
  ) {
    throw new InputError(
      `${path} is not a signed election record: expected {"record": ..., "signature": {"algorithm": "${SIGNATURE_ALGORITHM}", "value": "<base64 DER>"}}.`,
    );
  }
  return { text, parsed, record: e.record, signature: Buffer.from(e.signature.value, 'base64') };
}

/**
 * True when the file is exactly the RFC 8785 text of what it parses to, with at most one final
 * newline. That refuses duplicate keys (JSON.parse keeps the last, a reader may see the first),
 * numbers that parse to something other than what they say, and anything else that lets the
 * bytes a person reads differ from the value that was checked.
 */
function isCanonicalText(envelope: Envelope): boolean {
  try {
    const body = envelope.text.endsWith('\n') ? envelope.text.slice(0, -1) : envelope.text;
    return canonicalize(envelope.parsed) === body;
  } catch {
    return false;
  }
}

function verifyCommand(args: VerifyArgs, io: Io): number {
  const envelope = readEnvelope(io, args.file);
  const key = readPublicKey(io, args.keyFile);
  const line = (status: 'pass' | 'FAIL' | 'info', name: string, detail: string) =>
    io.out(printable(`${status}  ${name.padEnd(12)} ${detail}`));
  const check = (ok: boolean, name: string, detail: string) =>
    line(ok ? 'pass' : 'FAIL', name, detail);
  io.out(printable(`${ENGINE.name} ${ENGINE.version}: verifying ${args.file}`));

  if (!isCanonicalText(envelope)) {
    check(
      false,
      'format',
      'the file is not exactly RFC 8785 JSON (duplicate keys, extra whitespace, or non-canonical numbers); a record writer must emit the canonical form',
    );
    io.out('NOT verified.');
    return 1;
  }

  const fingerprint = createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  let signatureOk: boolean;
  try {
    signatureOk = verify(
      'sha256',
      canonicalBytes(envelope.record),
      { key, dsaEncoding: 'der' },
      envelope.signature,
    );
  } catch {
    signatureOk = false;
  }
  check(
    signatureOk,
    'signature',
    `${signatureOk ? 'valid' : 'does not match'}: ECDSA P-256 with SHA-256 over the RFC 8785 record, key sha256:${fingerprint}`,
  );

  let record: ElectionRecord;
  try {
    record = parseRecord(envelope.record);
  } catch (error) {
    if (!(error instanceof TallyInputError)) throw error;
    check(false, 'record', error.message);
    io.out('NOT verified.');
    return 1;
  }
  line('info', 'record hash', `sha256:${recordHash(record)}`);
  const { name, version, integrity } = record.tally.engine;
  if (integrity !== undefined) {
    line('info', 'build hash', `${integrity}; compare: npm view ${name}@${version} dist.integrity`);
  }

  const options: RetallyOptions =
    args.seedCommitment === undefined ? {} : { seedCommitment: args.seedCommitment };
  const report = retallyRecord(record, options);
  for (const c of report.checks) check(c.ok, c.name, c.detail);
  for (const d of report.differences.slice(0, MAX_DIFFERENCES)) {
    io.out(printable(`      ${d.path}: expected ${show(d.expected)}, found ${show(d.found)}`));
  }
  if (report.differences.length > MAX_DIFFERENCES) {
    io.out(`      and ${report.differences.length - MAX_DIFFERENCES} more`);
  }

  const ok = signatureOk && report.ok;
  io.out(ok ? 'Verified.' : 'NOT verified.');
  return ok ? 0 : 1;
}

const show = (value: unknown) => (value === undefined ? 'nothing' : JSON.stringify(value));

// C0 and C1 controls, zero-width and bidirectional marks, line and paragraph separators, and the
// byte-order mark: anything that could make a line display differently from what it says.
const UNPRINTABLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
  ]
    .map(([from, to]) => `\\u{${from!.toString(16)}}-\\u{${to!.toString(16)}}`)
    .join('')}]`,
  'gu',
);

/** Escapes characters that could drive a terminal or reorder text taken from a record. */
export function printable(text: string): string {
  return text.replace(UNPRINTABLE, (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, '0')}`);
}
