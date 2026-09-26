# Changelog

All notable changes to Trama are recorded in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Versions are computed from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and the release workflow writes each new section from the merge commits on `main`. Notes under `[Unreleased]` can be written by hand: the next release moves them into its section. See [Releases](CONTRIBUTING.md#releases) in the contributing guide.

## [Unreleased]

Trama has no release yet. The notes below are the first version, reconstructed from the pull requests merged into `main` up to 2026-09-26.

### Added

- Electron desktop app with Synara's interface, replacing the SwiftUI prototype ([#109](https://github.com/emanueledenaro/trama/pull/109)).
- Adapters for nine providers ported from Synara: Codex, Claude, Cursor, Grok, Droid, Devin, OpenCode, Antigravity and Pi ([#110](https://github.com/emanueledenaro/trama/pull/110)).
- Coordinator memory and learning loop ported from Hermes Agent ([#111](https://github.com/emanueledenaro/trama/pull/111)).
- Grilling in numbered rounds of decision cards before the plan ([#115](https://github.com/emanueledenaro/trama/pull/115)).
- Goals saved before their outcome, with a reopening test ([#116](https://github.com/emanueledenaro/trama/pull/116)).
- Layout that adapts to the window size ([#117](https://github.com/emanueledenaro/trama/pull/117)).
- Native skills engine, with the original `grilling` text and a Trama binding ([#132](https://github.com/emanueledenaro/trama/pull/132)).
- Every Matt Pocock skill in the package ([#133](https://github.com/emanueledenaro/trama/pull/133)).
- Settings and Connections as a page ([#136](https://github.com/emanueledenaro/trama/pull/136)).
- A full team in every project, with the moment of each role ([#149](https://github.com/emanueledenaro/trama/pull/149)).
- Computed phase and a single next step ([#150](https://github.com/emanueledenaro/trama/pull/150)).
- Withdraw questions, archive goals, delete empty conversations and queued messages ([#151](https://github.com/emanueledenaro/trama/pull/151)).
- Bug triage, diagnosis of failed checks and architecture review always on under a granted mandate ([#154](https://github.com/emanueledenaro/trama/pull/154)).
- The plan as a spec with `to-spec` ([#155](https://github.com/emanueledenaro/trama/pull/155)).
- A new mandate request supersedes the pending one ([#161](https://github.com/emanueledenaro/trama/pull/161)).
- Rename developers, with a colour and a tag for every agent ([#162](https://github.com/emanueledenaro/trama/pull/162)).
- Continuous work of the Coordinator within the mandate ([#164](https://github.com/emanueledenaro/trama/pull/164)).
- Focus bar and task queue ([#166](https://github.com/emanueledenaro/trama/pull/166)).
- Glossary and ADRs from decisions with `domain-modeling` ([#167](https://github.com/emanueledenaro/trama/pull/167)).
- Work split into vertical slices with `to-tickets` ([#168](https://github.com/emanueledenaro/trama/pull/168)).
- Presence through git, with consent and freshness ([#178](https://github.com/emanueledenaro/trama/pull/178)).
- A slice developer works with `implement` and `tdd` ([#180](https://github.com/emanueledenaro/trama/pull/180)).
- The Coordinator uses team presence ([#182](https://github.com/emanueledenaro/trama/pull/182)).
- Group view of who works on what ([#183](https://github.com/emanueledenaro/trama/pull/183)).
- Overlap warnings in the map, the focus bar and the chat ([#184](https://github.com/emanueledenaro/trama/pull/184)).
- Assignment contract and structured developer report ([#191](https://github.com/emanueledenaro/trama/pull/191)).
- Antigravity in every role, with a read-only hook profile ([#192](https://github.com/emanueledenaro/trama/pull/192)).
- Focus mode on a candidate with native code review ([#198](https://github.com/emanueledenaro/trama/pull/198)).
- Community files, issue and pull request templates, Dependabot, CodeQL, a dependency license check and the release workflow ([#210](https://github.com/emanueledenaro/trama/issues/210)).

### Changed

- One place for every panel, and the sidebar footer holds only Settings ([#135](https://github.com/emanueledenaro/trama/pull/135), [#153](https://github.com/emanueledenaro/trama/pull/153)).
- README in English with the structure of an open source project ([#159](https://github.com/emanueledenaro/trama/pull/159), [#160](https://github.com/emanueledenaro/trama/pull/160)).

### Removed

- **BREAKING** The SwiftUI app. Its sources stay in the git history ([#109](https://github.com/emanueledenaro/trama/pull/109)).

### Fixed

- The Coordinator turn closes in the project you leave ([#114](https://github.com/emanueledenaro/trama/pull/114)).
- Fixes from the first real run ([#112](https://github.com/emanueledenaro/trama/pull/112)).
- Grilling before the mandate, the plan after clarification, a single indicator ([#134](https://github.com/emanueledenaro/trama/pull/134)).
- Every button does what it says, on every screen ([#163](https://github.com/emanueledenaro/trama/pull/163)).
- `assign_task` assigns work only to developers ([#165](https://github.com/emanueledenaro/trama/pull/165)).
- Stable tests in the full suite under load ([#172](https://github.com/emanueledenaro/trama/pull/172)).
- Criteria checks, tests and `ui-check` for V04 and V05 on the Electron app ([#171](https://github.com/emanueledenaro/trama/pull/171)).
