import { describe, expect, it } from "vitest";
import { emptyDocument } from "../main/core/document";
import type { AssignmentStatus, CandidateState, CardKind, ConflictAssessment, DecisionRequest, ProjectDocument, SpecialistAssignment, WorkPlan } from "./domain";
import { type SettledContext, settledCard } from "./settledCards";
import type { TimelineRow } from "./timeline";

const at = "2026-09-28T12:00:00.000Z";

const label = (text: string) => ({ label: text, tone: "secondary" as const });
const context = (candidateStates: Record<string, CandidateState> = {}): SettledContext => ({
  candidateStates,
  colleagues: [],
  labels: {
    assignment: Object.fromEntries((["preparing", "running", "stopRequested", "stopped", "completed", "failed", "paused"] as AssignmentStatus[]).map((s) => [s, label(s)])) as SettledContext["labels"]["assignment"],
    candidate: Object.fromEntries((["building", "verified", "decided", "superseded"] as CandidateState[]).map((s) => [s, label(s)])) as SettledContext["labels"]["candidate"],
  },
});

const card = (cardKind: CardKind, referenceId: string): TimelineRow => ({
  kind: "card",
  id: `E-${referenceId}`,
  cardKind,
  event: { id: `E-${referenceId}`, sequence: 1, origin: "trama", requestId: null, createdAt: at, content: { type: "card", kind: cardKind, title: "", detail: null, referenceId } },
});

function question(id: string, extra: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    id,
    requestId: null,
    category: "product",
    question: `Quale pagamento accettiamo? (${id})`,
    concreteCase: "Ordine 42",
    alternatives: [
      { behavior: "Solo carta", example: "Visa" },
      { behavior: "Carta e bonifico", example: "IBAN" },
    ],
    revisesDecisionId: null,
    askedAt: at,
    outcome: null,
    ...extra,
  } as DecisionRequest;
}

const answered = (alternativeIndex: number | null, answer = "Carta e bonifico") => ({ outcome: { answer, alternativeIndex, decisionId: "D-1", version: 1, answeredAt: at } });

function withTeam(document: ProjectDocument, assignments: Partial<SpecialistAssignment>[]): ProjectDocument {
  document.team.specialists.push({
    id: "S-1",
    name: "Luca",
    competence: "Node",
    assignments: assignments.map((a) => ({ objective: "Correggi lo script typecheck", status: "completed", ...a }) as SpecialistAssignment),
  } as ProjectDocument["team"]["specialists"][number]);
  return document;
}

