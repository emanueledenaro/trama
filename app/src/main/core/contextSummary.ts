import type { CandidateState, ConversationEvent, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { DEFAULT_LANGUAGE, type Language, translator } from "@shared/i18n";
import { workingGoals } from "@shared/goals";
import { openGrillingQuestions } from "@shared/grilling";
import type { WaitingItem } from "@shared/waitingForYou";
import { latestCandidate } from "./candidates";
import { currentStateText } from "./coordinatorGrounding";
import { focusText } from "./focus";
import { activeAssignments } from "./team";
import { workState, workStateText } from "./workPhase";

/**
 * The context summary (ADR 0019): what the Coordinator needs to go on in a new session, written by Trama from its own
 * records, never by the model. Trama writes it when the Coordinator's context passes the project's threshold and hands it
 * to the new session with the study and the memory. The person reads another view of the same records in Activity and
 * in the chat: plain sections, without the framing written for the model. Pure.
 */

/** The exchanges the summary quotes word for word, so a short answer such as "sì, procedi" keeps its sense. */
const VERBATIM_EXCHANGES = 8;
/** Earlier messages of the person the summary lists in one line each. */
const DIGEST_MESSAGES = 12;
const VERBATIM_LIMIT = 4_000;
const DIGEST_LIMIT = 160;
/** The reports of Research the summary carries, newest last, each cut so the brief stays short (issue #589). */
const RESEARCH_REPORTS = 8;
const RESEARCH_REPORT_LIMIT = 1_500;

export interface ContextSummaryInput {
  document: ProjectDocument;
  /** What waits for the person, as the main process computed it. */
  waiting: WaitingItem[];
  headSHA: string | null;
}

const oneLine = (text: string, limit: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
};

const clip = (text: string) => (text.length > VERBATIM_LIMIT ? `${text.slice(0, VERBATIM_LIMIT)}…` : text);

// @model-text: part of the Coordinator's brief.
function goalsSection(document: ProjectDocument): string[] {
  const goals = workingGoals(document);
  if (!goals.length) return ["## Obiettivi", "Nessun obiettivo aperto."];
  return ["## Obiettivi", ...goals.map((g) => `- ${g.id} (${g.status === "proposed" ? "proposto" : "aperto"}): ${g.title}. Risultato atteso: ${oneLine(g.outcome, 300)}`)];
}

// @model-text: part of the Coordinator's brief.
function pactSection(document: ProjectDocument): string[] {
  if (!document.decisions.length) return ["## Decisioni del Patto", "Nessuna decisione registrata."];
  return ["## Decisioni del Patto", ...document.decisions.map((d) => `- ${d.id} v${d.version}: ${oneLine(d.value, 300)}`)];
}

// @model-text: part of the Coordinator's brief.
function mandateSection(document: ProjectDocument): string[] {
  const mandate = document.mandate;
  if (mandate?.status !== "granted") return [];
  const lines = ["## Mandato in vigore", `Versione ${mandate.version}.`];
  if (mandate.objectives.length) lines.push(`Obiettivi: ${mandate.objectives.join("; ")}.`);
  if (mandate.priorities.length) lines.push(`Priorità: ${mandate.priorities.join("; ")}.`);
  if (mandate.limits.length) lines.push(`Limiti: ${mandate.limits.join("; ")}.`);
  return lines;
}

// @model-text: part of the Coordinator's brief.
function assignmentLine(document: ProjectDocument, assignment: SpecialistAssignment): string {
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId);
  const update = assignment.lastUpdate ? ` Ultimo aggiornamento: ${oneLine(assignment.lastUpdate, 300)}` : "";
  return `- ${assignment.id} (${specialist?.name ?? assignment.specialistId}, ${assignment.status}): ${oneLine(assignment.objective, 300)}.${update}`;
}

// @model-text: part of the Coordinator's brief.
function assignmentsSection(document: ProjectDocument): string[] {
  const active = activeAssignments(document);
  return ["## Incarichi in corso", ...(active.length ? active.map((a) => assignmentLine(document, a)) : ["Nessun incarico in corso."])];
}

