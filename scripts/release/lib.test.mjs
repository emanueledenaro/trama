import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  extractSection,
  groupCommits,
  isPrerelease,
  nextVersion,
  parseVersion,
  parseSubject,
  pullRequestNumber,
  releaseChangelog,
  uncitedCommits,
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

test('reads a beta pre-release', () => {
  assert.deepEqual(parseVersion('0.2.0-beta.3'), [0, 2, 0, 3]);
  assert.deepEqual(parseVersion('0.2.0'), [0, 2, 0, null]);
  assert.equal(isPrerelease('0.2.0-beta.1'), true);
  assert.equal(isPrerelease('0.2.0'), false);
});

test('refuses versions outside the policy', () => {
  for (const version of ['v0.2.0', '0.2', '0.2.0-rc.1', '0.2.0-beta', '0.2.0-beta.01', '0.2.0+build.1', '01.2.0']) {
    assert.throws(() => parseVersion(version), /is not a MAJOR/, version);
  }
});

test('orders pre-releases before their release', () => {
  assert.ok(compareVersions('0.2.0-beta.1', '0.2.0-beta.2') < 0);
  assert.ok(compareVersions('0.2.0-beta.10', '0.2.0-beta.9') > 0);
  assert.ok(compareVersions('0.2.0-beta.2', '0.2.0') < 0);
  assert.ok(compareVersions('0.2.0', '0.2.0-beta.2') > 0);
  assert.ok(compareVersions('0.2.0-beta.1', '0.1.9') > 0);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0-beta.1'), 0);
});

test('after a pre-release the next version is the release it previewed', () => {
  assert.equal(nextVersion('0.2.0-beta.2', [commit('fix: a')]), '0.2.0');
  assert.equal(nextVersion('0.2.0-beta.2', [commit('feat!: a')]), '0.2.0');
  assert.equal(nextVersion('0.2.0-beta.2', [commit('docs: a')]), null);
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
    Added: [`- **app:** Add the palette ([#5](${REPO}/pull/5)).`],
    Fixed: ['- Guard paths.'],
    Changed: ['- **BREAKING** **deps:** Require Node 24.'],
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

test('treats the version as plain text, not as a pattern', () => {
  assert.equal(extractSection(CHANGELOG, '0.1.*'), null);
  assert.equal(extractSection(CHANGELOG, '0.1'), null);
});

test('reads the pull request a merge subject ends with', () => {
  assert.equal(pullRequestNumber('feat(app): add the palette (#12)'), 12);
  assert.equal(pullRequestNumber('test(app): one clock (#321) (#321)'), 321);
  assert.equal(pullRequestNumber('Merge pull request #7 from owner/branch'), null);
  assert.equal(pullRequestNumber('fix: no number'), null);
});

test('skips the pull requests the changelog already cites', () => {
  const changelog = `## [Unreleased]\n\n### Added\n\n- Palette ([#5](${REPO}/pull/5)).\n- Templates ([#9](${REPO}/issues/9)).\n`;
  const commits = [commit('feat: palette (#5)'), commit('feat: search (#7)'), commit('fix: templates (#9)'), commit('fix: no number')];
  assert.deepEqual(
    uncitedCommits(commits, changelog, REPO).map((c) => c.subject),
    ['feat: search (#7)', 'fix: no number'],
  );
});

test('a link to another repository does not hide a pull request of this one', () => {
  const changelog = `## [Unreleased]\n\n### Fixed\n\n- Upstream bug ([other#123](https://github.com/other/project/issues/123)).\n- Old ([#4](${REPO}-fork/pull/4)).\n`;
  const commits = [commit('feat: own change (#123)'), commit('fix: old (#4)')];
  assert.deepEqual(
    uncitedCommits(commits, changelog, REPO).map((c) => c.subject),
    ['feat: own change (#123)', 'fix: old (#4)'],
  );
});

test('the first release keeps the hand-written notes and adds every pull request they miss', () => {
  const changelog = `# Changelog

## [Unreleased]

Reconstructed up to the 26th.

### Added

- Palette ([#5](${REPO}/pull/5)).
`;
  const history = [
    commit('feat(app): add the search (#8)'),
    commit('fix(app): guard paths (#7)'),
    commit('docs: update the README (#6)'),
    commit('feat(app): add the palette (#5)'),
    commit('Merge pull request #4 from owner/old-branch'),
  ];
  const result = releaseChangelog(changelog, {
    version: '0.2.0',
    date: '2026-09-28',
    previousTag: null,
    generated: groupCommits(uncitedCommits(history, changelog, REPO), REPO),
    repoUrl: REPO,
  });
  const section = extractSection(result, '0.2.0');
  assert.equal(
    section,
    [
      '### Added',
      '',
      `- Palette ([#5](${REPO}/pull/5)).`,
      `- **app:** Add the search ([#8](${REPO}/pull/8)).`,
      '',
      '### Fixed',
      '',
      `- **app:** Guard paths ([#7](${REPO}/pull/7)).`,
    ].join('\n'),
  );
  assert.equal(result.match(/\/pull\/5\)/g).length, 1);
});
