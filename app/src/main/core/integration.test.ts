import { describe, expect, it } from "vitest";
import type { Candidate } from "@shared/domain";
import { approveCandidate, clearCandidate, declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import type { PullRequestForMerge } from "./github";
import { acknowledgeIntegrationStop, deletedFiles, destructiveChange, integrateByMandate, type IntegrationEvent, integrationBlockers, type MergePort, reconcileIntegration } from "./integration";
import { decide, grantMandate, revokeMandate } from "./pact";
import { restrictMandate } from "./projectMandate";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));
const HEAD = "a".repeat(40);

/** A candidate published by the person, green-lit by the Coordinator under mandate v1 on modules m. */
function setup(options: { diff?: string; breaking?: string | null; grant?: boolean } = {}) {
  const document = emptyDocument("p");
  const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "e", rationale: "r" });
  confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "TS", reason: "r", moduleIds: [] }] }).id, null, null);
  const assignment = assign(
    document,
    { specialist: "Ada", kind: "agreedTicket", objective: "o", issueNumber: null, exercise: null, moduleIds: ["m"], dependencies: [], model: "gpt", tools: ["edits"], requiredChecks: ["git_status"], instructions: "i" },
    1,
    null,
  );
  beginTurn(document, assignment.id, "t", "gpt");
  endTurn(document, assignment.id, "t", { kind: "completed", text: "ok" });
  const review = { snapshotId: "snap", baseSHA: "base", diff: options.diff ?? "diff --git a/a b/a\n+x", changedFiles: ["a"], excludedSensitiveFiles: [], whitespaceErrors: [] };
  const candidate = declareCandidate(document, { assignmentId: assignment.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review, at(0));
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" }, at(1));
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "ok" }, at(2));
  if (options.grant !== false) {
    grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["openPullRequest", "integrateCandidate"], limits: [] }, at(3));
    clearCandidate(document, candidate.id, "Coordinatore", "base", at(4));
  }
  approveCandidate(document, candidate.id, "Persona", "base", at(5));
  candidate.commit = { type: "feat", scope: null, description: "d", breaking: options.breaking ?? null, message: "feat: d", conventions: {} as never, correctedBy: null };
  candidate.pullRequest = { url: "https://github.com/o/r/pull/7", number: 7, branch: "feature/x", at: at(6).toISOString(), headSHA: HEAD };
  return { document, candidate, decision };
}

const openPull = (fields: Partial<PullRequestForMerge> = {}): PullRequestForMerge => ({
  number: 7,
  state: "OPEN",
  headSHA: HEAD,
  baseBranch: "main",
  mergeable: true,
  mergeSHA: null,
  checks: "success",
  ...fields,
});

/** A fake GitHub: each read returns the next pull request of `pulls` (the last one repeats). */
function fakeGitHub(options: { pulls?: PullRequestForMerge[]; bases?: string[]; merge?: () => Promise<{ sha: string }> } = {}) {
  const pulls = options.pulls ?? [openPull()];
  const bases = options.bases ?? ["base"];
  let pullReads = 0;
  let baseReads = 0;
  const merges: { number: number; headSHA: string; title: string }[] = [];
  const port: MergePort = {
    readPullRequest: async () => pulls[Math.min(pullReads++, pulls.length - 1)]!,
    readBaseHead: async () => bases[Math.min(baseReads++, bases.length - 1)]!,
    merge: async (number, headSHA, title) => {
      merges.push({ number, headSHA, title });
      return options.merge ? options.merge() : { sha: "m".repeat(40) };
    },
  };
  return { port, merges };
}

async function integrate(document: ReturnType<typeof setup>["document"], candidate: Candidate, port: MergePort) {
  const events: IntegrationEvent[] = [];
  let saves = 0;
  const outcome = await integrateByMandate({
    document,
    candidate,
    repository: "o/r",
    baseBranch: "main",
    title: "feat: d",
    port,
    persist: () => saves++,
    record: (e) => events.push(e),
    now: () => at(10),
  });
  return { outcome, events, saves };
}