describe("settledCard (issue #271)", () => {
  it("keeps an open decision whole and turns an answered one into a line with the choice", () => {
    const document = emptyDocument("p");
    document.decisionRequests.push(question("Q-1"), question("Q-2", answered(1)), question("Q-3", answered(null, "Solo contanti alla consegna")), question("Q-4", { withdrawal: { reason: "non serve", withdrawnAt: at } }));
    expect(settledCard(document, card("decision", "Q-1"), context())).toBeNull();
    expect(settledCard(document, card("decision", "Q-2"), context())).toMatchObject({ title: "Decisione", answer: "Carta e bonifico", outcome: { label: "Decisa", tone: "success" } });
    expect(settledCard(document, card("decision", "Q-3"), context())?.answer).toBe("Solo contanti alla consegna");
    expect(settledCard(document, card("decision", "Q-4"), context())).toMatchObject({ answer: null, outcome: { label: "Ritirata" } });
  });

  it("closes a grilling round only when every question it still asks has an answer", () => {
    const document = emptyDocument("p");
    const grilling = (number: number) => ({ grilling: { subjectRequestId: "R1", round: 1, number } }) as Partial<DecisionRequest>;
    document.decisionRequests.push(question("Q-1", { ...grilling(1), ...answered(0) }), question("Q-2", grilling(2)));
    const round: TimelineRow = { kind: "grillingRound", id: "round-1", subjectRequestId: "R1", round: 1, questionIds: ["Q-1", "Q-2"] };
    expect(settledCard(document, round, context())).toBeNull();
    document.decisionRequests[1]!.withdrawal = { reason: "chiarita", withdrawnAt: at };
    expect(settledCard(document, round, context())).toMatchObject({ subject: "2 domande", outcome: { label: "Turno completo" } });
    expect(settledCard(document, card("decision", "Q-1"), context())?.title).toBe("Domanda 1");
  });

  it("settles a mandate or a team proposal once the person answered it", () => {
    const document = emptyDocument("p");
    const mandate = { id: "M-1", requestId: null, reason: "Unire la correzione di Luca", objectives: [], priorities: [], scopeModuleIds: [], authorizedActions: [], limits: [], askedAt: at, resolution: null };
    document.mandateRequests.push(mandate as ProjectDocument["mandateRequests"][number]);
    expect(settledCard(document, card("mandate", "M-1"), context())).toBeNull();
    document.mandateRequests[0]!.resolution = { kind: "granted", version: 2, resolvedAt: at };
    expect(settledCard(document, card("mandate", "M-1"), context())).toMatchObject({ title: "Mandato", subject: "Unire la correzione di Luca", outcome: { label: "Concesso, v2", tone: "success" } });

    document.team.proposals.push({ id: "T-1", requestId: null, summary: null, members: [{ name: "Luca" }, { name: "Marco" }], askedAt: at, resolution: null } as unknown as ProjectDocument["team"]["proposals"][number]);
    expect(settledCard(document, card("teamProposal", "T-1"), context())).toBeNull();
    document.team.proposals[0]!.resolution = { kind: "confirmed", specialistIds: [], resolvedAt: at };
    expect(settledCard(document, card("teamProposal", "T-1"), context())).toMatchObject({ subject: "Luca, Marco", outcome: { label: "Team confermato" } });
  });

  it("settles a plan replaced by another, and keeps one to review or with its slices at work", () => {
    const document = emptyDocument("p");
    const plan = (id: string, extra: Partial<WorkPlan>) => ({ id, summary: `Piano ${id}`, status: "ready", ...extra }) as WorkPlan;
    document.plans.push(plan("P-1", { status: "superseded" }), plan("P-2", { slicing: { status: "approved" } as WorkPlan["slicing"] }), plan("P-3", { slicing: { status: "proposed" } as WorkPlan["slicing"] }));
    expect(settledCard(document, card("plan", "P-1"), context())?.outcome.label).toBe("Superato");
    expect(settledCard(document, card("plan", "P-2"), context())).toBeNull();
    expect(settledCard(document, card("plan", "P-3"), context())).toBeNull();
  });

  it("settles finished work, but keeps the card of a developer's last work that stopped, where Riprendi is", () => {
    const document = withTeam(emptyDocument("p"), [
      { id: "A-1", status: "failed" },
      { id: "A-2", status: "completed" },
      { id: "A-3", status: "running" },
    ]);
    expect(settledCard(document, card("assignment", "A-1"), context())).toMatchObject({ subject: "Luca: Correggi lo script typecheck", outcome: { label: "failed" } });
    expect(settledCard(document, card("assignment", "A-2"), context())?.outcome.label).toBe("completed");
    expect(settledCard(document, card("assignment", "A-3"), context())).toBeNull();
    document.team.specialists.at(-1)!.assignments[2]!.status = "stopped";
    expect(settledCard(document, card("assignment", "A-3"), context())).toBeNull();
  });

  it("settles a replaced candidate and the conflicts that repeat the branch divergence, never the live ones", () => {
    const document = emptyDocument("p");
    document.candidates.push({ id: "C-1", assignmentId: "A-1", specialistId: "S-1", changedFiles: ["package.json"] } as ProjectDocument["candidates"][number]);
    expect(settledCard(document, card("candidate", "C-1"), context({ "C-1": "verified" }))).toBeNull();
    expect(settledCard(document, card("candidate", "C-1"), context({ "C-1": "decided" }))).toBeNull();
    expect(settledCard(document, card("candidate", "C-1"), context({ "C-1": "superseded" }))).toMatchObject({ subject: "1 file", outcome: { label: "superseded" } });
    // A merged candidate is settled too, with its pull request (issue #247).
    document.candidates[0]!.pullRequest = { url: "u", number: 21, branch: "b", at: at, mergedAt: at };
    expect(settledCard(document, card("candidate", "C-1"), context({ "C-1": "decided" }))).toMatchObject({ outcome: { label: "Unito, #21", tone: "success" } });
    document.candidates[0]!.pullRequest = null;
    // A refused one too, with the person's reason.
    document.candidates[0]!.humanRejection = { actor: "Persona", note: "Troppo acceso in scuro", fingerprint: "f", at };
    expect(settledCard(document, card("candidate", "C-1"), context({ "C-1": "decided" }))).toMatchObject({ subject: "1 file, motivo: Troppo acceso in scuro", answer: null, outcome: { label: "Rifiutato da te", tone: "warning" } });
    document.candidates[0]!.humanRejection = null;

    const conflict = { id: "K-1", candidateId: "C-1", snapshotId: "s", remoteSHA: "abc", references: ["main"], classification: "conflict", detail: "", conflictingFiles: ["package.json"], checkedAt: at } as ConflictAssessment;
    document.conflicts = [conflict];
    expect(settledCard(document, card("conflict", "K-1"), context())).toBeNull();
    document.branchDivergence = { branch: "chore/pre-apertura", defaultBranch: "main", headSHA: "h", remoteSHA: "abc", ahead: 13, behind: 7, conflictingFiles: [], checkedAt: at };
    expect(settledCard(document, card("conflict", "K-1"), context())).toMatchObject({ title: "Branch principale su GitHub", outcome: { label: "Nell'avviso del progetto" } });
  });

  it("never settles the other rows", () => {
    const document = emptyDocument("p");
    expect(settledCard(document, card("study", "X"), context())).toBeNull();
    expect(settledCard(document, { kind: "person", id: "P", event: card("study", "X").kind === "card" ? (card("study", "X") as Extract<TimelineRow, { kind: "card" }>).event : (null as never), text: "ciao", moduleName: null, imageCount: 0 }, context())).toBeNull();
  });
});
