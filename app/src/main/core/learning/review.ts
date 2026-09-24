/**
 * The self-improvement review, ported from Hermes Agent `agent/background_review.py`,
 * `agent/turn_context.py`, `agent/turn_finalizer.py` and `agent/prompt_builder.py` (revision 58c896e,
 * MIT, Copyright (c) 2025 Nous Research).
 *
 * Two counters decide when a review runs: user turns since the Coordinator last wrote memory, and tool
 * iterations since it last wrote a skill. When one reaches its interval after a completed turn, Trama
 * runs a separate, unattended session that sees the conversation and may only use the memory and skill
 * tools; it never blocks the person's conversation. The prompts are Hermes' own, verbatim.
 */

export const MEMORY_NUDGE_INTERVAL = 10;
export const SKILL_NUDGE_INTERVAL = 10;
export const REVIEW_MAX_TOOL_CALLS = 16;
const DIGEST_TAIL = 24;

export const MEMORY_GUIDANCE =
  "You have persistent memory, carried across sessions and loaded into each new session's context; the memory tool's schema defines what belongs there. Skills come first: when you learn something while doing a task — a procedure, a pitfall, and the user's preferences and corrections for that kind of work — record it in the skill you used or built for the task (skill_manage), where it loads only when relevant. Memory is the narrow exception for facts that apply to EVERY session regardless of task (who the user is, environment facts, standing conventions with no task home); it has a hard character budget, so when it fills, replace or consolidate stale entries rather than skipping the save. Write entries as declarative facts, not instructions to yourself: 'User prefers concise responses' ✓ — 'Always respond concisely' ✗ (imperative phrasing gets re-read as a directive in later sessions and can override the user's current request). A fact stale within a week belongs in session history; procedures and workflows belong in skills.";

export const SKILLS_GUIDANCE = "When you work out a non-trivial workflow, record it with skill_manage for future reuse.";

const MEMORY_ROUTING = `Memory has TWO distinct stores — pick the right one for each fact:
  • USER.md (memory tool, target='user'): who the user is — persona, preferences, communication and work style, personal details they revealed, and expectations about how you should behave.
  • MEMORY.md (memory tool, target='memory'): facts about the ENVIRONMENT you operate in — tool quirks, project conventions, config gotchas, paths and endpoints that matter.

One fact goes to ONE store, never both — writing it to both bloats both files until they hit their size limits and crowds out the facts that matter; misrouting it puts it where the next session won't look. If the tool schema lists only one target, that store is the only one enabled — use it and skip the other.`;

export const MEMORY_REVIEW_PROMPT = `Review the conversation above and consider saving to memory if appropriate.

${MEMORY_ROUTING}

If something stands out, save it once, in the right store, using the memory tool with the matching target. If nothing is worth saving, just say 'Nothing to save.' and stop.`;

const LESSON_LAYER = `What a skill IS: the instructions for doing a class of task the most efficient and correct way, to THIS user's specifications — the procedure, the tools and commands that work, the order, the user's preferences for how the result should look, and the pitfalls that cost time. A future session should be able to follow it and produce what the user wants on the first try. Everything below is about writing that well:
  • Procedure first: the steps in the order they are done, with the concrete commands, tool calls, and decision points. Lessons and pitfalls attach to the step they affect.
  • A pitfall is a generalizable rule + one clause of WHY (the mechanism), imperative. 'Grep the test tree for the SYMBOL before widening a helper signature — hand-rolled mocks reimplement the old shape and fail on a shard you did not run.' Not a narrative of what happened this session.
  • No PR/issue numbers, dates, ticket IDs, or quoted user text as content — the rule must stand without the incident behind it. Keep a short quote ONLY when the quote itself is the clearest statement of the rule.
  • The same lesson learned twice is ONE rule. Before adding, search the skill (and its references/) for the rule already stated; strengthen or clarify it rather than appending a second copy.
  • Not a duplicate of what the environment already teaches: repo AGENTS.md files, tool schema descriptions, and other always-loaded context. A skill carries the WORKFLOW and the pitfalls; it does not restate the codebase map or a tool's parameter list.
  • Always-on rules (standing user preferences, gates that apply to every instance of the task) live in SKILL.md itself, whole. references/ is for depth that is only needed sometimes: a decision table, a recipe, a domain note — each file topical and reusable, never '<date>-<incident>.md'. Prefer extending an existing references/ file over creating one; a skill with dozens of one-off references is the failure shape, not the goal.
  • Fix the skill in place when it is wrong: edit the sentence that misled, do not append 'UPDATE: actually...' underneath it.`;

