// Converts the ballots USTP published for its 2019 Electronic Primary into anonymous ballots.
//   node scripts/fixtures/primary-2019.mjs USTP_Presidential_Primary_Election_Input_Parameters_into_Instant-Runoff_Voting_Tool.txt
// That file is what USTP entered into the Instant-Runoff Voting Tool: the candidate list, then one
// line per ballot giving each candidate's rank in list order. Kimberly Forsythe's mid-election
// withdrawal is already applied in it. Ballots are written in canonical sorted order.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rankingFromRanks, sha256File, writeBallots } from './lib.mjs';

const EXPECTED_SHA256 = 'ed2bad0a7f152db4a5293dc969d710cac64bdc1f44d35dfc30a6f0d278860184';
const CANDIDATES = [
  ['Johannon Ben Zion', 'ben-zion'],
  ['Kristan T. Harris', 'harris'],
  ['Rachel Haywire', 'haywire'],
  ['Charles Holsopple', 'holsopple'],
  ['John J. Kerecz', 'kerecz'],
  ['Jonathan Schattke', 'schattke'],
  ['Matt Taylor', 'taylor'],
  ['Vrillon', 'vrillon'],
  ['None of the Above', 'none-of-the-above'],
];

const [source] = process.argv.slice(2);
if (!source) throw new Error('usage: primary-2019.mjs <path to the .txt>');
const hash = sha256File(source);
if (hash !== EXPECTED_SHA256) throw new Error(`unexpected source file (sha256 ${hash})`);

const lines = readFileSync(source, 'utf8').split(/\r?\n/);
const names = lines.slice(2, 2 + CANDIDATES.length);
CANDIDATES.forEach(([name], i) => {
  if (names[i] !== name) throw new Error(`candidate ${i + 1} is "${names[i]}", expected "${name}"`);
});
const ballots = lines
  .filter((line) => /^\s*\d+(\s*,\s*\d+)+\s*$/.test(line))
  .map((line, n) => {
    const ranks = line.split(',').map((r) => Number(r.trim()));
    if (ranks.length !== CANDIDATES.length)
      throw new Error(`ballot ${n + 1} has ${ranks.length} ranks`);
    const byCandidate = Object.fromEntries(CANDIDATES.map(([, id], i) => [id, ranks[i]]));
    return { contests: { president: rankingFromRanks(byCandidate, `ballot ${n + 1}`) } };
  });

const out = fileURLToPath(new URL('../../fixtures/primary-2019/ballots.json', import.meta.url));
console.log(`wrote ${writeBallots(out, ballots)} ballots to ${out}`);
