import type { Candidate, NextMove, ProjectDocument } from "@shared/domain";
import { pendingMandateRequest } from "@shared/domain";
import { inspectCandidate, latestCandidate, worktreeAssessmentCurrent } from "./candidates";
import { COORDINATOR_MOVES, type CoordinatorMove, type MoveOption, PERSON_MOVE_LABELS, workRequests, workState } from "./workPhase";

/**
 * The Coordinator grounded in Trama's records (issue #269): every turn it reads the buttons the person sees now and
 * the current state of the mandate, the plan and its slices and the candidates, computed from the project document,
 * never from its memory of the thread. Trama checks each reply and flags a step button it names that is not there.
 */

/** The heading of the per-turn section, also named in the Coordinator's instructions. */
export const CURRENT_STATE_HEADING = "## Stato attuale di Trama";
/** The activity Trama records when a reply names a step button the person does not have. */
export const MISSING_BUTTON_TITLE = "Pulsante citato che ora non c'è";
const FEEDBACK_HEADING = "## Pulsante che non c'è";

/** How many unmerged candidates the section lists, newest first. */
const CANDIDATES_SHOWN = 8;
/** How many conflicting files the section names for each conflict. */
const FILES_SHOWN = 5;

/**
 * Every step button Trama can show, with the words that name it: the person's moves, with the mandate card's own
 * button, and the Coordinator's moves, shown as a button when it declares them as the next step.
 */
const BUTTON_WORDS: Array<{ move: NextMove; label: string; pattern: string }> = [
  ...Object.entries(PERSON_MOVE_LABELS).map(([move, label]) => ({ move: move as NextMove, label, pattern: escape(label) })),
  { move: "answerQuestions", label: "Rispondi alle domande", pattern: "Rispondi alle (?:\\d+ )?domande" },
  { move: "grantMandate", label: "Accetta la proposta", pattern: escape("Accetta la proposta") },
  ...Object.entries(COORDINATOR_MOVES).map(([move, words]) => ({ move: move as CoordinatorMove, label: words.label, pattern: escape(words.label) })),
];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
}

/** Quote marks and Markdown emphasis that may wrap a button's words. */
const OPEN = "[\"“«'`*_]";
const CLOSE = "[\"”»'`*_]";

/**
 * A button named as a button: after "pulsante", "bottone", "tasto", "scheda" or a verb that presses it ("premi",
 * "clicca", "usa"), or wrapped in quotes or emphasis. The same words in a plain sentence are not a citation.
 */
function citation(pattern: string): RegExp {
  const lead = `(?:\\b(?:pulsante|bottone|tasto|scheda|premi|premere|clicca|cliccare|tocca|toccare|usa|usare|usando|seleziona)\\s+(?:su\\s+|il\\s+|la\\s+|sul\\s+|sulla\\s+)?${OPEN}*\\s*${pattern}\\b)`;
  const wrapped = `(?:${OPEN}+\\s*${pattern}\\s*[.!]?\\s*${CLOSE}+)`;
  return new RegExp(`${lead}|${wrapped}`, "iu");
}

const CITATIONS = BUTTON_WORDS.map((words) => ({ ...words, regex: citation(words.pattern) }));

/**
 * The step buttons the person can press now, in any dialog: the moves of the current request's work and of the
 * latest request of every dialog, each once. Pure.
 */
export function availableButtons(document: ProjectDocument, requestId: string | null): MoveOption[] {
  const latest = new Map<string | null, string>();
  for (const request of document.requests) latest.set(request.goalId ?? null, request.id);
  const ids = [...new Set([...(requestId ? [requestId] : []), ...latest.values()])];
  const buttons: MoveOption[] = [];
  for (const id of ids) {
    for (const option of workState(document, id).moves) {
      if (!buttons.some((b) => b.move === option.move)) buttons.push(option);
    }
  }
  return buttons;
}

/**
 * The step buttons a reply names that the person does not have now, with the words the reply used, or an empty list.
 * Only Trama's own step buttons are checked, so a reply that names another control is left alone. Pure.
 */
export function missingButtons(reply: string, available: MoveOption[]): string[] {
  const moves = new Set(available.map((b) => b.move));
  const text = reply.replace(/\s+/g, " ");
  const missing: string[] = [];
  for (const words of CITATIONS) {
    if (moves.has(words.move) || !words.regex.test(text)) continue;
    if (!missing.includes(words.label)) missing.push(words.label);
  }
  return missing;
}

