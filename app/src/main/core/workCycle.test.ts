import { describe, expect, it } from "vitest";
import type { Candidate, CoordinatorRequest, GateFinding, GateRole, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { candidateSuperseded } from "@shared/conflictScope";
import { GATE_ROLES, latestGate } from "@shared/gate";
import { REVIEW_OUTPUT_SCHEMA, readReviewAnswer, reviewerInstructions } from "./cleanCode";
import { candidateAfterTurn, declareCandidate, inspectCandidate, latestCandidate, openCorrections, recordEvidence, recordTechnicalReview } from "./candidates";
import { automaticMove, automaticMoveSection } from "./continuousWork";
import { workState } from "./workPhase";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import {
  applyOverruled,
  applyPactRule,
  cleanCodeOutcome,
  readReviewerAnswer,
  REVIEWER_SCHEMA,
  SEVERITY_RULE,
  beginReviews,
  closeGate,
  finishReview,
  GateSettlementError,
  openGate,
  overruleFinding,
  PACT_RULE,
  rememberOverruled,
  reviewerTurn,
  settleGate,
  stopAtSecrets,
} from "./gate";
import { setPersonLanguage } from "./personLanguage";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { resumeInput } from "./specialistBriefing";
import { assign, confirmTeam, endTurn, findSpecialist, mergedWorktrees, proposeTeam, recordWorkspace, reopenForFindings, requestStop } from "./team";
import { MergeError } from "./workspace";

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
  requestStop(document, assignment.specialistId, "trama", "Decision changed or is under review.", false, at(minute));
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

  it("leaves alone work the person stopped: new work does not take its working copy before the person writes", () => {
    const document = shop();
    const marco = realignment(document);
    blockedCandidate(document, marco, 2);
    stopByTrama(document, marco, 3);
    marco.stops.at(-1)!.by = "person";
    request(document, "r2", 4).step = { move: "assignWork", by: "trama" };
    expect(openCorrections(document, "r2", { moduleIds: ["src/app"], slice: null })).toEqual([]);
    request(document, "r3", 5);
    expect(openCorrections(document, "r3", { moduleIds: ["src/app"], slice: null })).toEqual([marco.id]);
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

  it("resumes work that later work replaced as new work on its working copy, so its next candidate is not superseded (the shop at 13:37)", async () => {
    const document = shop();
    const marco = realignment(document);
    blockedCandidate(document, marco, 2);
    stopByTrama(document, marco, 3);
    // Before this fix Bea got the same issue in an empty working copy of her own and ended without changes.
    request(document, "r2", 4);
    const empty = assign(
      document,
      { specialist: "Bea", kind: "decidedBehaviorCorrection", objective: "Correggere i documenti", issueNumber: 24, exercise: null, moduleIds: ["src/app"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Correggi" },
      document.mandate!.version,
      "r2",
      at(5),
    );
    recordWorkspace(document, empty.id, { sourceRoot: "/tmp/negozio", worktreeRoot: "/tmp/Worktrees/8b8d354e", branch: "chore/issue-24-docs-trama-8b8d354e", baseSHA: "f1197f9" }, at(5));
    endTurn(document, empty.id, null, { kind: "completed", text: "La correzione va ripresa nella copia di Marco" }, at(6));
    const { context: tools, started } = context(document);

    const result = parse(await runCoordinatorTool("resume_assignment", { assignment: marco.id, instructions: "Correggi i documenti nella tua copia.", reason: "Il merge è nella copia di Marco" }, tools));
    const resumed = findSpecialist(document, "Marco")!.assignments.at(-1)!;
    expect(result).toMatchObject({ assignmentID: resumed.id, status: "resumed", replacesAssignmentID: marco.id, branch: marco.workspace!.branch });
    expect(resumed.id).not.toBe(marco.id);
    expect(resumed.workspace).toEqual(marco.workspace);
    expect(started).toEqual([resumed.id]);
    endTurn(document, resumed.id, null, { kind: "completed", text: "Fatto" }, at(8));
    const next = declareCandidate(
      document,
      { assignmentId: resumed.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
      { snapshotId: "snap-9", baseSHA: "f1197f9", diff: "+docs", changedFiles: ["src/app/page.tsx"], excludedSensitiveFiles: [], whitespaceErrors: [] },
      at(9),
    );
    expect(candidateSuperseded(document, next)).toBe(false);
  });

  it("resumes work that a correction replaced without a slice or issue, so the correction's candidate is superseded too", async () => {
    const document = shop();
    const first = realignment(document);
    first.issueNumber = null;
    blockedCandidate(document, first, 2);
    stopByTrama(document, first, 3);
    request(document, "r2", 4);
    // The correction names only the work it corrects: it shares no slice or issue with it.
    const correctionWork = assign(
      document,
      { specialist: "Bea", kind: "decidedBehaviorCorrection", objective: "Correggere i documenti", issueNumber: null, exercise: null, moduleIds: ["src/app"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "Correggi", replaces: [first.id], workspace: first.workspace },
      document.mandate!.version,
      "r2",
      at(5),
    );
    const second = blockedCandidate(document, correctionWork, 6);
    const { context: tools } = context(document);

    const result = parse(await runCoordinatorTool("resume_assignment", { assignment: first.id, instructions: "Riprendi il lavoro nella tua copia.", reason: "Il merge è nella copia" }, tools));
    const resumed = findSpecialist(document, "Marco")!.assignments.at(-1)!;
    expect(result).toMatchObject({ assignmentID: resumed.id, status: "resumed", replacesAssignmentID: first.id });
    expect(resumed.replaces).toEqual([first.id, correctionWork.id]);
    expect(candidateSuperseded(document, second)).toBe(true);
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

    requestStop(document, marco.specialistId, "person", "Basta per oggi", false, at(2));
    endTurn(document, marco.id, null, { kind: "interrupted" }, at(2));
    expect(await call({ assignment: marco.id })).toMatchObject({ error: true, text: expect.stringContaining("stopped_by_person") });

    marco.stops.at(-1)!.by = "trama";
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
    expect(automaticMoveSection("assignWork", { kind: "worktreeConflict", blocker: "Conflitto con main", why: "Conflitto" })).toContain("commit_merge");
    // A finding against the Pact is overruled citing the decision, so it does not come back at the next round.
    const loop = automaticMoveSection("settleReview", { kind: "reviewLoop", blocker: "Bloccato due volte", why: "Disaccordo" });
    expect(loop).toContain("overrule_finding");
    expect(loop).toContain("decisionIDs");
  });

  it("lets the Coordinator record the resolved merge in the working copy (commit_merge), never while the developer works", async () => {
    const document = shop();
    const marco = realignment(document);
    const { context: tools } = context(document);
    const calls: [string, string | null][] = [];
    tools.concludeMerge = async (id, message) => {
      calls.push([id, message]);
      if (calls.length === 2) throw new MergeError("unmerged_files", "The merge has files still in conflict: src/app/page.tsx.");
      return { commit: "c0ffee", mergedHead: "4df3c14", message: "chore: merge origin/main into chore/issue-24" };
    };
    const running = await runCoordinatorTool("commit_merge", { assignment: marco.id }, tools);
    expect(running.isError).toBe(true);
    expect(running.content[0]!.text).toContain("assignment_running");

    const candidate = blockedCandidate(document, marco, 2);
    const done = parse(await runCoordinatorTool("commit_merge", { assignment: candidate.id }, tools));
    expect(done).toMatchObject({ assignmentID: marco.id, commit: "c0ffee", mergedHead: "4df3c14", message: "chore: merge origin/main into chore/issue-24" });
    expect(calls).toEqual([[marco.id, null]]);
    const refused = await runCoordinatorTool("commit_merge", { assignment: marco.id, message: "chore: merge main" }, tools);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("unmerged_files");
    expect(calls.at(-1)).toEqual([marco.id, "chore: merge main"]);
  });

  it("does not let the Coordinator declare a merge left with files in conflict", async () => {
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Merge a metà" }, at(2));
    const { context: tools } = context(document);
    tools.reviewWorkspace = async () => ({
      snapshotId: "snap-merge",
      baseSHA: "f1197f9",
      diff: "+<<<<<<< HEAD",
      changedFiles: ["src/app/page.tsx"],
      excludedSensitiveFiles: [],
      whitespaceErrors: [],
      unmergedFiles: ["src/app/page.tsx"],
    });
    const result = await runCoordinatorTool("declare_candidate", { assignment: marco.id, decisionIDs: [document.decisions[0]!.id] }, tools);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("merge_unresolved");
    expect(result.content[0]!.text).toContain("resume_assignment");
    expect(document.candidates).toEqual([]);
  });

  it("resumes work the person stopped once the person wrote in its dialog, in any language", async () => {
    const document = shop();
    const marco = realignment(document);
    requestStop(document, marco.specialistId, "person", "Enough for today", false, at(2));
    endTurn(document, marco.id, null, { kind: "interrupted" }, at(2));
    const { context: tools, started } = context(document);
    const call = () => runCoordinatorTool("resume_assignment", { assignment: marco.id, instructions: "Riprendi", reason: "La persona lo chiede" }, tools);
    expect((await call()).content[0]!.text).toContain("stopped_by_person");
    // A turn Trama started by itself is not the person's word.
    request(document, "r2", 3).step = { move: "assignWork", by: "trama" };
    expect((await call()).content[0]!.text).toContain("stopped_by_person");
    request(document, "r3", 4);
    expect(parse(await call())).toMatchObject({ assignmentID: marco.id, status: "resumed" });
    expect(started).toEqual([marco.id]);
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
    tools.concludeMerge = async () => {
      throw new Error("must not run");
    };
    const merge = await runCoordinatorTool("commit_merge", { assignment: marco.id }, tools);
    expect(merge.content[0]!.text).toContain("not_in_mandate");
  });
});

describe("one work, one working copy, one candidate", () => {
  /** What Trama reads in Marco's copy when nothing changed since the candidate of minute 2. */
  const sameCopy = { snapshotId: "snap-2", baseSHA: "f1197f9", diff: "+merge", changedFiles: ["src/app/page.tsx"], excludedSensitiveFiles: [], whitespaceErrors: [], unmergedFiles: [] };

  it("returns the same candidate when the Coordinator declares a working copy that did not change (the shop's four copies of one content)", async () => {
    const document = shop();
    const marco = realignment(document);
    const candidate = blockedCandidate(document, marco, 2);
    const { context: tools } = context(document);
    tools.reviewWorkspace = async () => sameCopy;
    const result = parse(await runCoordinatorTool("declare_candidate", { assignment: marco.id, decisionIDs: [document.decisions[0]!.id] }, tools));
    expect(result).toMatchObject({ candidateID: candidate.id, unchanged: true });
    expect(document.candidates).toHaveLength(1);
    // A changed copy is a new candidate, as before.
    tools.reviewWorkspace = async () => ({ ...sameCopy, snapshotId: "snap-3" });
    const changed = parse(await runCoordinatorTool("declare_candidate", { assignment: marco.id, decisionIDs: [document.decisions[0]!.id] }, tools));
    expect(changed.candidateID).not.toBe(candidate.id);
    expect(document.candidates).toHaveLength(2);
  });

  it("lets the Coordinator settle at once when the developer ends the returned work without changing the copy, instead of a new round on the same content", () => {
    const document = shop();
    const marco = realignment(document);
    const candidate = blockedCandidate(document, marco, 2);
    const gate = latestGate(document.gates, candidate.id)!;
    reopenForFindings(document, marco.id, { gateId: gate.id, candidateId: candidate.id, findings: ["Dati aziendali in config.json"] }, at(3));
    gate.returned = { assignmentId: marco.id, at: at(3).toISOString(), waiting: null };
    endTurn(document, marco.id, null, { kind: "completed", text: "Il rilievo è sbagliato: non cambio niente" }, at(4));
    expect(candidateAfterTurn(document, marco.id, sameCopy, at(4))).toEqual({ kind: "current", candidate });

    const state = workState(document, "r1");
    expect(state).toMatchObject({ phase: "blocked", block: "reviewLoop" });
    expect(state.blocker).toContain("settle_review");
    expect(state.moves.filter((m) => m.actor === "coordinator").map((m) => [m.move, m.targetId])).toEqual([["settleReview", candidate.id]]);
    expect(automaticMove(document, "r1", "assignmentEnded", { enabled: true, paused: false, busy: false, unavailable: null })?.move).toBe("settleReview");
    expect(latestCandidate(document, marco.id)).toBe(candidate);
  });
});

describe("working copies do not pile up", () => {
  it("frees by itself the working copy of merged work nobody continues in", () => {
    const document = shop();
    const marco = realignment(document);
    const candidate = blockedCandidate(document, marco, 2);
    expect(mergedWorktrees(document)).toEqual([]);
    candidate.pullRequest = { url: "u", number: 7, branch: marco.workspace!.branch, headSHA: "h", at: at(4).toISOString(), mergedAt: at(5).toISOString() };
    expect(mergedWorktrees(document).map((a) => a.id)).toEqual([marco.id]);
    // Work that continues in the same copy keeps it.
    request(document, "r2", 6);
    const bea = assign(
      document,
      { specialist: "Bea", kind: "agreedTicket", objective: "Altro", issueNumber: null, exercise: null, moduleIds: ["src/app"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i", workspace: marco.workspace },
      document.mandate!.version,
      "r2",
      at(6),
    );
    expect(mergedWorktrees(document)).toEqual([]);
    endTurn(document, bea.id, null, { kind: "completed", text: "Fatto" }, at(7));
    nextCandidate(document, bea, 8);
    expect(mergedWorktrees(document)).toEqual([]);
    // A copy already removed is not freed again.
    marco.workspaceRemovedAt = bea.workspaceRemovedAt = at(9).toISOString();
    expect(mergedWorktrees(document)).toEqual([]);
  });

  it("lets the Coordinator free a working copy that holds no open work (release_worktree), never one at work or with an open candidate", async () => {
    const document = shop();
    const marco = realignment(document);
    const { context: tools } = context(document);
    const freed: string[] = [];
    tools.releaseWorktree = async (id) => {
      freed.push(id);
      if (freed.length === 2) throw new Error("La copia di lavoro ha modifiche non registrate.");
      return { branchDeleted: false };
    };
    const call = async (assignment: string) => {
      const result = await runCoordinatorTool("release_worktree", { assignment, reason: "Lavoro superato" }, tools);
      return { error: result.isError === true, text: result.content[0]!.text };
    };
    expect(await call(marco.id)).toMatchObject({ error: true, text: expect.stringContaining("assignment_running") });
    const open = blockedCandidate(document, marco, 2);
    expect(await call(marco.id)).toMatchObject({ error: true, text: expect.stringContaining("open_candidate") });
    // Superseded by a correction in another copy: the old copy can go.
    request(document, "r2", 3);
    const correction = assign(
      document,
      { specialist: "Bea", kind: "agreedTicket", objective: "Correzione", issueNumber: 24, exercise: null, moduleIds: ["src/app"], dependencies: [], model: "gpt-5.5", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i", replaces: [marco.id] },
      document.mandate!.version,
      "r2",
      at(3),
    );
    expect(candidateSuperseded(document, open)).toBe(true);
    expect(correction.workspace).toBeNull();
    expect(parse(await runCoordinatorTool("release_worktree", { assignment: open.id, reason: "Lavoro superato" }, tools))).toMatchObject({ assignmentID: marco.id, status: "released" });
    // Trama's own refusal, as for uncommitted changes, reaches the Coordinator.
    expect(await call(marco.id)).toMatchObject({ error: true, text: expect.stringContaining("modifiche non registrate") });
    expect(freed).toEqual([marco.id, marco.id]);
  });
});

/** A gate on `candidate` whose figures answer with `findings`, not closed yet. */
function gateWith(document: ProjectDocument, candidate: Candidate, findings: [GateRole, GateFinding][], minute: number) {
  const gate = openGate(document, candidate, at(minute));
  beginReviews(gate, { spec: true, model: "mini", cleanCodeModel: "gpt-5.5" }, at(minute));
  for (const role of GATE_ROLES) finishReview(gate, role, { report: "", findings: findings.filter(([r]) => r === role).map(([, f]) => ({ ...f })) }, at(minute));
  return gate;
}

/** A new candidate of the same work, as after the developer's next turn. */
function nextCandidate(document: ProjectDocument, assignment: SpecialistAssignment, minute: number): Candidate {
  const candidate = declareCandidate(
    document,
    { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${minute}`, baseSHA: "f1197f9", diff: "+docs", changedFiles: ["src/app/page.tsx"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(minute),
  );
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: candidate.snapshotId }, at(minute));
  return candidate;
}

const businessData: GateFinding = { severity: "blocking", title: "Dati aziendali in config.json", detail: "Via dal repository", file: "src/config/config.json" };

describe("the reviewers read the Pact as rules and the findings the Coordinator overruled", () => {
  it("gives every reviewer the Pact decisions in force as rules: a finding against one is not blocking", () => {
    const document = shop();
    const marco = realignment(document);
    const candidate = blockedCandidate(document, marco, 2);
    const gate = latestGate(document.gates, candidate.id)!;
    const decision = document.decisions[0]!;
    for (const role of ["specReviewer", "security", "ux"] as const) {
      const turn = reviewerTurn({ projectName: "negozio", gate, candidate, assignment: marco, spec: null, decisions: document.decisions }, role, null, true);
      expect(turn.prompt).toContain(`${decision.id} v${decision.version}: ${decision.value}`);
      expect(turn.instructions).toContain(PACT_RULE);
    }
  });

  it("blocks only what breaks the product, goes against the Pact or is Trama's evidence, and Trama holds the reviewers to the Pact", () => {
    for (const words of ["breaks the product", "Pact decision", "never stops the work"]) expect(SEVERITY_RULE).toContain(words);
    expect(REVIEWER_SCHEMA.properties.findings.items.required).toContain("against");
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    const candidate = nextCandidate(document, marco, 2);
    const decision = document.decisions[0]!;
    // The spec reviewer says its finding asks to go against the Pact decision: Trama checks the decision is in force.
    const answer = readReviewerAnswer(
      JSON.stringify({
        report: "Dati aziendali",
        findings: [
          { severity: "blocking", title: "Dati aziendali in config.json", detail: "Via", file: "src/config/config.json", against: decision.id },
          { severity: "blocking", title: "Link rotto", detail: "404", file: "src/app/page.tsx", against: "D-INESISTENTE" },
        ],
      }),
    );
    expect(answer.findings.map((f) => f.against)).toEqual([decision.id, "D-INESISTENTE"]);
    const gate = gateWith(document, candidate, [], 3);
    finishReview(gate, "specReviewer", answer, at(3));
    expect(applyPactRule(document, gate)).toBe(1);
    closeGate(gate, at(3));
    const findings = gate.reviews.find((r) => r.role === "specReviewer")!.findings;
    expect(findings[0]).toMatchObject({ severity: "advisory", overruled: { decisionIds: [decision.id] } });
    // A decision that does not exist decides nothing: the finding still blocks.
    expect(findings[1]).toMatchObject({ severity: "blocking" });
    expect(gate.status).toBe("blocked");
  });

  it("holds Clean Code to the Pact as the other figures: the rule, the field and a block that follows the decision", () => {
    expect(reviewerInstructions(undefined)).toContain(PACT_RULE);
    expect(reviewerInstructions({ disabledRules: [], note: null })).toContain(PACT_RULE);
    expect(REVIEW_OUTPUT_SCHEMA.properties.findings.items.required).toContain("against");
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    const candidate = nextCandidate(document, marco, 2);
    const decision = document.decisions[0]!;
    const raw = (findings: object[], verdict = "changesRequested") => ({ verdict, summary: "Dati fissi nel codice.", findings });
    const finding = { severity: "blocking", rule: "other", file: "src/config.ts", line: 3, message: "Dati fissi in src/config.ts" };

    // A blocking finding against a decision in force stops nothing, and the gate passes.
    const followed = gateWith(document, candidate, [], 3);
    finishReview(followed, "cleanCode", cleanCodeOutcome(readReviewAnswer(raw([{ ...finding, against: decision.id }])), document.decisions), at(3));
    expect(applyPactRule(document, followed)).toBe(1);
    closeGate(followed, at(3));
    expect(followed.reviews.find((r) => r.role === "cleanCode")!.findings[0]).toMatchObject({ severity: "advisory", overruled: { decisionIds: [decision.id] } });
    expect(followed.status).toBe("passed");

    // The reviewer already made it a suggestion but still asks for changes: the request is not a block of its own.
    const suggested = gateWith(document, nextCandidate(document, marco, 4), [], 4);
    finishReview(suggested, "cleanCode", cleanCodeOutcome(readReviewAnswer(raw([{ ...finding, severity: "suggestion", against: decision.id }])), document.decisions), at(4));
    applyPactRule(document, suggested);
    closeGate(suggested, at(4));
    expect(suggested.status).toBe("passed");

    // Only some findings go against the Pact: the request for changes may be about the others, so it still blocks.
    const mixed = gateWith(document, nextCandidate(document, marco, 7), [], 7);
    const otherSuggestion = { ...finding, severity: "suggestion", file: "src/other.ts", message: "Nome poco chiaro in src/other.ts" };
    finishReview(mixed, "cleanCode", cleanCodeOutcome(readReviewAnswer(raw([{ ...finding, severity: "suggestion", against: decision.id }, otherSuggestion])), document.decisions), at(7));
    applyPactRule(document, mixed);
    closeGate(mixed, at(7));
    expect(mixed.status).toBe("blocked");

    // A decision that does not exist decides nothing, and a request for changes with no finding still blocks.
    const unknown = gateWith(document, nextCandidate(document, marco, 5), [], 5);
    finishReview(unknown, "cleanCode", cleanCodeOutcome(readReviewAnswer(raw([{ ...finding, against: "D-INESISTENTE" }])), document.decisions), at(5));
    applyPactRule(document, unknown);
    closeGate(unknown, at(5));
    expect(unknown.status).toBe("blocked");
    const bare = gateWith(document, nextCandidate(document, marco, 6), [], 6);
    finishReview(bare, "cleanCode", cleanCodeOutcome(readReviewAnswer(raw([])), document.decisions), at(6));
    applyPactRule(document, bare);
    closeGate(bare, at(6));
    expect(bare.status).toBe("blocked");
  });

  it("remembers a finding overruled with a Pact decision, so the same work is not blocked by it again", () => {
    const document = shop();
    const marco = realignment(document);
    const first = blockedCandidate(document, marco, 2);
    const decision = document.decisions[0]!;
    const gate = latestGate(document.gates, first.id)!;
    const outcome = overruleFinding(document, first, { role: "specReviewer", title: "dati aziendali in config.json", reason: "Il Patto vuole i dati aziendali nel sito", decisionIds: [decision.id] }, at(3));
    expect(outcome).toEqual({ remaining: 0, gatePassed: true });
    expect(gate.status).toBe("passed");
    expect(first.technicalReview).toMatchObject({ verdict: "approved" });
    expect(inspectCandidate(document, first, "f1197f9").map((b) => b.code)).toEqual([]);
    expect(document.overruledFindings).toEqual([
      expect.objectContaining({ role: "specReviewer", title: "Dati aziendali in config.json", file: "src/config/config.json", decisionIds: [decision.id], assignmentIds: [marco.id] }),
    ]);

    // The next round the spec reviewer says it again, in other words and with a line: it does not block any more.
    const second = nextCandidate(document, marco, 4);
    const again = gateWith(document, second, [["specReviewer", { ...businessData, title: "Sensitive data still committed", file: "src/config/config.json:12" }]], 4);
    applyOverruled(document, again);
    closeGate(again, at(4));
    expect(again.status).toBe("passed");
    expect(again.reviews.find((r) => r.role === "specReviewer")!.findings[0]).toMatchObject({ severity: "advisory", overruled: { reason: "Il Patto vuole i dati aziendali nel sito" } });
    // Reviewers read it as already decided.
    const turn = reviewerTurn({ projectName: "negozio", gate: again, candidate: second, assignment: marco, spec: null, decided: document.overruledFindings }, "specReviewer", null, true);
    expect(turn.prompt).toContain("Il Patto vuole i dati aziendali nel sito");

    // Another figure, or another file, still blocks.
    const third = nextCandidate(document, marco, 5);
    const other = gateWith(document, third, [["ux", businessData], ["specReviewer", { ...businessData, file: "src/app/page.tsx" }]], 5);
    applyOverruled(document, other);
    closeGate(other, at(5));
    expect(other.status).toBe("blocked");
    expect(other.reviews.flatMap((r) => r.findings).filter((f) => f.severity === "blocking")).toHaveLength(2);
  });

  it("tells Security's findings apart by their title: a decision on one does not silence a new one in the same file", () => {
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    const decision = document.decisions[0]!;
    const pixel: GateFinding = { severity: "blocking", title: "Pixel di tracciamento in src/api/orders.ts", detail: "Invia dati a un terzo", file: "src/api/orders.ts:12" };
    const first = nextCandidate(document, marco, 2);
    closeGate(gateWith(document, first, [["security", pixel]], 2), at(2));
    overruleFinding(document, first, { role: "security", title: pixel.title, reason: "Il Patto vuole il tracciamento", decisionIds: [decision.id] }, at(3));

    // The same finding, now on another line, no longer blocks.
    const same = gateWith(document, nextCandidate(document, marco, 4), [["security", { ...pixel, file: "src/api/orders.ts:14" }]], 4);
    applyOverruled(document, same);
    closeGate(same, at(4));
    expect(same.status).toBe("passed");

    // A different weakness in the same file still blocks, and keeps its own words.
    const injection: GateFinding = { severity: "blocking", title: "SQL injection in src/api/orders.ts", detail: "La query concatena l'input", file: "src/api/orders.ts:88" };
    const other = gateWith(document, nextCandidate(document, marco, 5), [["security", injection]], 5);
    expect(applyOverruled(document, other)).toBe(0);
    closeGate(other, at(5));
    expect(other.status).toBe("blocked");
    expect(other.reviews.find((r) => r.role === "security")!.findings[0]).toMatchObject({ severity: "blocking", title: injection.title });
  });

  it("remembers the findings of a gate the Coordinator settled with the developer", () => {
    const document = shop();
    const marco = realignment(document);
    const first = blockedCandidate(document, marco, 2);
    const gate = latestGate(document.gates, first.id)!;
    rememberOverruled(document, gate, { reason: "Il Patto vuole i dati aziendali nel sito", decisionIds: [] }, at(3));
    settleGate(gate, first, { side: "developer", reason: "Il Patto vuole i dati aziendali nel sito" }, at(3));
    const second = nextCandidate(document, marco, 4);
    const again = gateWith(document, second, [["specReviewer", businessData]], 4);
    applyOverruled(document, again);
    closeGate(again, at(4));
    expect(again.status).toBe("passed");
  });

  it("never overrules Trama's own evidence, a finding it does not know, or without a Pact decision", () => {
    const document = shop();
    const marco = realignment(document);
    const candidate = blockedCandidate(document, marco, 2);
    const decision = document.decisions[0]!.id;
    const input = { reason: "No", decisionIds: [decision] };
    expect(() => overruleFinding(document, candidate, { ...input, role: "regressionGuardian", title: "Regressione" }, at(3))).toThrow(GateSettlementError);
    expect(() => overruleFinding(document, candidate, { ...input, role: "specReviewer", title: "Un altro rilievo" }, at(3))).toThrow(/no blocking finding/);
    expect(() => overruleFinding(document, candidate, { ...input, role: "specReviewer", title: "Dati aziendali in config.json", decisionIds: [] }, at(3))).toThrow(/Pact decision/);
    expect(() => overruleFinding(document, candidate, { ...input, role: "specReviewer", title: "Dati aziendali in config.json", decisionIds: ["D-NESSUNA"] }, at(3))).toThrow(/Pact decision/);
    expect(document.overruledFindings ?? []).toEqual([]);
    expect(latestGate(document.gates, candidate.id)!.status).toBe("blocked");
  });

  it("never overrules a secret in the diff, even when the person switched language after the gate", () => {
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    const candidate = nextCandidate(document, marco, 2);
    const gate = openGate(document, candidate, at(2));
    stopAtSecrets(gate, ["chiave API in src/app/page.tsx"], at(2));
    finishReview(gate, "regressionGuardian", { report: "", findings: [] }, at(2));
    closeGate(gate, at(2));
    expect(gate.status).toBe("blocked");
    setPersonLanguage("en");
    try {
      expect(() => settleGate(gate, candidate, { side: "developer", reason: "Va bene" }, at(3))).toThrow(/cannot be overruled/);
      expect(() => rememberOverruled(document, gate, { reason: "Va bene", decisionIds: [] }, at(3))).not.toThrow();
      expect(document.overruledFindings ?? []).toEqual([]);
    } finally {
      setPersonLanguage("it");
    }
    expect(gate.status).toBe("blocked");
  });

  it("lets the Coordinator overrule one finding with overrule_finding and keeps the gate blocked by the others", async () => {
    const document = shop();
    const marco = realignment(document);
    endTurn(document, marco.id, null, { kind: "completed", text: "Fatto" }, at(2));
    const candidate = nextCandidate(document, marco, 2);
    const gate = gateWith(document, candidate, [["specReviewer", businessData], ["cleanCode", { severity: "blocking", title: "Funzione duplicata", detail: "Due helper", file: "src/app/url.ts:3" }]], 2);
    closeGate(gate, at(2));
    const { context: tools } = context(document);
    const decision = document.decisions[0]!.id;
    const result = parse(await runCoordinatorTool("overrule_finding", { candidate: candidate.id, role: "specReviewer", title: businessData.title, reason: "Il Patto vuole i dati nel sito", decisionIDs: [decision] }, tools));
    expect(result).toMatchObject({ candidateID: candidate.id, remainingBlocking: 1, gatePassed: false });
    expect(gate.status).toBe("blocked");
  });
});
