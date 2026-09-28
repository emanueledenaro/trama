import { describe, expect, it } from "vitest";
import { activityLog } from "@shared/activity";
import type { CandidateGate, GitHubIssue, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { problemActivity, problemBacklog } from "@shared/problems";
import { emptyDocument } from "./document";
import { concludeDuty, type DutyContext, nextDuty, observeIssues, recordCheckOutcome } from "./duties";
import { grantMandate } from "./pact";
import {
  collectProblems,
  DEFAULT_TRIAGE_LABELS,
  keepInLocalBacklog,
  labelsAfterTriage,
  LOCAL_BACKLOG_REASON,
  parseTriageLabels,
  placeProblems,
  problemIssueBody,
  problemMarker,
  problemsToOpen,
  problemsWithoutIssue,
  recordIssueFailure,
  recordProblemIssue,
  sameProblemIssue,
} from "./problems";
import { doneSince } from "./recap";
import { beginTurn, endTurn } from "./team";
import { translator } from "@shared/i18n";

const t = translator("it");

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));
const runner = { provider: "codex" as const, model: "gpt-6-luna", modelReason: "Il modello più leggero del catalogo." };
const context = (issues: GitHubIssue[] | null): DutyContext => ({ issues, headSHA: "a".repeat(40), coordinatorBusy: false, moduleIds: ["app"], runner });

function project(): ProjectDocument {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Correggere i bug"], priorities: [], scopeModuleIds: ["app"], authorizedActions: ["executeInWorktree"], limits: [] });
  return document;
}

const issue = (number: number, overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  body: "",
  url: `https://github.com/o/r/issues/${number}`,
  author: "rita",
  labels: [],
  updatedAt: "",
  ...overrides,
});

/** A red test on the checkout at `sha`, recorded as Trama records the checks it runs. */
const redTest = (document: ProjectDocument, sha: string, minute: number) =>
  recordCheckOutcome(
    document,
    { check: "node_test", passed: false, ran: true, output: "1 failed", command: "npm test", target: { kind: "checkout", headSHA: sha } },
    at(minute),
  )!;

function finish(document: ProjectDocument, assignment: SpecialistAssignment, answer: string): void {
  beginTurn(document, assignment.id, `turn-${assignment.id}`, "m");
  endTurn(document, assignment.id, `turn-${assignment.id}`, { kind: "completed", text: answer });
  concludeDuty(document, assignment.id, answer);
}

const triageAnswer = (state = "ready-for-agent") =>
  JSON.stringify({ category: "bug", state, reasoning: "Il test fallisce sul branch", verification: "", alreadyImplemented: "", comment: "" });

function gate(overrides: Partial<CandidateGate> = {}): CandidateGate {
  return {
    id: "G-1",
    candidateId: "C-1",
    assignmentId: "A-1",
    snapshotId: "snap",
    baseSHA: "b".repeat(40),
    status: "passed",
    checksFailed: [],
    suite: [],
    reviews: [],
    returned: null,
    failure: null,
    startedAt: at(5).toISOString(),
    updatedAt: at(6).toISOString(),
    finishedAt: at(6).toISOString(),
    ...overrides,
  };
}

