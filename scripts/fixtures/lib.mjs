// Shared helpers for the fixture converters. Node built-ins only, so anyone can re-run a
// converter on the file they downloaded and compare the output byte for byte.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Writes anonymous ballots one per line, in canonical sorted order. Each ballot here holds a single
 * contest with one key per object, so JSON.stringify already yields its RFC 8785 form.
 */
export function writeBallots(path, ballots) {
  const lines = ballots.map((b) => {
    if (Object.keys(b).length !== 1 || Object.keys(b.contests).length !== 1) {
      throw new Error('expected one contest per ballot');
    }
    return JSON.stringify(b);
  });
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  writeFileSync(path, `[\n${lines.join(',\n')}\n]\n`);
  return lines.length;
}

/** Reads one member of a zip archive (an .xlsx is a zip of XML parts). */
export function readZipEntry(zipPath, name) {
  const zip = readFileSync(zipPath);
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${zipPath} is not a zip archive`);
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLength);
    if (entryName === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`unsupported compression method ${method}`);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} not found in ${zipPath}`);
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Reads a worksheet into rows of { column letter: text }. */
export function readSheet(xlsxPath, sheetFile) {
  let shared = [];
  try {
    const xml = readZipEntry(xlsxPath, 'xl/sharedStrings.xml');
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
    );
  } catch {
    // A workbook without shared strings stores text inline.
  }
  const xml = readZipEntry(xlsxPath, `xl/worksheets/${sheetFile}`);
  return [...xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = /t="(\w+)"/.exec(c[2])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1];
      const text =
        type === 's' ? shared[Number(v)] : type === 'inlineStr' ? decode(inline ?? '') : v;
      if (text !== undefined && text !== '') cells[c[1]] = text.trim();
    }
    return cells;
  });
}

/**
 * Turns a candidate-to-rank map into a ranking, first choice first. Repeated or non-positive
 * ranks always fail. A skipped rank fails unless closeGaps is set, in which case the later
 * choices move up and the ballot is reported in `gaps`.
 */
export function rankingFromRanks(ranks, where, { closeGaps = false, gaps = [] } = {}) {
  const entries = Object.entries(ranks);
  const numbers = entries.map(([, r]) => r);
  for (const r of numbers) {
    if (!Number.isInteger(r) || r < 1) throw new Error(`${where}: bad rank ${r}`);
  }
  if (new Set(numbers).size !== numbers.length) throw new Error(`${where}: repeated rank`);
  if (Math.max(0, ...numbers) !== numbers.length) {
    if (!closeGaps) throw new Error(`${where}: ranks must run 1..${numbers.length}`);
    gaps.push({ where, ranks });
  }
  return entries.sort(([, a], [, b]) => a - b).map(([candidate]) => candidate);
}
