// Dependency license check used by .github/workflows/dependencies.yml and
// tested in lib.test.mjs. Reads the licenses that npm records in
// app/package-lock.json, so it needs no install and no network.

// Permissive licenses, plus MPL-2.0 (file-level copyleft, used unmodified by
// build tools), OFL-1.1 (bundled font) and Python-2.0 (argparse).
export const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
]);

// Packages whose license is not an SPDX identifier from the list above.
// Each entry needs a reason; a new package or license fails the check until
// a maintainer reviews it and adds it here.
export const EXCEPTIONS = [
  {
    pattern: /^@anthropic-ai\/claude-agent-sdk(-[a-z0-9-]+)?$/,
    reason:
      'Proprietary: Anthropic legal agreements (https://code.claude.com/docs/en/legal-and-compliance). ' +
      'Official SDK that runs the Claude provider.',
  },
];

/**
 * Evaluates an SPDX expression: identifiers, OR, AND (which binds tighter),
 * parentheses and `WITH` exceptions (judged by the license they modify).
 */
export function isAllowed(expression) {
  const tokens = (expression ?? '').replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let position = 0;
  const peek = () => tokens[position];
  const fail = () => {
    throw new Error(`unreadable SPDX expression "${expression}"`);
  };
  function primary() {
    const token = tokens[position++];
    if (token === '(') {
      const value = or();
      if (tokens[position++] !== ')') fail();
      return value;
    }
    if (token === undefined || token === ')' || token === 'OR' || token === 'AND' || token === 'WITH') fail();
    if (peek() === 'WITH') position += 2;
    return ALLOWED.has(token);
  }
  function and() {
    let value = primary();
    while (peek() === 'AND') {
      position += 1;
      value = primary() && value;
    }
    return value;
  }
  function or() {
    let value = and();
    while (peek() === 'OR') {
      position += 1;
      value = and() || value;
    }
    return value;
  }
  try {
    const value = or();
    return position === tokens.length && value;
  } catch {
    return false;
  }
}

export function packageName(path) {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** Returns the packages of a lockfile whose license is not allowed. */
export function checkLockfile(lockfile) {
  const problems = [];
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (path === '' || entry.link) continue;
    const name = packageName(path);
    if (EXCEPTIONS.some((exception) => exception.pattern.test(name))) continue;
    if (!isAllowed(entry.license)) {
      problems.push({ name, version: entry.version, license: entry.license ?? '(none)' });
    }
  }
  return problems;
}