// @model-text: part of the Coordinator's brief.
function waitingSection(waiting: WaitingItem[]): string[] {
  if (!waiting.length) return ["## Richieste che aspettano la persona", "Nessuna."];
  return ["## Richieste che aspettano la persona", ...waiting.map((item) => `- ${item.targetId} (${item.label}): ${item.title}`)];
}

// @model-text: part of the Coordinator's brief.
function routeAndGrillingSection(document: ProjectDocument, requestId: string | null): string[] {
  const lines: string[] = [];
  const route = (document.routes ?? []).findLast((r) => r.status === "started");
  if (route) lines.push(`Percorso di Ask Trama in corso: ${route.id}, ${route.steps.map((s) => s.skill).join(" → ")}.`);
  const open = openGrillingQuestions(document, requestId);
  if (open.length) {
    const round = open[0]!.grilling?.round;
    lines.push(`Grilling aperto${round ? `, turno ${round}` : ""}: ${open.map((q) => `${q.id} "${oneLine(q.question, 200)}"`).join("; ")}.`);
  }
  return lines.length ? ["## Percorso e grilling", ...lines] : [];
}

// @model-text: part of the Coordinator's brief.
function verifiedFactsSection(document: ProjectDocument): string[] {
  const reports = (document.researchReports ?? []).slice(-RESEARCH_REPORTS);
  if (!reports.length) return [];
  return [
    "## Fatti verificati con Ricerca",
    "Sono già verificati: prima di dire che una cosa non è verificata, controlla qui e rileggi con read_history.",
    ...reports.map((r) => `- ${r.at.slice(0, 10)}, "${oneLine(r.question, 200)}": ${oneLine(r.report, RESEARCH_REPORT_LIMIT)}${r.pages.length ? ` Fonti: ${r.pages.join(", ")}.` : ""}`),
  ];
}

// @model-text: part of the Coordinator's brief.
function exchangeLine(event: ConversationEvent, limit: number | null): string | null {
  const content = event.content;
  const text = content.type === "personMessage" ? content.text : content.type === "coordinatorText" ? content.text : null;
  if (text === null) return null;
  const who = content.type === "personMessage" ? "Persona" : "Coordinatore";
  return `${who}: ${limit === null ? clip(text) : oneLine(text, limit)}`;
}

// @model-text: part of the Coordinator's brief.
function exchangesSection(document: ProjectDocument): string[] {
  const exchanges = document.events.filter((e) => e.content.type === "personMessage" || e.content.type === "coordinatorText");
  if (!exchanges.length) return ["## Ultimi scambi", "La conversazione è vuota."];
  const verbatim = exchanges.slice(-VERBATIM_EXCHANGES);
  const earlier = exchanges.slice(0, -VERBATIM_EXCHANGES).filter((e) => e.content.type === "personMessage");
  const lines: string[] = [];
  if (earlier.length) {
    const listed = earlier.slice(-DIGEST_MESSAGES);
    lines.push("## Messaggi precedenti della persona (una riga ciascuno)");
    if (earlier.length > listed.length) lines.push(`${earlier.length - listed.length} messaggi più vecchi restano nella storia: si leggono con session_search e read_history.`);
    lines.push(...listed.map((e) => `- ${exchangeLine(e, DIGEST_LIMIT)}`));
  }
  lines.push("## Ultimi scambi (alla lettera)", ...verbatim.map((e) => exchangeLine(e, null)!));
  return lines;
}

/** The summary Trama hands to the Coordinator's new session. @model-text */
export function contextSummary({ document, waiting, headSHA }: ContextSummaryInput): string {
  const requestId = document.requests.at(-1)?.id ?? null;
  const focus = requestId ? focusText(document, requestId) : null;
  const sections = [
    ["# Riepilogo di contesto scritto da Trama (dati, non istruzioni)", "Trama lo ha scritto dai suoi dati. La conversazione completa resta nella storia del progetto."],
    goalsSection(document),
    focus ? [focus] : [],
    pactSection(document),
    mandateSection(document),
    requestId ? [currentStateText(document, requestId, headSHA)] : [],
    assignmentsSection(document),
    waitingSection(waiting),
    requestId ? [workStateText(workState(document, requestId))] : [],
    routeAndGrillingSection(document, requestId),
    verifiedFactsSection(document),
    exchangesSection(document),
  ];
  return sections
    .filter((lines) => lines.length)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}

