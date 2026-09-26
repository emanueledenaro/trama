// Conventional Commits 1.0.0 checks used by CI, the optional commit-msg hook
// and the tests in lib.test.mjs. No dependencies beyond Node's standard library.

export const TYPES = [
  'feat',
  'fix',
  'docs',
  'refactor',
  'test',
  'build',
  'ci',
  'chore',
  'perf',
  'style',
  'revert',
];

const HEADER_RE = new RegExp(
  `^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?(!)?: (.*)$`,
);

const BRANCH_RE = /^(feature|bugfix|hotfix)\/[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(reason) {
  return { ok: false, reason };
}

function ok() {
  return { ok: true };
}

/**
 * Checks a single commit or PR title header line against
 * `<type>[(scope)][!]: <description>`.
 */
export function checkHeader(header) {
  const line = (header ?? '').split('\n')[0].trim();
  if (line.length === 0) {
    return fail('the message is empty');
  }
  const match = HEADER_RE.exec(line);
  if (!match) {
    return fail(
      `"${line}" does not follow Conventional Commits 1.0.0: expected ` +
        `"<type>[(scope)][!]: <description>" with type one of ${TYPES.join(', ')}`,
    );
  }
  const description = match[4];
  if (description.trim().length === 0) {
    return fail(`"${line}" has an empty description`);
  }
  if (/^\s/.test(description)) {
    return fail(`"${line}" has extra spaces after the colon, use a single space`);
  }
  return ok();
}

export function checkCommitMessage(message) {
  return checkHeader(message);
}

export function checkPrTitle(title) {
  return checkHeader(title);
}

export function checkBranchName(branch) {
  const name = (branch ?? '').trim();
  if (name.length === 0) {
    return fail('the branch name is empty');
  }
  if (!BRANCH_RE.test(name)) {
    return fail(
      `branch "${name}" must match feature/, bugfix/ or hotfix/ followed by ` +
        'lowercase english words separated by hyphens, for example feature/search-palette',
    );
  }
  return ok();
}
