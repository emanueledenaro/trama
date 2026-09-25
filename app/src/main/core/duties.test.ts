import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DutySkill, GitHubIssue, MandateAction, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { declareCandidate } from "./candidates";
import { emptyDocument } from "./document";
import {
  ARCHITECTURE_BINDING,
  concludeDuty,
  DIAGNOSIS_BINDING,
  type DutyContext,
  dutyModel,
  dutySession,
  FIX_BINDING,
  nextDuty,
  recordCheckOutcome,
  TRIAGE_BINDING,
  withinMandate,
} from "./duties";
import { loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, decide, grantMandate, withdrawDecisionRequest } from "./pact";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam, recordWorkspace } from "./team";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const runner = { provider: "codex" as const, model: "gpt-5.6-luna", modelReason: "Il modello più leggero del catalogo." };
const HEAD = "a".repeat(40);

const issue = (number: number, labels: string[] = [], state: "open" | "closed" = "open"): GitHubIssue => ({
  number,
  title: `Il salvataggio non riesce ${number}`,
  state,
  body: "Premo Salva e non succede niente.",
  url: `https://github.com/o/r/issues/${number}`,
  author: "rita",
  labels,
  updatedAt: "",
});

const context = (overrides: Partial<DutyContext> = {}): DutyContext => ({
  issues: null,
  headSHA: HEAD,
  coordinatorBusy: false,
  moduleIds: ["app", "docs"],
  runner,
  ...overrides,
});

function project(actions: MandateAction[] | null = ["executeInWorktree"]): ProjectDocument {
  const document = emptyDocument("p");
  if (actions) grantMandate(document, { objectives: ["Correggere i bug"], priorities: [], scopeModuleIds: ["app"], authorizedActions: actions, limits: [] });
  return document;
}

function finish(document: ProjectDocument, assignment: SpecialistAssignment, text = "Fatto"): void {
  beginTurn(document, assignment.id, `turn-${assignment.id}`, "m");
  endTurn(document, assignment.id, `turn-${assignment.id}`, { kind: "completed", text });
}

const roleOf = (document: ProjectDocument, assignment: SpecialistAssignment) => document.team.specialists.find((s) => s.id === assignment.specialistId)!.role;

/** A confirmed developer, Ada, with finished work on `app` and its candidate. */
function withCandidate(document: ProjectDocument) {
  confirmTeam(
    document,
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "TypeScript", reason: "Il codice è in TypeScript", moduleIds: ["app"] }] }).id,
    null,
    null,
  );
  const work = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "Salvare le bozze",
      issueNumber: null,
      exercise: null,
      moduleIds: ["app"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["node_test"],
      instructions: "Salva la bozza",
    },
    1,
    null,
  );
  recordWorkspace(document, work.id, { sourceRoot: "/repo", worktreeRoot: "/worktrees/ada", branch: "trama/ada-1", baseSHA: HEAD });
  finish(document, work);
  const decision = decide(document, { id: null, value: "La bozza si salva", acceptedExample: "Salva: bozza salvata", rationale: "r" });
  const candidate = declareCandidate(
    document,
    { assignmentId: work.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: "snap-1", baseSHA: HEAD, diff: "", changedFiles: ["app/save.ts"], excludedSensitiveFiles: [] },
  );
  return { work, candidate };
}

const diagnosisAnswer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    loopCommand: "npm --prefix app test -- save",
    loopOutput: "1 failed: save keeps the draft",
    reproduced: true,
    hypotheses: ["La bozza non viene scritta", "Il test usa un percorso vecchio"],
    cause: "saveDraft scrive prima di creare la cartella",
    regressionTest: "Un test in app/save.test.ts che salva una bozza in una cartella nuova",
    seamNote: "",
    fix: "Creare la cartella prima di scrivere",
    moduleIDs: ["app"],
    openQuestions: "",
    ...overrides,
  });

const architectureAnswer = (count: number) =>
  JSON.stringify({
    candidates: Array.from({ length: count }, (_, i) => ({
      title: `Approfondire il modulo ${i + 1}`,
      files: [`app/m${i + 1}.ts`],
      problem: "Interfaccia quasi complessa quanto l'implementazione",
      solution: "Un modulo profondo dietro un'interfaccia piccola",
      benefits: "Più località e test sull'interfaccia",
      strength: i === 2 ? "Strong" : i === 0 ? "Speculative" : "Worth exploring",
      adrConflict: "",
    })),
    topRecommendation: "Partire dal modulo 3",
  });