describe("merge by mandate", () => {
  it("merges the exact candidate as the Coordinator's act and leaves the person's approval alone", async () => {
    const { document, candidate } = setup();
    const approval = { ...candidate.humanApproval! };
    const github = fakeGitHub();
    const { outcome, events } = await integrate(document, candidate, github.port);
    expect(outcome.status).toBe("merged");
    expect(github.merges).toEqual([{ number: 7, headSHA: HEAD, title: "feat: d" }]);
    expect(candidate.integration).toMatchObject({ actor: "Coordinatore", mandateVersion: 1, status: "merged", mergeSHA: "m".repeat(40) });
    expect(candidate.integration!.destination).toEqual({ repository: "o/r", pullRequestNumber: 7, baseBranch: "main", headSHA: HEAD });
    expect(candidate.humanApproval).toEqual(approval);
    expect(candidate.pullRequest!.mergedAt).toBe(at(10).toISOString());
    // The merge is its own event: no deployment and no update of the app are implied.
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Pull request #7 unita dal Coordinatore");
    expect(events[0]!.detail).toMatch(/non parte nessuna distribuzione/);
  });

  it("never merges twice: a merged candidate is a duplicate", async () => {
    const { document, candidate } = setup();
    const github = fakeGitHub();
    await integrate(document, candidate, github.port);
    const again = await integrate(document, candidate, github.port);
    expect(again.outcome).toMatchObject({ status: "merged", duplicate: true });
    expect(again.events).toEqual([]);
    expect(github.merges).toHaveLength(1);
  });

  it("does not merge a candidate green-lit before the mandate or cleared by nobody", async () => {
    const legacy = setup();
    delete legacy.candidate.clearance!.mandateVersion;
    const refused = await integrate(legacy.document, legacy.candidate, fakeGitHub().port);
    expect(refused.outcome.status === "blocked" && refused.outcome.blockers.map((b) => b.code)).toEqual(["CLEARANCE_OUTDATED"]);

    const none = setup({ grant: false });
    grantMandate(none.document, { objectives: ["o"], priorities: [], scopeModuleIds: ["m"], authorizedActions: ["integrateCandidate"], limits: [] }, at(7));
    const blocked = await integrate(none.document, none.candidate, fakeGitHub().port);
    expect(blocked.outcome.status === "blocked" && blocked.outcome.blockers.map((b) => b.code)).toEqual(["CLEARANCE_MISSING"]);
    // The person's approval never stands in for the Coordinator's green light.
    expect(none.candidate.humanApproval).not.toBeNull();
  });

  it("asks a new green light after the mandate changes, and refuses without the mandate", async () => {
    const restricted = setup();
    restricted.document.mandate!.scopeModuleIds.push("other");
    restrictMandate(restricted.document, { scopeModuleIds: ["m"], authorizedActions: ["openPullRequest", "integrateCandidate"] }, at(8));
    const outdated = await integrate(restricted.document, restricted.candidate, fakeGitHub().port);
    expect(outdated.outcome.status === "blocked" && outdated.outcome.blockers.map((b) => b.code)).toEqual(["CLEARANCE_OUTDATED"]);

    const revoked = setup();
    revokeMandate(revoked.document, "basta", at(8));
    const github = fakeGitHub();
    const refused = await integrate(revoked.document, revoked.candidate, github.port);
    expect(refused.outcome.status === "blocked" && refused.outcome.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["MANDATE"]));
    expect(github.merges).toEqual([]);
  });

  it("does not merge a pull request published before the merge by mandate", async () => {
    const { document, candidate } = setup();
    delete candidate.pullRequest!.headSHA;
    const { outcome } = await integrate(document, candidate, fakeGitHub().port);
    expect(outcome.status === "blocked" && outcome.blockers.map((b) => b.code)).toEqual(["PUBLISHED_BEFORE_MANDATE_MERGE"]);
  });

  it("blocks a stale candidate: base moved, decision changed, other work on the branch, CI not green, conflicts", async () => {
    const { document, candidate, decision } = setup();
    const codes = (pull: PullRequestForMerge, baseHead = "base") => integrationBlockers(document, candidate, { pull, baseHead, baseBranch: "main" }).map((b) => b.code);
    expect(codes(openPull())).toEqual([]);
    expect(codes(openPull(), "moved")).toEqual(["BASE_CHANGED"]);
    expect(codes(openPull({ headSHA: "b".repeat(40) }))).toEqual(["PULL_HEAD_CHANGED"]);
    expect(codes(openPull({ checks: "failure" }))).toEqual(["CI_FAILED"]);
    expect(codes(openPull({ checks: "pending" }))).toEqual(["CI_PENDING"]);
    expect(codes(openPull({ checks: "none" }))).toEqual(["CI_MISSING"]);
    expect(codes(openPull({ mergeable: false }))).toEqual(["PULL_CONFLICT"]);
    expect(codes(openPull({ baseBranch: "develop" }))).toEqual(["PULL_BASE"]);
    expect(codes(openPull({ state: "CLOSED" }))).toEqual(["PULL_NOT_OPEN"]);
    decide(document, { id: decision.id, value: "Altro", acceptedExample: "e", rationale: "r" });
    expect(codes(openPull())).toEqual(expect.arrayContaining(["DECISION_CHANGED", "EVIDENCE_STALE", "CLEARANCE_STALE"]));
  });

  it("stops on a concurrent change between the check and the merge, keeping the destination", async () => {
    const { document, candidate } = setup();
    const github = fakeGitHub({ bases: ["base", "moved"] });
    const { outcome, events } = await integrate(document, candidate, github.port);
    expect(outcome.status).toBe("failed");
    expect(github.merges).toEqual([]);
    expect(candidate.integration).toMatchObject({ status: "failed", failure: "La base su GitHub è cambiata durante il controllo." });
    expect(candidate.integration!.destination.pullRequestNumber).toBe(7);
    expect(events[0]!.title).toBe("Unione di #7 non riuscita");
  });

  it("stops a serious destructive change for the person with consequences and alternatives", async () => {
    const diff = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\ndiff --git a/db.sql b/db.sql\n+DROP TABLE orders;";
    const { document, candidate } = setup({ diff, breaking: "l'API degli ordini cambia" });
    const github = fakeGitHub();
    const { outcome, events } = await integrate(document, candidate, github.port);
    expect(outcome.status).toBe("stopped");
    expect(github.merges).toEqual([]);
    const stop = candidate.integration!.stop!;
    expect(stop.reasons).toEqual(["Modifica incompatibile.", "Cancella un file.", "Contiene istruzioni che cancellano dati."]);
    expect(stop.consequences.join(" ")).toMatch(/old\.ts/);
    expect(stop.alternatives).toHaveLength(3);
    expect(events[0]!.title).toBe("Unione di #7 fermata: serve la tua decisione");
    // Asked again, the Coordinator gets the same stop and adds no new event.
    const again = await integrate(document, candidate, github.port);
    expect(again.outcome.status).toBe("stopped");
    expect(again.events).toEqual([]);
    acknowledgeIntegrationStop(candidate, at(11));
    expect(candidate.integration!.stop!.acknowledgedAt).toBe(at(11).toISOString());
  });

  it("settles a merge whose answer was lost without merging again", async () => {
    const { document, candidate } = setup();
    // GitHub merged the pull request, but the answer never arrived.
    const github = fakeGitHub({ pulls: [openPull(), openPull(), openPull({ state: "MERGED", mergeSHA: "c".repeat(40) })], merge: () => Promise.reject(new Error("timeout")) });
    const { outcome, saves } = await integrate(document, candidate, github.port);
    expect(outcome.status).toBe("merged");
    expect(candidate.integration).toMatchObject({ status: "merged", mergeSHA: "c".repeat(40) });
    expect(saves).toBeGreaterThanOrEqual(2);
    expect(github.merges).toHaveLength(1);
  });

  it("keeps an unknown outcome as merging and reads the pull request first on the next attempt", async () => {
    const { document, candidate } = setup();
    let reads = 0;
    const flaky: MergePort = {
      readPullRequest: async () => {
        reads++;
        if (reads === 3) throw new Error("rete assente");
        return reads >= 4 ? openPull({ state: "MERGED", mergeSHA: "d".repeat(40) }) : openPull();
      },
      readBaseHead: async () => "base",
      merge: () => Promise.reject(new Error("timeout")),
    };
    const first = await integrate(document, candidate, flaky);
    expect(first.outcome.status).toBe("unknown");
    expect(candidate.integration!.status).toBe("merging");
    expect(first.events[0]!.title).toBe("Esito dell'unione di #7 da verificare");
    const merges: number[] = [];
    const second = await integrate(document, candidate, { ...flaky, merge: async (n) => (merges.push(n), { sha: "x" }) });
    expect(second.outcome.status).toBe("merged");
    expect(merges).toEqual([]);
    expect(candidate.integration).toMatchObject({ status: "merged", mergeSHA: "d".repeat(40) });
  });

  it("retries a failed merge at the same destination with fresh checks", async () => {
    const { document, candidate } = setup();
    const failing = fakeGitHub({ merge: () => Promise.reject(new Error("Base branch was modified")) });
    const first = await integrate(document, candidate, failing.port);
    expect(first.outcome.status).toBe("failed");
    expect(candidate.integration!.failure).toMatch(/Base branch was modified/);
    const working = fakeGitHub();
    const second = await integrate(document, candidate, working.port);
    expect(second.outcome.status).toBe("merged");
    expect(working.merges).toEqual([{ number: 7, headSHA: HEAD, title: "feat: d" }]);
  });

  it("reconciles only an attempt in flight", async () => {
    const { candidate } = setup();
    expect(await reconcileIntegration(candidate, fakeGitHub().port, at(12).toISOString())).toBe("open");
    candidate.integration = {
      actor: "Coordinatore",
      mandateVersion: 1,
      destination: { repository: "o/r", pullRequestNumber: 7, baseBranch: "main", headSHA: HEAD },
      status: "merging",
      startedAt: at(10).toISOString(),
      updatedAt: at(10).toISOString(),
      mergeSHA: null,
      failure: null,
      stop: null,
    };
    expect(await reconcileIntegration(candidate, fakeGitHub({ pulls: [openPull({ state: "CLOSED" })] }).port, at(12).toISOString())).toBe("open");
    expect(candidate.integration).toMatchObject({ status: "failed", failure: "La pull request è stata chiusa senza unirla." });
  });
});

describe("destructive changes", () => {
  it("reads deleted files from the diff and ignores ordinary changes", () => {
    expect(deletedFiles("diff --git a/x.ts b/x.ts\ndeleted file mode 100644\ndiff --git a/y.ts b/y.ts\n+y")).toEqual(["x.ts"]);
    const ordinary = { diff: "diff --git a/y.ts b/y.ts\n+const deleteFromCart = 1;\n-DROP TABLE old;", commit: undefined } as unknown as Candidate;
    expect(destructiveChange(ordinary)).toBeNull();
  });
});
