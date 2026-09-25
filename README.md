# Trama

Trama is a desktop app that reads a repository, links a request to the project's modules and keeps decisions, work and checks on the same candidate. It uses OpenAI's Codex App Server as the engine of the Coordinator and GitHub CLI for explicit GitHub operations.

The app is built with Electron and follows the interface of [Synara](https://github.com/Emanuele-web04/synara) (see [ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md)). The code is in [`app/`](app). The sources of the SwiftUI version were removed on 23 September 2026 and remain in the git history.

The project is in alpha. The first real run of the Electron app on its own repository took place on 24 September 2026 and is recorded in [V09](docs/verifiche/v09-trama-su-trama-2026-09-24.md). The public repository is [emanueledenaro/trama](https://github.com/emanueledenaro/trama) and planned work is tracked in [GitHub Issues](https://github.com/emanueledenaro/trama/issues).

The app interface and most of the product documentation in `docs/` are in Italian.

## Requirements

- macOS, Linux or Windows.
- Node.js 22 and npm.
- Git.
- [GitHub CLI](https://cli.github.com/) to read or publish issues. Operations that write to the remote need a valid `gh` login and an explicit action in the app.
- Codex CLI with a ChatGPT account. Trama refuses API key accounts and providers other than OpenAI, so that it never switches to API billing without you knowing. Alternatively, the Coordinator can use another supported provider you have already signed in to from its own CLI.
- To run the candidate's Node tests with local networking: `sandbox-exec` on macOS (built in) or `bubblewrap` on Linux. Without them Trama falls back to the Codex sandbox, which also blocks 127.0.0.1.

## Development

```bash
git clone https://github.com/emanueledenaro/trama.git
cd trama/app
npm install
npm run dev
```

`npm run dev` starts Vite for the interface, builds the main process and opens Electron. `TRAMA_CODEX_PATH` points to a Codex executable other than the one found in `PATH`; `TRAMA_DATA_DIR` moves the data folder.

Other commands, also in `app/`:

```bash
npm run typecheck   # type check
npm test            # tests for the main process and shared logic
npm run build       # build the interface and the main process
npm start           # build and launch
npm run ui-check    # launch the app with a fake Codex and save screenshots in ui-check/
npm run dist        # package with electron-builder
```

## How it works

- **Coordinator.** Your only point of contact. It studies the project, proposes the developers and writes structured replies in the chat: the conclusion first, then lists, comparison tables and callouts for decisions and blockers.
- **Grilling before the plan.** Before a request becomes a plan or an assignment, the Coordinator clarifies it in numbered rounds with AI Hero's original `grilling` skill. Each question is a decision card with a recommended alternative. The plan starts only when every question of the round has an answer.
- **Pact and mandate.** Only your answers enter the Pact. The mandate says what the Coordinator may do on its own.
- **Team.** Every project has the developers proposed by the Coordinator plus eleven fixed roles: QA, UX, research, documentation and domain, bug triage and debugger, spec reviewer, Clean Code, regression guardian, security, performance and DevOps. The Team panel shows who steps in at each moment (clarification and spec, slices, candidate, background). Running the fixed roles at their moment is not wired yet ([#147](https://github.com/emanueledenaro/trama/issues/147), [#148](https://github.com/emanueledenaro/trama/issues/148)).
- **Goals.** Project outcomes with accepted and rejected examples, saved in the project document before they are shown (ADR 0013).
- **Checks.** Trama runs the checks on the candidate itself: `git_status`, `git_diff_check`, `swift_build`, `swift_test`, `node_test` and `node_typecheck`. Node checks run in the worktree, borrowing the checkout's dependencies when `package-lock.json` matches, inside a sandbox that allows only local networking.
- **Skills.** The full set of Matt Pocock's skills (v1.2.3) is bundled with Trama's names, for example `ask-trama` and `setup-trama`. Type `/` in the composer to use them. Details in [docs/aihero-attribution.md](docs/aihero-attribution.md).
- **Interface.** Panels (goals, map, Pact, mandate, team, issues, memory) live in the sidebar. Sidebar and inspector can be resized. Each provider has its own light and dark theme, and the window uses glass on macOS and Windows 11. Settings and connections are a single page with the sections general, connections, method, learning and monitor.

## Structure

- `app/src/main`: main process. Repository scanning, Coordinator, MCP tool server on `127.0.0.1`, Pact, mandate, team, goals, checks, GitHub and persistence.
- `app/src/main/core/nativeSkills.ts`: delivers an AI Hero skill unchanged, together with a Trama binding that maps the skill's verbs to Trama's tools.
- `app/src/main/core/providers`: adapters for the nine providers ported from Synara (ADR 0012) behind the common `AgentRuntime` shape: Codex, Claude Agent, Cursor, Grok, Droid, Devin, OpenCode, Antigravity and Pi.
- `app/src/main/core/learning`: the Coordinator's learning loop ported from [Hermes Agent](https://github.com/NousResearch/hermes-agent) (ADR 0014, [attribution](docs/hermes-attribution.md)): `MEMORY.md` and `USER.md` memory, search over past conversations, learned skills, experience review and skill maintenance.
- `app/src/preload`: IPC bridge with typed actions. The renderer has no access to Node.
- `app/src/renderer`: React interface with Tailwind CSS 4 and `@base-ui/react`, built on Synara's design tokens.
- `app/src/shared`: shared types and logic, such as the conversation timeline, grilling rounds and team roles.
- `app/resources/AIHero`: the AI Hero skills with their license and `bundle.json`, which records every name substitution. `app/scripts/sync-aihero.mjs` rebuilds the bundle from a checkout of the source.
- `app/resources/DemoProject`: the sample project.
- `app/test-fixtures/fake-codex.mjs`: a fake app server for tests and `ui-check`. Its replies are not Codex results.

## First use

1. Open an existing project or the sample project.
2. Open Settings (Impostazioni), Connections section (Collegamenti), and check the providers: Codex with a ChatGPT account, or another provider you have already signed in to from its CLI. The introductory guide walks you through the first launch and can be reopened from the Help (Aiuto) menu.
3. To use GitHub, run `gh auth login` in a terminal first and check the repository the app shows.
4. Read the Coordinator's study and confirm or correct the proposed developers.
5. Send it a request. You can pick a module as context in the composer and a skill with `/`.
6. Answer the rounds of questions and the mandate cards: only your answers enter the Pact and the mandate.

Trama stores recent projects, conversations and working state in the user data folder, under `Trama/Desktop` (`~/Library/Application Support/Trama/Desktop` on macOS, `~/.config/Trama/Desktop` on Linux, `%APPDATA%\Trama\Desktop` on Windows). On first launch the app reads the SwiftUI version's recent projects from `Trama/` and, when a project is opened, imports its conversation, Pact, mandate, memory and Coordinator thread. The SwiftUI version's files are not modified. What the Coordinator learns is kept in the same folder, under `Learning/`, and never in the project repository. ChatGPT credentials stay in the official Codex component. The app does not read `auth.json` and does not copy tokens.

## Supported repositories

The first structural analysis reads Swift and JavaScript or TypeScript projects. For Swift it recognizes direct imports. For `js`, `ts`, `mjs`, `cjs`, `jsx` and `tsx` files it recognizes imports and relative references. `package.json` is indexed; other JSON files are not treated as source.

Modules are grouped from the actual paths, with specific handling for `Sources` and `src` folders. Trama does not invent semantic modules the repository does not declare. Secrets, credentials, symlinks and paths outside the root are excluded from the index.

## Current limits

- The first real run ([V09](docs/verifiche/v09-trama-su-trama-2026-09-24.md)) passed the base path with Claude and Pi on real accounts: message, Trama tool, interrupt, restart and resume. The full path with Codex has not run yet, because the test account had used up its quota. No candidate has been declared and verified end to end.
- Cursor, Grok, Droid, Devin, OpenCode and Antigravity have an adapter but are tested only against fake CLIs, servers and SDKs. Droid was not detected on the test machine. Antigravity works only in a worktree, without shell or network. Switching from one provider to another is verified only live.
- Pull request publishing is tested up to the branch push; creating the PR with `gh` has not been tested on a real repository yet. The full list is in [ADR 0011](docs/adr/0011-app-desktop-electron-con-design-synara.md).
- The Node sandbox with local networking is tested on macOS. On Linux, `bubblewrap` has not been tested on a real machine. On Windows the Codex sandbox remains, so tests that open a local server fail.
- Some planning documents (`docs/piano-operativo.md`, the vertical spec) still describe the SwiftUI version and can give the Coordinator a wrong picture of the project.
- The `Rilascio` workflow (`.github/workflows/release.yml`) builds packages for macOS, Windows and Linux on every `v*` tag. Signing and notarization run only with the `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` secrets; without them the packages stay unsigned. No signed package has been produced yet.
- CI (`.github/workflows/electron.yml`) runs type check, tests, build and `ui-check` on Ubuntu with Node 22, and uploads the screenshots. Local checks of the removed SwiftUI version remain in [docs/verifiche-locali.md](docs/verifiche-locali.md) as a historical record.

These limits are tracked in tickets T01-T18 and in [GitHub Issues](https://github.com/emanueledenaro/trama/issues). Code or a local test alone does not close a ticket.

## License

Trama is released under the MIT license. The interface follows Synara's design, also MIT, with attribution in [docs/synara-attribution.md](docs/synara-attribution.md). Matt Pocock's skills include their MIT license and attribution in [docs/aihero-attribution.md](docs/aihero-attribution.md); the Hermes Agent learning loop is attributed in [docs/hermes-attribution.md](docs/hermes-attribution.md). Codex CLI is installed separately and is not included in the app.
