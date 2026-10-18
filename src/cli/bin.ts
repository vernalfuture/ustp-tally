#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main } from './main.js';

process.exitCode = main(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, 'utf8'),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