const quoted = (labels: string[]) => labels.map((l) => `«${l}»`).join(", ");

/** The activity detail for the person: the button named, and the ones there are now. */
export function missingButtonDetail(missing: string[], available: MoveOption[]): string {
  const named = missing.length === 1 ? `il pulsante ${quoted(missing)}, che ora non c'è` : `i pulsanti ${quoted(missing)}, che ora non ci sono`;
  const persons = available.filter((b) => b.actor === "person").map((b) => b.label);
  const now = persons.length ? `Adesso puoi usare: ${quoted(persons)}.` : "Adesso non c'è un pulsante da premere.";
  return `Il Coordinatore ha nominato ${named}. ${now}`;
}

/**
 * What the Coordinator reads when its previous reply in the dialog of `requestId` named a button that was not there,
 * from the activity Trama recorded then. Null otherwise.
 */
export function missingButtonFeedback(document: ProjectDocument, requestId: string): string | null {
  const index = document.requests.findIndex((r) => r.id === requestId);
  if (index < 0) return null;
  const goalId = document.requests[index]!.goalId ?? null;
  const previous = document.requests.slice(0, index).findLast((r) => (r.goalId ?? null) === goalId);
  if (!previous) return null;
  const flagged = document.events.findLast((e) => e.requestId === previous.id && e.content.type === "activity" && e.content.title === MISSING_BUTTON_TITLE);
  if (flagged?.content.type !== "activity") return null;
  const names = flagged.content.detail?.match(/«[^»]+»/g)?.join(", ") ?? "";
  return [
    FEEDBACK_HEADING,
    `La tua risposta precedente diceva alla persona di usare ${names}, ma quel pulsante non c'era: la persona l'ha cercato senza trovarlo. Nomina solo i pulsanti elencati in "Stato attuale di Trama", con le stesse parole, e correggi l'indicazione di prima in una riga.`,
  ].join("\n");
}

/**
 * The state the Coordinator reads at the start of every turn (issue #269): the buttons the person sees, the mandate,
 * the plan of the work with its slices and the open candidates, computed now from the document. Pure.
 */
export function currentStateText(document: ProjectDocument, requestId: string): string {
  const buttons = availableButtons(document, requestId);
  const persons = buttons.filter((b) => b.actor === "person").map((b) => b.label);
  const lines = [
    `${CURRENT_STATE_HEADING} (letto ora dai dati, non dalla memoria del thread)`,
    "Vale più di quello che ricordi o hai scritto nei turni precedenti: se non coincide, parti da qui e correggi quello che avevi detto.",
    persons.length ? `Pulsanti che la persona vede ora: ${quoted(persons)}.` : "Pulsanti che la persona vede ora: nessuno.",
    "Nomina alla persona solo questi pulsanti, con le stesse parole. Un pulsante che non è in questo elenco ora non c'è: non dire alla persona di premerlo.",
    mandateLine(document),
    ...planLines(document, requestId),
    ...candidateLines(document),
  ];
  return lines.join("\n");
}

function mandateLine(document: ProjectDocument): string {
  const mandate = document.mandate;
  const active =
    mandate?.status === "granted"
      ? `Mandato: versione ${mandate.version}, concesso il ${mandate.grantedAt}.`
      : mandate
        ? `Mandato: revocato${mandate.revocation ? ` il ${mandate.revocation.revokedAt}` : ""}.`
        : "Mandato: nessuno.";
  const pending = pendingMandateRequest(document);
  return pending ? `${active} Proposta di mandato ${pending.id} chiesta il ${pending.askedAt}: aspetta la risposta della persona.` : `${active} Nessuna proposta di mandato in attesa.`;
}

const SLICING_TEXT = {
  drafting: "fette in preparazione",
  proposed: "fette proposte, aspettano la conferma della persona",
  approved: "fette confermate dalla persona",
  failed: "divisione in fette non riuscita",
} as const;