describe("triage of new issues (W11)", () => {
  it("takes the issues Trama already knew as the baseline and triages each new one once, oldest first", () => {
    const document = project();
    expect(nextDuty(document, context({ issues: [issue(1), issue(2)] }))).toBeNull();
    expect(document.duties?.issueBaseline).toBe(2);

    const issues = [issue(1), issue(2), issue(4), issue(3)];
    const first = nextDuty(document, context({ issues }))!;
    expect(roleOf(document, first)).toBe("bugTriage");
    expect(first).toMatchObject({ issueNumber: 3, tools: ["commands"], moduleIds: [], model: "gpt-5.6-luna", provider: "codex", status: "preparing" });
    expect(first.duty).toMatchObject({ skill: "triage", trigger: { kind: "newIssue", issueNumber: 3 }, outcome: null });
    // One at a time: the role is busy until the triage ends.
    expect(nextDuty(document, context({ issues }))).toBeNull();
    finish(document, first);
    const second = nextDuty(document, context({ issues }))!;
    expect(second.duty?.trigger).toMatchObject({ kind: "newIssue", issueNumber: 4 });
    finish(document, second);
    expect(nextDuty(document, context({ issues }))).toBeNull();
  });

  it("leaves out closed issues and issues that already have a state role", () => {
    const document = project();
    nextDuty(document, context({ issues: [] }));
    const issues = [issue(1, ["ready-for-agent"]), issue(2, [], "closed"), issue(3, ["wontfix"]), issue(4, ["bug", "needs-triage"])];
    expect(nextDuty(document, context({ issues }))?.issueNumber).toBe(4);
  });

  it("starts nothing without a granted mandate or a provider, yet keeps the baseline", () => {
    const document = project(null);
    expect(nextDuty(document, context({ issues: [issue(1)] }))).toBeNull();
    expect(nextDuty(document, context({ issues: [issue(1), issue(2)] }))).toBeNull();
    expect(document.duties?.issueBaseline).toBe(1);
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["app"], authorizedActions: ["plan"], limits: [] });
    expect(nextDuty(document, context({ issues: [issue(1), issue(2)], runner: null }))).toBeNull();
    expect(nextDuty(document, context({ issues: [issue(1), issue(2)] }))?.issueNumber).toBe(2);
  });

  it("records the skill's recommendation as the outcome, readable for the person", () => {
    const document = project();
    nextDuty(document, context({ issues: [] }));
    const triage = nextDuty(document, context({ issues: [issue(1)] }))!;
    finish(document, triage, "{}");
    concludeDuty(
      document,
      triage.id,
      JSON.stringify({
        category: "bug",
        state: "ready-for-agent",
        reasoning: "Il salvataggio fallisce su una cartella nuova",
        verification: "Riprodotto con `npm test`",
        alreadyImplemented: "",
        comment: "> *This was generated by AI during triage.*\n\n## Agent Brief\nSalvare la bozza.",
      }),
    );
    expect(triage.duty?.outcome).toEqual({
      kind: "triage",
      category: "bug",
      state: "ready-for-agent",
      reasoning: "Il salvataggio fallisce su una cartella nuova",
      verification: "Riprodotto con `npm test`",
      alreadyImplemented: null,
      comment: "> *This was generated by AI during triage.*\n\n## Agent Brief\nSalvare la bozza.",
    });
    expect(triage.result).toContain("ready-for-agent");
    expect(triage.result).toContain("## Agent Brief");
    expect(triage.lastUpdate).toContain("#1");

    const other = nextDuty(document, context({ issues: [issue(1), issue(2)] }))!;
    finish(document, other, "non è JSON");
    concludeDuty(document, other.id, "non è JSON");
    expect(other.duty).toMatchObject({ unreadable: true, outcome: null });
    expect(other.result).toBe("non è JSON");
  });
});

