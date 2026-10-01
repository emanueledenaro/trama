# Changelog

All notable changes to Trama are recorded in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Versions are computed from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and the release workflow writes each new section from the merge commits on `main`. Notes under `[Unreleased]` can be written by hand: the next release moves them into its section. See [Releases](CONTRIBUTING.md#releases) in the contributing guide.

## [Unreleased]

## [0.4.0] - 2026-09-30

### Added

- **app:** Apply the design rules to the Progetti overview and its dialogs ([#518](https://github.com/emanueledenaro/trama/pull/518)).
- **app:** Apply the design rules to the Monitor and Presenza settings ([#517](https://github.com/emanueledenaro/trama/pull/517)).
- **app:** Apply the design rules to the Metodo settings ([#516](https://github.com/emanueledenaro/trama/pull/516)).
- **app:** Apply the design rules to the Collegamenti settings ([#515](https://github.com/emanueledenaro/trama/pull/515)).
- **app:** Apply the design rules to the Generale settings ([#514](https://github.com/emanueledenaro/trama/pull/514)).
- **app:** Answer the Ask Trama route before its steps ([#493](https://github.com/emanueledenaro/trama/pull/493)).
- **app:** Put the candidate verdict and its actions first in the chat card ([#520](https://github.com/emanueledenaro/trama/pull/520)).
- **app:** Give the empty chat an action and align chat spacing to 16 px ([#512](https://github.com/emanueledenaro/trama/pull/512)).
- **app:** Show the context meter only near the threshold ([#511](https://github.com/emanueledenaro/trama/pull/511)).
- **app:** Apply the design rules to automatic work and agent conversations ([#509](https://github.com/emanueledenaro/trama/pull/509)).
- **app:** Put Recenti above Inizia for who comes back ([#507](https://github.com/emanueledenaro/trama/pull/507)).
- **app:** Give Impara and the exercise panel the design rules ([#506](https://github.com/emanueledenaro/trama/pull/506)).
- **app:** Rebuild the agent screen around a settings gear ([#501](https://github.com/emanueledenaro/trama/pull/501)).
- **app:** Make Apri un progetto the one main action of Inizia ([#503](https://github.com/emanueledenaro/trama/pull/503)).
- **app:** Make the steps of Configura ask for nothing once done ([#505](https://github.com/emanueledenaro/trama/pull/505)).
- **app:** Give Recenti its four states and icon-only navigation ([#504](https://github.com/emanueledenaro/trama/pull/504)).
- **app:** Put the squads list on the 8 px grid and name its icons ([#508](https://github.com/emanueledenaro/trama/pull/508)).
- **app:** Show the outcome and its actions first on the candidate page ([#500](https://github.com/emanueledenaro/trama/pull/500)).
- **app:** Show the assignment actions before its contract ([#492](https://github.com/emanueledenaro/trama/pull/492)).
- **app:** Put the plan decision and its slices above the long spec ([#491](https://github.com/emanueledenaro/trama/pull/491)).
- **app:** Put the verdict first in the in-depth review ([#498](https://github.com/emanueledenaro/trama/pull/498)).
- **app:** Show what a candidate is missing first in its chat card ([#487](https://github.com/emanueledenaro/trama/pull/487)).
- **app:** Open the agent's whole look from one button ([#483](https://github.com/emanueledenaro/trama/pull/483)).

### Changed

- **app:** Share the identical candidate fields between chat and inspector ([#524](https://github.com/emanueledenaro/trama/pull/524)).
- **app:** Apply the design rules to the Standard view ([#523](https://github.com/emanueledenaro/trama/pull/523)).
- **app:** Apply the design rules to the Mandato and Moduli views ([#522](https://github.com/emanueledenaro/trama/pull/522)).
- **app:** Apply the design rules to the Patto view ([#521](https://github.com/emanueledenaro/trama/pull/521)).
- **app:** Give the title bar 32 px buttons and drop its branch copy ([#497](https://github.com/emanueledenaro/trama/pull/497)).
- **app:** Make the goal detail's secondary actions icons ([#513](https://github.com/emanueledenaro/trama/pull/513)).
- **app:** Apply the button rules to Lavoro, issues and git detail ([#502](https://github.com/emanueledenaro/trama/pull/502)).
- **app:** Order Aspetta te by importance ([#499](https://github.com/emanueledenaro/trama/pull/499)).
- **app:** Read the status bar by importance ([#495](https://github.com/emanueledenaro/trama/pull/495)).

### Fixed

- **app:** Keep the chat and the composer free of filled buttons ([#510](https://github.com/emanueledenaro/trama/pull/510)).
- **app:** Apply the design rules to the examination view ([#489](https://github.com/emanueledenaro/trama/pull/489)).
- **app:** Apply the design rules to the memory view ([#494](https://github.com/emanueledenaro/trama/pull/494)).
- **app:** Give up the waiting item's title before the work bar cuts it ([#485](https://github.com/emanueledenaro/trama/pull/485)).
- **app:** Let a stopped controller save nothing more ([#484](https://github.com/emanueledenaro/trama/pull/484)).
- **app:** Let a correction continue the candidate of the work it replaces ([#481](https://github.com/emanueledenaro/trama/pull/481)).
- **app:** Tell Security's overruled findings apart by their title ([#480](https://github.com/emanueledenaro/trama/pull/480)).
- **app:** Keep a merged candidate decided when the integration base moves on ([#482](https://github.com/emanueledenaro/trama/pull/482)).
- **app:** Make Clean Code follow the whole Pact ([#477](https://github.com/emanueledenaro/trama/pull/477)).
- **app:** Keep punctuation on the line of the link before it ([#478](https://github.com/emanueledenaro/trama/pull/478)).
- **app:** Resume replaced work as the replacement of its whole line ([#474](https://github.com/emanueledenaro/trama/pull/474)).
- **app:** Take delegated steps after an automatic turn the person's message set aside ([#475](https://github.com/emanueledenaro/trama/pull/475)).

## [0.3.0] - 2026-09-29

### Added

- **app:** Let the Coordinator settle disagreements and keep the chat free while the team works ([#473](https://github.com/emanueledenaro/trama/pull/473)).
- **app:** Let the person choose each agent's model and look in its tab ([#467](https://github.com/emanueledenaro/trama/pull/467)).
- **app:** Keep one neutral glass surface and let the provider set only the accents ([#463](https://github.com/emanueledenaro/trama/pull/463)).

### Fixed

- **app:** Keep the candidate's reviewer rows readable in a narrow side bar ([#456](https://github.com/emanueledenaro/trama/pull/456)).

## [0.2.0] - 2026-09-29

### Added

- Electron desktop app, replacing the SwiftUI prototype ([#109](https://github.com/emanueledenaro/trama/pull/109)).
- Adapters for nine providers: Codex, Claude, Cursor, Grok, Droid, Devin, OpenCode, Antigravity and Pi ([#110](https://github.com/emanueledenaro/trama/pull/110)).
- Coordinator memory and learning loop ([#111](https://github.com/emanueledenaro/trama/pull/111)).
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
- **app:** Open Welcome as a page of the editor area instead of the setup screen ([#404](https://github.com/emanueledenaro/trama/pull/404)).
- **app:** Apply the button rule to the chat, the bars and the settings ([#447](https://github.com/emanueledenaro/trama/pull/447)).
- **app:** Time-box agent discussions and record their decision ([#430](https://github.com/emanueledenaro/trama/pull/430)).
- **app:** Translate the chat texts into English ([#361](https://github.com/emanueledenaro/trama/pull/361)).
- **app:** Translate the shared texts into English ([#365](https://github.com/emanueledenaro/trama/pull/365)).
- **app:** Lay out the application menu as each platform's native apps, in the chosen language ([#401](https://github.com/emanueledenaro/trama/pull/401)).
- **app:** Open focus mode on a module or the project in full screen ([#327](https://github.com/emanueledenaro/trama/pull/327)).
- **app:** Add full delegation so the Coordinator works on its own, even at night ([#435](https://github.com/emanueledenaro/trama/pull/435)).
- **app:** Let the person's written request unlock every action, with a confirmation for deletions ([#429](https://github.com/emanueledenaro/trama/pull/429)).
- **app:** Order each squad's backlog, with the person's order winning ([#439](https://github.com/emanueledenaro/trama/pull/439)).
- **app:** Show Aspetta te in the side bar with the decision buttons on top ([#433](https://github.com/emanueledenaro/trama/pull/433)).
- **app:** Open the details in editor tabs beside the conversation ([#384](https://github.com/emanueledenaro/trama/pull/384)).
- **app:** Let the person rename, merge and split squads ([#427](https://github.com/emanueledenaro/trama/pull/427)).
- **app:** Translate the main texts into English ([#375](https://github.com/emanueledenaro/trama/pull/375)).
- **app:** Bring goals, slices, branches, pull requests and issues into the Lavoro view ([#382](https://github.com/emanueledenaro/trama/pull/382)).
- **app:** Show who works now, the squads' people and the automatic work in the Squads view ([#386](https://github.com/emanueledenaro/trama/pull/386)).
- **app:** Move the learning settings into the Memory view ([#379](https://github.com/emanueledenaro/trama/pull/379)).
- **app:** Show Activity in a bottom panel under the editor ([#383](https://github.com/emanueledenaro/trama/pull/383)).
- **app:** Show Regole as Mandato, Patto and Standard tabs ([#380](https://github.com/emanueledenaro/trama/pull/380)).
- **app:** Lay out the window as VS Code with the activity bar, side bar, editor and status bar ([#350](https://github.com/emanueledenaro/trama/pull/350)).
- **app:** Integrate candidates by mandate without faking the human review ([#320](https://github.com/emanueledenaro/trama/pull/320)).
- **app:** Add Trama's security, test and docs lenses to focus mode ([#324](https://github.com/emanueledenaro/trama/pull/324)).
- **app:** Let Trama reorder the agents' context at the threshold ([#315](https://github.com/emanueledenaro/trama/pull/315)).
- **app:** Show conflicts between specialists and GitHub collaborators in the chat ([#339](https://github.com/emanueledenaro/trama/pull/339)).
- **app:** Turn a finding into a ticket, an assignment or a Pact card ([#322](https://github.com/emanueledenaro/trama/pull/322)).
- **app:** Run an assignment in a Claude Code cloud session with the person's choice of place ([#329](https://github.com/emanueledenaro/trama/pull/329)).
- **app:** Update tickets and checklists only when the evidence allows it ([#323](https://github.com/emanueledenaro/trama/pull/323)).
- **app:** Keep authorized teams working when the person switches project ([#346](https://github.com/emanueledenaro/trama/pull/346)).
- **app:** Recompute only the assignments a decision or scope change touches ([#326](https://github.com/emanueledenaro/trama/pull/326)).
- **app:** Set the editorial typography with bundled fonts ([#349](https://github.com/emanueledenaro/trama/pull/349)).
- **app:** Merge candidates with the green light and hold interface changes for the person ([#312](https://github.com/emanueledenaro/trama/pull/312)).
- **app:** Choose Italian or English at first launch ([#303](https://github.com/emanueledenaro/trama/pull/303)).
- **app:** Speak plain Italian to the person, with names instead of ids ([#299](https://github.com/emanueledenaro/trama/pull/299)).
- **app:** Keep the timeline compact with technical steps in Activity ([#298](https://github.com/emanueledenaro/trama/pull/298)).
- **app:** Let the Coordinator run the whole cycle within the mandate and clear technical blocks ([#296](https://github.com/emanueledenaro/trama/pull/296)).
- **app:** Turn every reference in messages into a link ([#285](https://github.com/emanueledenaro/trama/pull/285)).
- **app:** Show the conversations between agents ([#261](https://github.com/emanueledenaro/trama/pull/261)).
- **app:** Resume the always active Coordinator after provider limits and on reopening ([#295](https://github.com/emanueledenaro/trama/pull/295)).
- **app:** Let the Coordinator open and triage the issues it finds ([#294](https://github.com/emanueledenaro/trama/pull/294)).
- **app:** Propose a project mandate for the whole cycle with fixed bans ([#291](https://github.com/emanueledenaro/trama/pull/291)).
- **app:** Let the Coordinator recap each milestone or on request ([#290](https://github.com/emanueledenaro/trama/pull/290)).
- **app:** Keep the Coordinator active with a periodic round and a Pause ([#288](https://github.com/emanueledenaro/trama/pull/288)).
- **app:** Gather what waits for the person in one place ([#283](https://github.com/emanueledenaro/trama/pull/283)).
- **app:** Keep one Coordinator chat per project with goals as filters ([#286](https://github.com/emanueledenaro/trama/pull/286)).
- **app:** Show the Coordinator's status line and move single steps to Activity ([#282](https://github.com/emanueledenaro/trama/pull/282)).
- **app:** Gate a candidate on every reviewer in parallel ([#280](https://github.com/emanueledenaro/trama/pull/280)).
- **app:** Resume the Coordinator after limits, restarts and outages ([#274](https://github.com/emanueledenaro/trama/pull/274)).
- **app:** Verify focus mode findings with evidence ([#259](https://github.com/emanueledenaro/trama/pull/259)).
- **app:** Animate each agent as a stitched bot in its color ([#232](https://github.com/emanueledenaro/trama/pull/232)).
- **app:** Resize panels with VS Code style sashes ([#230](https://github.com/emanueledenaro/trama/pull/230)).
- **app:** Use the avatars stitched seam as a sparing design accent ([#223](https://github.com/emanueledenaro/trama/pull/223)).
- **app:** Let free developers pick the next ready slice by themselves ([#216](https://github.com/emanueledenaro/trama/pull/216)).
- **app:** Add Ask Trama, running ask-matt inside Trama ([#194](https://github.com/emanueledenaro/trama/pull/194)).
- **app:** Let developers ask the Coordinator and pause blocked slices ([#202](https://github.com/emanueledenaro/trama/pull/202)).
- **app:** Add Trama's Clean Code standard for developers and the technical review ([#201](https://github.com/emanueledenaro/trama/pull/201)).
- **app:** Explain provider and GitHub errors with recovery actions ([#195](https://github.com/emanueledenaro/trama/pull/195)).
- **app:** Add the launch intro, the first-run welcome and the project picker ([#208](https://github.com/emanueledenaro/trama/pull/208)).
- **app:** Add the Trama logo, app icons and TramaMark ([#214](https://github.com/emanueledenaro/trama/pull/214)).
- **app:** Add Conventional Commits, Conventional Branch and the publishing standard ([#203](https://github.com/emanueledenaro/trama/pull/203)).

### Changed

- One place for every panel, and the sidebar footer holds only Settings ([#135](https://github.com/emanueledenaro/trama/pull/135), [#153](https://github.com/emanueledenaro/trama/pull/153)).
- README in English with the structure of an open source project ([#159](https://github.com/emanueledenaro/trama/pull/159), [#160](https://github.com/emanueledenaro/trama/pull/160)).
- **app:** Settle the provider adapter shape ([#319](https://github.com/emanueledenaro/trama/pull/319)).

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
- **app:** Let the Coordinator supersede an older candidate of the same work ([#436](https://github.com/emanueledenaro/trama/pull/436)).
- **app:** Use a Projects icon and Trama's mark in the activity bar ([#416](https://github.com/emanueledenaro/trama/pull/416)).
- **app:** Close the candidate and review cycle ([#395](https://github.com/emanueledenaro/trama/pull/395)).
- **app:** Keep the candidate in step with the developer's worktree ([#398](https://github.com/emanueledenaro/trama/pull/398)).
- **app:** Derive what waits for the person from one list ([#394](https://github.com/emanueledenaro/trama/pull/394)).
- **app:** Keep the chat and the views readable for the person ([#397](https://github.com/emanueledenaro/trama/pull/397)).
- **app:** Redact personal data before publishing and let git work in the sandbox ([#396](https://github.com/emanueledenaro/trama/pull/396)).
- **app:** Restore what the parallel merges broke since September 26 ([#340](https://github.com/emanueledenaro/trama/pull/340)).
- **app:** Wait for the Antigravity hook only on model steps and repair it by itself ([#353](https://github.com/emanueledenaro/trama/pull/353)).
- **app:** Name every state the same way in every view ([#307](https://github.com/emanueledenaro/trama/pull/307)).
- **app:** Require quoted lines and exact commands in verified findings ([#343](https://github.com/emanueledenaro/trama/pull/343)).
- **app:** Keep the project opened last when opens overlap ([#351](https://github.com/emanueledenaro/trama/pull/351)).
- **app:** Show the panel border and use one sash for every resizable panel ([#234](https://github.com/emanueledenaro/trama/pull/234)).
- **app:** Pass Antigravity the full model label instead of a separate effort ([#347](https://github.com/emanueledenaro/trama/pull/347)).
- **app:** Stop the avatars' eyes following the cursor ([#341](https://github.com/emanueledenaro/trama/pull/341)).
- **app:** Show the Trama logo as the app icon on every platform ([#342](https://github.com/emanueledenaro/trama/pull/342)).
- **app:** Measure the context window right on every provider and stop memory retries ([#318](https://github.com/emanueledenaro/trama/pull/318)).
- **app:** Stop the gate only on real sandbox failures and mark its reviewers not started ([#304](https://github.com/emanueledenaro/trama/pull/304)).
- **app:** Stop the gate when a check could not run and drop empty running turns ([#302](https://github.com/emanueledenaro/trama/pull/302)).
- **app:** Keep candidate evidence on sandbox failures and page only turns with steps ([#300](https://github.com/emanueledenaro/trama/pull/300)).
- **app:** Keep one focus bar per project and number the A09 screenshots after A08 ([#297](https://github.com/emanueledenaro/trama/pull/297)).
- **app:** Title the focus bar with the goal and keep tool errors out of the chat ([#287](https://github.com/emanueledenaro/trama/pull/287)).
- **app:** Count every card that waits for the person in Aspetta te ([#293](https://github.com/emanueledenaro/trama/pull/293)).
- **app:** List only the Coordinator chat, goals and agents in the sidebar ([#289](https://github.com/emanueledenaro/trama/pull/289)).
- **app:** Report branch divergence once per project instead of colleague conflicts ([#279](https://github.com/emanueledenaro/trama/pull/279)).
- **app:** Never push outside the mandate and record every push ([#284](https://github.com/emanueledenaro/trama/pull/284)).
- **app:** Show what a mandate proposal changes and keep the active mandate on reject ([#281](https://github.com/emanueledenaro/trama/pull/281)).
- **app:** Let the Coordinator cite only real buttons and current state ([#278](https://github.com/emanueledenaro/trama/pull/278)).
- **app:** Guard the Coordinator's replaced opening and share its default model ([#275](https://github.com/emanueledenaro/trama/pull/275)).
- **app:** Start the Coordinator's study with the model the person chose ([#238](https://github.com/emanueledenaro/trama/pull/238)).
- **app:** Send the Coordinator back to a card when it writes choices in text ([#236](https://github.com/emanueledenaro/trama/pull/236)).
- **app:** Guard duty requests and read closed pull request links ([#237](https://github.com/emanueledenaro/trama/pull/237)).
- **app:** Run fixed role duties only when due, show their state and start them on request ([#235](https://github.com/emanueledenaro/trama/pull/235)).
- **app:** Give every provider Trama's tools instead of its own ([#233](https://github.com/emanueledenaro/trama/pull/233)).
- **app:** Start the Coordinator of the project opened last ([#227](https://github.com/emanueledenaro/trama/pull/227)).
- **app:** Pass Antigravity models with their effort level ([#218](https://github.com/emanueledenaro/trama/pull/218)).
- **app:** Name the Codex permission profile on a turn only to switch it ([#226](https://github.com/emanueledenaro/trama/pull/226)).
- **app:** Guide the checks after an ended assignment to a declared candidate ([#211](https://github.com/emanueledenaro/trama/pull/211)).
- **app:** Bring main back to green with the three pending fixes ([#225](https://github.com/emanueledenaro/trama/pull/225)).
- **app:** Keep agent sessions inside the project ([#221](https://github.com/emanueledenaro/trama/pull/221)).

[Unreleased]: https://github.com/emanueledenaro/trama/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/emanueledenaro/trama/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/emanueledenaro/trama/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/emanueledenaro/trama/releases/tag/v0.2.0