function planLines(document: ProjectDocument, requestId: string): string[] {
  const scope = workRequests(document, requestId);
  const plan = scope ? document.plans.filter((p) => p.requestId !== null && scope.has(p.requestId)).at(-1) : null;
  if (!plan) return ["Piano del lavoro: nessuno."];
  const slicing = plan.slicing;
  const slices = slicing
    ? `${SLICING_TEXT[slicing.status]}${slicing.status === "approved" && slicing.approvedAt ? ` il ${slicing.approvedAt}` : ""}`
    : "senza divisione in fette";
  return [`Piano del lavoro ${plan.id}: stato ${plan.status}, ${slices}.`];
}

function candidateLines(document: ProjectDocument): string[] {
  const assignments = document.team.specialists.flatMap((s) => s.assignments.map((a) => ({ assignment: a, specialist: s })));
  const open = assignments
    .map(({ assignment, specialist }) => ({ candidate: latestCandidate(document, assignment.id), specialist }))
    .filter((item): item is { candidate: Candidate; specialist: (typeof assignments)[number]["specialist"] } => item.candidate !== null && !item.candidate.pullRequest?.mergedAt)
    .sort((a, b) => b.candidate.declaredAt.localeCompare(a.candidate.declaredAt))
    .slice(0, CANDIDATES_SHOWN);
  if (!open.length) return ["Candidati aperti: nessuno."];
  return ["Candidati aperti (l'ultimo di ogni incarico, dal più recente):", ...open.map(({ candidate, specialist }) => `- ${candidate.id} di ${specialist.name} (incarico ${candidate.assignmentId}): ${candidateState(document, candidate)}`)];
}

const specialistOf = (document: ProjectDocument, candidateId: string) => {
  const candidate = document.candidates.find((c) => c.id === candidateId);
  return document.team.specialists.find((s) => s.id === candidate?.specialistId)?.name ?? null;
};

const files = (list: string[]) => (list.length > FILES_SHOWN ? `${list.slice(0, FILES_SHOWN).join(", ")} e altri ${list.length - FILES_SHOWN}` : list.join(", "));

/** Where a candidate stands, in plain words: ready for the person only when nothing blocks it and the review approved it. */
function candidateState(document: ProjectDocument, candidate: Candidate): string {
  const problems: string[] = [];
  for (const blocker of inspectCandidate(document, candidate, null)) {
    switch (blocker.code) {
      case "EVIDENCE_MISSING":
        problems.push(`verifica ${blocker.detail} mai eseguita`);
        break;
      case "EVIDENCE_STALE":
        problems.push(`verifica ${blocker.detail} da rifare`);
        break;
      case "CHECK_FAILED":
        problems.push(`verifica ${blocker.detail} fallita`);
        break;
      case "DECISION_CHANGED":
        problems.push(`decisione ${blocker.detail} cambiata dopo il candidato`);
        break;
      case "UNRESOLVED_CHOICE":
        problems.push(`scelta aperta: ${blocker.detail}`);
        break;
      case "EXTERNAL_EFFECT_UNSUPPORTED":
        problems.push(`effetto esterno non verificato: ${blocker.detail}`);
        break;
      case "REMOTE_CONFLICT":
      case "WORKTREE_CONFLICT":
        // Conflicts are spelled out below, with the other side named.
        break;
      default:
        problems.push(`${blocker.code} ${blocker.detail}`.trim());
    }
  }
  for (const assessment of document.conflicts ?? []) {
    if (assessment.candidateId !== candidate.id || assessment.snapshotId !== candidate.snapshotId) continue;
    if (assessment.classification !== "conflict" || !worktreeAssessmentCurrent(document, assessment)) continue;
    const other = assessment.otherCandidateId
      ? `il candidato ${assessment.otherCandidateId}${specialistOf(document, assessment.otherCandidateId) ? ` di ${specialistOf(document, assessment.otherCandidateId)}` : ""}`
      : assessment.references.join(", ");
    problems.push(`in conflitto con ${other} su ${files(assessment.conflictingFiles)}`);
  }
  const review = candidate.technicalReview?.verdict;
  if (review === "changesRequested") problems.push("la revisione tecnica chiede modifiche");
  else if (review !== "approved") problems.push("revisione tecnica non ancora fatta");
  if (problems.length) return `non verificato, non è pronto per la persona (${problems.join("; ")}).`;
  if (candidate.pullRequest) return `verificato e approvato, pull request #${candidate.pullRequest.number} aperta e non ancora unita.`;
  return "verificato e approvato: pronto per la revisione della persona.";
}
