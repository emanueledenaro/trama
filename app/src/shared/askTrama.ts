import type { ProjectDocument } from "./domain";
import type { Translate } from "./i18n";

/**
 * Ask Trama (M07): AI Hero's ask-trama skill (upstream ask-matt) picks a route through the skills, and Trama starts
 * it instead of telling the person which command to type. Main and renderer share these shapes and labels.
 */

export const ASK_TRAMA_SKILL = "ask-trama";

/** The parts of the ask-trama skill a route can come from, in the skill's own section order. */
export const ROUTE_PATHS = ["mainFlow", "onRamp", "codebaseHealth", "vocabulary", "standalone", "precondition"] as const;
export type RoutePath = (typeof ROUTE_PATHS)[number];

/** The five options at a phase boundary, as PHASE-BOUNDARIES.md orders them. */
export const PHASE_BOUNDARIES = ["continue", "clear", "handoff", "subagent", "compact"] as const;
export type PhaseBoundary = (typeof PHASE_BOUNDARIES)[number];

/**
 * How Trama runs a step: `flow` is a Trama flow that runs the skill with its original text, `skill` is a bundled skill
 * Trama has no flow for, run in the Coordinator's session with its original text, `unavailable` is a skill the
 * bundled package does not carry: Trama never simulates it.
 */
export type RouteStepKind = "flow" | "skill" | "unavailable";

export interface RouteStep {
  skill: string;
  kind: RouteStepKind;
}

export type RouteStatus = "proposed" | "started" | "declined" | "superseded";

export interface AskTramaRoute {
  /** `AT-` and 8 hex characters. */
  id: string;
  /** The request whose turn proposed it. */
  requestId: string | null;
  /** The goal dialog it belongs to; null is the project dialog. */
  goalId: string | null;
  situation: string;
  path: RoutePath;
  steps: RouteStep[];
  /** The move at the boundary between the conversation so far and the route's first phase. */
  boundary: PhaseBoundary;
  reason: string;
  status: RouteStatus;
  createdAt: string;
  answeredAt: string | null;
}

/**
 * The skills of ask-trama that have a Trama flow (issue #130). Every other skill the package carries runs as itself in
 * the Coordinator's session.
 */
export const FLOW_SKILLS = [
  "grill-with-docs",
  "grilling",
  "domain-modeling",
  "to-spec",
  "to-tickets",
  "implement",
  "tdd",
  "code-review",
  "triage",
  "diagnosing-bugs",
  "improve-codebase-architecture",
] as const;
type FlowSkill = (typeof FLOW_SKILLS)[number];
const hasFlow = (skill: string): skill is FlowSkill => (FLOW_SKILLS as readonly string[]).includes(skill);

/** The Trama flow of a skill in the person's words, or null when the skill has none. */
export const flowLabel = (t: Translate, skill: string): string | null => (hasFlow(skill) ? t(`shared.flow.${skill}`) : null);

/** ask-trama's commands that are phase boundaries in Trama, not steps of a route. */
export const BOUNDARY_COMMANDS: Readonly<Record<string, PhaseBoundary>> = { clear: "clear", compact: "compact", handoff: "handoff" };

export const routePathLabel = (t: Translate, path: RoutePath): string => t(`shared.routePath.${path}`);

/** What each boundary means in Trama (issue #130): the Coordinator's session, a new one, a summary or a read-only specialist. */
export const boundaryLabel = (t: Translate, boundary: PhaseBoundary): { label: string; detail: string } => ({
  label: t(`shared.boundary.${boundary}`),
  detail: t(`shared.boundary.${boundary}.detail`),
});

export const stepKindLabel = (t: Translate, kind: RouteStepKind): string => t(`shared.stepKind.${kind}`);

/** How Trama runs `skill`: its flow, the skill itself when bundled, otherwise not at all. */
export function stepKind(skill: string, bundled: readonly string[]): RouteStepKind {
  if (!bundled.includes(skill)) return "unavailable";
  return hasFlow(skill) ? "flow" : "skill";
}

/** The step Trama starts on confirmation: the first one it can run. */
export function firstRunnableStep(route: AskTramaRoute): RouteStep | null {
  return route.steps.find((step) => step.kind !== "unavailable") ?? null;
}

export function findRoute(document: ProjectDocument, id: string): AskTramaRoute | null {
  return document.routes?.find((route) => route.id === id) ?? null;
}

/** The route's steps as the person reads them, for example "grill-with-docs → to-spec". */
export const routeSteps = (route: AskTramaRoute) => route.steps.map((step) => step.skill).join(" → ");
