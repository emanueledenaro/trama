import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLockfile, isAllowed, packageName } from './lib.mjs';

test('accepts permissive licenses and SPDX choices', () => {
  assert.equal(isAllowed('MIT'), true);
  assert.equal(isAllowed('(MIT OR CC0-1.0)'), true);
  assert.equal(isAllowed('GPL-3.0-only OR MIT'), true);
});

test('rejects copyleft, unknown and missing licenses', () => {
  assert.equal(isAllowed('GPL-3.0-only'), false);
  assert.equal(isAllowed('AGPL-3.0-or-later'), false);
  assert.equal(isAllowed('MIT AND GPL-2.0-only'), false);
  assert.equal(isAllowed('SEE LICENSE IN LICENSE.md'), false);
  assert.equal(isAllowed(undefined), false);
});

test('reads the package name from a nested lockfile path', () => {
  assert.equal(packageName('node_modules/vite/node_modules/@scope/pkg'), '@scope/pkg');
});

test('reports only packages outside the policy', () => {
  const problems = checkLockfile({
    packages: {
      '': { name: 'trama', license: 'MIT' },
      'node_modules/ok': { version: '1.0.0', license: 'ISC' },
      'node_modules/bad': { version: '2.0.0', license: 'GPL-3.0-only' },
      'node_modules/none': { version: '3.0.0' },
      'node_modules/@anthropic-ai/claude-agent-sdk': { version: '0.3.0', license: 'SEE LICENSE IN README.md' },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64': { version: '0.3.0', license: 'SEE LICENSE IN LICENSE.md' },
    },
  });
  assert.deepEqual(problems, [
    { name: 'bad', version: '2.0.0', license: 'GPL-3.0-only' },
    { name: 'none', version: '3.0.0', license: '(none)' },
  ]);
});
