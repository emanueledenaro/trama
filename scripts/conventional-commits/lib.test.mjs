import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHeader, checkBranchName } from './lib.mjs';

test('accepts a conforming commit header', () => {
  assert.equal(checkHeader('feat(app): add the search palette').ok, true);
});

test('accepts a header without a scope', () => {
  assert.equal(checkHeader('chore: merge origin/main into feature/x').ok, true);
});

test('accepts a breaking change marker', () => {
  assert.equal(checkHeader('feat(app)!: drop the legacy palette').ok, true);
});

test('rejects an unknown type', () => {
  const result = checkHeader('update: tweak the palette');
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not follow Conventional Commits/);
});

test('rejects a GitHub default merge subject', () => {
  assert.equal(checkHeader('Merge pull request #42 from owner/branch').ok, false);
});

test('rejects a default git merge subject', () => {
  assert.equal(checkHeader("Merge branch 'main' into feature/x").ok, false);
});

test('rejects an empty description', () => {
  assert.equal(checkHeader('feat(app):').ok, false);
});

test('rejects a description with extra spaces after the colon', () => {
  assert.equal(checkHeader('feat(app):  add the search palette').ok, false);
});

test('rejects an uppercase type', () => {
  assert.equal(checkHeader('Feat(app): add the search palette').ok, false);
});

test('accepts a valid feature branch name', () => {
  assert.equal(checkBranchName('feature/search-palette').ok, true);
});

test('accepts a valid branch name with digits', () => {
  assert.equal(checkBranchName('bugfix/fix-crash-42').ok, true);
});

test('accepts a valid hotfix branch name', () => {
  assert.equal(checkBranchName('hotfix/guard-reveal-paths').ok, true);
});

test('rejects a branch without an allowed prefix', () => {
  assert.equal(checkBranchName('docs/old-tickets-audit').ok, false);
});

test('rejects an uppercase branch name', () => {
  assert.equal(checkBranchName('feature/Search-Palette').ok, false);
});

test('rejects a claude-prefixed branch name', () => {
  assert.equal(checkBranchName('claude/c-tickets-audit-x').ok, false);
});

test('rejects a branch with underscores', () => {
  assert.equal(checkBranchName('feature/search_palette').ok, false);
});
