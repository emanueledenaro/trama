# Contributing to Trama

Thanks for your interest in Trama. This guide explains how to run the project, how to test a change and how a change reaches `main`. The project rules live in [AGENTS.md](AGENTS.md) and [docs/agents/](docs/agents/): this guide links to them instead of repeating them. When the two disagree, `AGENTS.md` wins.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Languages

Trama is an Italian project with an English face on GitHub. In short, as [AGENTS.md](AGENTS.md#lingua-del-codice) states:

- source code, identifiers, technical comments, log messages and commit messages are in English;
- the app interface, product documentation, issues and pull requests are in Italian;
- `README.md` and the community files (this guide, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`) are in English.

Italian text follows the Humanizer rules in [AGENTS.md](AGENTS.md#humanizer): plain sentences, no em or en dashes, no promotional tone.

## Getting started

Requirements: Git and Node.js 22. The README lists the optional tools and the providers ([Quick start](README.md#quick-start)).

```bash
git clone https://github.com/emanueledenaro/trama.git
cd trama/app
npm ci
npm run dev
```

Before changing the domain, read [CONTEXT.md](CONTEXT.md), the [ADRs](docs/adr/) and [docs/agents/domain.md](docs/agents/domain.md). Interface work follows Synara's tokens, sizes and components in `app/src/renderer` ([ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md)).

## Testing a change

Run these in `app/` before you open or update a pull request:

```bash
npx tsc --noEmit -p .   # type check
npx vitest run          # unit and integration tests
npm run build           # interface and main process
npm run ui-check        # Electron + Playwright with the fake Codex server
```

On Linux, run `ui-check` under a virtual display: `xvfb-run -a npm run ui-check`. It saves screenshots in `app/ui-check/`; when you change the interface, check both the light and the dark theme. If your environment cannot run Electron, say so in the pull request instead of reporting the check as passed.

The fake Codex server in `app/test-fixtures/` replies with fixed data. Its output, like any AI answer, is not evidence that a feature works: see the boundaries in [AGENTS.md](AGENTS.md#confini) and the records in [docs/verifiche/](docs/verifiche/).

The scripts at the repository root have their own tests, with no dependencies beyond Node:

```bash
node --test scripts/licenses/lib.test.mjs scripts/release/lib.test.mjs
```

## Commits

Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope][!]: <description>`, for example `feat(app): add the search palette`. The allowed types and the breaking change rules are in [AGENTS.md](AGENTS.md#commit-e-branch). This also applies to merge commits: to bring `main` into your branch, use

```bash
git fetch origin
git merge -m "chore: merge origin/main into <branch>" origin/main
```

rather than GitHub's "Update branch" button, whose default subject does not conform.

Commit types drive the version number and the changelog (see [Releases](#releases)), so pick them with care: `feat` for a new capability, `fix` for a bug fix, `!` or a `BREAKING CHANGE:` footer for an incompatible change.

## Branches

Branch names follow [Conventional Branch](https://conventionalbranch.org/): `<type>/<description>`, lowercase letters, digits and single hyphens, with the issue number when there is one, for example `feature/issue-142-assignment-contract`. The prefixes used in this repository are listed in [AGENTS.md](AGENTS.md#commit-e-branch). Dots appear only in release versions, such as `release/v1.2.0`.

## Pull requests

`main` is protected: every change goes through a pull request, and the required checks must pass before it is merged.

1. Open an issue first for anything larger than a small fix, so the change can be discussed. Issues use the templates in `.github/ISSUE_TEMPLATE/`.
2. Create your branch from the latest `main` and keep it up to date with the merge command above.
3. Give the pull request a Conventional Commits title and write the body in Italian. The [template](.github/PULL_REQUEST_TEMPLATE.md) asks what changes, which checks you ran and which issue it closes (`Closes #123`).
4. A maintainer reviews it ([CODEOWNERS](.github/CODEOWNERS)). The merge into `main` is a merge commit whose subject is the pull request title with its number, for example `feat(app): add the search palette (#123)`.

CI runs the type check, tests, build and `ui-check` ([electron.yml](.github/workflows/electron.yml)), CodeQL ([codeql.yml](.github/workflows/codeql.yml)) and the dependency checks ([dependencies.yml](.github/workflows/dependencies.yml)).

## Dependencies

Dependabot opens weekly pull requests for npm and GitHub Actions ([dependabot.yml](.github/dependabot.yml)). Every pull request runs a license check on `app/package-lock.json` ([scripts/licenses/](scripts/licenses/)): a dependency with a license outside the policy fails the build until a maintainer reviews it and records it in `scripts/licenses/lib.mjs`. Dependency review also blocks new dependencies with known high or critical vulnerabilities.

## AI agents and the AI Hero method

Many changes to Trama are made by AI coding agents, and Trama itself runs the same method. Agents and people follow the same rules:

- read [AGENTS.md](AGENTS.md) first, then [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md), [docs/agents/triage-labels.md](docs/agents/triage-labels.md) and [docs/agents/domain.md](docs/agents/domain.md);
- the project uses a local set of [Matt Pocock's skills](https://github.com/mattpocock/skills) in `.agents/skills/` ([setup](docs/agents/aihero-setup.md), [attribution](docs/aihero-attribution.md)): clarify with `grilling`, write the spec with `to-spec`, split the work with `to-tickets`, implement with `implement` and `tdd`, review with `code-review`;
- the skills are used with their original text. Trama adds only a thin binding to its own tools (`app/src/main/core/nativeSkills.ts`); do not paraphrase or edit the skill text.

## Releases

Versions follow [Semantic Versioning](https://semver.org/) and are computed from the Conventional Commits on `main`. Release tags are named `v<major>.<minor>.<patch>` and are **immutable**: a tag is never moved or deleted, and a wrong release gets a new version number.

1. **Prepare.** A maintainer runs the [Preparazione del rilascio](.github/workflows/release-prepare.yml) workflow from the Actions tab. With no input, it reads the first-parent history of `main` since the last `v*` tag, where each merge commit carries a pull request title, and picks the version: a breaking change bumps the major version (the minor version before 1.0.0), `feat` bumps the minor version, `fix` and `perf` bump the patch version. The first release needs an explicit version.
2. **Review.** The workflow moves the `[Unreleased]` notes of [CHANGELOG.md](CHANGELOG.md), merged with the entries generated from `feat`, `fix`, `perf`, `refactor` and `revert` commits, into a new section, sets the version in `app/package.json`, and opens the pull request `chore(release): vX.Y.Z` from the branch `release/vX.Y.Z`. The changelog can be edited in that pull request.
3. **Publish.** When the release pull request is merged, [Pubblicazione del rilascio](.github/workflows/release-publish.yml) sees a version with a changelog section and no tag. It creates a draft GitHub release with the changelog section as notes, builds the macOS, Windows and Linux packages with [release.yml](.github/workflows/release.yml), attaches them and publishes the release, which creates the tag on the merge commit.

The scripts behind these steps are in [scripts/release/](scripts/release/). Packages are signed and notarized only when the signing secrets are set.

## Questions

See [SUPPORT.md](SUPPORT.md).