describe("diagnosis of failed checks (W11)", () => {
  it("queues a failed test on the checkout once per HEAD and has the debugger diagnose it read-only", () => {
    const document = project();
    const failed = { check: "node_test" as const, passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "checkout" as const, headSHA: HEAD } };
    const failure = recordCheckOutcome(document, failed)!;
    expect(failure).toMatchObject({ check: "node_test", title: "test Node", target: "checkout", version: HEAD, regression: false, diagnosisId: null });
    expect(recordCheckOutcome(document, failed)).toBeNull();
    // Git checks describe the checkout, and a check Trama could not run proves nothing.
    expect(recordCheckOutcome(document, { ...failed, check: "git_diff_check" })).toBeNull();
    expect(recordCheckOutcome(document, { ...failed, check: "node_typecheck", ran: false })).toBeNull();

    const diagnosis = nextDuty(document, context())!;
    expect(roleOf(document, diagnosis)).toBe("bugTriage");
    expect(diagnosis).toMatchObject({ tools: ["commands"], moduleIds: [], workspace: null });
    expect(diagnosis.duty).toMatchObject({ skill: "diagnosing-bugs", trigger: { kind: "failedCheck", failureId: failure.id } });
    expect(failure.diagnosisId).toBe(diagnosis.id);
    finish(document, diagnosis);
    expect(nextDuty(document, context())).toBeNull();
  });

  it("marks a regression when the same check passed before, on an earlier HEAD or on the candidate's base", () => {
    const document = project();
    const checkout = (headSHA: string, passed: boolean) =>
      recordCheckOutcome(document, { check: "node_test", passed, ran: true, output: "", command: "npm test", target: { kind: "checkout", headSHA } });
    expect(checkout("h0", true)).toBeNull();
    expect(checkout("h1", false)?.regression).toBe(true);

    const other = project();
    recordCheckOutcome(other, { check: "node_test", passed: true, ran: true, output: "", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const { work, candidate } = withCandidate(other);
    const failure = recordCheckOutcome(other, { check: "node_test", passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "candidate", candidateId: candidate.id } })!;
    expect(failure).toMatchObject({ target: "candidate", candidateId: candidate.id, assignmentId: work.id, version: "snap-1", regression: true });
    // The diagnosis reads the candidate's worktree, without writing to it.
    const diagnosis = nextDuty(other, context())!;
    expect(diagnosis.workspace).toEqual(work.workspace);
    expect(diagnosis.tools).toEqual(["commands"]);
  });

  it("turns a reproduced bug into a fix with a regression test, only within the mandate", () => {
    const document = project(["plan"]);
    const failure = recordCheckOutcome(document, { check: "node_test", passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "checkout", headSHA: HEAD } })!;
    const diagnosis = nextDuty(document, context())!;
    finish(document, diagnosis, diagnosisAnswer());
    concludeDuty(document, diagnosis.id, diagnosisAnswer());
    const outcome = diagnosis.duty!.outcome!;
    expect(outcome).toMatchObject({ kind: "diagnosis", reproduced: true, moduleIds: ["app"], cause: "saveDraft scrive prima di creare la cartella", fixAssignmentId: null });
    expect(diagnosis.result).toContain("npm --prefix app test -- save");

    // The mandate does not let anyone write: the fix waits, and says why.
    expect(nextDuty(document, context())).toBeNull();
    expect(outcome.kind === "diagnosis" && outcome.fixWaiting).toMatch(/mandato/);

    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["app"], authorizedActions: ["executeInWorktree"], limits: [] });
    const fix = nextDuty(document, context())!;
    expect(roleOf(document, fix)).toBe("bugTriage");
    expect(fix).toMatchObject({ tools: ["commands", "edits"], moduleIds: ["app"], requiredChecks: ["node_test"], kind: "decidedBehaviorCorrection", workspace: null });
    expect(fix.duty).toMatchObject({ skill: "diagnosing-bugs", trigger: { kind: "diagnosisFix", diagnosisId: diagnosis.id }, outcome: null });
    expect(fix.instructions).toContain("app/save.test.ts");
    expect(fix.instructions).toContain("npm --prefix app test -- save");
    expect(outcome.kind === "diagnosis" && outcome).toMatchObject({ fixAssignmentId: fix.id, fixWaiting: null });
    expect(failure.diagnosisId).toBe(diagnosis.id);
    finish(document, fix);
    // The bug is fixed once; the fix changed code, so the free team now gets Clean Code's review.
    expect(nextDuty(document, context())?.duty?.skill).toBe("improve-codebase-architecture");
  });

  it("holds a fix while other work writes to the same modules", () => {
    const document = project();
    const { work } = withCandidate(document);
    const busy = assign(document, { ...work, specialist: "Ada", objective: "Altro lavoro", exercise: null, dependencies: [], tools: ["edits"], requiredChecks: ["node_test"] }, 1, null);
    recordCheckOutcome(document, { check: "node_test", passed: false, ran: true, output: "x", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const diagnosis = nextDuty(document, context())!;
    finish(document, diagnosis);
    concludeDuty(document, diagnosis.id, diagnosisAnswer());
    expect(nextDuty(document, context())).toBeNull();
    expect(diagnosis.duty?.outcome).toMatchObject({ fixAssignmentId: null, fixWaiting: "La correzione aspetta che finisca il lavoro in corso su app." });
    finish(document, busy);
    expect(nextDuty(document, context())?.duty?.trigger).toEqual({ kind: "diagnosisFix", diagnosisId: diagnosis.id });
  });

  it("fixes a candidate in its own worktree and never fixes what the loop did not reproduce", () => {
    const document = project();
    const { work, candidate } = withCandidate(document);
    recordCheckOutcome(document, { check: "node_test", passed: false, ran: true, output: "x", command: "npm test", target: { kind: "candidate", candidateId: candidate.id } });
    const diagnosis = nextDuty(document, context())!;
    finish(document, diagnosis);
    concludeDuty(document, diagnosis.id, diagnosisAnswer({ moduleIDs: [] }));
    const fix = nextDuty(document, context())!;
    expect(fix.workspace).toEqual(work.workspace);
    expect(fix.moduleIds).toEqual(["app"]);

    const other = project();
    recordCheckOutcome(other, { check: "node_test", passed: false, ran: true, output: "x", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const blind = nextDuty(other, context())!;
    finish(other, blind);
    concludeDuty(other, blind.id, diagnosisAnswer({ reproduced: false, loopCommand: "", openQuestions: "Serve il log del server" }));
    expect(nextDuty(other, context())).toBeNull();
    expect(blind.result).toContain("Serve il log del server");
  });
});

describe("architecture review when the team is free (W11)", () => {
  it("runs Clean Code read-only after the team changed code and is free, once per commit", () => {
    const document = project();
    expect(nextDuty(document, context())).toBeNull();
    const { work } = withCandidate(document);
    expect(findAssignment(document, work.id)?.status).toBe("completed");
    expect(nextDuty(document, context({ coordinatorBusy: true }))).toBeNull();
    expect(nextDuty(document, context({ headSHA: null }))).toBeNull();

    const review = nextDuty(document, context())!;
    expect(roleOf(document, review)).toBe("cleanCode");
    expect(review).toMatchObject({ tools: ["commands"], moduleIds: [], workspace: null });
    expect(review.duty).toMatchObject({ skill: "improve-codebase-architecture", trigger: { kind: "idleTeam", headSHA: HEAD } });
    finish(document, review);
    const { decisionRequestId } = concludeDuty(document, review.id, architectureAnswer(2));
    expect(decisionRequestId).not.toBeNull();

    // Same commit, or an unanswered card: nothing new.
    expect(nextDuty(document, context())).toBeNull();
    expect(nextDuty(document, context({ headSHA: "b".repeat(40) }))).toBeNull();
    answerDecisionRequest(document, decisionRequestId!, { alternativeIndex: 0, freeText: null });
    // A new commit alone is not enough: the team must have changed code since the review.
    expect(nextDuty(document, context({ headSHA: "b".repeat(40) }))).toBeNull();
    const more = assign(
      document,
      { ...work, specialist: "Ada", objective: "Altro lavoro", exercise: null, dependencies: [], tools: ["edits"], requiredChecks: ["node_test"] },
      1,
      null,
    );
    finish(document, more);
    const second = nextDuty(document, context({ headSHA: "b".repeat(40) }))!;
    expect(second.duty?.trigger).toEqual({ kind: "idleTeam", headSHA: "b".repeat(40), afterWork: [work.id, more.id] });

    // A card the person withdrew does not hold the next review back.
    finish(document, second);
    const next = concludeDuty(document, second.id, architectureAnswer(1)).decisionRequestId!;
    withdrawDecisionRequest(document, next, "Non ora");
    const last = assign(document, { ...work, specialist: "Ada", objective: "Terzo lavoro", exercise: null, dependencies: [], tools: ["edits"], requiredChecks: ["node_test"] }, 1, null);
    finish(document, last);
    expect(nextDuty(document, context({ headSHA: "c".repeat(40) }))?.duty?.skill).toBe("improve-codebase-architecture");
  });

  it("puts the proposals to the person as one Pact decision card, strongest first, never as edits", () => {
    const document = project();
    withCandidate(document);
    const review = nextDuty(document, context())!;
    finish(document, review);
    const { decisionRequestId } = concludeDuty(document, review.id, architectureAnswer(4));
    const card = document.decisionRequests.find((r) => r.id === decisionRequestId)!;
    expect(card.category).toBe("product");
    expect(card.alternatives.map((a) => a.behavior)).toEqual([
      "Approfondire: Approfondire il modulo 3",
      "Approfondire: Approfondire il modulo 2",
      "Approfondire: Approfondire il modulo 4",
      "Nessuno per ora",
    ]);
    expect(card.concreteCase).toContain("Partire dal modulo 3");
    expect(review.duty?.outcome).toMatchObject({ kind: "architecture", decisionRequestId });
    expect(review.result).toContain("app/m1.ts");
    expect(review.tools).not.toContain("edits");

    const quiet = project();
    withCandidate(quiet);
    const calm = nextDuty(quiet, context())!;
    finish(quiet, calm);
    expect(concludeDuty(quiet, calm.id, architectureAnswer(0)).decisionRequestId).toBeNull();
    expect(quiet.decisionRequests).toHaveLength(0);
    expect(calm.result).toMatch(/niente da segnalare/i);
  });
});

describe("sessions with the original skills (W11)", () => {
  /** A duty of each kind, ready to open its session. */
  function duties(): { skill: DutySkill; binding: string; document: ProjectDocument; assignment: SpecialistAssignment }[] {
    const triaged = project();
    nextDuty(triaged, context({ issues: [] }));
    const triage = nextDuty(triaged, context({ issues: [issue(7)] }))!;

    const diagnosed = project();
    recordCheckOutcome(diagnosed, { check: "node_test", passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const diagnosis = nextDuty(diagnosed, context())!;
    const fixed = project();
    recordCheckOutcome(fixed, { check: "node_test", passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const first = nextDuty(fixed, context())!;
    finish(fixed, first);
    concludeDuty(fixed, first.id, diagnosisAnswer());
    const fix = nextDuty(fixed, context())!;

    const reviewed = project();
    withCandidate(reviewed);
    const review = nextDuty(reviewed, context())!;
    return [
      { skill: "triage", binding: TRIAGE_BINDING, document: triaged, assignment: triage },
      { skill: "diagnosing-bugs", binding: DIAGNOSIS_BINDING, document: diagnosed, assignment: diagnosis },
      { skill: "diagnosing-bugs", binding: FIX_BINDING, document: fixed, assignment: fix },
      { skill: "improve-codebase-architecture", binding: ARCHITECTURE_BINDING, document: reviewed, assignment: review },
    ];
  }

  it("delivers each skill's files byte for byte with its binding, and SKILL.md as a native input to Codex", async () => {
    for (const { skill: name, binding, document, assignment } of duties()) {
      const skill = await loadNativeSkill(skillsDirectory, name);
      const base = { projectName: "Bozze", document, assignment, moduleIds: ["app", "docs"], issue: issue(7), resumed: false, skill };
      const text = dutySession({ ...base, nativeInput: false });
      expect(text.skills).toEqual([]);
      const delivered = Buffer.from(`${text.instructions}\n${text.prompt}`, "utf8");
      for (const file of (await readdir(join(skillsDirectory, name))).filter((f) => f.endsWith(".md"))) {
        expect(delivered.includes(await readFile(join(skillsDirectory, name, file))), `${name}/${file}`).toBe(true);
      }
      expect(text.prompt.endsWith(`## Trama binding for the ${name} skill\n${binding}`)).toBe(true);
      expect(text.outputSchema === null).toBe(assignment.tools.includes("edits"));

      const codex = dutySession({ ...base, nativeInput: true });
      expect(codex.skills).toEqual([{ name, path: join(skillsDirectory, name, "SKILL.md"), enabled: true, description: null }]);
      expect(codex.prompt).not.toContain(await readFile(join(skillsDirectory, name, "SKILL.md"), "utf8"));
      expect(codex.prompt).toContain(`## Trama binding for the ${name} skill`);
    }
  });

  it("gives the session the data that started it", () => {
    const [triage, diagnosis, fix, review] = duties();
    const session = (d: ReturnType<typeof duties>[number]) =>
      dutySession({ projectName: "Bozze", document: d.document, assignment: d.assignment, moduleIds: ["app", "docs"], issue: issue(7), resumed: false, skill: { name: "x", skillPath: "/x/SKILL.md", files: [{ relativePath: "SKILL.md", text: "S" }] }, nativeInput: false });
    expect(session(triage!).prompt).toContain("Premo Salva e non succede niente.");
    expect(session(triage!).instructions).toMatch(/read-only/);
    expect(session(diagnosis!).prompt).toContain("1 failed");
    expect(session(diagnosis!).prompt).toContain("app, docs");
    expect(session(fix!).instructions).toContain("Git worktree");
    expect(session(review!).prompt).toContain(HEAD.slice(0, 7));
  });

  it("binds each skill to Trama without restating its method", async () => {
    const bindings: [string, string][] = [
      ["triage", TRIAGE_BINDING],
      ["diagnosing-bugs", DIAGNOSIS_BINDING],
      ["diagnosing-bugs", FIX_BINDING],
      ["improve-codebase-architecture", ARCHITECTURE_BINDING],
    ];
    for (const [name, binding] of bindings) {
      const original = await readFile(join(skillsDirectory, name, "SKILL.md"), "utf8");
      for (const sentence of original.split(/(?<=[.:!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 40)) {
        expect(binding, `${name}: ${sentence}`).not.toContain(sentence);
      }
      expect(binding).toMatch(/grants no permission/);
      expect(binding).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("mandate and model of the automatic work (W11)", () => {
  it("lets read-only work run under any granted mandate and work that writes only where the mandate reaches", () => {
    const document = project(["plan"]);
    recordCheckOutcome(document, { check: "node_test", passed: false, ran: true, output: "x", command: "npm test", target: { kind: "checkout", headSHA: HEAD } });
    const diagnosis = nextDuty(document, context())!;
    expect(withinMandate(document, diagnosis)).toBe(true);
    const fixLike = { ...diagnosis, tools: ["commands", "edits"] as SpecialistAssignment["tools"], moduleIds: ["app"] };
    expect(withinMandate(document, fixLike)).toBe(false);
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["app"], authorizedActions: ["executeInWorktree"], limits: [] });
    expect(withinMandate(document, fixLike)).toBe(true);
    expect(withinMandate(document, { ...fixLike, moduleIds: ["docs"] })).toBe(false);
    document.mandate!.status = "revoked";
    expect(withinMandate(document, diagnosis)).toBe(false);
  });

  it("runs on the lightest model of the catalogue, or on the Coordinator's", () => {
    const model = (id: string, isDefault = false) => ({ id, model: id, displayName: id, description: "", isDefault, supportedReasoningEfforts: [], defaultReasoningEffort: null });
    expect(dutyModel([model("gpt-5.5", true), model("gpt-5.6-luna")], "gpt-5.5")?.model).toBe("gpt-5.6-luna");
    expect(dutyModel([model("claude-sonnet-4-5", true), model("claude-haiku-4-5")], "claude-sonnet-4-5")?.model).toBe("claude-haiku-4-5");
    expect(dutyModel([model("gpt-5.5", true), model("gpt-5.5-fast")], "gpt-5.5")).toEqual({ model: "gpt-5.5", reason: expect.stringMatching(/Coordinatore/) });
    expect(dutyModel([], null)).toBeNull();
  });
});
