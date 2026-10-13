#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePhh } from './phh-state-machine-validator.js';

function filesAt(path) {
  const entry = statSync(path);
  if (entry.isFile()) return path.endsWith('.phh') ? [path] : [];
  const result = [];
  const queue = [path];
  while (queue.length) {
    const directory = queue.pop();
    for (const name of readdirSync(directory)) {
      const candidate = `${directory}/${name}`;
      if (statSync(candidate).isDirectory()) queue.push(candidate);
      else if (candidate.endsWith('.phh')) result.push(candidate);
    }
  }
  return result.sort();
}

const [target = 'phh', ...flags] = process.argv.slice(2);
const json = flags.includes('--json');
const paths = filesAt(resolve(target));
const results = paths.map((path) => ({ path, ...validatePhh(readFileSync(path, 'utf8')) }));
const summary = Object.fromEntries(['valid', 'invalid', 'unsupported'].map((status) => [status, results.filter((result) => result.status === status).length]));
const report = { files: results.length, summary, results: results.filter((result) => result.status !== 'valid') };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`PHH validation: ${summary.valid} valid, ${summary.invalid} invalid, ${summary.unsupported} unsupported (${results.length} files)`);
  for (const result of report.results) console.log(`${result.status.toUpperCase()} ${result.path}: ${result.reason || result.errors?.[0]?.message}`);
}
process.exitCode = summary.invalid > 0 ? 1 : 0;