const DO_NOT_CAPTURE = `  • Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
  • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y from execute_code'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
  • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
  • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.

  • Unresolved failures: if the session ended WITHOUT actually finding a working method — you tried several things, none worked, and told the user to check manually — do NOT write those attempts up as a 'reliable workflow' or 'recommended approach'. That presents an untested sequence of failures as validated guidance a future session will trust and repeat. Either say 'Nothing to save', or, only if you are independently confident of a real working alternative (not something you are merely guessing might work), capture ONLY that alternative — never the dead ends, and never dressed up as best practice.

If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.`;

// Hermes names its own protected kinds (bundled, hub, external dirs); Trama's library has none of
// them, so only the pinned and person-owned rules stay, and "hermes curator adopt" becomes Trama's
// adoption in the Memory view.
export const SKILL_REVIEW_PROMPT = `Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the library: CLASS-LEVEL skills, each with a SKILL.md of always-on rules and a small \`references/\` set of topical depth. Not a flat list of narrow one-session skills, and not an umbrella hoarding a references/ file per session. This shapes HOW you update, not WHETHER you update.

${LESSON_LAYER}

Signals to look for (any one of these warrants action):
  • User corrected your style, tone, format, legibility, or verbosity. Frustration signals like 'stop doing X', 'this is too verbose', 'don't format like this', 'why are you explaining', 'just give me the answer', 'you always do Y and I hate it', or an explicit 'remember this' are FIRST-CLASS skill signals, not just memory signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
  • User corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
  • Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from. Capture it.
  • A skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.

Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
  1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the conversation for skills you read via skill_view. If any of them covers the territory of the new learning, PATCH that one first (re-load it with skill_view during this review — see Read-before-write below). It is the skill that was in play, so it's the right one to extend — but only if it is curator-managed. Pinned and user-owned skills are off-limits to you no matter how relevant (see Protected skills below); for those, fall through to the next option.
  2. UPDATE AN EXISTING UMBRELLA (via skills_list + skill_view). If no loaded skill fits but an existing class-level skill does, patch it. Add a subsection, a pitfall, or broaden a trigger.
  3. ADD A SUPPORT FILE under an existing umbrella. Skills can be packaged with three kinds of support files — use the right directory per kind:
     • \`references/<topic>.md\` — topical depth needed only sometimes: a decision table, a reproduction recipe, provider quirks, condensed domain notes or API excerpts. Name it by TOPIC and extend an existing file when one covers the topic; do not create a per-session or per-incident file, and do not paste error transcripts — distill them to the rule.
     • \`templates/<name>.<ext>\` — starter files meant to be copied and modified (boilerplate configs, scaffolding, a known-good example the agent can \`reproduce with modifications\`).
     • \`scripts/<name>.<ext>\` — statically re-runnable actions the skill can invoke directly (verification scripts, fixture generators, deterministic probes, anything the agent should run rather than hand-type each time).
     Add support files via skill_manage action=write_file with file_path starting 'references/', 'templates/', or 'scripts/'. The umbrella's SKILL.md should gain a one-line pointer to any new support file so future agents know it exists.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class. The name MUST be at the class level. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).

Read-before-write (ENFORCED — skill_manage refuses otherwise): before you patch or edit an existing skill's SKILL.md, call skill_view(name) for that skill during this review. Before you overwrite or remove an EXISTING supporting file, call skill_view(name, file_path=...) for that exact file. Content quoted earlier in the conversation transcript does NOT count — the guard requires a fresh load within this review, and your write must be based on what skill_view just returned. Creating a brand-new skill or adding a NEW supporting file needs no prior read. If a write is refused with a read-before-write error, call skill_view for the named target once and retry the write once; do not loop.

User-preference embedding (important): when the user expressed a style/format/workflow preference, the update belongs in the SKILL.md body, not just in memory. Memory captures 'who the user is and what the current situation and state of your operations are'; skills capture 'how to do this class of task for this user'. When they complain about how you handled a task, the skill that governs that task needs to carry the lesson.

If you notice two existing skills that overlap, note it in your reply — the background curator handles consolidation at scale.

Protected skills (DO NOT edit these):
  • PINNED skills (the person pinned them in Trama). You are an autonomous no-user-present actor, so pin blocks your writes too — content updates included. Only the person, in a foreground session, can change a pinned skill.
  • USER-OWNED skills — anything not curator-managed. A skill the person asked the Coordinator to create in a normal turn is theirs, not yours; your writes to it WILL be refused. This includes skills that were loaded or consulted this session: being in play does not make one yours to edit. If such a skill is wrong or outdated, say so in your reply and recommend that the person adopt it in Trama — do not try to patch it.
If the only skills that need updating are protected, say
'Nothing to save.' and stop.

Do NOT capture (these become persistent self-imposed constraints that bite you later when the environment changes):
${DO_NOT_CAPTURE}

'Nothing to save.' is a real option but should NOT be the default. If the session ran smoothly with no corrections and produced no new technique, just say 'Nothing to save.' and stop. Otherwise, act.`;

