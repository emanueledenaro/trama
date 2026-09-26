import type { ProjectDocument } from "./domain";

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
 * The skills of ask-trama that have a Trama flow, with the flow in the person's words (issue #130). Every other skill
 * the package carries runs as itself in the Coordinator's session.
 */
export const TRAMA_FLOWS: Readonly<Record<string, string>> = {
  "grill-with-docs": "Grilling prima del piano, con glossario e ADR",
  grilling: "Grilling prima del piano",
  "domain-modeling": "Glossario e ADR dalle decisioni del Patto",
  "to-spec": "Piano scritto come spec",
  "to-tickets": "Fette verticali del piano",
  implement: "Incarico a uno sviluppatore, con implement e tdd",
  tdd: "Incarico a uno sviluppatore, con implement e tdd",
  "code-review": "Revisione tecnica del candidato",
  triage: "Triage delle issue, dal ruolo Bug triage e debugger",
  "diagnosing-bugs": "Diagnosi di un difetto, dal ruolo Bug triage e debugger",
  "improve-codebase-architecture": "Revisione dell'architettura, dal ruolo Clean Code",
};

/** ask-trama's commands that are phase boundaries in Trama, not steps of a route. */
export const BOUNDARY_COMMANDS: Readonly<Record<string, PhaseBoundary>> = { clear: "clear", compact: "compact", handoff: "handoff" };

export const ROUTE_PATH_LABELS: Record<RoutePath, string> = {
  mainFlow: "Flusso principale",
  onRamp: "Ingresso nel flusso principale",
  codebaseHealth: "Salute del codice",
  vocabulary: "Vocabolario",
  standalone: "Strumento isolato",
  precondition: "Preparazione",
};

/** What each boundary means in Trama (issue #130): the Coordinator's session, a new one, a summary or a read-only specialist. */
export const BOUNDARY_LABELS: Record<PhaseBoundary, { label: string; detail: string }> = {
  continue: { label: "Continua", detail: "Il Coordinatore resta nella sessione di adesso." },
  clear: { label: "Nuova sessione", detail: "Il Coordinatore apre una sessione nuova con lo studio e la memoria, senza la conversazione." },
  handoff: { label: "Passaggio di consegne", detail: "Il Coordinatore apre una sessione nuova e riceve la trascrizione della conversazione scritta da Trama." },
  subagent: { label: "Sessione separata", detail: "Il lavoro va a una sessione separata gestita da Trama; la sessione del Coordinatore non cambia." },
  compact: { label: "Riassunto", detail: "Il Coordinatore apre una sessione nuova e riceve la trascrizione della conversazione scritta da Trama." },
};

export const STEP_KIND_LABELS: Record<RouteStepKind, string> = {
  flow: "Flusso di Trama",
  skill: "Skill nel Coordinatore",
  unavailable: "Non ancora disponibile in Trama",
};

/** How Trama runs `skill`: its flow, the skill itself when bundled, otherwise not at all. */
export function stepKind(skill: string, bundled: readonly string[]): RouteStepKind {
  if (!bundled.includes(skill)) return "unavailable";
  return TRAMA_FLOWS[skill] ? "flow" : "skill";
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
