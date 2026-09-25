# AI Hero skills attribution

Trama includes a bundled subset of [Matt Pocock's skills](https://github.com/mattpocock/skills).

The copied source is release `v1.2.3`, resolved from its annotated Git tag to commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`. The tag object is `835450ef244ab7335f75d95b83e7d979eae22a6d`.

The included files retain the upstream MIT license. The upstream license reads `Copyright (c) 2026 Matt Pocock`. A copy is bundled at `app/resources/AIHero/LICENSE` and installed in configured projects as `.agents/skills/AIHERO-LICENSE`.

The bundle includes `ask-matt`, `setup-matt-pocock-skills`, `to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `grilling`, `grill-with-docs`, `domain-modeling`, `codebase-design`, and `writing-for-agents`, including each selected directory's local reference files.

Trama also runs bundled skills inside its own flow with their original text (issue #118). `app/src/main/core/nativeSkills.ts` delivers `SKILL.md` and the reference files next to it unchanged, followed by a separate Trama binding that maps the skill's generic verbs to Trama tools. The `grilling` skill is the first one delivered this way.
