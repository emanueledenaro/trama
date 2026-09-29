import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DutySkill, GitHubIssue, MandateAction, ProjectDocument, PullRequestLink, SpecialistAssignment } from "@shared/domain";
import { dutyTriggerText } from "@shared/duties";
import { declareCandidate } from "./candidates";
import { emptyDocument } from "./document";
import {
  ARCHITECTURE_BINDING,
  automaticWorkStatus,
  concludeDuty,
  DIAGNOSIS_BINDING,
  DOMAIN_WRITING_BINDING,
  type DutyContext,
  DutyRequestError,
  dutyModel,
  dutySession,
  FIX_BINDING,
  environmentFailure,
  dutyLedger,
  nextDuty,
  onRequestBindingLine,
  recordCheckOutcome,
  startDomainWriting,
  startDutyOnRequest,
  TRIAGE_BINDING,
  withinMandate,
} from "./duties";
import { proposeDomainDocs } from "./domainDocs";
import { loadNativeSkill } from "./nativeSkills";
import { setPersonLanguage } from "./personLanguage";
import { answerDecisionRequest, decide, grantMandate, withdrawDecisionRequest } from "./pact";
import { assign, beginTurn, confirmTeam, endTurn, findAssignment, proposeTeam, recordWorkspace } from "./team";
import { translator } from "@shared/i18n";

const t = translator("it");

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const runner = { provider: "codex" as const, model: "gpt-5.6-luna", modelReason: "Il modello più leggero del catalogo." };
const HEAD = "a".repeat(40);

