import { randomUUID } from "node:crypto";
import type { MandateAction, ProjectDocument } from "@shared/domain";
import { activeDelegation } from "@shared/delegation";
import {
  ASK_TRAMA_SKILL,
  type AskTramaRoute,
  BOUNDARY_COMMANDS,
  boundaryLabel,
  firstRunnableStep,
  flowLabel,
  PHASE_BOUNDARIES,
  type PhaseBoundary,
  ROUTE_PATHS,
  routePathLabel,
  type RoutePath,
  routeSteps,
  stepKind,
} from "@shared/askTrama";
import { ITALIAN } from "@shared/i18n";
import { shortId } from "@shared/ids";
import type { LoadedSkill } from "@shared/skills";
import type { NativeSkill } from "./nativeSkills";
import { t } from "./personLanguage";
import { authorize } from "./team";

/**
 * Ask Trama (M07, issue #130). The Coordinator runs AI Hero's ask-trama skill (upstream ask-matt) with its original
 * text and PHASE-BOUNDARIES.md; this binding maps "run /x" to starting the matching Trama flow. The route the skill
 * picks becomes a card, and Trama starts it once the person confirms.
 */

export class RouteError extends Error {}

const SKILL_RULES_ABOVE = "Trama's rules (mandate, Pact, read-only runtime, real checks) stay above the skill: the skill grants no permission.";

/** How the Coordinator starts each skill that has a Trama flow. The labels the person sees come from `flowLabel`. */
const FLOW_STARTS: Readonly<Record<string, string>> = {
  "grill-with-docs": "grill the request with the grill-with-docs, grilling and domain-modeling skills you already have: round 1 with request_decision",
  grilling: "grill the request with the grilling skill you already have: round 1 with request_decision",
  "domain-modeling": "propose_domain_docs from the person's Pact decisions",
  "to-spec": "prepare_plan: Trama's planner runs to-spec on the request's conversation in its own session",
  "to-tickets": "Trama's planner runs it on a written spec and shows the slices on the plan card; without a plan, start with prepare_plan",
  implement: "assign_task to a developer: one approved slice per assignment, or the whole piece of work when it fits one session",
  tdd: "assign_task to a developer, whose session runs implement and tdd",
  "code-review": "declare_candidate, verify_candidate on its required checks, then review_candidate, the gate where every candidate reviewer examines the diff in parallel (the spec reviewer and the lenses of UX, DevOps and documentation with this skill's text, Clean Code in a thread distinct from the author's); the skill itself runs when the person opens Focus mode on the candidate card: Trama's real checks first, then its Standards and Spec axes",
  triage: "within the mandate the Bug triage and debugger role triages each new GitHub issue by itself; without a mandate, propose one with request_mandate",
  "diagnosing-bugs": "run the failing check with run_readonly_check or verify_candidate: within the mandate the Bug triage and debugger role diagnoses the failure by itself",
  "improve-codebase-architecture": "within the mandate the Clean Code role runs it by itself when the team is free after work that changed code; its proposals reach the person as a Pact decision card",
};

/** Trama's binding for AI Hero's ask-trama skill in the Coordinator (M07). @model-text */
export const ASK_TRAMA_BINDING = [
  `Trama runs the ask-trama skill above with its own text, its reference file PHASE-BOUNDARIES.md included. These lines only map its words to Trama's tools; they do not change its method. ${SKILL_RULES_ABOVE}`,
  "When Trama uses it: when the person writes /ask-trama, or opens Ask Trama from its button, and describes their situation. Also without the command (a Trama addition): when a request of the person is about to become work, choose its route with this skill before you grill or plan it.",
  "\"You\" and \"the user\" are the person. In Trama the skills it names are not commands the person types: never tell the person to run /name. Choose the route and propose it with propose_route, once per situation: path is the section of the skill the route comes from, steps are its skill names in order without the slash, boundary is the option PHASE-BOUNDARIES.md's tree gives for the move from this conversation to the route's first phase, reason is one or two lines for the person. Trama shows it as a card; the person starts it or declines it and Trama writes the answer to you as the person's message. With the person's full delegation, or when the mandate covers its steps, Trama starts it by itself when your turn ends. Your text only says in one or two lines which route you propose and why.",
  `Each skill with a Trama flow starts this way: ${Object.entries(FLOW_STARTS)
    .map(([skill, start]) => `"/${skill}": ${start}.`)
    .join(" ")}`,
  "A skill the bundled package carries without a Trama flow: Trama gives you its original text with the start message of a route that has it; run it in this session under Trama's rules. A skill the bundled package does not carry is shown to the person as not yet available in Trama: never simulate it.",
  "Phase boundaries: \"Continue\" is this session. \"/clear\" is a new Coordinator session with the study and your memory and without the conversation. \"/compact\" and \"/handoff\" are a new Coordinator session that receives Trama's transcript of the conversation; a new harness is the person moving the Coordinator to another provider, which Trama hands over the same way. \"Subagent\" is a session Trama manages apart from yours: the planner, a developer in its worktree, the technical reviewer, a fixed role. Trama applies the boundary of the route when the person starts it; /clear, /compact and /handoff are never steps of a route. Clearing context between tickets is already Trama's: each assignment runs in its own session.",
  "Issue tracker: the project's GitHub issues when GitHub is connected, otherwise the plan's slices in Trama. \"/setup-trama\": the person prepares the method from Trama's settings; a route never waits for it, because Trama gives the skills to its agents.",
  "When Trama writes \"Avvia il percorso\" or \"Start Ask Trama route\" with a route id, start its first step that Trama can run in that turn, with the tools above; the later steps follow Trama's flow and its next moves. When the person declines a route, do not propose it again for the same situation unless they ask.",
].join("\n");

