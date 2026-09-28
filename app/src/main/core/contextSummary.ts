import type { ConversationEvent, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { workingGoals } from "@shared/goals";
import { openGrillingQuestions } from "@shared/grilling";
import type { WaitingItem } from "@shared/waitingForYou";
import { currentStateText } from "./coordinatorGrounding";
import { focusText } from "./focus";
import { activeAssignments } from "./team";
import { workState, workStateText } from "./workPhase";

/**
 * The context summary (ADR 0018): what the Coordinator needs to go on in a new session, written by Trama from its own
 * records, never by the model. Trama writes it when the Coordinator's context passes the project's threshold, keeps it
 * in Activity and hands it to the new session with the study and the memory. Pure.
 */

export const CONTEXT_SUMMARY_TITLE = "Riepilogo del contesto";

/** The exchanges the summary quotes word for word, so a short answer such as "sì, procedi" keeps its sense. */
const VERBATIM_EXCHANGES = 8;
/** Earlier messages of the person the summary lists in one line each. */
const DIGEST_MESSAGES = 12;
const VERBATIM_LIMIT = 4_000;
const DIGEST_LIMIT = 160;

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

function goalsSection(document: ProjectDocument): string[] {
  const goals = workingGoals(document);
  if (!goals.length) return ["## Obiettivi", "Nessun obiettivo aperto."];
  return ["## Obiettivi", ...goals.map((g) => `- ${g.id} (${g.status === "proposed" ? "proposto" : "aperto"}): ${g.title}. Risultato atteso: ${oneLine(g.outcome, 300)}`)];
}

function pactSection(document: ProjectDocument): string[] {
  if (!document.decisions.length) return ["## Decisioni del Patto", "Nessuna decisione registrata."];
  return ["## Decisioni del Patto", ...document.decisions.map((d) => `- ${d.id} v${d.version}: ${oneLine(d.value, 300)}`)];
}

function mandateSection(document: ProjectDocument): string[] {
  const mandate = document.mandate;
  if (mandate?.status !== "granted") return [];
  const lines = ["## Mandato in vigore", `Versione ${mandate.version}.`];
  if (mandate.objectives.length) lines.push(`Obiettivi: ${mandate.objectives.join("; ")}.`);
  if (mandate.priorities.length) lines.push(`Priorità: ${mandate.priorities.join("; ")}.`);
  if (mandate.limits.length) lines.push(`Limiti: ${mandate.limits.join("; ")}.`);
  return lines;
}

function assignmentLine(document: ProjectDocument, assignment: SpecialistAssignment): string {
  const specialist = document.team.specialists.find((s) => s.id === assignment.specialistId);
  const update = assignment.lastUpdate ? ` Ultimo aggiornamento: ${oneLine(assignment.lastUpdate, 300)}` : "";
  return `- ${assignment.id} (${specialist?.name ?? assignment.specialistId}, ${assignment.status}): ${oneLine(assignment.objective, 300)}.${update}`;
}

function assignmentsSection(document: ProjectDocument): string[] {
  const active = activeAssignments(document);
  return ["## Incarichi in corso", ...(active.length ? active.map((a) => assignmentLine(document, a)) : ["Nessun incarico in corso."])];
}

function waitingSection(waiting: WaitingItem[]): string[] {
  if (!waiting.length) return ["## Richieste che aspettano la persona", "Nessuna."];
  return ["## Richieste che aspettano la persona", ...waiting.map((item) => `- ${item.targetId} (${item.label}): ${item.title}`)];
}

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

function exchangeLine(event: ConversationEvent, limit: number | null): string | null {
  const content = event.content;
  const text = content.type === "personMessage" ? content.text : content.type === "coordinatorText" ? content.text : null;
  if (text === null) return null;
  const who = content.type === "personMessage" ? "Persona" : "Coordinatore";
  return `${who}: ${limit === null ? clip(text) : oneLine(text, limit)}`;
}

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

/** The summary Trama hands to the Coordinator's new session. */
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
    exchangesSection(document),
  ];
  return sections
    .filter((lines) => lines.length)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}
