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

// Conventional Branch 1.1.0 conformance fixtures, from
// https://github.com/conventional-branch/conventional-branch/blob/main/tests/fixtures.json
const BRANCH_FIXTURES = [
  ['main', true, 'trunk branch'],
  ['master', true, 'trunk branch'],
  ['develop', true, 'trunk branch'],
  ['feature/add-login-page', true, 'new feature'],
  ['feat/add-login-page', true, 'short alias for feature'],
  ['bugfix/fix-header-bug', true, 'bug fix'],
  ['fix/header-bug', true, 'short alias for bugfix'],
  ['hotfix/security-patch', true, 'urgent fix'],
  ['release/v1.2.0', true, 'release with dotted version'],
  ['chore/update-dependencies', true, 'non-code task'],
  ['feature/issue-123-new-login', true, 'feature with ticket number'],
  ['chore/123', true, 'digits-only description segment'],
  ['feature/a', true, 'single-character description'],
  ['ai/refactor-auth-flow', true, 'generic AI agent prefix'],
  ['claude/security-patch', true, 'Claude Code by Anthropic'],
  ['codex/optimize-query', true, 'OpenAI Codex'],
  ['copilot/add-login-page', true, 'GitHub Copilot'],
  ['cursor/fix-header-bug', true, 'Cursor'],
  ['Feature/Add-Login', false, 'uppercase letters not allowed'],
  ['Main', false, 'trunk branch must be lowercase'],
  ['feature/new--login', false, 'consecutive hyphens not allowed'],
  ['feature/-new-login', false, 'leading hyphen in description'],
  ['feature/new-login-', false, 'trailing hyphen in description'],
  ['feature/new..login', false, 'consecutive dots not allowed'],
  ['feature/.new', false, 'leading dot in description'],
  ['feature/new.', false, 'trailing dot in description'],
  ['release/v1.-2.0', false, 'hyphen adjacent to dot'],
  ['fix/header bug', false, 'spaces not allowed'],
  ['fix/header_bug', false, 'underscores not allowed'],
  ['unknown/some-task', false, 'unknown prefix type'],
  ['feature', false, 'prefixed type without a description'],
  ['feature/', false, 'empty description'],
  ['/add-login', false, 'missing type'],
  ['feature/a/b', false, 'description must not contain a slash'],
  // Repo-specific case: a plain docs/ prefix is not part of Conventional Branch.
  ['docs/old-tickets-audit', false, 'unknown prefix type'],
];

for (const [branch, valid, reason] of BRANCH_FIXTURES) {
  test(`branch "${branch}" is ${valid ? 'valid' : 'invalid'}: ${reason}`, () => {
    assert.equal(checkBranchName(branch).ok, valid);
  });
}