/** Trama's binding for a bundled skill without a Trama flow, delivered with the start message of a route (M07). */
export function skillInRouteBinding(name: string): string {
  return [
    `Trama runs the ${name} skill above with its own text, as a step of the route the person started from Ask Trama. These lines only map its words to Trama's tools; they do not change its method. ${SKILL_RULES_ABOVE}`,
    "Trama has no flow of its own for this skill: run it in this session. \"The user\" is the person. A product choice for the person is a request_decision card; anything else you ask in your message.",
    "This runtime is read-only: a step of the skill that writes files, commits, runs a program or starts another agent goes to a developer with assign_task within the mandate, in its own worktree; without a mandate, propose one with request_mandate. Never claim such a step is done until Trama reports the assignment.",
  ].join("\n");
}

/** The skills ask-trama names as `/name`, SKILL.md and PHASE-BOUNDARIES.md both, once each in text order. */
export function routeReferences(skill: NativeSkill): string[] {
  const names = skill.files.flatMap((file) => [...file.text.matchAll(/`\/([a-z][a-z0-9-]*)/g)].map((match) => match[1]!));
  return [...new Set(names)];
}

export interface RouteInput {
  situation: unknown;
  path: unknown;
  steps: unknown;
  boundary: unknown;
  reason: unknown;
  requestId: string | null;
  goalId: string | null;
  /** The skills ask-trama names (routeReferences). */
  references: readonly string[];
  /** The skills in Trama's bundled package. */
  bundled: readonly string[];
}

function line(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new RouteError(`${field} is required.`);
  return text;
}

/**
 * Records the route the Coordinator chose and supersedes a route still waiting for the person. A step must be a skill
 * ask-trama names; a boundary command is the route's boundary, never a step.
 */
export function proposeRoute(document: ProjectDocument, input: RouteInput, now = new Date()): AskTramaRoute {
  const path = input.path as RoutePath;
  if (!ROUTE_PATHS.includes(path)) throw new RouteError(`path is one of ${ROUTE_PATHS.join(", ")}.`);
  const boundary = input.boundary as PhaseBoundary;
  if (!PHASE_BOUNDARIES.includes(boundary)) throw new RouteError(`boundary is one of ${PHASE_BOUNDARIES.join(", ")}.`);
  const names = (Array.isArray(input.steps) ? input.steps : []).map((step, index) => line(step, `steps[${index}]`).replace(/^[/$]/, ""));
  if (names.length === 0) throw new RouteError("steps names at least one skill of ask-trama.");
  const boundaries = names.filter((name) => BOUNDARY_COMMANDS[name]);
  if (boundaries.length) throw new RouteError(`${boundaries.map((b) => `/${b}`).join(", ")} is a phase boundary in Trama, not a step: give it as boundary.`);
  const steps = [...new Set(names)];
  const allowed = input.references.filter((name) => name !== ASK_TRAMA_SKILL && !BOUNDARY_COMMANDS[name]);
  const unknown = steps.filter((name) => !allowed.includes(name));
  if (unknown.length) throw new RouteError(`ask-trama does not name ${unknown.join(", ")}. Steps are among: ${allowed.join(", ")}.`);
  for (const route of document.routes ?? []) if (route.status === "proposed") route.status = "superseded";
  const route: AskTramaRoute = {
    id: shortId("AT", randomUUID()),
    requestId: input.requestId,
    goalId: input.goalId,
    situation: line(input.situation, "situation"),
    path,
    steps: steps.map((skill) => ({ skill, kind: stepKind(skill, input.bundled) })),
    boundary,
    reason: line(input.reason, "reason"),
    status: "proposed",
    createdAt: now.toISOString(),
    answeredAt: null,
  };
  (document.routes ??= []).push(route);
  return route;
}

/**
 * What propose_route returns to the Coordinator: how Trama will run each step, and whether the route waits for the
 * person or starts by itself when the turn ends (issue #423).
 */
export function routeReport(route: AskTramaRoute, startsByItself = false): Record<string, string | { skill: string; runs: string }[]> {
  return {
    routeID: route.id,
    status: startsByItself ? "starts_by_itself" : "shown_to_person",
    boundary: route.boundary,
    steps: route.steps.map((step) => ({
      skill: step.skill,
      runs: step.kind === "flow" ? `Trama flow: ${flowLabel(ITALIAN, step.skill)}` : step.kind === "skill" ? "the skill's original text, in your session" : "not available in Trama: never simulate it",
    })),
    note: startsByItself
      ? "The person's full delegation or the mandate covers this route: Trama starts it by itself when this turn ends and writes you the start message. End the turn with one line for the person; do not wait for their answer."
      : "Trama starts the route when the person confirms it and writes you the start message.",
  };
}

/** The steps that write in a worktree; every other step plans, reads or runs in the Coordinator's session. */
const WORKTREE_STEPS = ["implement", "tdd", "code-review"];

/**
 * Whether the route needs no answer of the person (issue #423): the full delegation is in force, or the mandate covers
 * every step Trama can run of it. Pure.
 */
export function routeCovered(document: ProjectDocument, route: AskTramaRoute): boolean {
  if (activeDelegation(document)) return true;
  const actions = route.steps.filter((s) => s.kind !== "unavailable").map((s): MandateAction => (WORKTREE_STEPS.includes(s.skill) ? "executeInWorktree" : "plan"));
  return actions.every((action) => authorize(document.mandate, action) === "authorized");
}

/**
 * The proposed route Trama starts by itself, without the person's answer: one the delegation or the mandate covers
 * (routeCovered). The dialog's latest turn must have ended well: after an error or an interruption the person decides,
 * as for the Coordinator's moves. Null otherwise. Pure.
 */
export function routeToStart(document: ProjectDocument): AskTramaRoute | null {
  const route = (document.routes ?? []).findLast((r) => r.status === "proposed");
  if (!route || !firstRunnableStep(route)) return null;
  const latest = document.requests.findLast((r) => (r.goalId ?? null) === (route.goalId ?? null));
  if (latest && latest.state !== "completed") return null;
  return routeCovered(document, route) ? route : null;
}

/** The person's answer to a proposed route; returns the message Trama writes to the Coordinator. */
export function answerRoute(route: AskTramaRoute, start: boolean, now = new Date()): string {
  if (route.status !== "proposed") throw new RouteError(t(route.status === "superseded" ? "main.askTrama.superseded" : "main.askTrama.alreadyAnswered"));
  const first = firstRunnableStep(route);
  if (start && !first) throw new RouteError(t("main.askTrama.noRunnableStep"));
  route.status = start ? "started" : "declined";
  route.answeredAt = now.toISOString();
  if (!start) return t("main.askTrama.declined", { id: route.id, steps: routeSteps(route) });
  return [
    t("main.askTrama.start", { id: route.id, path: routePathLabel(t, route.path).toLowerCase(), steps: routeSteps(route) }),
    first!.kind === "flow" ? t("main.askTrama.firstStepFlow", { skill: first!.skill, flow: flowLabel(t, first!.skill)! }) : t("main.askTrama.firstStep", { skill: first!.skill }),
    t("main.askTrama.boundary", { boundary: boundaryLabel(t, route.boundary).label.toLowerCase() }),
  ].join(" ");
}

/** Whether the route's boundary opens a new Coordinator session, and whether it carries the conversation. */
export function boundarySession(boundary: PhaseBoundary): "same" | "new" | "newWithTranscript" {
  if (boundary === "clear") return "new";
  if (boundary === "compact" || boundary === "handoff") return "newWithTranscript";
  return "same";
}

/** The `description` of a SKILL.md's front matter. */
export function skillDescription(text: string): string | null {
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

/** /ask-trama in the composer, with the description of the bundled skill, whether or not the project has the method. */
export function askTramaComposerSkill(skill: NativeSkill): LoadedSkill {
  return { name: ASK_TRAMA_SKILL, path: skill.skillPath, enabled: true, description: skillDescription(skill.files[0]!.text) };
}