export const COMBINED_REVIEW_PROMPT = `Review the conversation above and update two things:

**Memory**: TWO distinct stores — pick the right one for each fact:
  • USER.md (memory tool, target='user'): who the user is — persona, preferences, communication and work style, personal details they revealed, and expectations about how you should behave.
  • MEMORY.md (memory tool, target='memory'): facts about the ENVIRONMENT you operate in — tool quirks, project conventions, config gotchas, paths and endpoints that matter.

One fact goes to ONE store, never both — writing it to both bloats both files until they hit their size limits and crowds out the facts that matter; misrouting it puts it where the next session won't look. If the tool schema lists only one target, that store is the only one enabled — use it and skip the other.

**Skills**: how to do this class of task. Be ACTIVE — most sessions produce at least one skill update. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the skill library: CLASS-LEVEL skills with a SKILL.md of always-on rules and a small \`references/\` set of topical depth — not narrow one-session skills, and not an umbrella hoarding a references/ file per session.

${LESSON_LAYER}

Signals that warrant a skill update (any one is enough):
  • User corrected your style, tone, format, legibility, verbosity, or approach. Frustration is a FIRST-CLASS skill signal, not just a memory signal. 'stop doing X', 'don't format like this', 'I hate when you Y' — embed the lesson in the skill that governs that task so the next session starts fixed.
  • Non-trivial technique, fix, workaround, or debugging path emerged.
  • A skill that was loaded or consulted turned out wrong, missing, or outdated — patch it now.

Preference order for skills — pick the earliest that fits:
  1. UPDATE A CURRENTLY-LOADED SKILL. Check what skills were loaded via skill_view in the conversation. If one of them covers the learning, PATCH it first (re-load it with skill_view during this review — see Read-before-write below). It was in play; it's the right place — provided it is curator-managed. Protected and user-owned skills are off-limits however relevant; fall through when one of those is the best fit.
  2. UPDATE AN EXISTING UMBRELLA (skills_list + skill_view to find the right one). Patch it.
  3. ADD A SUPPORT FILE under an existing umbrella via skill_manage action=write_file. Three kinds: \`references/<topic>.md\` for topical depth (decision tables, recipes, quirks, condensed domain notes) — extend an existing topical file before creating one, never a per-session file; \`templates/<name>.<ext>\` for starter files meant to be copied and modified; \`scripts/<name>.<ext>\` for statically re-runnable actions (verification, fixture generators, probes). Add a one-line pointer in SKILL.md so future agents find them.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing exists. Name at the class level — NOT a PR number, error string, codename, library-alone name, or 'fix-X / debug-Y' session artifact. If the name only fits today's task, fall back to (1), (2), or (3).

Read-before-write (ENFORCED — skill_manage refuses otherwise): before patching or editing an existing skill's SKILL.md, call skill_view(name) during this review; before overwriting or removing an EXISTING supporting file, call skill_view(name, file_path=...) for that exact file. Content quoted earlier in the transcript does NOT count — base the write on what skill_view just returned. New skills and NEW supporting files need no prior read. On a read-before-write refusal: view the named target once, retry the write once, do not loop.

User-preference embedding: when the user complains about how you handled a task, update the skill that governs that task rather than memory. Memory says 'who the user is and what the current situation and state of your operations are'; skills say 'how to do this class of task for this user'. A user-preference lesson lives in exactly ONE place: the skill that governs the task when one exists, USER.md only for cross-cutting preferences no skill owns — never both. Duplicating it is how a memory file ends up restating SKILL.md until both hit their size limits.

If you notice overlapping existing skills, mention it — the background curator handles consolidation.

Protected skills (DO NOT edit these):
  • PINNED skills (the person pinned them in Trama). Pin blocks autonomous writes entirely — content updates included — because no user is present to consent. Only a foreground session can change one.
  • USER-OWNED skills — anything not curator-managed (created by the Coordinator at the person's request in a normal turn). Your writes to these WILL be refused, including to skills loaded or consulted this session. If one is wrong, say so in your reply and recommend that the person adopt it in Trama instead.
If the only skills that need updating are protected, say
'Nothing to save.' and stop.

Do NOT capture as skills (these become persistent self-imposed constraints that bite you later when the environment changes):
${DO_NOT_CAPTURE}

Act on whichever of the two dimensions has real signal. If genuinely nothing stands out on either, say 'Nothing to save.' and stop — but don't reach for that conclusion as a default.`;

