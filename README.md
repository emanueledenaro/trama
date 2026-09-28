<div align="center">

<img src="docs/brand/trama-app-icon.svg" alt="Trama app icon: two ribbons woven into a T" width="112">

# Trama

**A desktop app that coordinates AI coding agents on your repository and keeps every decision, task and check tied to the change it belongs to.**

[![CI](https://github.com/emanueledenaro/trama/actions/workflows/electron.yml/badge.svg)](https://github.com/emanueledenaro/trama/actions/workflows/electron.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)
[![Latest release](https://img.shields.io/github/v/release/emanueledenaro/trama?include_prereleases&label=release)](https://github.com/emanueledenaro/trama/releases)
[![CodeQL](https://github.com/emanueledenaro/trama/actions/workflows/codeql.yml/badge.svg)](https://github.com/emanueledenaro/trama/actions/workflows/codeql.yml)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Providers](#providers) · [Status](#status-and-known-limits) · [Contributing](#contributing)

<img src="docs/images/readme/candidate.png" alt="Trama showing a verified candidate with its decisions, check results and diff" width="860">

<sub>The sample project with a candidate, its linked decision, the check results and the diff Trama captured. Screenshot taken on Linux with the fake Codex server used by the tests.</sub>

</div>

> [!WARNING]
> Trama is in **alpha**. The base path has run with real Claude and Pi accounts. The first live run with real Codex (26 September, `gpt-6-luna`) went from a request to a developer's finished worktree, then stopped short of a verified candidate on a known bug ([verification log](docs/verifiche/v04-v05.md), [#204](https://github.com/emanueledenaro/trama/issues/204)). Read [Status and known limits](#status-and-known-limits) before relying on it.

## Why Trama

Coding agents are good at writing code and bad at remembering why. Decisions end up scattered across chat threads, an agent reports tests it never ran, and nobody can say which answer a given diff was based on.

Trama puts one **Coordinator** between you and the agents:

- You make the product decisions. The Coordinator asks, you answer, and only your answers become rules for the project (the **Pact**).
- You set how far it can go on its own (the **mandate**). Anything outside it needs you.
- Agents work in their own git worktrees. Trama runs the checks itself and ties the results to the exact diff, the decisions it depends on and the goal it serves. An AI saying "tests pass" is never taken as evidence.

## Features

- **The AI Hero method, run natively.** A request is clarified in numbered rounds with `grilling`; `domain-modeling` proposes glossary terms and ADRs from the decisions taken; `to-spec` turns the plan into a spec with the seams you confirm; `to-tickets` splits it into vertical slices with their acceptance criteria. Each developer ships a slice with `implement` and `tdd`. Bug triage, failed-check diagnosis and Clean Code's architecture review start on their own within the mandate. Every skill keeps Matt Pocock's original text, with a thin Trama binding.
- **A focused work loop.** The chat leads with the task in focus, its phase and the one next step allowed right now; the rest wait in a queue, started ones first. Inside the mandate the Coordinator takes its own next moves - preparing the plan, assigning work, running checks - and stops only for the person: product decisions, confirming the shared understanding, the mandate, the team, the seams and the slices proposed in the plan, and the merge.
- **A compact history.** Each work turn is one line in the chat, who worked, for how long, how many tools and errors; it opens on the spot into Activity's own "Passi tecnici" list, with repeated steps and empty notes grouped and counted instead of listed one by one. A resolved card, a decision answered, a mandate granted, a slice closed, collapses to a single outcome line; anything still waiting on you, or still actionable, stays open ([verification log](docs/verifiche/u06-cronologia-compatta-2026-09-28.md)).
- **Plain language, real names.** Cards, the inspector and Activity call a decision, a task or a candidate by its name, with the technical id only on hover; comparisons, cross-references and internal codes are written as short sentences instead of ids and constants ([verification log](docs/verifiche/u05-linguaggio-umano-2026-09-28.md)).
- **Merges the clear-cut candidates itself.** A verified candidate that already has the Coordinator's green light, and the mandate to integrate, is published and merged on its own once its checks are green; Activity and the summary record it. A candidate that touches the interface never merges itself: it waits for you in Aspetta te with before-and-after screenshots, light and dark, to approve or reject ([verification log](docs/verifiche/a07-unione-con-via-libera-2026-09-28.md)).
- **An assignment contract and a developer's report.** Every task carries its goal, the seams to test, the Pact decisions it depends on and the checks required; Trama refuses an incomplete one. Each developer closes with a structured report of files touched, tests written and seams covered - a claim, never evidence.
- **Developers can ask, and pause.** A developer with a doubt asks the Coordinator through a tool; the slice pauses and the developer is freed while dependent slices wait. The Coordinator answers from facts, or opens a Pact decision when the answer blocks the work, and the assignment resumes in the same worktree once it is answered ([#202](https://github.com/emanueledenaro/trama/pull/202)).
- **A Clean Code standard, measured by Trama.** Work in a worktree gets Trama's own Clean Code standard, after a project's own rules and the native skills. Trama measures the argument count and length of every function the candidate adds or touches, and duplicated blocks on the added lines, as evidence for the technical review; a finding on naming, hidden side effects or duplication always blocks. Rules are configurable per project in Settings ([#201](https://github.com/emanueledenaro/trama/pull/201)).
- **Every candidate reviewer, in parallel.** Before a candidate reaches you, Trama runs the checks still missing, then the whole candidate team reviews the diff at once: spec reviewer, Clean Code with the technical review, regression guardian, security, performance, UX, DevOps and documentation. The guardian runs the candidate's build and tests on its base commit and compares them; a test that passed and now fails blocks the candidate. A reviewer with nothing to say signs "Niente da segnalare"; a blocking finding goes back to the developer, who resumes in the same worktree.
- **Presence and collaboration.** The Group view's "Who works on what" board, the map and the focus bar show who, person or agent, is working on which branch and files, shared over dedicated git refs with your consent. Overlaps are flagged at three levels, same module, same file, real conflict, and the Coordinator itself steers new assignments away from files a colleague already has open.
- **Focus mode with native code review.** Open a candidate and Trama runs its real checks first, then two read-only passes of the `code-review` skill in parallel, Standards and Spec, against the candidate's base commit. Each finding carries a proof: Trama rechecks the ones it can run, a stronger model confirms serious ones Trama cannot, and the rest are shown as hypotheses.
- **Nine providers, every role.** Codex, Claude, Cursor, Grok, Droid, Devin, OpenCode, Antigravity and Pi behind one runtime interface. Antigravity now works in every role, not only for developers: read-only for the Coordinator, planners, reviewers and checks, edits only inside a developer's own worktree. Each adapter reads context usage the way its provider actually reports it; a reading outside the provider's real window shows as unavailable instead of a wrong number ([#318](https://github.com/emanueledenaro/trama/pull/318)).
- **Understandable provider and GitHub errors.** A rate limit, an expired quota, a missing login or an unreachable provider get a plain explanation and the matching action, retry, change model or provider, add your key, log in again, never a raw error payload. On a temporary limit the Coordinator and specialists wait with a growing backoff and resume the work themselves.
- **A publishing standard.** Trama reads a project's own conventions first (`AGENTS.md`, `CONTRIBUTING.md`, commitlint config, existing branch prefixes) and falls back to Conventional Commits and Conventional Branch. It writes the commit message and branch name itself, and publishes a candidate only when it is verified, the message is valid, no secrets or sensitive files are staged, `git diff --check` is clean, the linked issue exists and no Pact question is still open ([its ADR](docs/adr/0016-conventional-commits-e-standard-di-pubblicazione.md)).
- **A guided first run, in your language.** A brief animated intro leads into a Welcome flow that opens with your language, Italian or English, then connecting a provider, GitHub and the AI Hero method, each step skippable and resumable later; the same choice lives in Settings, General. The project picker then lists your recents with their phase, blockers and active colleagues, next to opening a folder, cloning from GitHub or trying the sample project.
- **Editorial typography, a native feel.** Chat messages, cards and markdown content are set in Newsreader; the interface stays in Inter, code in JetBrains Mono, all three bundled with the app so nothing loads over the network ([verification log](docs/verifiche/tipografia-editoriale-2026-09-28.md)). Panel separators follow VS Code's own sash, no line at rest, a 1px border, the provider's accent only on hover or drag, and the app's own woven-ribbon icon shows on macOS, Windows and Linux, packaged or run from source.
- **Checks Trama runs itself.** `git_status`, `git_diff_check`, `swift_build`, `swift_test`, `node_test` and `node_typecheck`, with Node checks in a sandbox that allows only local networking.
- **Goals with examples.** Outcomes with accepted and rejected examples that tasks, candidates and decisions link to explicitly.
- **Memory and learning.** The Coordinator keeps notes on you and the project, searches past conversations and maintains the skills it learns.
- **Repository map.** Swift and JavaScript/TypeScript projects are indexed into modules from their real paths, with secrets and symlinks excluded.

<table>
  <tr>
    <td width="33%"><img src="docs/images/readme/decision.png" alt="A decision card with two alternatives and a free answer field"></td>
    <td width="33%"><img src="docs/images/readme/team.png" alt="The Team panel listing fixed roles and developers by moment"></td>
    <td width="33%"><img src="docs/images/readme/focus-mode.png" alt="Focus mode on a candidate, with its real checks and the Standards and Spec review"></td>
  </tr>
  <tr>
    <td align="center"><sub>A decision card: a concrete case, alternatives with examples, or your own words.</sub></td>
    <td align="center"><sub>The team, moment by moment.</sub></td>
    <td align="center"><sub>Focus mode: real checks first, then Standards and Spec in parallel.</sub></td>
  </tr>
</table>

The app interface is in Italian, except the first-launch language choice and the Settings page, which also ship in English ([#303](https://github.com/emanueledenaro/trama/pull/303)); the rest of the English translation is still underway. Most of the documentation in `docs/` is in Italian.

## Quick start

There is no signed release yet, so Trama runs from source.

**Requirements**

- macOS, Linux or Windows, with Git and Node.js 22.
- At least one provider you are already signed in to from its CLI. For Codex this means a **ChatGPT account**: Trama refuses API keys and non-OpenAI providers for Codex, so it never moves you to API billing silently.
- Optional: [GitHub CLI](https://cli.github.com/) (`gh auth login`) for issues, pull requests and presence.
- Optional: `bubblewrap` on Linux, so Node tests that open a local server can run in Trama's sandbox. macOS uses the built-in `sandbox-exec`.

**Run it**

```bash
git clone https://github.com/emanueledenaro/trama.git
cd trama/app
npm install
npm run dev
```

**First steps**

1. On first launch, the Welcome flow asks you to connect a provider, optionally GitHub, and set up the AI Hero method; skip or resume any step later from the Help (Aiuto) menu.
2. From the project picker, open a folder, clone one from GitHub, or try the sample project.
3. Read the Coordinator's study of the project and confirm the developers it proposes.
4. Send a request. Pick a module as context with `@` or a skill with `/`.
5. Answer the rounds of questions and the mandate card. Only your answers enter the Pact and the mandate.
6. Follow the focus bar for the task in focus and the queue behind it. Inside the mandate, the Coordinator keeps moving between rounds on its own, and merges a clear-cut candidate itself; you step in for product decisions, the mandate, the team and anything that changes the interface.

## How it works

```mermaid
flowchart LR
    R[Request] --> G[Grilling rounds]
    G -->|your answers| P[Pact]
    P --> PL[Spec and slices]
    PL -->|within the mandate| A[Assignment contract in worktrees]
    A --> C[Candidate]
    C --> V[Checks, reviewer gate and focus mode]
    V --> M{Green light and interface check}
    M -->|no interface change| PR[Trama merges it]
    M -->|changes the interface| AP[Your approval]
    AP --> PR
```

1. **Clarify.** The Coordinator reads the code for facts and asks you only what the code cannot answer, one round at a time, with `grilling`.
2. **Decide.** Each answer is a versioned decision in the Pact. Changing a decision invalidates only the work that depended on it.
3. **Plan.** `to-spec` writes the request as a spec with the seams you confirm; `to-tickets` splits it into vertical slices in dependency order.
4. **Delegate.** Within the mandate, the Coordinator assigns ready slices to developers, one each, through an assignment contract: goal, seams, decisions and checks required. Each works in a dedicated worktree with `implement` and `tdd`, and closes with a structured report.
5. **Verify.** A candidate carries its diff, the decisions it relies on and the check results Trama ran itself. Then every candidate reviewer examines the diff in parallel, and a regression or a blocking finding sends the work back to its developer. Focus mode adds a read-only Standards and Spec review on demand. A later relevant change revokes the approval.
6. **Publish.** Trama writes a Conventional Commit and branch name by its publishing standard and opens the pull request through `gh`. A candidate with the Coordinator's own green light and nothing touching the interface merges there and then; one that changes the interface waits for your explicit approval, with before-and-after screenshots.

Throughout, presence shows who else is on the same files, and the Coordinator avoids assigning work where a colleague already has it open.

The vocabulary (Coordinator, Pact, mandate, candidate, moment, presence, focus mode) is defined in [CONTEXT.md](CONTEXT.md), and the reasons behind the design are in the [ADRs](docs/adr/).

## Providers

| Provider | Adapter | Tested with a real account |
| --- | --- | --- |
| Codex (ChatGPT) | yes | Live in the Electron app on 26 September with real `gpt-6-luna`: study, team, mandate, assignment contract and a developer's finished worktree. Stopped before a verified candidate, on a bug in `verify_candidate` ([verification log](docs/verifiche/v04-v05.md), [#204](https://github.com/emanueledenaro/trama/issues/204)) |
| Claude | yes | Base path: message, Trama tool, interrupt, restart, resume |
| Pi | yes | Base path: message, Trama tool, interrupt, restart, resume |
| Cursor, Grok, Devin, OpenCode | yes | No, fake CLIs and servers only |
| Antigravity | yes | No, fake CLI only. Every role: read-only for the Coordinator, planners, reviewers and checks, edits only in a specialist's worktree, never shell or network |
| Droid | yes | No. Not detected on the test machine |

The adapters are written in TypeScript in the main process ([ADR 0012](docs/adr/0012-provider-in-typescript.md)). Credentials stay with each provider's official CLI. Trama does not read `auth.json` or copy tokens.

## Configuration

| Variable | Purpose |
| --- | --- |
| `TRAMA_CODEX_PATH` | Codex executable to use instead of the one in `PATH` |
| `TRAMA_DATA_DIR` | Data folder to use instead of the default |

Data lives in the user data folder under `Trama/Desktop`: `~/Library/Application Support/Trama/Desktop` on macOS, `~/.config/Trama/Desktop` on Linux, `%APPDATA%\Trama\Desktop` on Windows. What the Coordinator learns is stored under `Learning/` in the same folder, never in your repository. Presence is shared over `refs/trama/presence/<user>` on your project's `origin`, only with your consent, never in the repository itself. On first launch Trama imports recent projects from the former SwiftUI version without modifying its files.

## Development

All commands run in `app/`:

```bash
npm run dev         # Vite + main process + Electron
npm run typecheck   # type check
npm test            # unit and integration tests (Vitest)
npm run build       # build the interface and the main process
npm start           # build and launch
npm run ui-check    # launch with a fake Codex and save screenshots in ui-check/
npm run dist        # package with electron-builder
```

<details>
<summary>Project structure</summary>

| Path | Contents |
| --- | --- |
| `app/src/main` | Main process: repository scanner, Coordinator, MCP tool server on `127.0.0.1`, Pact, mandate, team, goals, checks, presence, GitHub, persistence |
| `app/src/main/core/providers` | The nine provider adapters behind `AgentRuntime` |
| `app/src/main/core/learning` | Coordinator memory, past conversation search, learned skills, experience review and weekly skill upkeep ([ADR 0014](docs/adr/0014-apprendimento-del-coordinatore.md)) |
| `app/src/main/core/nativeSkills.ts` | Delivers a bundled skill unchanged, with a binding to Trama's tools |
| `app/src/main/core/audit.ts` | Focus mode: real checks first, then the `code-review` skill on two read-only sessions |
| `app/src/main/core/gate.ts` | Candidate gate: the checks, then every candidate reviewer in parallel, the suite on base and candidate, the return to the developer |
| `app/src/main/core/merge.ts` | Merges a candidate with the Coordinator's own green light, or holds it in Aspetta te when it changes the interface |
| `app/src/main/core/auditFindings.ts` | Focus mode findings: Trama rechecks each proof, a stronger model confirms serious ones |
| `app/src/main/core/presence.ts` | Presence over dedicated git refs, and overlap checks against colleagues' branches |
| `app/src/main/core/conventions.ts`, `app/src/main/core/quality.ts` | Reads a project's own commit and branch conventions, and gates publishing on the standard |
| `app/src/preload` | Typed IPC bridge. The renderer has no Node access |
| `app/src/renderer` | React, Tailwind CSS 4 and `@base-ui/react` on Trama's design tokens |
| `app/src/renderer/components/brand` | `TramaMark`, the app's woven-ribbon glyph, tinted to each provider's accent |
| `app/src/shared` | Shared types and logic: timeline, grilling rounds, team roster, presence, overlap |
| `app/resources/AIHero` | Bundled skills, license and `bundle.json` with every renamed file |
| `app/resources/DemoProject` | The sample project |
| `app/test-fixtures/fake-codex.mjs` | Fake app server for tests and `ui-check`. Its replies are not Codex results |

</details>

CI ([`electron.yml`](.github/workflows/electron.yml)) runs type check, tests, build and `ui-check` on Ubuntu with Node 22. [CodeQL](.github/workflows/codeql.yml) and a [dependency check](.github/workflows/dependencies.yml) with a license policy run on every pull request. The [`release.yml`](.github/workflows/release.yml) workflow builds packages for macOS, Windows and Linux on every `v*` tag; they are signed and notarized only when the signing secrets are set. Versions come from Conventional Commits and are listed in [CHANGELOG.md](CHANGELOG.md); the release steps are in [CONTRIBUTING.md](CONTRIBUTING.md#releases). `main` is a protected branch: changes land through a pull request, never a direct push.

## Status and known limits

- **In progress.** The window redesign to match VS Code's layout, a versioning policy with signed installers for macOS, Windows and Linux, and the rest of the English translation beyond the first-launch and Settings choice are underway; track them on the [roadmap](https://github.com/emanueledenaro/trama/issues/193).
- **End to end.** No candidate has yet been declared and verified end to end on a real project. The closest live run (26 September, real Codex `gpt-6-luna`) reached a developer's finished worktree and stopped before declaring a candidate, on a bug in `verify_candidate` ([verification log](docs/verifiche/v04-v05.md), [#204](https://github.com/emanueledenaro/trama/issues/204)).
- **Candidate gate.** Verified with the fake Codex only, not yet with a real model ([verification log](docs/verifiche/w10-cancello-candidato-2026-09-27.md)). The regression guardian compares the build and test checks the candidate requires, not a suite the assignment did not name. The messages between reviewers and developers are recorded in the developer's work; their own threads come with [#144](https://github.com/emanueledenaro/trama/issues/144).
- **Pull requests and merges.** Publishing and the merge of a clear-cut candidate are both tested with a fake `gh` only; no real pull request has been opened or merged from the app on GitHub ([verification log](docs/verifiche/a07-unione-con-via-libera-2026-09-28.md)). Recognizing an interface change relies on file paths, so a UI file with an unusual name or path could be missed.
- **Language.** English ships for the first-launch choice and the Settings page only ([#303](https://github.com/emanueledenaro/trama/pull/303)); the rest of the interface is still Italian.
- **Sandbox.** The Node sandbox with local networking is tested on macOS only. On Windows, tests that open a local server fail under the Codex sandbox. The Linux `bubblewrap` path is coded but not tested on a real Linux machine.
- **Provider switch.** Switching providers mid-conversation is verified only live.
- **Presence.** Verified against a local bare remote and, once, directly against GitHub. A remote other than GitHub or a local folder, and a repository whose CI triggers on any push, are not verified.
- **Distribution.** No signed or notarized package has been produced yet.
- **Planning docs.** Some documents in `docs/` still describe the SwiftUI version.

The complete list is in [ADR 0011](docs/adr/0011-app-desktop-electron.md) and in [GitHub Issues](https://github.com/emanueledenaro/trama/issues). Code or a passing local test alone does not close a ticket; the verification logs are in [`docs/verifiche/`](docs/verifiche/).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you start: it covers setup, the checks to run, Conventional Commits, branch names, the pull request flow and releases. The project rules are in [AGENTS.md](AGENTS.md) and the vocabulary in [CONTEXT.md](CONTEXT.md).

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat(app): add the search palette`.
- Branches follow [Conventional Branch](https://conventionalbranch.org/): `feature/`, `bugfix/` or `hotfix/` with a short English description.
- Source code, comments and commit messages are in English. The interface, issues and pull requests are in Italian.
- `main` is protected: only a pull request with green CI gets merged.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Questions go to [SUPPORT.md](SUPPORT.md); security problems are reported privately as described in [SECURITY.md](SECURITY.md).

## Acknowledgements

- Third-party code and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Matt Pocock's skills](https://github.com/mattpocock/skills) for the bundled skills (MIT, [attribution](docs/aihero-attribution.md)).
- [Codex](https://github.com/openai/codex) by OpenAI, installed separately and not bundled with the app.

## License

[MIT](LICENSE)
