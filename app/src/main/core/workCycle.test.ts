import { describe, expect, it } from "vitest";
import type { Candidate, CoordinatorRequest, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { candidateSuperseded } from "@shared/conflictScope";
import { GATE_ROLES } from "@shared/gate";
import { declareCandidate, openCorrections, recordEvidence, recordTechnicalReview } from "./candidates";
import { automaticMoveSection } from "./continuousWork";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { beginReviews, closeGate, finishReview, openGate } from "./gate";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { resumeInput } from "./specialistBriefing";
import { assign, confirmTeam, endTurn, findSpecialist, proposeTeam, recordWorkspace, requestStop } from "./team";

/**
 * The cycle of the work on the shop's realignment (29 September): the Coordinator opened new assignments in new, empty
 * working copies instead of taking up the one that held the resolved merge. A correction continues in the working copy
 * of the work it corrects, and the Coordinator resumes stopped work, or hands it to another developer, in that copy.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 13, minute));

function request(document: ProjectDocument, id: string, minute: number): CoordinatorRequest {
  const value: CoordinatorRequest = { id, text: id, moduleId: null, state: "completed", model: "gpt-5.5", effort: null, createdAt: at(minute).toISOString(), completedAt: null, failure: null, goalId: null, step: null };
  document.requests.push(value);
  return value;
}

/** The shop: a mandate over the site, Marco and Bea as developers, one Pact decision and the person's first message. */
function shop(actions: ("plan" | "executeInWorktree" | "integrateCandidate")[] = ["plan", "executeInWorktree"]): ProjectDocument {
  const document = emptyDocument("negozio");
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: ["src/app"], authorizedActions: actions, limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Marco", competence: "Next.js", reason: "Negozio", moduleIds: ["src/app"] },
      { name: "Bea", competence: "Next.js", reason: "Negozio", moduleIds: ["src/app"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  const alternatives = [
    { behavior: "Dati aziendali nel sito", example: "La P.IVA nel piè di pagina", consequence: null },
    { behavior: "Dati aziendali solo nei documenti", example: "Nessuna P.IVA nel sito", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: null, category: "product", question: "Dove vanno i dati aziendali?", concreteCase: "Piè di pagina", alternatives, revisesDecisionId: null });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  request(document, "r1", 0);
  return document;
}

const WORKTREE = "/tmp/Worktrees/c4e84cfe";

/** Marco's realignment: its working copy holds the resolved merge, not committed. */
function realignment(document: ProjectDocument, minute = 1): SpecialistAssignment {
  const assignment = assign(
    document,
    {
      specialist: "Marco",
      kind: "decidedBehaviorCorrection",
      objective: "Riallineare chore/pre-apertura con main",
      issueNumber: 24,
      exercise: null,
      moduleIds: ["src/app"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Unisci main e risolvi i conflitti",
      decisionIds: [document.decisions[0]!.id],
    },
    document.mandate!.version,
    "r1",
    at(minute),
  );
  recordWorkspace(document, assignment.id, { sourceRoot: "/tmp/negozio", worktreeRoot: WORKTREE, branch: "chore/issue-24-riallineare-trama-c4e84cfe", baseSHA: "f1197f9" }, at(minute));
  return assignment;
}

/** The developer's turn ended; the Coordinator declared the working copy and the gate blocked it. */
function blockedCandidate(document: ProjectDocument, assignment: SpecialistAssignment, minute: number): Candidate {
  if (assignment.status === "preparing") endTurn(document, assignment.id, null, { kind: "completed", text: "Merge risolto, non committato" }, at(minute));
  const candidate = declareCandidate(
    document,
    { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${minute}`, baseSHA: "f1197f9", diff: "+merge", changedFiles: ["src/app/page.tsx"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(minute),
  );
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: candidate.snapshotId }, at(minute));
  const gate = openGate(document, candidate, at(minute));
  beginReviews(gate, { spec: false, model: "mini", cleanCodeModel: "gpt-5.5" }, at(minute));
  for (const role of GATE_ROLES) finishReview(gate, role, { report: "", findings: [] }, at(minute));
  finishReview(gate, "specReviewer", { report: "", findings: [{ severity: "blocking", title: "Dati aziendali in config.json", detail: "Via dal repository", file: "src/config/config.json" }] }, at(minute));
  closeGate(gate, at(minute));
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: `gate:${gate.id}`, authorThreadId: "author", verdict: "changesRequested", summary: "Fermato", gateId: gate.id }, at(minute));
  return candidate;
}

/** Trama stops the work because a Pact decision changed while it ran (C06). */
function stopByTrama(document: ProjectDocument, assignment: SpecialistAssignment, minute: number) {
  if (assignment.status === "completed") assignment.status = "running";
  requestStop(document, assignment.specialistId, "Trama", "Decision changed or is under review.", false, at(minute));
  endTurn(document, assignment.id, null, { kind: "interrupted" }, at(minute));
}

function context(document: ProjectDocument, runningRequestId = "r2") {
  const started: string[] = [];
  const value = {
    document,
    runningRequestId,
    changed: () => undefined,
    addCard: () => undefined,
    snapshot: { modules: [{ id: "src/app", name: "app", relativePath: "src/app", files: [] }] },
    startAssignment: (id: string) => void started.push(id),
    models: ["gpt-5.5"],
    defaultModel: "gpt-5.5",
    defaultProvider: "codex",
    providers: [{ id: "codex", models: ["gpt-5.5"] }],
    headSHA: async () => "f1197f9",
  } as unknown as ToolContext;
  return { context: value, started };
}

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

const correction = {
  kind: "decidedBehaviorCorrection",
  objective: "Correggere i rimandi a config.json nei documenti",
  moduleIDs: ["src/app"],
  requiredChecks: ["git_status"],
  tools: ["edits"],
  instructions: "Correggi i rimandi, non toccare config.json",
  seams: ["I documenti"],
  decisionIDs: [],
  dependencies: [],
};

describe("a correction continues in the working copy of the work it corrects", () => {
  it("takes up the working copy with the resolved merge instead of preparing an empty one", async () => {
    const document = shop();
    const marco = realignment(document);
    const blocked = blockedCandidate(document, marco, 2);
    request(document, "r2", 3);
    const { context: tools, started } = context(document);

    const result = parse(await runCoordinatorTool("assign_task", { ...correction, specialist: "Bea" }, tools));
    const bea = findSpecialist(document, "Bea")!.assignments.at(-1)!;
    expect(result.replacesAssignmentIDs).toEqual([marco.id]);
    expect(bea.workspace).toEqual(marco.workspace);
    expect(result.worktree).toEqual({ branch: marco.workspace!.branch, continuesAssignmentID: marco.id });
    expect(started).toEqual([bea.id]);
    expect(candidateSuperseded(document, blocked)).toBe(true);
  });

  it("corrects work Trama stopped as well, as the shop's realignment stopped when a decision changed", async () => {
    const document = shop();
    const marco = realignment(document);
    blockedCandidate(document, marco, 2);
    stopByTrama(document, marco, 3);
    expect(marco.status).toBe("stopped");
    request(document, "r2", 4);
    expect(openCorrections(document, "r2", { moduleIds: ["src/app"], slice: null })).toEqual([marco.id]);
    const { context: tools } = context(document);
    parse(await runCoordinatorTool("assign_task", { ...correction, specialist: "Bea" }, tools));
    expect(findSpecialist(document, "Bea")!.assignments.at(-1)!.workspace?.worktreeRoot).toBe(WORKTREE);
  });

  it("gives other work on the same modules a working copy of its own", async () => {
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    request(document, "r2", 3);
    const { context: tools } = context(document);
    const result = parse(await runCoordinatorTool("assign_task", { ...correction, specialist: "Bea" }, tools));
    expect(result.replacesAssignmentIDs).toBeUndefined();
    expect(result.worktree).toBeUndefined();
    expect(findSpecialist(document, "Bea")!.assignments.at(-1)!.workspace).toBeNull();
  });
});

describe("the Coordinator resumes stopped work in its working copy (resume_assignment)", () => {
  it("resumes Marco's stopped realignment in its working copy with the Coordinator's instructions, once", async () => {
    const document = shop();
    const marco = realignment(document);
    blockedCandidate(document, marco, 2);
    stopByTrama(document, marco, 3);
    const { context: tools, started } = context(document);

    const result = parse(
      await runCoordinatorTool(
        "resume_assignment",
        { assignment: marco.id, instructions: "Correggi solo i rimandi nei documenti; il merge resta com'è.", reason: "La copia di Marco ha il merge risolto" },
        tools,
      ),
    );
    expect(result).toMatchObject({ assignmentID: marco.id, status: "resumed", branch: marco.workspace!.branch });
    expect(marco.status).toBe("preparing");
    expect(started).toEqual([marco.id]);
    const input = resumeInput(marco, document.decisions);
    expect(input).toContain("Correggi solo i rimandi nei documenti; il merge resta com'è.");
    // Once: a later turn does not repeat the instructions.
    const later = new Date(Date.parse(marco.coordinatorNote!.at) + 60_000).toISOString();
    marco.turns.push({ id: "t2", number: 2, model: "gpt-5.5", startedAt: later, endedAt: later, outcome: "completed" });
    expect(resumeInput(marco, document.decisions)).not.toContain("Correggi solo i rimandi");
  });

  it("hands the stopped work to another developer on the same working copy and branch", async () => {
    const document = shop();
    const marco = realignment(document);
    const blocked = blockedCandidate(document, marco, 2);
    stopByTrama(document, marco, 3);
    const { context: tools, started } = context(document);

    const result = parse(
      await runCoordinatorTool("resume_assignment", { assignment: blocked.id, specialist: "Bea", instructions: "Continua il riallineamento di Marco.", reason: "Marco è fermo" }, tools),
    );
    const bea = findSpecialist(document, "Bea")!.assignments.at(-1)!;
    expect(result).toMatchObject({ assignmentID: bea.id, status: "handedOver", replacesAssignmentID: marco.id, branch: marco.workspace!.branch });
    expect(bea).toMatchObject({ objective: marco.objective, moduleIds: marco.moduleIds, issueNumber: 24, replaces: [marco.id], requiredChecks: ["git_status"] });
    expect(bea.workspace).toEqual(marco.workspace);
    expect(bea.instructions).toContain("Continua il riallineamento di Marco.");
    expect(started).toEqual([bea.id]);
    expect(candidateSuperseded(document, blocked)).toBe(true);
    expect(marco.status).toBe("stopped");
  });

  it("refuses work at work, work the person stopped, merged work and work without a working copy", async () => {
    const document = shop();
    const marco = realignment(document);
    const { context: tools, started } = context(document);
    const call = async (args: Record<string, string>) => {
      const result = await runCoordinatorTool("resume_assignment", { instructions: "Riprendi", reason: "Motivo", ...args }, tools);
      return { error: result.isError === true, text: result.content[0]!.text };
    };
    expect(await call({ assignment: marco.id })).toMatchObject({ error: true, text: expect.stringContaining("assignment_running") });

    requestStop(document, marco.specialistId, "Persona", "Basta per oggi", false, at(2));
    endTurn(document, marco.id, null, { kind: "interrupted" }, at(2));
    expect(await call({ assignment: marco.id })).toMatchObject({ error: true, text: expect.stringContaining("stopped_by_person") });

    marco.stops.at(-1)!.requestedBy = "Trama";
    const candidate = blockedCandidate(document, marco, 3);
    candidate.pullRequest = { url: "u", number: 7, branch: marco.workspace!.branch, headSHA: "h", at: at(4).toISOString(), mergedAt: at(5).toISOString() };
    expect(await call({ assignment: marco.id })).toMatchObject({ error: true, text: expect.stringContaining("already_merged") });

    candidate.pullRequest = null;
    marco.workspaceRemovedAt = at(6).toISOString();
    expect(await call({ assignment: marco.id })).toMatchObject({ error: true, text: expect.stringContaining("no_worktree") });
    expect(started).toEqual([]);
  });

  it("is the way Trama points the Coordinator to for a red check, stalled work and a conflict, not new work", () => {
    for (const kind of ["checkFailed", "stalledAssignment", "worktreeConflict"] as const) {
      const text = automaticMoveSection("assignWork", { kind, blocker: "Il lavoro di Marco è fermo", why: "Fermo" });
      expect(text).toContain("resume_assignment");
      expect(text).toContain("stessa copia di lavoro");
      expect(text).not.toMatch(/riassegnalo con assign_task|la correzione con assign_task|con assign_task il riallineamento/);
    }
  });

  it("stays within the mandate", async () => {
    const document = shop(["plan"]);
    const marco = realignment(document);
    stopByTrama(document, marco, 2);
    const { context: tools, started } = context(document);
    const result = await runCoordinatorTool("resume_assignment", { assignment: marco.id, instructions: "Riprendi", reason: "Motivo" }, tools);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not_in_mandate");
    expect(started).toEqual([]);
  });
});