afterEach(() => setPersonLanguage("it"));

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
    { snapshotId: "snap-1", baseSHA: HEAD, diff: "", changedFiles: ["app/save.ts"], excludedSensitiveFiles: [], whitespaceErrors: [] },
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

  it("never diagnoses a failure of the sandbox or the machine as a bug of the project (issue #271)", () => {
    const document = project();
    const failed = { check: "node_typecheck" as const, passed: false, ran: true, command: "npm run typecheck", target: { kind: "checkout" as const, headSHA: HEAD } };
    const sandbox = [
      "Error: EPERM: operation not permitted, open '/Users/p/.npm/_logs/debug.log'",
      "listen EPERM: operation not permitted 127.0.0.1\n[Trama] Alcuni fallimenti vengono dalla sandbox: la rete è permessa solo verso 127.0.0.1, internet è bloccato.",
      "mkdir: /private/var/folders/x: Read-only file system",
      "sh: tsc: command not found",
      "bwrap: Creating new namespace failed: Operation not permitted",
      "env: ‘npm’: No such file or directory",
      "sh: tsc: Command not found",
    ];
    recordCheckOutcome(document, { ...failed, passed: true, output: "" });
    for (const output of sandbox) {
      expect(environmentFailure(output)).toBe(true);
      expect(recordCheckOutcome(document, { ...failed, output })).toBeNull();
    }
    // The failure says nothing about the code: it does not hide the pass recorded before, and nothing starts.
    expect(document.duties?.failures ?? []).toEqual([]);
    expect(document.duties?.checkoutChecks.node_typecheck).toEqual({ headSHA: HEAD, passed: true });
    expect(nextDuty(document, context())).toBeNull();
    // A failure of the code on the same check is still diagnosed.
    expect(environmentFailure("src/app/page.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.")).toBe(false);
    expect(recordCheckOutcome(document, { ...failed, output: "src/app/page.tsx(3,7): error TS2322" })).not.toBeNull();
    expect(nextDuty(document, context())?.duty?.skill).toBe("diagnosing-bugs");
  });

  it("leaves out a sandbox failure recorded before the rule, and says the diagnosis has nothing to do", () => {
    const document = project();
    dutyLedger(document).failures.push({
      id: "F-1",
      check: "node_typecheck",
      title: "typecheck Node",
      command: "npm run typecheck",
      target: "checkout",
      candidateId: null,
      assignmentId: null,
      version: HEAD,
      regression: false,
      output: "Error: EACCES: permission denied, mkdir '/Users/p/.cache'",
      at: "2026-09-27T10:00:00.000Z",
      diagnosisId: null,
    });
    expect(nextDuty(document, context())).toBeNull();
    // Once the machine is fixed, a failure of the code on the same check and version is recorded and diagnosed.
    const failure = recordCheckOutcome(document, {
      check: "node_typecheck",
      passed: false,
      ran: true,
      output: "src/app/page.tsx(3,7): error TS2322",
      command: "npm run typecheck",
      target: { kind: "checkout", headSHA: HEAD },
    });
    expect(failure).not.toBeNull();
    expect(nextDuty(document, context())?.duty?.trigger).toEqual({ kind: "failedCheck", failureId: failure!.id });
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

  it("writes the result in the person's words, never the skill's English strengths (issue #392)", () => {
    for (const [language, strongest] of [["it", "(consigliata)"], ["en", "(recommended)"]] as const) {
      const document = project();
      withCandidate(document);
      const review = nextDuty(document, context())!;
      finish(document, review);
      concludeDuty(document, review.id, architectureAnswer(3), new Date(), language);
      expect(review.result).toContain(`### Approfondire il modulo 3 ${strongest}`);
      expect(review.result).not.toMatch(/Strong|Worth exploring|Speculative/);
    }
    // The skill's vocabulary guides the review; the texts the person reads say it in plain words.
    expect(ARCHITECTURE_BINDING).toMatch(/Locality, Leverage/);
    expect(ARCHITECTURE_BINDING).toMatch(/plain words/);
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
      "Approfondire il modulo 3",
      "Approfondire il modulo 2",
      "Approfondire il modulo 4",
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

    const documented = project();
    const decision = decide(documented, { id: null, value: "Le bozze si salvano da sole", acceptedExample: "Bozza salvata dopo 5 s", rationale: "r" });
    const proposal = proposeDomainDocs(documented, {
      requestId: null,
      decisionIds: [decision.id],
      contextPath: undefined,
      terms: [{ term: "Bozza", definition: "Un testo non ancora pubblicato.", avoid: ["Draft"] }],
      adrs: [],
      projectModuleIds: ["app", "docs"],
    });
    const writing = startDomainWriting(documented, proposal, runner)!;
    return [
      { skill: "triage", binding: TRIAGE_BINDING, document: triaged, assignment: triage },
      { skill: "diagnosing-bugs", binding: DIAGNOSIS_BINDING, document: diagnosed, assignment: diagnosis },
      { skill: "diagnosing-bugs", binding: FIX_BINDING, document: fixed, assignment: fix },
      { skill: "improve-codebase-architecture", binding: ARCHITECTURE_BINDING, document: reviewed, assignment: review },
      { skill: "domain-modeling", binding: DOMAIN_WRITING_BINDING, document: documented, assignment: writing },
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
    const [triage, diagnosis, fix, review, writing] = duties();
    const session = (d: ReturnType<typeof duties>[number]) =>
      dutySession({ projectName: "Bozze", document: d.document, assignment: d.assignment, moduleIds: ["app", "docs"], issue: issue(7), resumed: false, skill: { name: "x", skillPath: "/x/SKILL.md", files: [{ relativePath: "SKILL.md", text: "S" }] }, nativeInput: false });
    expect(session(triage!).prompt).toContain("Premo Salva e non succede niente.");
    expect(session(triage!).instructions).toMatch(/read-only/);
    expect(session(diagnosis!).prompt).toContain("1 failed");
    expect(session(diagnosis!).prompt).toContain("app, docs");
    expect(session(fix!).instructions).toContain("Git worktree");
    expect(session(review!).prompt).toContain(HEAD.slice(0, 7));
    expect(session(writing!).instructions).toContain("Git worktree");
    expect(session(writing!).prompt).toContain("**Bozza**:\nUn testo non ancora pubblicato.\n_Avoid_: Draft");
  });

  it("binds each skill to Trama without restating its method", async () => {
    const bindings: [string, string][] = [
      ["triage", TRIAGE_BINDING],
      ["diagnosing-bugs", DIAGNOSIS_BINDING],
      ["diagnosing-bugs", FIX_BINDING],
      ["improve-codebase-architecture", ARCHITECTURE_BINDING],
      ["domain-modeling", DOMAIN_WRITING_BINDING],
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
    setPersonLanguage("en");
    expect(dutyModel([model("gpt-5.5-mini")], null)?.reason).toBe("Chosen by Trama: the lightest model in the catalog, for the fixed roles' automatic work.");
  });
});

const pull = (number: number, linkedIssues: number[]): PullRequestLink => ({ number, linkedIssues });

describe("only issues that are new for Trama go to triage (issue #231)", () => {
  it("leaves out an issue already in work, one with a linked pull request and one that was closed and reopened", () => {
    const document = project();
    nextDuty(document, context({ issues: [] }));
    const { work } = withCandidate(document);
    work.issueNumber = 187;
    // A pull request of any state: GitHub lists the closed and merged ones with the issues.
    const linked = pull(190, [188]);
    // The reopened issue was seen closed: it never becomes new again.
    nextDuty(document, context({ issues: [issue(189, [], "closed")], pullRequests: [] }));
    const issues = [issue(187), issue(188), issue(189), issue(191)];
    const triage = nextDuty(document, context({ issues, pullRequests: [linked] }))!;
    expect(triage.issueNumber).toBe(191);
    const dropped = Object.fromEntries((document.duties?.newIssues ?? []).map((e) => [e.number, e.dropped]));
    expect(dropped[187]).toContain(work.id);
    expect(dropped[188]).toContain("#190");
    expect(dropped[189]).toContain("chiusa");
    expect(dropped[191]).toBeNull();
    // A pull request that shows up later still takes the issue out before its triage.
    finish(document, triage);
    const later = nextDuty(document, context({ issues: [...issues, issue(192)], pullRequests: [linked, pull(193, [192])] }));
    expect(later?.duty?.skill).not.toBe("triage");
    expect(document.duties?.newIssues?.find((e) => e.number === 192)?.dropped).toContain("#193");
  });

  it("treats every issue GitHub lists as already seen when the ledger predates the record of new issues", () => {
    const document = project();
    // A ledger written before issue #231: a low baseline and no record of the issues seen since.
    document.duties = { issueBaseline: 100, failures: [], checkoutChecks: {} };
    expect(nextDuty(document, context({ issues: [issue(120), issue(187)] }))?.duty?.skill).not.toBe("triage");
    expect(document.duties.issueBaseline).toBe(187);
    expect(nextDuty(document, context({ issues: [issue(120), issue(187), issue(200)] }))?.issueNumber).toBe(200);
  });

  it("keeps the baseline when GitHub is not read, so a lost cache makes nothing new", () => {
    const document = project();
    nextDuty(document, context({ issues: [issue(5)] }));
    nextDuty(document, context({ issues: null }));
    expect(document.duties?.issueBaseline).toBe(5);
    expect(nextDuty(document, context({ issues: [issue(5)] }))).toBeNull();
  });
});

describe("the state of the automatic work (issue #231)", () => {
  const byKind = (document: ProjectDocument, overrides: Partial<DutyContext> = {}) =>
    Object.fromEntries(automaticWorkStatus(document, context(overrides)).map((w) => [w.kind, w]));

  it("says Clean Code waits for a free team, and how many assignments are at work", () => {
    const document = project();
    withCandidate(document);
    const busy = assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "Altro", issueNumber: null, exercise: null, moduleIds: ["app"], dependencies: [], model: "m", tools: ["commands"], requiredChecks: [], instructions: "i" },
      1,
      null,
    );
    const waiting = byKind(document).architectureReview!;
    expect(waiting).toMatchObject({ state: "waiting", role: "cleanCode", onRequest: { allowed: true } });
    expect(waiting.detail).toContain("team sia libero: un incarico è al lavoro");
    finish(document, busy);
    expect(byKind(document, { coordinatorBusy: true }).architectureReview!.detail).toContain("Coordinatore");
    expect(byKind(document).architectureReview!.state).toBe("due");
    const review = nextDuty(document, context())!;
    expect(byKind(document).architectureReview).toMatchObject({ state: "running", assignmentId: review.id });
    expect(byKind(document).architectureReview!.onRequest).toMatchObject({ allowed: false });
  });

  it("says where the work stands in the person's language (issue #301)", () => {
    setPersonLanguage("en");
    const document = project();
    withCandidate(document);
    assign(
      document,
      { specialist: "Ada", kind: "agreedTicket", objective: "Altro", issueNumber: null, exercise: null, moduleIds: ["app"], dependencies: [], model: "m", tools: ["commands"], requiredChecks: [], instructions: "i" },
      1,
      null,
    );
    expect(byKind(document).architectureReview!.detail).toBe("Waits for the team to be free: one assignment is at work.");
    expect(byKind(project(null), { issues: [] }).triage!.detail).toBe(
      "No new issue to triage: it starts when an issue is opened after Trama started following the project, not yet in work and with no linked pull request.",
    );
    expect(() => startDutyOnRequest(project(null), { kind: "architectureReview" }, context(), "person")).toThrow(
      "Without a granted mandate Trama does not start the fixed roles' automatic work.",
    );
    const review = startDutyOnRequest(project(), { kind: "architectureReview" }, context(), "person");
    expect(review.objective).toBe(`Architecture review at commit ${HEAD.slice(0, 7)}`);
    // The instructions are for the agent: they stay as they are.
    expect(review.instructions).toContain("Revisione dell'architettura con la skill improve-codebase-architecture");
  });

  it("says why nothing starts: no mandate, no provider, no new issue", () => {
    const document = project(null);
    nextDuty(document, context({ issues: [issue(1)] }));
    nextDuty(document, context({ issues: [issue(1), issue(2)] }));
    const noMandate = byKind(document, { issues: [issue(1), issue(2)] });
    expect(noMandate.triage).toMatchObject({ state: "waiting", onRequest: { allowed: false } });
    expect(noMandate.triage!.detail).toContain("#2");
    expect(noMandate.triage!.detail).toContain("mandato");
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["app"], authorizedActions: ["plan"], limits: [] });
    expect(byKind(document, { issues: [issue(1), issue(2)], runner: null }).triage!.detail).toContain("provider");
    expect(byKind(document, { issues: [issue(1)] }).triage).toMatchObject({ state: "idle" });
    expect(byKind(document).diagnosis).toMatchObject({ state: "idle", onRequest: null });
    expect(byKind(document).architectureReview).toMatchObject({ state: "idle" });
    expect(byKind(document).domainWriting).toMatchObject({ state: "idle", onRequest: null });
    // Reading the state changes nothing.
    const before = JSON.stringify(document);
    byKind(document, { issues: [issue(1), issue(2), issue(3)] });
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe("the state of the domain writing (issue #231)", () => {
  it("is due when nothing holds it, and names what holds it otherwise", () => {
    const proposal = (scope: string[]) => ({
      id: "P-1",
      requestId: null,
      decisionIds: ["D-1"],
      contextPath: "CONTEXT.md",
      adrDirectory: "docs/adr",
      terms: [{ term: "Ordine", definition: "d", avoid: [] }],
      adrs: [],
      moduleIds: scope,
      scopeModuleIds: scope,
      createdAt: "",
      assignmentId: null,
      // A reason saved earlier, no longer true: the state reads the rules again.
      waiting: "Senza un mandato valido nessuno scrive i file: la proposta aspetta il mandato.",
    });
    const writing = (document: ProjectDocument, overrides: Partial<DutyContext> = {}) =>
      automaticWorkStatus(document, context(overrides)).find((w) => w.kind === "domainWriting")!;
    const document = project();
    document.domainProposals = [proposal(["app"])];
    expect(writing(document)).toMatchObject({ state: "due", detail: expect.stringContaining("P-1") });
    expect(writing(document, { runner: null }).detail).toContain("provider");
    // Another assignment at work on the proposal's modules: assignDuty would refuse it, so it waits.
    const { work } = withCandidate(document);
    work.status = "running";
    expect(writing(document)).toMatchObject({ state: "waiting", detail: expect.stringContaining(`app (incarico ${work.id})`) });
    work.status = "completed";
    document.domainProposals = [proposal(["docs"])];
    expect(writing(document)).toMatchObject({ state: "waiting", detail: expect.stringContaining("correzione del mandato") });
    expect(writing(project(null))).toMatchObject({ state: "idle" });
  });
});

describe("automatic work started on request (issue #231)", () => {
  it("starts Clean Code's review now, outside the rule, and says who asked", async () => {
    const document = project();
    const review = startDutyOnRequest(document, { kind: "architectureReview" }, context(), "person");
    expect(roleOf(document, review)).toBe("cleanCode");
    expect(review).toMatchObject({ tools: ["commands"], model: "gpt-5.6-luna", status: "preparing" });
    expect(review.duty).toMatchObject({ skill: "improve-codebase-architecture", requestedBy: "person", trigger: { kind: "idleTeam", headSHA: HEAD } });
    expect(dutyTriggerText(t, document, review.duty!)).toBe(`Su richiesta tua: revisione al commit ${HEAD.slice(0, 7)}`);
    const session = dutySession({
      projectName: "p",
      document,
      assignment: review,
      moduleIds: ["app"],
      issue: null,
      resumed: false,
      skill: await loadNativeSkill(skillsDirectory, "improve-codebase-architecture"),
      nativeInput: false,
    });
    expect(session.prompt).toContain(ARCHITECTURE_BINDING);
    expect(session.prompt).toContain(onRequestBindingLine("person"));
    expect(session.instructions).toContain("because the person asked");
    // The role is busy now: a second request is refused with the reason.
    expect(() => startDutyOnRequest(document, { kind: "architectureReview" }, context(), "coordinator")).toThrow(/al lavoro sull'incarico/);
    // The rule stays as it is: it does not start another review on the same commit.
    finish(document, review);
    concludeDuty(document, review.id, architectureAnswer(0));
    expect(nextDuty(document, context())).toBeNull();
  });

  it("starts the triage of an open issue the Coordinator names, even one that is not new", () => {
    const document = project();
    nextDuty(document, context({ issues: [issue(187)] }));
    const triage = startDutyOnRequest(document, { kind: "triage", issueNumber: 187 }, context({ issues: [issue(187)] }), "coordinator");
    expect(triage).toMatchObject({ issueNumber: 187 });
    expect(triage.duty).toMatchObject({ skill: "triage", requestedBy: "coordinator" });
    expect(dutyTriggerText(t, document, triage.duty!)).toContain("Su richiesta del Coordinatore");
    finish(document, triage);
    const refuse = (issues: GitHubIssue[] | null, number: number) => {
      try {
        startDutyOnRequest(document, { kind: "triage", issueNumber: number }, context({ issues }), "person");
        return null;
      } catch (error) {
        return (error as DutyRequestError).code;
      }
    };
    expect(refuse([issue(187)], 5)).toBe("issue_not_found");
    expect(refuse([issue(5, [], "closed")], 5)).toBe("issue_closed");
    expect(refuse(null, 187)).toBe("github_unavailable");
  });

  it("refuses without a granted mandate or a provider", () => {
    const code = (document: ProjectDocument, overrides: Partial<DutyContext> = {}) => {
      try {
        startDutyOnRequest(document, { kind: "architectureReview" }, context(overrides), "person");
        return null;
      } catch (error) {
        return (error as DutyRequestError).code;
      }
    };
    expect(code(project(null))).toBe("mandate_missing");
    expect(code(project(), { runner: null })).toBe("provider_unavailable");
    expect(code(project(), { headSHA: null })).toBe("head_unknown");
  });
});
