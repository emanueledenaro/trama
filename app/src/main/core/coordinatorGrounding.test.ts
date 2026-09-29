import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, ProjectDocument, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import {
  availableButtons,
  currentStateText,
  memorySection,
  missingButtonTitle,
  missingButtonDetail,
  missingButtonFeedback,
  missingButtons,
} from "./coordinatorGrounding";
import { appendEvent, emptyDocument } from "./document";
import { grantDelegation } from "./fullDelegation";
import { answerDecisionRequest, createDecisionRequest, createMandateRequest, grantMandate } from "./pact";
import { setPersonLanguage } from "./personLanguage";
import { assign, confirmTeam, endTurn, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 12, minute));

function request(document: ProjectDocument, id: string, goalId: string | null = null): CoordinatorRequest {
  const value: CoordinatorRequest = { id, text: id, moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId };
  document.requests.push(value);
  return value;
}

const alternatives = [
  { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
  { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
];

function grill(document: ProjectDocument, requestId: string) {
  const grilling = placeGrillingQuestion(document, { runningRequestId: requestId, round: 1, recommendedIndex: 1, alternatives: 2 });
  return createDecisionRequest(document, { requestId, category: "product", question: `Domanda ${grilling.number}`, concreteCase: "Ordine 42", alternatives, revisesDecisionId: null, grilling });
}

function plan(document: ProjectDocument, requestId: string): WorkPlan {
  const value: WorkPlan = {
    id: `P-${document.plans.length + 1}`,
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Revisione degli ordini",
    issueNumber: null,
    status: "ready",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
  };
  document.plans.push(value);
  return value;
}

/** Grilling settled, mandate and team granted, a ready plan and two assignments of Luca and Ada. */
function shop() {
  const document = emptyDocument("negozio");
  request(document, "r1");
  answerDecisionRequest(document, grill(document, "r1").id, { alternativeIndex: 1, freeText: null });
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Luca", competence: "Node", reason: "Script", moduleIds: ["Sources/Orders"] },
      { name: "Ada", competence: "Test", reason: "Test", moduleIds: ["Sources/Payments"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  request(document, "r2");
  plan(document, "r2");
  request(document, "r3");
  return document;
}

function work(document: ProjectDocument, specialist: string, moduleId: string, minute: number) {
  return assign(
    document,
    { specialist, kind: "agreedTicket", objective: "Correggere", issueNumber: null, exercise: null, moduleIds: [moduleId], dependencies: [], model: "gpt-6-luna", tools: ["edits"], requiredChecks: ["node_typecheck"], instructions: "Scrivi" },
    document.mandate!.version,
    "r3",
    at(minute),
  );
}

function candidate(document: ProjectDocument, assignmentId: string, check: "pass" | null, review: "approved" | null, minute = 5) {
  endTurn(document, assignmentId, null, { kind: "completed", text: "Fatto" });
  const value = declareCandidate(
    document,
    { assignmentId, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignmentId}`, baseSHA: "base", diff: "+x", changedFiles: ["package.json"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(minute),
  );
  if (check) recordEvidence(document, value.id, { check: "node_typecheck", passed: true, command: "npm run typecheck", output: "", snapshotId: value.snapshotId });
  if (review) recordTechnicalReview(document, value.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: review, summary: "Letto" });
  return value;
}

describe("missingButtons: a reply that names a step button the person does not have (issue #269)", () => {
  it("flags the buttons of the shop audit when the work does not offer them", () => {
    const document = shop();
    const buttons = availableButtons(document, "r3");
    expect(buttons.map((b) => b.move)).not.toContain("reviewCandidate");
    expect(missingButtons("Ora devi usare la scheda Verifica il candidato.", buttons)).toEqual(["Verifica il candidato"]);
    expect(missingButtons("Ora devi solo confermare usando il pulsante Conferma la comprensione.", buttons)).toEqual(["Conferma la comprensione"]);
    expect(missingButtons('Premi **"Conferma le fette"** qui sotto.', buttons)).toEqual(["Conferma le fette"]);
    expect(missingButtons("Clicca su «Accetta la proposta».", buttons)).toEqual(["Accetta la proposta"]);
    expect(missingButtons("Usa il pulsante\nRispondi alle 3 domande.", buttons)).toEqual(["Rispondi alle domande"]);
  });

  it("leaves alone the buttons the person has now, in any dialog, and the same words in a plain sentence", () => {
    const document = shop();
    createMandateRequest(document, { requestId: "r1", reason: "Serve unire", objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    request(document, "g1", "G-1");
    const buttons = availableButtons(document, "g1");
    expect(buttons.map((b) => b.move)).toContain("grantMandate");
    expect(missingButtons("Premi «Accetta la proposta» sulla scheda del mandato, oppure il pulsante Concedi il mandato.", buttons)).toEqual([]);
    expect(missingButtons("Luca verifica il candidato e poi Trama conferma le fette.", buttons)).toEqual([]);
    expect(missingButtons("Apri il diff dalla scheda del candidato.", buttons)).toEqual([]);
    expect(missingButtons("", buttons)).toEqual([]);
  });

  it("allows a step button only while it is the declared next step under the latest reply", () => {
    const document = shop();
    const assignment = work(document, "Luca", "Sources/Orders", 2);
    candidate(document, assignment.id, "pass", "approved");
    // The work allows the review, but without a declared next step the chat shows no button for it.
    expect(missingButtons("Ora usa la scheda Verifica il candidato.", availableButtons(document, "r3"))).toEqual(["Verifica il candidato"]);
    document.requests.find((r) => r.id === "r3")!.nextStep = { move: "reviewCandidate", reason: "Il candidato è pronto.", declaredAt: at(8).toISOString() };
    const buttons = availableButtons(document, "r3");
    expect(buttons).toContainEqual({ move: "reviewCandidate", actor: "person", label: "Verifica il candidato" });
    expect(missingButtons("Ora usa la scheda Verifica il candidato.", buttons)).toEqual([]);
  });

  it("tells the person what was named and what there is now", () => {
    const document = shop();
    expect(missingButtonDetail(["Verifica il candidato"], [])).toBe(
      "Il Coordinatore ha nominato il pulsante «Verifica il candidato», che ora non c'è. Adesso non c'è un pulsante da premere.",
    );
    createMandateRequest(document, { requestId: "r3", reason: "Serve unire", objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    expect(missingButtonDetail(["Verifica il candidato", "Conferma le fette"], availableButtons(document, "r3"))).toBe(
      "Il Coordinatore ha nominato i pulsanti «Verifica il candidato», «Conferma le fette», che ora non ci sono. Adesso puoi usare: «Concedi il mandato».",
    );
  });
});

describe("missingButtonFeedback: the next turn reads the button that was not there (issue #269)", () => {
  it("sends back the names from the activity of the previous reply in the same dialog", () => {
    const document = shop();
    const there = [{ move: "grantMandate" as const, actor: "person" as const, label: "Concedi il mandato" }];
    appendEvent(document, "trama", { type: "activity", title: missingButtonTitle(), detail: missingButtonDetail(["Verifica il candidato"], there), tone: "error" }, "r3");
    request(document, "r4");
    request(document, "g1", "G-1");
    const feedback = missingButtonFeedback(document, "r4");
    expect(feedback).toContain("## Pulsante che non c'è");
    expect(feedback).toContain("«Verifica il candidato»");
    // The buttons there were are not named as missing.
    expect(feedback).not.toContain("Concedi il mandato");
    expect(missingButtonFeedback(document, "g1")).toBeNull();
    expect(missingButtonFeedback(document, "r1")).toBeNull();
    expect(missingButtonFeedback(document, "missing")).toBeNull();
  });

  it("writes the activity in English and still reads it back for the Coordinator (issue #301)", () => {
    setPersonLanguage("en");
    try {
      const document = shop();
      const there = [{ move: "grantMandate" as const, actor: "person" as const, label: "Concedi il mandato" }];
      const detail = missingButtonDetail(["Verifica il candidato"], there);
      expect(missingButtonTitle()).toBe("Cited button that is not there now");
      expect(detail).toBe("The Coordinator named the button “Verifica il candidato”, which is not there now. Now you can use: “Concedi il mandato”.");
      appendEvent(document, "trama", { type: "activity", title: missingButtonTitle(), detail, tone: "error" }, "r3");
      request(document, "r4");
      setPersonLanguage("it");
      const feedback = missingButtonFeedback(document, "r4");
      expect(feedback).toContain("«Verifica il candidato»");
      expect(feedback).not.toContain("Concedi il mandato");
    } finally {
      setPersonLanguage("it");
    }
  });
});

describe("memory notes against the delegation and the mandate (issue #423)", () => {
  it("tells the Coordinator every turn that a note asking to wait for the person does not hold the work", () => {
    const document = shop();
    // Within the mandate: a note that asks for the person's yes on a step the mandate covers does not stop it.
    expect(currentStateText(document, "r3")).toContain("Il mandato vale più delle note di memoria");
    // With the full delegation: the note gives way, and the Coordinator corrects it and writes it down for the person.
    document.events.push({ id: "E-d", sequence: 99, origin: "person", requestId: null, createdAt: at(1).toISOString(), content: { type: "personMessage", text: "devi essere autonomo tu coordinatore", moduleId: null, moduleName: null, composer: true } });
    grantDelegation(document, { quote: "devi essere autonomo tu coordinatore", tickets: false });
    const text = currentStateText(document, "r3");
    expect(text).toContain("La delega vale più delle note di memoria");
    expect(text).toContain("correggi la nota con memory");
  });

  it("heads the memory with what counts more than a note", () => {
    expect(memorySection([])).toBe("## Memoria (note tue, non decisioni della persona: il mandato, la delega piena e i messaggi della persona valgono di più)\nLa memoria è vuota.");
    expect(memorySection(["§ Nota uno", "§ Nota due"])).toContain("§ Nota uno\n\n§ Nota due");
  });
});

describe("currentStateText: the state the Coordinator reads every turn (issue #269)", () => {
  it("names the buttons, the mandate, the confirmed slices and each candidate as Trama records them", () => {
    const document = shop();
    document.plans[0]!.slicing = { status: "approved", tickets: [], feedback: null, approvedAt: at(7).toISOString(), failure: null, publishFailure: null };
    const matrix = work(document, "Luca", "Sources/Orders", 2);
    const old = candidate(document, matrix.id, null, null, 4);
    const script = work(document, "Ada", "Sources/Payments", 3);
    const fixed = candidate(document, script.id, "pass", "approved", 6);
    document.conflicts = [
      {
        id: "K-1",
        candidateId: fixed.id,
        snapshotId: fixed.snapshotId,
        remoteSHA: "abc",
        references: [old.id],
        classification: "conflict",
        conflictingFiles: ["package.json"],
        otherCandidateId: old.id,
        otherSnapshotId: old.snapshotId,
        detail: "",
        checkedAt: at(4).toISOString(),
      },
    ];
    createMandateRequest(document, { requestId: "r3", reason: "Serve unire", objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });

    const text = currentStateText(document, "r3");
    expect(text).toContain("## Stato attuale di Trama");
    expect(text).toContain("Pulsanti che la persona vede ora: «Concedi il mandato».");
    expect(text).toContain("non dire alla persona di premerlo");
    expect(text).toContain(`Mandato: versione 1, concesso il ${document.mandate!.grantedAt}. Proposta di mandato ${document.mandateRequests[0]!.id}`);
    expect(text).toContain(`Piano del lavoro P-1: stato ready, fette confermate dalla persona il ${at(7).toISOString()}.`);
    expect(text).toContain(`- ${fixed.id} di Ada (incarico ${script.id}): non verificato, non è pronto per la persona (in conflitto con il candidato ${old.id} di Luca su package.json).`);
    expect(text).toContain(`- ${old.id} di Luca (incarico ${matrix.id}): non verificato, non è pronto per la persona (verifica node_typecheck mai eseguita; revisione tecnica non ancora fatta).`);
    // The newest candidate comes first.
    expect(text.indexOf(fixed.id)).toBeLessThan(text.indexOf(`- ${old.id}`));
  });

  it("tells the Coordinator that realigning a diverged branch is its move within the mandate, never the person's", () => {
    const document = shop();
    expect(currentStateText(document, "r3")).not.toContain("Branch del progetto:");
    // The person's checkout has a commit GitHub lacks, while chore/pre-apertura on GitHub moved on with 9 commits.
    const divergence = {
      branch: "chore/pre-apertura",
      defaultBranch: "chore/pre-apertura",
      headSHA: "f1197f9104cf652c4b1d8b06137e7aab9173388d",
      remoteSHA: "8b70a5f32bb2f6502443e4700e383f7e2173657b",
      ahead: 1,
      behind: 9,
      conflictingFiles: ["package-lock.json"],
      checkedAt: at(8).toISOString(),
    };
    document.branchDivergence = divergence;
    const own = currentStateText(document, "r3");
    expect(own).toContain(
      "Branch del progetto: la copia della persona di chore/pre-apertura ha 1 commit che chore/pre-apertura su GitHub non ha, e GitHub ne ha 9 che la copia non ha; la loro unione lascia in conflitto package-lock.json.",
    );
    expect(own).toContain("Riallinearli tocca a te dentro il mandato");
    expect(own).toContain("unisce origin/chore/pre-apertura");
    // The branch as it is on GitHub against main: the same move, towards the project's branch.
    document.branchDivergence = { ...divergence, defaultBranch: "main", ahead: 13, behind: 7, conflictingFiles: [".gitignore", "next.config.js"] };
    const main = currentStateText(document, "r3");
    expect(main).toContain(
      "Branch del progetto: chore/pre-apertura e main su GitHub sono andati in direzioni diverse (13 commit solo in chore/pre-apertura, 7 solo in main); la loro unione lascia in conflitto .gitignore, next.config.js.",
    );
    expect(main).toContain("unisce origin/main");
  });

  it("says a candidate is ready for the person only when it is verified and approved", () => {
    const document = shop();
    const assignment = work(document, "Luca", "Sources/Orders", 2);
    const ready = candidate(document, assignment.id, "pass", "approved");
    const text = currentStateText(document, "r3");
    expect(text).toContain(`- ${ready.id} di Luca (incarico ${assignment.id}): verificato e approvato: pronto per la revisione della persona.`);
    expect(text).toContain("Pulsanti che la persona vede ora: nessuno.");
    expect(text).toContain("Nessuna proposta di mandato in attesa.");
    // After the checkout moved on, the same candidate is blocked, as in the candidate reports.
    expect(currentStateText(document, "r3", "new-head")).toContain(
      `- ${ready.id} di Luca (incarico ${assignment.id}): non verificato, non è pronto per la persona (il progetto è cambiato dopo il candidato, va ricostruito e verificato di nuovo).`,
    );
    expect(currentStateText(document, "r3", "base")).toContain("pronto per la revisione della persona");
  });

  it("says a candidate that lags the worktree is not the work of now (issue #388)", () => {
    const document = shop();
    const assignment = work(document, "Luca", "Sources/Orders", 2);
    const ready = candidate(document, assignment.id, "pass", "approved");
    assignment.worktreeSnapshot = { snapshotId: "after-the-fix", at: "2026-09-28T16:26:00.000Z" };
    const text = currentStateText(document, "r3");
    expect(text).toContain(`- ${ready.id} di Luca (incarico ${assignment.id}): non verificato, non è pronto per la persona (la copia di lavoro è cambiata dopo questo candidato`);
    expect(text).not.toContain("pronto per la revisione della persona");
  });

  it("says when there is no mandate, plan, candidate or button", () => {
    const document = emptyDocument("vuoto");
    request(document, "r1");
    const text = currentStateText(document, "r1");
    expect(text).toContain("Pulsanti che la persona vede ora: nessuno.");
    expect(text).toContain("Mandato: nessuno. Nessuna proposta di mandato in attesa.");
    expect(text).toContain("Piano del lavoro: nessuno.");
    expect(text).toContain("Candidati aperti: nessuno.");
  });
});
