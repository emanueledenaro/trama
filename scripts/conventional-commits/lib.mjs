// Conventional Commits 1.0.0 and Conventional Branch 1.1.0 checks used by CI,
// the optional commit-msg hook and the tests in lib.test.mjs. No dependencies
// beyond Node's standard library.

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

export const TRUNK_BRANCHES = ['main', 'master', 'develop'];

export const BRANCH_TYPES = [
  'feature',
  'feat',
  'bugfix',
  'fix',
  'hotfix',
  'release',
  'chore',
  'ai',
  'claude',
  'codex',
  'copilot',
  'cursor',
];

// Conventional Branch 1.1.0: https://conventionalbranch.org/
const BRANCH_RE = new RegExp(
  `^(?:${TRUNK_BRANCHES.join('|')}|(?:${BRANCH_TYPES.join('|')})/[a-z0-9]+(?:\\.[a-z0-9]+)*(?:-[a-z0-9]+(?:\\.[a-z0-9]+)*)*)$`,
);

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

// The subject GitHub's "Update branch" button and a plain `git merge` give a
// merge of a trunk branch into a work branch, for example
// "Merge branch 'main' into feature/x". It is accepted only on a merge commit.
const BASE_MERGE_RE = new RegExp(
  `^Merge (?:remote-tracking )?branch '(?:origin/)?(?:${TRUNK_BRANCHES.join('|')})'(?: of \\S+)? into \\S+$`,
);

export function isBaseMergeSubject(subject) {
  return BASE_MERGE_RE.test((subject ?? '').split('\n')[0].trim());
}

/**
 * Checks one commit of a pull request. A merge commit may keep the subject git
 * gives a merge of main into the branch; every other commit follows checkHeader.
 */
export function checkCommit(subject, { isMerge = false } = {}) {
  if (isMerge && isBaseMergeSubject(subject)) {
    return ok();
  }
  return checkHeader(subject);
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
      `branch "${name}" does not follow Conventional Branch 1.1.0: use main, master or ` +
        `develop, or <type>/<description> with type one of ${BRANCH_TYPES.join(', ')}, ` +
        'a lowercase description of letters, digits and hyphens (dots only in release versions), ' +
        'for example feature/search-palette',
    );
  }
  return ok();
}