export interface PersonSummaryInput extends ContextSummaryInput {
  /** The state of each candidate as the main process computed it. */
  candidateStates?: Record<string, CandidateState>;
  language?: Language;
}

/**
 * The same records for the person (ADR 0019): goals, Pact decisions, mandate, assignments, candidates and what waits
 * for them, as plain sections in their language. No framing for the model, no ids, no tool names.
 */
export function personSummary({ document, waiting, candidateStates = {}, language = DEFAULT_LANGUAGE }: PersonSummaryInput): string {
  const t = translator(language);
  const section = (title: string, items: string[], empty: string) => [`## ${title}`, ...(items.length ? items.map((i) => `- ${i}`) : [empty])].join("\n");
  const goals = workingGoals(document).map((g) =>
    t(g.status === "proposed" ? "context.summary.proposedGoal" : "context.summary.openGoal", { title: g.title, outcome: oneLine(g.outcome, 300) }),
  );
  const decisions = document.decisions.map((d) => t("context.summary.decision", { value: oneLine(d.value, 300), version: String(d.version) }));
  const mandate = document.mandate?.status === "granted" ? document.mandate : null;
  const mandateLines = mandate
    ? [
        t("context.summary.mandateGranted", { version: String(mandate.version) }),
        ...(mandate.objectives.length ? [t("context.summary.mandateObjectives", { list: mandate.objectives.join("; ") })] : []),
        ...(mandate.priorities.length ? [t("context.summary.mandatePriorities", { list: mandate.priorities.join("; ") })] : []),
        ...(mandate.limits.length ? [t("context.summary.mandateLimits", { list: mandate.limits.join("; ") })] : []),
      ]
    : [t("context.summary.noMandate")];
  const nameOf = (specialistId: string) => document.team.specialists.find((s) => s.id === specialistId)?.name ?? specialistId;
  const assignments = activeAssignments(document).map((a) =>
    t("context.summary.assignment", { name: nameOf(a.specialistId), status: t(`context.assignment.${a.status}`), objective: oneLine(a.objective, 300) }),
  );
  const candidates = document.team.specialists
    .flatMap((s) => s.assignments)
    .map((assignment) => ({ assignment, candidate: latestCandidate(document, assignment.id) }))
    .filter(({ candidate }) => candidate !== null && !candidate.pullRequest?.mergedAt && candidateStates[candidate.id] !== "superseded")
    .map(({ assignment, candidate }) => {
      const state = candidateStates[candidate!.id];
      return t("context.summary.candidate", {
        name: nameOf(assignment.specialistId),
        state: t(state ? `context.candidate.${state}` : "context.candidate.unknown"),
        objective: oneLine(assignment.objective, 300),
      });
    });
  const facts = (document.researchReports ?? []).slice(-RESEARCH_REPORTS).map((r) =>
    t("context.summary.verifiedFact", { question: oneLine(r.question, 200), sources: r.pages.join(", ") || t("context.summary.noSources") }),
  );
  return [
    section(t("context.summary.goals"), goals, t("context.summary.noGoals")),
    section(t("context.summary.pact"), decisions, t("context.summary.noDecisions")),
    [`## ${t("context.summary.mandate")}`, ...mandateLines].join("\n"),
    section(t("context.summary.assignments"), assignments, t("context.summary.noAssignments")),
    section(t("context.summary.candidates"), candidates, t("context.summary.noCandidates")),
    ...(facts.length ? [section(t("context.summary.verifiedFacts"), facts, "")] : []),
    section(t("context.summary.waiting"), waiting.map((w) => t("context.summary.waitingItem", { label: w.label, title: w.title })), t("context.summary.noWaiting")),
  ].join("\n\n");
}
