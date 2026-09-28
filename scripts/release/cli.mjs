#!/usr/bin/env node
// CLI used by the release workflows. See CONTRIBUTING.md, "Releases".
//   cli.mjs prepare [version]   write the new CHANGELOG.md section, print the version
//   cli.mjs notes <version>     print the CHANGELOG.md section of a version
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  compareVersions,
  extractSection,
  groupCommits,
  nextVersion,
  parseVersion,
  releaseChangelog,
} from './lib.mjs';

const CHANGELOG = 'CHANGELOG.md';
const repoUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
    : 'https://github.com/emanueledenaro/trama';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function lastTag() {
  const result = spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Main uses merge commits whose subjects carry the PR title, so the first
// parent history gives one entry per pull request.
function commitsSince(tag) {
  const output = git('log', '--first-parent', '--format=%s%x1f%b%x1e', `${tag}..HEAD`);
  return output
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [subject, body] = record.split('\x1f');
      return { subject, body };
    });
}

function prepare(requested) {
  const tag = lastTag();
  const commits = tag ? commitsSince(tag) : [];
  let version = requested;
  if (version) {
    try {
      parseVersion(version);
    } catch (error) {
      fail(error.message);
    }
  } else {
    if (!tag) fail('no v* tag yet: pass the first version explicitly, for example 0.1.0');
    version = nextVersion(tag.slice(1), commits);
    if (!version) fail(`no feat, fix, perf or breaking change since ${tag}: nothing to release`);
  }
  if (tag && compareVersions(version, tag.slice(1)) <= 0) {
    fail(`${version} is not greater than the last tag ${tag}`);
  }
  if (git('tag', '--list', `v${version}`).trim()) fail(`tag v${version} already exists and tags are immutable`);

  const date = new Date().toISOString().slice(0, 10);
  let changelog;
  try {
    changelog = releaseChangelog(readFileSync(CHANGELOG, 'utf8'), {
      version,
      date,
      previousTag: tag,
      generated: groupCommits(commits, repoUrl),
      repoUrl,
    });
  } catch (error) {
    fail(error.message);
  }
  writeFileSync(CHANGELOG, changelog);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(version);
}

function notes(version) {
  const section = extractSection(readFileSync(CHANGELOG, 'utf8'), version ?? '');
  if (section === null) fail(`CHANGELOG.md has no section for ${version}`);
  console.log(section);
}

const [, , command, ...args] = process.argv;
switch (command) {
  case 'prepare':
    prepare(args[0]);
    break;
  case 'notes':
    notes(args[0]);
    break;
  default:
    console.error('Usage:\n  cli.mjs prepare [version]\n  cli.mjs notes <version>');
    process.exit(2);
}
