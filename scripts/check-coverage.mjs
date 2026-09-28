#!/usr/bin/env node
// Backend coverage gate (issue #686). Reads the `--experimental-test-coverage`
// report from stdin (or a file path argument), keeps only files under `src/`,
// and fails when their unweighted mean line/branch/function coverage drops
// below the floors below. Frontend `public/ts` is intentionally not gated.
//
// Floors sit a few points under the current values so ordinary churn doesn't
// trip CI; raise them as coverage improves.
//   usage: npm run test:coverage 2>&1 | node scripts/check-coverage.mjs
/* global console, process */
import fs from 'node:fs';

const FLOORS = { line: 82, branch: 80, funcs: 85 };

const input = fs.readFileSync(process.argv[2] ?? 0, 'utf-8');
const rows = [];
let inSrc = false;
for (const raw of input.split('\n')) {
  const m = raw.match(/^# ( *)(\S[^|]*?)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/);
  if (!m) continue;
  const [, indent, name, line, branch, funcs] = m;
  if (indent.length === 0) {
    inSrc = name === 'src';
    continue;
  }
  if (!inSrc || line.trim() === '') continue; // directory rows have empty metrics
  rows.push({ name, line: parseFloat(line), branch: parseFloat(branch), funcs: parseFloat(funcs) });
}

if (rows.length === 0) {
  console.error('check-coverage: no src/** rows found in the coverage report');
  process.exit(2);
}

const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
let failed = false;
console.log(`Backend (src/**) coverage across ${rows.length} files, unweighted mean:`);
for (const k of ['line', 'branch', 'funcs']) {
  const v = mean(k);
  const ok = v >= FLOORS[k];
  if (!ok) failed = true;
  console.log(
    `  ${k.padEnd(6)} ${v.toFixed(2)}%  (floor ${FLOORS[k]}%)  ${ok ? 'ok' : 'BELOW FLOOR'}`
  );
}
process.exit(failed ? 1 : 0);