export type ReviewScope = { memory: boolean; skills: boolean };

/** Hermes' `_PROMPT_NAME_BY_SCOPE`, plus the tools line the review is told about. */
export function reviewPrompt(scope: ReviewScope, memoryAvailable: boolean, focus: string | null = null): string {
  let prompt = scope.memory && scope.skills ? COMBINED_REVIEW_PROMPT : scope.memory ? MEMORY_REVIEW_PROMPT : SKILL_REVIEW_PROMPT;
  if (focus?.trim()) prompt += `\n\nThe user explicitly requested this review with the following focus — prioritize it over the general instructions above:\n${focus.trim()}`;
  const memoryTools = scope.memory && memoryAvailable;
  return `${prompt}\n\nYou can only call ${memoryTools ? "memory and skill " : "skill "}management tools. Other tools will be denied at runtime — do not attempt them.`;
}

/** The tools a review may call: a review started only by the skill counter never gets `memory`. */
export function reviewToolNames(scope: ReviewScope, memoryAvailable: boolean): string[] {
  return [...(scope.memory && memoryAvailable ? ["memory"] : []), "skills_list", "skill_view", "skill_manage"];
}

export function deniedToolMessage(tool: string, allowed: string[]): string {
  const memory = allowed.includes("memory") ? " and memory for notes (add only)" : "";
  return `Background review denied non-whitelisted tool: ${tool}. Allowed here: skill_view/skills_list to read, skill_manage(action='patch'|...) to change skills${memory}. Do not retry ${tool}.`;
}

export interface NudgeCounters {
  turnsSinceMemory: number;
  itersSinceSkill: number;
}

/** Called at the start of a turn: true when this turn completes a memory interval. */
export function tickMemoryNudge(counters: NudgeCounters, memoryAvailable: boolean, interval = MEMORY_NUDGE_INTERVAL): boolean {
  if (interval <= 0 || !memoryAvailable) return false;
  counters.turnsSinceMemory += 1;
  if (counters.turnsSinceMemory < interval) return false;
  counters.turnsSinceMemory = 0;
  return true;
}

/** Called when the Coordinator itself calls a learning tool. */
export function resetOnToolUse(counters: NudgeCounters, tool: string): void {
  if (tool === "memory") counters.turnsSinceMemory = 0;
  else if (tool === "skill_manage") counters.itersSinceSkill = 0;
}

