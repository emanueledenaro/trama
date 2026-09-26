// Release helpers used by .github/workflows/release-prepare.yml and
// .github/workflows/release-publish.yml, tested in lib.test.mjs.
// No dependencies beyond Node's standard library.

const HEADER_RE =
  /^(feat|fix|docs|refactor|test|build|ci|chore|perf|style|revert)(?:\(([a-z0-9][a-z0-9-]*)\))?(!)?: (\S.*)$/;

// Keep a Changelog groups for the commit types that reach users.
// docs, test, build, ci, chore and style stay out of the changelog.
const GROUPS = {
  feat: 'Added',
  perf: 'Changed',
  refactor: 'Changed',
  revert: 'Changed',
  fix: 'Fixed',
};

const GROUP_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSubject(subject) {
  const match = HEADER_RE.exec((subject ?? '').trim());
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return { type, scope: scope ?? null, breaking: bang === '!', description };
}

export function parseVersion(version) {
  const match = SEMVER_RE.exec(version ?? '');
  if (!match) throw new Error(`"${version}" is not a MAJOR.MINOR.PATCH version`);
  return match.slice(1, 4).map(Number);
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/**
 * Computes the next version from Conventional Commits. Commits carry a
 * `subject` and an optional `body`, where a `BREAKING CHANGE:` footer also
 * marks a breaking change. Before 1.0.0 a breaking change bumps the minor
 * version, as SemVer allows for initial development. Returns null when no
 * commit calls for a release.
 */
export function nextVersion(current, commits) {
  const [major, minor, patch] = parseVersion(current);
  let level = 0; // 0 none, 1 patch, 2 minor, 3 major
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    const breaking = parsed.breaking || /^BREAKING[ -]CHANGE: /m.test(commit.body ?? '');
    if (breaking) level = Math.max(level, 3);
    else if (parsed.type === 'feat') level = Math.max(level, 2);
    else if (parsed.type === 'fix' || parsed.type === 'perf') level = Math.max(level, 1);
  }
  if (level === 0) return null;
  if (major === 0 && level === 3) level = 2;
  if (level === 3) return `${major + 1}.0.0`;
  if (level === 2) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function linkPullRequests(text, repoUrl) {
  return text.replace(/\(#(\d+)\)$/, `([#$1](${repoUrl}/pull/$1))`);
}

/** Groups commits into Keep a Changelog sections: { Added: [...], ... }. */
export function groupCommits(commits, repoUrl) {
  const groups = {};
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    const breaking = parsed.breaking || /^BREAKING[ -]CHANGE: /m.test(commit.body ?? '');
    const group = GROUPS[parsed.type];
    if (!group && !breaking) continue;
    const scope = parsed.scope ? `**${parsed.scope}:** ` : '';
    const marker = breaking ? '**BREAKING** ' : '';
    const line = `- ${marker}${scope}${linkPullRequests(parsed.description, repoUrl)}`;
    (groups[group ?? 'Changed'] ??= []).push(line);
  }
  return groups;
}

/** Parses the `### Group` blocks of a changelog section body. */
export function parseGroups(body) {
  const groups = {};
  let current = null;
  for (const line of body.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      groups[current] ??= [];
    } else if (current && line.trim().length > 0) {
      groups[current].push(line);
    }
  }
  return groups;
}

export function renderGroups(groups) {
  const names = [
    ...GROUP_ORDER.filter((name) => groups[name]?.length),
    ...Object.keys(groups).filter((name) => !GROUP_ORDER.includes(name) && groups[name].length),
  ];
  return names.map((name) => `### ${name}\n\n${groups[name].join('\n')}`).join('\n\n');
}

const UNRELEASED_RE = /^## \[Unreleased\][^\n]*\n/m;
const NEXT_SECTION_RE = /^## \[/m;
const LINKS_RE = /^\[[^\]]+\]: \S+$/m;

// Finds the `## [version]` heading line with plain string comparison, so the
// version never becomes part of a regular expression.
function findHeading(changelog, version) {
  const prefix = `## [${version}]`;
  let index = 0;
  for (const line of changelog.split('\n')) {
    if (line.startsWith(prefix)) return { index, length: line.length + 1 };
    index += line.length + 1;
  }
  return null;
}

/**
 * Moves the hand-written `## [Unreleased]` notes, merged with the generated
 * groups, into a new `## [version] - date` section and updates the links at
 * the bottom. The Unreleased heading stays, empty, for the next release.
 */
export function releaseChangelog(changelog, { version, date, previousTag, generated, repoUrl }) {
  const start = UNRELEASED_RE.exec(changelog);
  if (!start) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (findHeading(changelog, version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const bodyStart = start.index + start[0].length;
  const rest = changelog.slice(bodyStart);
  const nextSection = NEXT_SECTION_RE.exec(rest);
  const links = LINKS_RE.exec(rest);
  const bodyEnd = bodyStart + Math.min(nextSection?.index ?? rest.length, links?.index ?? rest.length);

  const groups = parseGroups(changelog.slice(bodyStart, bodyEnd));
  for (const [name, lines] of Object.entries(generated)) {
    groups[name] = [...(groups[name] ?? []), ...lines];
  }
  const rendered = renderGroups(groups);
  if (rendered.length === 0) throw new Error(`nothing to release in ${version}`);

  const section = `## [${version}] - ${date}\n\n${rendered}\n\n`;
  let result = `${changelog.slice(0, bodyStart)}\n${section}${changelog.slice(bodyEnd).replace(/^\n+/, '')}`;

  const tag = `v${version}`;
  const unreleasedLink = `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD`;
  const versionLink = previousTag
    ? `[${version}]: ${repoUrl}/compare/${previousTag}...${tag}`
    : `[${version}]: ${repoUrl}/releases/tag/${tag}`;
  if (/^\[Unreleased\]: .*$/m.test(result)) {
    result = result.replace(/^\[Unreleased\]: .*$/m, `${unreleasedLink}\n${versionLink}`);
  } else {
    result = `${result.trimEnd()}\n\n${unreleasedLink}\n${versionLink}\n`;
  }
  return result;
}

/** Returns the body of the `## [version]` section, for the release notes. */
export function extractSection(changelog, version) {
  const start = findHeading(changelog, version);
  if (!start) return null;
  const rest = changelog.slice(start.index + start.length);
  const nextSection = NEXT_SECTION_RE.exec(rest);
  const links = LINKS_RE.exec(rest);
  const end = Math.min(nextSection?.index ?? rest.length, links?.index ?? rest.length);
  return rest.slice(0, end).trim();
}