describe("found problems (A08)", () => {
  it("records a red check on the checkout once, and the same check red again is the same problem", () => {
    const document = project();
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    expect(problem).toMatchObject({ key: "check:node_test", title: "La verifica test Node non passa sul branch del progetto", issue: null, placement: null });
    expect(problem!.evidence).toMatchObject({ kind: "check", label: expect.stringContaining("Verifica test Node rossa sul checkout") });
    expect(collectProblems(document, null, at(3))).toEqual([]);

    // A new commit with the same red check is not a second problem while its issue is open.
    recordProblemIssue(problem!, issue(7), true, at(3));
    redTest(document, "h2", 4);
    expect(collectProblems(document, [issue(7)], at(5))).toEqual([]);

    // Once the issue is closed the same failure found again is a new problem.
    redTest(document, "h3", 6);
    expect(collectProblems(document, [issue(7, { state: "closed" })], at(7))).toHaveLength(1);
  });

  it("does not take what Trama recorded before it started looking for problems", () => {
    const document = project();
    redTest(document, "h1", 0);
    expect(collectProblems(document, null, at(1))).toEqual([]);
    expect(document.problems?.items).toEqual([]);
  });

  it("takes from the gate a check red on the base too and a finding on a file the candidate did not change", () => {
    const document = project();
    collectProblems(document, null, at(0));
    document.candidates.push({ id: "C-1", changedFiles: ["app/save.ts"] } as never);
    document.gates = [
      gate({
        suite: [
          { check: "node_typecheck", base: "fail", candidate: "fail", baseOutput: "error TS2322" },
          { check: "node_test", base: "pass", candidate: "fail", baseOutput: null },
        ],
        reviews: [
          {
            role: "security",
            status: "done",
            findings: [
              { severity: "advisory", title: "Token nel log", detail: "Il logger stampa il token.", file: "app/log.ts:12" },
              { severity: "advisory", title: "Nome poco chiaro", detail: "", file: "app/save.ts:3" },
              { severity: "blocking", title: "Segreto nel diff", detail: "", file: "app/config.ts" },
              { severity: "advisory", title: "Tutto il diff", detail: "", file: null },
            ],
            report: null,
            threadId: null,
            model: null,
            startedAt: null,
            finishedAt: at(6).toISOString(),
            failure: null,
          },
        ],
      }),
    ];
    const found = collectProblems(document, null, at(7));
    expect(found.map((p) => p.key)).toEqual(["check:node_typecheck", "finding:security:app/log.ts:token nel log"]);
    expect(found[0]!.detail).toContain("il candidato non l'ha causata");
    expect(found[1]!.evidence).toMatchObject({ kind: "finding", reference: "G-1", label: expect.stringContaining("Rilievo di") });
    // The gate is read once.
    expect(collectProblems(document, null, at(8))).toEqual([]);
  });

  it("finds the open issue about the same problem by its marker or its title, never a closed one", () => {
    const problem = { key: "check:node_test", title: "La verifica test Node non passa sul branch del progetto" };
    expect(sameProblemIssue(problem, [issue(3, { body: `testo\n\n${problemMarker(problem.key)}` })])?.number).toBe(3);
    expect(sameProblemIssue(problem, [issue(4, { title: "la verifica test node  non passa sul branch del progetto" })])?.number).toBe(4);
    expect(sameProblemIssue(problem, [issue(5, { state: "closed", body: problemMarker(problem.key) })])).toBeNull();
    expect(sameProblemIssue(problem, [issue(6, { title: "Altro" })])).toBeNull();
  });

  it("writes the proof and the marker in the body of the issue", () => {
    const document = project();
    collectProblems(document, null, at(0));
    const failure = redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    const body = problemIssueBody(problem!);
    expect(body).toContain(failure.id);
    expect(body).toContain("`triage`");
    expect(body.endsWith(problemMarker("check:node_test"))).toBe(true);
  });

  it("reads the repository's triage labels, keeping the skill's names for the roles it does not map", () => {
    expect(parseTriageLabels(null)).toEqual(DEFAULT_TRIAGE_LABELS);
    const labels = parseTriageLabels(
      [
        "| Label in mattpocock/skills | Label in our tracker | Meaning |",
        "| --- | --- | --- |",
        "| `needs-triage` | `triage` | Da valutare |",
        "| bug | kind/bug | Bug |",
      ].join("\n"),
    );
    expect(labels).toMatchObject({ "needs-triage": "triage", bug: "kind/bug", "ready-for-agent": "ready-for-agent" });
    expect(labelsAfterTriage(labels, { state: "ready-for-agent", category: "bug" })).toEqual({ add: ["ready-for-agent", "kind/bug"], remove: "triage" });
    expect(labelsAfterTriage(labels, { state: "needs-triage", category: "enhancement" })).toEqual({ add: ["triage", "enhancement"], remove: null });
  });

  it("sends the issue it opened to the bug triage and puts it in the backlog when no assignment works on it", () => {
    const document = project();
    nextDuty(document, context([issue(1)]));
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    // The diagnosis of the red check comes first; it does not reproduce the bug, so no fix is assigned.
    const diagnosis = nextDuty(document, context([issue(1)]))!;
    finish(
      document,
      diagnosis,
      JSON.stringify({
        loopCommand: "",
        loopOutput: "",
        reproduced: false,
        hypotheses: [],
        cause: "",
        regressionTest: "",
        seamNote: "",
        fix: "",
        moduleIDs: [],
        openQuestions: "",
      }),
    );

    const opened = issue(2, { title: problem!.title, body: problemIssueBody(problem!), labels: ["needs-triage"] });
    recordProblemIssue(problem!, opened, true, at(3));
    expect(placeProblems(document, at(3))).toEqual([]);
    const triage = nextDuty(document, context([issue(1), opened]))!;
    expect(triage.duty).toMatchObject({ skill: "triage", trigger: { kind: "newIssue", issueNumber: 2 } });
    // While the triage runs the problem waits.
    expect(placeProblems(document, at(4))).toEqual([]);
    finish(document, triage, triageAnswer("ready-for-agent"));
    expect(triage.result).toContain("Trama le applica le etichette di triage");

    expect(placeProblems(document, at(5))).toEqual([problem]);
    expect(problem!.placement).toMatchObject({ kind: "backlog", reason: expect.stringContaining("ready-for-agent") });
    expect(problemBacklog(document)).toEqual([problem]);
    expect(placeProblems(document, at(6))).toEqual([]);
  });

  it("assigns the issue to the fix of the reproduced bug, also when it was in the backlog", () => {
    const document = project();
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    recordProblemIssue(problem!, issue(9), false, at(3));
    // An issue that was already open is placed at once: its triage follows the rules of new issues.
    placeProblems(document, at(3));
    expect(problem!.placement?.kind).toBe("backlog");

    const diagnosis = nextDuty(document, context(null))!;
    finish(
      document,
      diagnosis,
      JSON.stringify({
        loopCommand: "npm test",
        loopOutput: "1 failed",
        reproduced: true,
        hypotheses: ["h"],
        cause: "c",
        regressionTest: "t",
        seamNote: "",
        fix: "f",
        moduleIDs: ["app"],
        openQuestions: "",
      }),
    );
    const fix = nextDuty(document, context(null))!;
    expect(fix.duty?.trigger.kind).toBe("diagnosisFix");
    expect(placeProblems(document, at(5))).toEqual([problem]);
    expect(problem!.placement).toMatchObject({ kind: "assignment", assignmentId: fix.id });
    expect(problemBacklog(document)).toEqual([]);
  });

  it("keeps the problems in Trama's backlog without GitHub", () => {
    const document = project();
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    expect(keepInLocalBacklog(document, at(3))).toEqual([problem]);
    expect(problem!.placement).toEqual({ kind: "backlog", at: at(3).toISOString(), reason: LOCAL_BACKLOG_REASON });
    expect(problemsWithoutIssue(document)).toEqual([]);
    // The item stands: the same check red again is the same problem.
    redTest(document, "h2", 4);
    expect(collectProblems(document, null, at(5))).toEqual([]);
  });

  it("waits a while after a failed attempt before it tries to open the issue again", () => {
    const document = project();
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    expect(problemsToOpen(document, at(2))).toEqual([problem]);
    recordIssueFailure(problem!, "La issue non è stata aperta.", at(2));
    expect(problemsToOpen(document, at(4))).toEqual([]);
    expect(problemsToOpen(document, at(7))).toEqual([problem]);
  });

  it("lists every choice in Activity and cites the issues it opened in the recap, with their number", () => {
    const document = project();
    collectProblems(document, null, at(0));
    redTest(document, "h1", 1);
    const [problem] = collectProblems(document, null, at(2));
    recordIssueFailure(problem!, "La issue non è stata aperta: limite di richieste.", at(2));
    expect(problemActivity(t, [problem!])).toMatchObject([{ kind: "problem", outcome: "stalled", label: expect.stringContaining("Issue non aperta") }]);

    recordProblemIssue(problem!, issue(12), true, at(3));
    problem!.placement = { kind: "backlog", at: at(4).toISOString(), reason: "Nessun incarico lavora su questo problema: resta nel backlog." };
    const entries = activityLog(t, document.requests, document.events, [], document.problems!.items);
    expect(entries.map((e) => e.label)).toEqual(["La issue #12 va nel backlog", `Aperta la issue #12: ${problem!.title}`]);
    expect(entries[0]).toMatchObject({ issue: { number: 12 }, trigger: problem!.evidence.label });

    const done = doneSince(document, null);
    expect(done).toContainEqual({ text: `Aperta la issue #12 per un problema trovato: ${problem!.title}`, number: 12, url: issue(12).url });
    // A linked issue was not opened by the Coordinator: the recap does not claim it.
    problem!.issue!.opened = false;
    expect(doneSince(document, null).some((f) => f.number === 12)).toBe(false);
  });

  it("makes the issue it opens count as new for the triage rule", () => {
    const document = project();
    // Trama already read the project's issues: #1 is old.
    observeIssues(document, { issues: [issue(1)] });
    expect(nextDuty(document, context([issue(1), issue(2)]))?.issueNumber).toBe(2);
  });
});
