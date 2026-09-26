import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  extractSection,
  groupCommits,
  nextVersion,
  parseSubject,
  releaseChangelog,
} from './lib.mjs';

const REPO = 'https://github.com/emanueledenaro/trama';
const commit = (subject, body = '') => ({ subject, body });

test('parses a conforming subject', () => {
  assert.deepEqual(parseSubject('feat(app)!: drop the palette (#12)'), {
    type: 'feat',
    scope: 'app',
    breaking: true,
    description: 'drop the palette (#12)',
  });
});

test('ignores a non conforming subject', () => {
  assert.equal(parseSubject('Merge pull request #1 from owner/branch'), null);
});

test('a fix bumps the patch version', () => {
  assert.equal(nextVersion('0.1.0', [commit('fix(app): guard paths'), commit('docs: typo')]), '0.1.1');
});

test('a feat bumps the minor version', () => {
  assert.equal(nextVersion('1.2.3', [commit('fix: a'), commit('feat: b')]), '1.3.0');
});

test('a breaking change bumps the major version from 1.0.0 on', () => {
  assert.equal(nextVersion('1.2.3', [commit('feat!: b')]), '2.0.0');
  assert.equal(nextVersion('1.2.3', [commit('refactor: b', 'BREAKING CHANGE: new format')]), '2.0.0');
});

test('a breaking change bumps the minor version before 1.0.0', () => {
  assert.equal(nextVersion('0.4.2', [commit('feat(app)!: b')]), '0.5.0');
});

test('no release without feat, fix, perf or breaking change', () => {
  assert.equal(nextVersion('0.1.0', [commit('docs: a'), commit('chore: merge origin/main into x')]), null);
});

test('compares versions numerically', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('groups commits into Keep a Changelog sections', () => {
  const groups = groupCommits(
    [
      commit('feat(app): add the palette (#5)'),
      commit('fix: guard paths'),
      commit('docs: update the README'),
      commit('build(deps)!: require Node 24'),
    ],
    REPO,
  );
  assert.deepEqual(groups, {
    Added: [`- **app:** add the palette ([#5](${REPO}/pull/5))`],
    Fixed: ['- guard paths'],
    Changed: ['- **BREAKING** **deps:** require Node 24'],
  });
});

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Added

- Hand-written note.

## [0.1.0] - 2026-09-26

### Added

- First.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

test('moves Unreleased notes and generated entries into the new section', () => {
  const result = releaseChangelog(CHANGELOG, {
    version: '0.2.0',
    date: '2026-10-01',
    previousTag: 'v0.1.0',
    generated: { Added: ['- Generated.'], Fixed: ['- A fix.'] },
    repoUrl: REPO,
  });
  assert.equal(
    result,
    `# Changelog

Intro.

## [Unreleased]

## [0.2.0] - 2026-10-01

### Added

- Hand-written note.
- Generated.

### Fixed

- A fix.

## [0.1.0] - 2026-09-26

### Added

- First.

[Unreleased]: ${REPO}/compare/v0.2.0...HEAD
[0.2.0]: ${REPO}/compare/v0.1.0...v0.2.0
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`,
  );
});

test('the first release links to its tag', () => {
  const result = releaseChangelog(`# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First.\n`, {
    version: '0.1.0',
    date: '2026-09-26',
    previousTag: null,
    generated: {},
    repoUrl: REPO,
  });
  assert.match(result, /^## \[0\.1\.0\] - 2026-09-26$/m);
  assert.match(result, new RegExp(`^\\[0\\.1\\.0\\]: ${REPO}/releases/tag/v0\\.1\\.0$`, 'm'));
  assert.match(result, new RegExp(`^\\[Unreleased\\]: ${REPO}/compare/v0\\.1\\.0\\.\\.\\.HEAD$`, 'm'));
});

test('refuses a version that already has a section', () => {
  assert.throws(
    () => releaseChangelog(CHANGELOG, { version: '0.1.0', date: 'x', previousTag: null, generated: {}, repoUrl: REPO }),
    /already has a section/,
  );
});

test('refuses an empty release', () => {
  const empty = `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-09-26\n\n### Added\n\n- First.\n`;
  assert.throws(
    () => releaseChangelog(empty, { version: '0.1.1', date: 'x', previousTag: 'v0.1.0', generated: {}, repoUrl: REPO }),
    /nothing to release/,
  );
});

test('extracts the notes of a version', () => {
  assert.equal(extractSection(CHANGELOG, '0.1.0'), '### Added\n\n- First.');
  assert.equal(extractSection(CHANGELOG, '9.9.9'), null);
});
