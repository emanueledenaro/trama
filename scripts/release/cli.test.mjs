// End-to-end check of cli.mjs on a throwaway git repository, so the history
// reading (first release without a tag, later releases from the last tag) is
// tested with real git, not only the helpers in lib.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('./cli.mjs', import.meta.url).pathname;
const REPO = 'https://github.com/emanueledenaro/trama';

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_SERVER_URL: '', GITHUB_REPOSITORY: '' },
  });
  return result;
}

function repository(changelog) {
  const dir = mkdtempSync(join(tmpdir(), 'trama-release-'));
  const git = (...args) => {
    const result = run(dir, 'git', args);
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  git('add', 'CHANGELOG.md');
  git('commit', '-q', '-m', 'docs: start the changelog (#1)');
  const commit = (subject) => git('commit', '-q', '--allow-empty', '-m', subject);
  return { dir, git, commit };
}

const HAND_WRITTEN = `# Changelog

## [Unreleased]

Reconstructed by hand up to the 26th.

### Added

- Palette ([#5](${REPO}/pull/5)).
`;

test('the first release, without a tag, lists every merged pull request the notes miss', (t) => {
  const { dir, commit } = repository(HAND_WRITTEN);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  commit('feat(app): add the palette (#5)');
  commit('fix(app): guard paths (#7)');
  commit('feat(app): add the search (#8)');
  commit('ci: check the branch names (#9)');

  const result = run(dir, process.execPath, [CLI, 'prepare', '0.2.0']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.2.0');

  const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  const notes = run(dir, process.execPath, [CLI, 'notes', '0.2.0']).stdout;
  assert.match(notes, /- Palette \(\[#5\]/);
  assert.match(notes, /- \*\*app:\*\* Add the search \(\[#8\]/);
  assert.match(notes, /### Fixed\n\n- \*\*app:\*\* Guard paths \(\[#7\]/);
  assert.doesNotMatch(notes, /#9|#1\]/);
  assert.equal(changelog.match(/\/pull\/5\)/g).length, 1);
  assert.match(changelog, /^## \[Unreleased\]\n\n## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}$/m);
  assert.match(changelog, new RegExp(`^\\[0\\.2\\.0\\]: ${REPO}/releases/tag/v0\\.2\\.0$`, 'm'));
});

test('a later release reads only the history since the last tag', (t) => {
  const { dir, git, commit } = repository(HAND_WRITTEN);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  commit('feat(app): add the palette (#5)');
  assert.equal(run(dir, process.execPath, [CLI, 'prepare', '0.2.0']).status, 0);
  git('commit', '-q', '-am', 'chore(release): v0.2.0 (#10)');
  git('tag', 'v0.2.0');
  commit('fix(app): keep the focus (#11)');

  const result = run(dir, process.execPath, [CLI, 'prepare']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.2.1');
  const notes = run(dir, process.execPath, [CLI, 'notes', '0.2.1']).stdout;
  assert.equal(notes.trim(), `### Fixed\n\n- **app:** Keep the focus ([#11](${REPO}/pull/11)).`);
});
