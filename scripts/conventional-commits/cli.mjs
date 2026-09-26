#!/usr/bin/env node
// CLI used by the CI workflow (.github/workflows/conventional-commits.yml) and
// by the optional commit-msg hook (scripts/conventional-commits/hooks/commit-msg).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkHeader, checkBranchName } from './lib.mjs';

const HELP = `Usage:
  cli.mjs branch-name <name>
  cli.mjs pr-title <title>
  cli.mjs commit-range <base-sha> <head-sha>
  cli.mjs commit-msg-file <path>
`;

function reportAndExit(results) {
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    console.log('ok: conforms to Conventional Commits 1.0.0');
    process.exit(0);
  }
  console.error('Conventional Commits check failed:');
  for (const failure of failures) {
    console.error(`  - ${failure.reason}`);
  }
  console.error(
    '\nSee docs/agents/conventional-commits.md for the expected format.',
  );
  process.exit(1);
}

function branchName(name) {
  reportAndExit([checkBranchName(name)]);
}

function prTitle(title) {
  reportAndExit([checkHeader(title)]);
}

function commitRange(base, head) {
  const result = spawnSync('git', ['log', '--format=%H%x1f%s', `${base}..${head}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stderr || 'git log failed');
    process.exit(result.status ?? 1);
  }
  const lines = result.stdout.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    console.log('ok: no commits to check in this range');
    process.exit(0);
  }
  const results = lines.map((line) => {
    const [sha, subject] = line.split('\x1f');
    const check = checkHeader(subject);
    if (check.ok) return check;
    return { ok: false, reason: `${sha.slice(0, 7)}: ${check.reason}` };
  });
  reportAndExit(results);
}

function commitMsgFile(path) {
  const content = readFileSync(path, 'utf8');
  const header = content.split('\n')[0];
  reportAndExit([checkHeader(header)]);
}

const [, , command, ...args] = process.argv;

switch (command) {
  case 'branch-name':
    branchName(args[0]);
    break;
  case 'pr-title':
    prTitle(args[0]);
    break;
  case 'commit-range':
    commitRange(args[0], args[1]);
    break;
  case 'commit-msg-file':
    commitMsgFile(args[0]);
    break;
  default:
    console.error(HELP);
    process.exit(2);
}
