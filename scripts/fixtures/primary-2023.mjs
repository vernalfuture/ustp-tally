// Converts USTP's published 2023 Electronic Primary spreadsheet into anonymous ballots.
//   node scripts/fixtures/primary-2023.mjs USTP_Detailed_2023_Presidential_Primary_Vote_Results.xlsx
// Keeps only the three rank columns. The vote timestamp, assigned voter ID, and validation time in
// the spreadsheet are dropped, and the ballots are written in canonical sorted order.
import { fileURLToPath } from 'node:url';
import { rankingFromRanks, readSheet, sha256File, writeBallots } from './lib.mjs';

const EXPECTED_SHA256 = '18059dcd21c3fa8215709698d99e816d54a2a4cc5ca2f483a05037ea86a91d67';
const COLUMNS = {
  D: { header: '[ROSS, Thomas Ernest, Jr. (Tom Ross) - "Defragment America"]', id: 'ross' },
  E: { header: '[TWEDT, Daniel Emerson (Daniel Twedt) - ', id: 'twedt' },
  F: { header: '[None of the Above]', id: 'none-of-the-above' },
};

const [source] = process.argv.slice(2);
if (!source) throw new Error('usage: primary-2023.mjs <path to the .xlsx>');
const hash = sha256File(source);
if (hash !== EXPECTED_SHA256) throw new Error(`unexpected source file (sha256 ${hash})`);

const [header, ...rows] = readSheet(source, 'sheet1.xml');
for (const [column, { header: text }] of Object.entries(COLUMNS)) {
  if (!header[column]?.startsWith(text)) throw new Error(`column ${column} is not ${text}`);
}
const ballots = [];
// One validated ballot ranks Twedt 1 and Ross 3 with no 2nd choice. USTP counted it; its later
// choice moves up (fixtures/primary-2023/source.md). Any other irregularity stops the conversion.
const gaps = [];
for (const row of rows) {
  if (!row.C?.startsWith('Manually Validated')) continue;
  const ranks = {};
  for (const [column, { id }] of Object.entries(COLUMNS)) {
    if (row[column] !== undefined) ranks[id] = Number(row[column]);
  }
  const where = `validated ballot ${ballots.length + 1}`;
  const ranking = rankingFromRanks(ranks, where, { closeGaps: true, gaps });
  if (ranking.length === 0) throw new Error(`${where} ranks no one`);
  ballots.push({ contests: { president: ranking } });
}
if (gaps.length !== 1 || JSON.stringify(gaps[0].ranks) !== '{"ross":3,"twedt":1}') {
  throw new Error(`unexpected skipped ranks: ${JSON.stringify(gaps)}`);
}

const out = fileURLToPath(new URL('../../fixtures/primary-2023/ballots.json', import.meta.url));
console.log(`wrote ${writeBallots(out, ballots)} ballots to ${out}`);
console.log(`closed a skipped rank on 1 ballot: ${JSON.stringify(gaps[0].ranks)}`);
