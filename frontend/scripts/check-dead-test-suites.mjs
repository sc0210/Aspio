#!/usr/bin/env node
/**
 * Fail when a Jest suite contributes no coverage at all.
 *
 * A suite that throws while loading — a bad `jest.mock` target, an incomplete
 * module mock, an import-time crash — reports "failed" but runs zero
 * assertions. Because this repo's CI never ran Jest, such suites sat green in
 * spirit for months while testing nothing, each one sitting directly on top of
 * a real bug:
 *
 *   - authService.test.ts mocked '@/services/apiClient', a module that does not
 *     exist. It collected zero tests while asserting a register route that also
 *     did not exist. Account registration was broken end to end.
 *   - 11 suites mocked react-i18next without initReactI18next, so lib/i18n threw
 *     at import and none of their 162 tests had ever executed.
 *
 * This check is deliberately narrow: it does NOT gate on failing assertions —
 * Jest's own exit code does that in CI. It gates only on the failure mode an
 * exit code cannot see: a suite that looks like it exists and does nothing.
 *
 * Usage:
 *   npx jest --json --outputFile=jest-results.json || true
 *   node scripts/check-dead-test-suites.mjs jest-results.json
 */

import { readFileSync } from 'node:fs';

/**
 * Suites permitted to run zero tests, with the reason. Keep this list empty if
 * you can; every entry is a suite that is silently contributing nothing.
 */
const ALLOWED_DEAD = new Map();

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error('usage: check-dead-test-suites.mjs <jest-results.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'));
} catch (error) {
  console.error(`Could not read Jest results from ${resultsPath}: ${error.message}`);
  console.error(
    '\nJest usually fails to write this file because the run died outright rather\n' +
      'than finishing with failures — most often a worker OOM taking the process\n' +
      'down with it. Check the Jest step above for "ran out of memory"; a suite\n' +
      'that heavy needs skipping via --testPathIgnorePatterns, not quarantining\n' +
      'here, because the report never gets written for this script to read.',
  );
  process.exit(2);
}

const suites = report.testResults ?? [];
if (suites.length === 0) {
  console.error('No test suites in the Jest report at all — refusing to pass.');
  process.exit(1);
}

const relative = (name) => name.split('/frontend/').pop();

const dead = [];
const skippedWholesale = [];

for (const suite of suites) {
  const path = relative(suite.name);
  const assertions = suite.assertionResults ?? [];

  if (assertions.length === 0) {
    dead.push({ path, reason: firstLine(suite.message) });
    continue;
  }
  // A fully-skipped suite executes nothing either. Called out separately so
  // nobody "fixes" a dead suite by skipping it — that would satisfy a naive
  // zero-assertion check while still testing nothing.
  if (assertions.every((a) => a.status === 'pending' || a.status === 'skipped')) {
    skippedWholesale.push({ path, reason: `all ${assertions.length} tests skipped` });
  }
}

function firstLine(message) {
  const line = (message ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('at ') && l !== '● Test suite failed to run')[0];
  return line ? line.slice(0, 120) : 'suite executed no tests';
}

const offenders = [...dead, ...skippedWholesale].filter(
  ({ path }) => !ALLOWED_DEAD.has(path),
);

const quarantined = [...dead, ...skippedWholesale].filter(({ path }) => ALLOWED_DEAD.has(path));

console.log(
  `Checked ${suites.length} suites — ${report.numTotalTests ?? '?'} tests collected, ` +
    `${report.numPassedTests ?? '?'} passing.`,
);

if (quarantined.length) {
  console.log(`\nQuarantined (known, allowed to run zero tests):`);
  for (const { path } of quarantined) {
    console.log(`  · ${path}\n      ${ALLOWED_DEAD.get(path)}`);
  }
}

if (offenders.length === 0) {
  console.log('\n✓ Every other suite ran at least one test.');
  process.exit(0);
}

console.error(`\n✗ ${offenders.length} suite(s) contributed no coverage:\n`);
for (const { path, reason } of offenders) {
  console.error(`  · ${path}`);
  console.error(`      ${reason}\n`);
}
console.error(
  'A suite that runs zero tests is worse than no suite: it looks like coverage\n' +
    'and provides none. Fix the load error, or delete the file. If it truly must\n' +
    'stay broken for now, add it to ALLOWED_DEAD in this script with a reason so\n' +
    'the exception is visible in review.',
);
process.exit(1);
