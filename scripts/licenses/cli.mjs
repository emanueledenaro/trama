#!/usr/bin/env node
// Usage: cli.mjs [path/to/package-lock.json]
import { readFileSync } from 'node:fs';
import { checkLockfile } from './lib.mjs';

const path = process.argv[2] ?? 'app/package-lock.json';
const problems = checkLockfile(JSON.parse(readFileSync(path, 'utf8')));
if (problems.length === 0) {
  console.log(`ok: every dependency in ${path} has an allowed license`);
  process.exit(0);
}
console.error(`License check failed for ${path}:`);
for (const { name, version, license } of problems) {
  console.error(`  - ${name}@${version}: ${license}`);
}
console.error('\nReview the license, then add it to ALLOWED or the package to EXCEPTIONS in scripts/licenses/lib.mjs.');
process.exit(1);