/** Called at the end of a turn with the tool iterations it ran (Hermes counts `tool_iterations` for Codex App Server). */
export function finishTurnSkillNudge(counters: NudgeCounters, toolIterations: number, interval = SKILL_NUDGE_INTERVAL): boolean {
  if (interval <= 0) return false;
  counters.itersSinceSkill += toolIterations;
  if (counters.itersSinceSkill < interval) return false;
  counters.itersSinceSkill = 0;
  return true;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "tool";
  text: string;
  tools?: string[];
}

/**
 * The conversation the review sees. Hermes forks the live session; a Trama review runs in its own
 * provider session, so it gets the transcript the way Hermes feeds a review routed to another model
 * (`_digest_history`): older turns summarised, the last 24 messages verbatim.
 */
export function reviewTranscript(messages: TranscriptMessage[], tail = DIGEST_TAIL): string {
  let keepFrom = Math.max(0, messages.length - tail);
  while (keepFrom > 0 && messages[keepFrom]?.role === "tool") keepFrom -= 1;
  const older = messages.slice(0, keepFrom);
  const recent = messages.slice(keepFrom);
  const oneLine = (text: string) => text.replace(/\n/g, " ").trim();
  const lines: string[] = [];
  if (older.length) {
    lines.push("[Earlier conversation digest — older turns summarised to bound the review's cold-write cost on the routed aux model. Recent turns follow verbatim below.]");
    for (const m of older) {
      if (m.role === "user" && m.text.trim()) lines.push(`USER: ${oneLine(m.text).slice(0, 300)}`);
      else if (m.role === "assistant" && m.tools?.length) lines.push(`ASSISTANT[tools: ${m.tools.join(", ")}]`);
      else if (m.role === "assistant" && m.text.trim()) lines.push(`ASSISTANT: ${oneLine(m.text).slice(0, 200)}`);
    }
    lines.push("");
  }
  for (const m of recent) lines.push(`${m.role.toUpperCase()}: ${m.text.trim()}`);
  return lines.join("\n");
}

type JsonRecord = Record<string, unknown>;

const SKILL_VERBS: Record<string, string> = { create: "created", patch: "patched", edit: "rewritten", write_file: "written", remove_file: "removed", delete: "deleted" };

/**
 * Hermes' `summarize_background_review_actions` in the default ("on") mode: one line per successful
 * memory or skill write of the review, staged proposals included; failures and reads say nothing.
 */
export function summarizeReviewActions(calls: { tool: string; args: JsonRecord; result: JsonRecord }[]): string[] {
  const actions: string[] = [];
  for (const { tool, args, result } of calls) {
    if (tool !== "memory" && tool !== "skill_manage") continue;
    if (result.success !== true) continue;
    if (result.staged === true) {
      if (result.proposal_staged && typeof result.message === "string") actions.push(result.message);
      continue;
    }
    const message = typeof result.message === "string" ? result.message : "";
    const target = (typeof result.target === "string" ? result.target : null) ?? (typeof args.target === "string" ? args.target : "memory");
    const isSkill = tool === "skill_manage";
    if (isSkill && Array.isArray(result.results)) {
      if (!result.operations_applied) continue;
      for (const item of result.results as JsonRecord[]) {
        if (item.success !== true || !item.name) continue;
        const verb = SKILL_VERBS[String(item.action)] ?? String(item.action);
        actions.push(`Skill '${String(item.name)}' ${verb}${item.file_path ? ` (${String(item.file_path)})` : ""}`);
      }
      continue;
    }
    const lower = message.toLowerCase();
    if (lower.includes("created") || lower.includes("updated") || (isSkill && ["patched", "deleted", "written", "archived"].some((w) => lower.includes(w)))) {
      actions.push(message);
      continue;
    }
    if (!isSkill && !target) continue;
    const label = isSkill ? "Skill" : ({ memory: "Memory", user: "User profile" } as Record<string, string>)[target] ?? target;
    if (["added", "replaced", "removed", "applied"].some((w) => lower.includes(w))) actions.push(`${label} updated`);
  }
  return [...new Set(actions)];
}
