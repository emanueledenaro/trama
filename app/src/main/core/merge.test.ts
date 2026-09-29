import { afterEach, describe, expect, it } from "vitest";
import type { CandidateGate } from "@shared/domain";
import { approveCandidate, candidateReport, clearCandidate, declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { declineDestructiveMerge, deletedFiles, destructiveChange, mergeActivity, mergeBan, MERGE_RETRY_MS, mergeCommitTitle, mergeReadiness, mergeRoute, pullRequestConflicted, pullRequestDrift, recordMerge, rejectCandidate, stopDestructiveMerge, stopOnDrift } from "./merge";
import { decide, grantMandate, revokeMandate } from "./pact";
import { restrictMandate } from "./projectMandate";
import { setPersonLanguage } from "./personLanguage";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam } from "./team";

const BRANCHES = { head: "feature/negozio-trama-0a1b2c3d", base: "main" };

function setup(changedFiles: string[], actions: Parameters<typeof grantMandate>[1]["authorizedActions"] = ["executeInWorktree", "openPullRequest", "integrateCandidate"], diff = "d") {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: ["m"], authorizedActions: actions, limits: [] });
  const decision = decide(document, { id: null, value: "Revisione", acceptedExample: "e", rationale: "r" });
  confirmTeam(
    document,
    proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Web", reason: "r", moduleIds: ["m"] }] }).id,
    null,
    null,
  );
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "o",
      issueNumber: null,
      exercise: null,
      moduleIds: ["m"],
      dependencies: [],
      model: "gpt",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "i",
    },
    1,
    null,
  );
  beginTurn(document, assignment.id, "t", "gpt");
  endTurn(document, assignment.id, "t", { kind: "completed", text: "ok" });
  const review = { snapshotId: "snap", baseSHA: "base", diff, changedFiles, excludedSensitiveFiles: [], whitespaceErrors: [] };
  const candidate = declareCandidate(document, { assignmentId: assignment.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review);
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: "snap" });
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: "r", authorThreadId: "a", verdict: "approved", summary: "ok" });
  return { document, decision, candidate };
}

function passGate(document: ReturnType<typeof setup>["document"], candidateId: string, snapshotId = "snap"): CandidateGate {
  const gate: CandidateGate = {
    id: `G-${document.gates?.length ?? 0}`,
    candidateId,
    assignmentId: document.candidates.find((c) => c.id === candidateId)!.assignmentId,
    snapshotId,
    baseSHA: "base",
    status: "passed",
    checksFailed: [],
    suite: [],
    reviews: [],
    returned: null,
    failure: null,
    startedAt: "2026-09-28T10:00:00Z",
    updatedAt: "2026-09-28T10:00:00Z",
    finishedAt: "2026-09-28T10:00:00Z",
  };
  document.gates = [...(document.gates ?? []), gate];
  return gate;
}

const readiness = (s: ReturnType<typeof setup>, branches = BRANCHES, now?: Date) => {
  const report = candidateReport(s.document, s.candidate, "base");
  return mergeReadiness(s.document, s.candidate, report, mergeRoute(s.document, s.candidate, "org/negozio").route, branches, now);
};

describe("merge of a candidate (issue #247)", () => {
  it("merges a verified candidate without interface changes on the Coordinator's green light, once the gate passed", () => {
    const s = setup(["NOTE.md", "Sources/Orders/Order.swift"]);
    expect(mergeRoute(s.document, s.candidate, "org/negozio")).toEqual({ route: "coordinator", reason: null });
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Il candidato non ha superato il cancello dei revisori." });
    passGate(s.document, s.candidate.id);
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Manca il via libera del Coordinatore su questo candidato." });
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    expect(readiness(s)).toEqual({ kind: "merge", by: "coordinator" });
    // The person's approval is not needed, and the green light is not the person's approval.
    expect(s.candidate.humanApproval).toBeNull();
  });

  it("does not merge by itself a candidate that changes the interface: the person's ok merges it", () => {
    const s = setup(["web/index.css", "NOTE.md"]);
    expect(mergeRoute(s.document, s.candidate, "org/negozio").route).toBe("interface");
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    expect(readiness(s)).toEqual({ kind: "person" });
    approveCandidate(s.document, s.candidate.id, "Persona", "base");
    expect(readiness(s)).toEqual({ kind: "merge", by: "person" });
  });

  it("keeps a refused interface candidate out of the merge until the person's ok takes the refusal back", () => {
    const s = setup(["web/index.css"]);
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    approveCandidate(s.document, s.candidate.id, "Persona", "base");
    expect(() => rejectCandidate(s.document, s.candidate.id, "  ", "Persona")).toThrow(/Scrivi perché/);
    rejectCandidate(s.document, s.candidate.id, "Il pulsante è illeggibile in scuro", "Persona");
    expect(s.candidate.humanApproval).toBeNull();
    expect(s.candidate.humanRejection).toMatchObject({ note: "Il pulsante è illeggibile in scuro", actor: "Persona" });
    expect(readiness(s)).toEqual({ kind: "wait", reason: "La persona ha rifiutato il candidato: torna allo sviluppatore." });
    approveCandidate(s.document, s.candidate.id, "Persona", "base");
    expect(s.candidate.humanRejection).toBeNull();
    expect(readiness(s)).toEqual({ kind: "merge", by: "person" });
  });

  it("does not merge a candidate changed after the green light or after the ok with the old one", () => {
    const s = setup(["web/index.css"]);
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    approveCandidate(s.document, s.candidate.id, "Persona", "base");
    expect(readiness(s)).toEqual({ kind: "merge", by: "person" });
    // New evidence changes what the green light and the ok covered.
    recordEvidence(s.document, s.candidate.id, { check: "git_status", passed: true, command: "git status", output: "again", snapshotId: "snap" }, new Date(Date.now() + 60_000));
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Manca il via libera del Coordinatore su questo candidato." });
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    expect(readiness(s)).toEqual({ kind: "person" });

    // A changed decision stops the Coordinator's merge too.
    const other = setup(["NOTE.md"]);
    passGate(other.document, other.candidate.id);
    clearCandidate(other.document, other.candidate.id, "Coordinatore", "base");
    decide(other.document, { id: other.decision.id, value: "Rimborso", acceptedExample: "e", rationale: "r" });
    expect(readiness(other)).toEqual({ kind: "wait", reason: "Il candidato non è verificato." });
  });

  it("stops a merge that would need a fixed ban", () => {
    const s = setup(["NOTE.md"]);
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    expect(readiness(s, { head: "main", base: "main" })).toEqual({ kind: "banned", ban: "pushMainBranch" });
    expect(readiness(s, { head: "develop", base: "develop" })).toEqual({ kind: "banned", ban: "pushMainBranch" });
    expect(mergeBan({ ...s.candidate, changedFiles: [".github/CODEOWNERS"] }, BRANCHES.head, "main")).toBe("repositorySettings");
    expect(mergeBan({ ...s.candidate, changedFiles: ["config/.env"] }, BRANCHES.head, "main")).toBe("secrets");
    expect(mergeBan(s.candidate, BRANCHES.head, "main")).toBeNull();
    // Once stopped, the same content does not try again: it waits for the person.
    recordMerge(s.document, s.candidate, "coordinator", "stopped", "Sul branch principale il lavoro arriva solo da una pull request.");
    expect(readiness(s, { head: "main", base: "main" })).toEqual({ kind: "wait", reason: "Sul branch principale il lavoro arriva solo da una pull request." });
    expect(mergeActivity(s.candidate, { kind: "banned", ban: "pushMainBranch" }, "coordinator")).toMatchObject({ title: "Unione fermata da un divieto fisso", tone: "error" });
  });

  it("leaves the candidate to the person when the mandate does not cover the merge or the project has no GitHub remote", () => {
    const s = setup(["NOTE.md"], ["executeInWorktree", "openPullRequest"]);
    expect(mergeRoute(s.document, s.candidate, "org/negozio")).toMatchObject({ route: "person" });
    expect(mergeRoute(s.document, s.candidate, null).reason).toMatch(/remoto GitHub/);
    const ui = setup(["web/index.css"]);
    expect(mergeRoute(ui.document, ui.candidate, null).route).toBe("person");
    passGate(s.document, s.candidate.id);
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Il candidato lo rivede e lo pubblica la persona." });
  });

  it("tries again a merge GitHub refused after a while, and never merges twice", () => {
    const s = setup(["NOTE.md"]);
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    const at = new Date("2026-09-28T10:00:00Z");
    recordMerge(s.document, s.candidate, "coordinator", "failed", "GitHub non ha unito la pull request #4: Base branch was modified", at);
    expect(readiness(s, BRANCHES, new Date(at.getTime() + 1_000))).toMatchObject({ kind: "wait" });
    expect(readiness(s, BRANCHES, new Date(at.getTime() + MERGE_RETRY_MS))).toEqual({ kind: "merge", by: "coordinator" });
    recordMerge(s.document, s.candidate, "coordinator", "running");
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Trama sta unendo il candidato." });
    s.candidate.pullRequest = { url: "u", number: 4, branch: BRANCHES.head, at: "", mergedAt: "2026-09-28T10:05:00Z", headSHA: "abc", mergedBy: "coordinator" };
    expect(readiness(s)).toEqual({ kind: "wait", reason: "Il candidato è già unito." });
  });

  it("titles the merge commit with the candidate's header and the pull request", () => {
    expect(mergeCommitTitle("feat(checkout): show the paid orders", 12)).toBe("feat(checkout): show the paid orders (#12)");
  });

  describe("in English (issue #301)", () => {
    afterEach(() => setPersonLanguage("it"));

    it("writes the merge rows and the reasons in the person's language", () => {
      const s = setup(["NOTE.md"]);
      setPersonLanguage("en");
      expect(mergeActivity(s.candidate, { kind: "merged", number: 1234, url: "https://github.com/o/r/pull/1234" }, "coordinator")).toMatchObject({
        title: `Candidate ${s.candidate.id} merged with the Coordinator's green light`,
        detail: "Pull request #1234: https://github.com/o/r/pull/1234",
      });
      expect(mergeActivity(s.candidate, { kind: "merged", number: 2, url: "u" }, "person").title).toBe(`Candidate ${s.candidate.id} merged with your ok`);
      expect(mergeRoute(s.document, s.candidate, null).reason).toBe("The project has no GitHub remote: Trama does not open or merge the pull request.");
      expect(() => rejectCandidate(s.document, s.candidate.id, " ", "persona")).toThrow("Write why you reject the candidate: the reason goes back to the developer.");
    });
  });
});

describe("merge by mandate without faking the human review (issue #41)", () => {
  const ready = (diff = "d") => {
    const s = setup(["NOTE.md"], undefined, diff);
    passGate(s.document, s.candidate.id);
    clearCandidate(s.document, s.candidate.id, "Coordinatore", "base");
    return s;
  };

  it("merges only on a green light of the mandate in force, and records that mandate on the merge", () => {
    const s = ready();
    expect(s.candidate.clearance).toMatchObject({ actor: "Coordinatore", mandateVersion: 1 });
    expect(readiness(s)).toEqual({ kind: "merge", by: "coordinator" });
    recordMerge(s.document, s.candidate, "coordinator", "merged");
    expect(s.candidate.merge).toMatchObject({ by: "coordinator", mandateVersion: 1 });
    // A green light given before it carried its mandate is not reused.
    const legacy = ready();
    delete legacy.candidate.clearance!.mandateVersion;
    expect(readiness(legacy)).toEqual({ kind: "wait", reason: "Il via libera è stato dato con un mandato diverso da quello in vigore: serve un nuovo via libera." });
    // A narrower mandate still covering the candidate asks a new green light too.
    const narrowed = ready();
    narrowed.document.mandate!.authorizedActions.push("plan");
    restrictMandate(narrowed.document, { scopeModuleIds: ["m"], authorizedActions: ["executeInWorktree", "openPullRequest", "integrateCandidate"] });
    expect(readiness(narrowed)).toMatchObject({ kind: "wait", reason: expect.stringMatching(/mandato diverso/) });
    clearCandidate(narrowed.document, narrowed.candidate.id, "Coordinatore", "base");
    expect(readiness(narrowed)).toEqual({ kind: "merge", by: "coordinator" });
    // The person's ok never records a mandate, and a revoked mandate leaves the merge to the person.
    recordMerge(narrowed.document, narrowed.candidate, "person", "running");
    expect(narrowed.candidate.merge!.mandateVersion).toBeNull();
    revokeMandate(narrowed.document, "Pausa");
    expect(mergeRoute(narrowed.document, narrowed.candidate, "org/negozio").route).toBe("person");
  });

  it("stops a serious destructive change for the person, and merges it only on their ok", () => {
    const diff = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\ndiff --git a/db.sql b/db.sql\n+DROP TABLE orders;";
    const s = ready(diff);
    const decided = readiness(s);
    expect(decided.kind).toBe("destructive");
    const stop = decided.kind === "destructive" ? decided.stop : null!;
    expect(stop.reasons).toEqual(["Cancella un file.", "Contiene istruzioni che cancellano dati."]);
    expect(stop.consequences.join(" ")).toMatch(/old\.ts/);
    expect(stop.alternatives).toHaveLength(3);
    stopDestructiveMerge(s.document, s.candidate, stop);
    expect(s.candidate.merge).toMatchObject({ by: "coordinator", status: "stopped", mandateVersion: 1, stop: { acknowledgedAt: null } });
    expect(readiness(s)).toMatchObject({ kind: "wait" });
    expect(mergeActivity(s.candidate, { kind: "destructive", reasons: stop.reasons }, "coordinator")).toMatchObject({ title: "Unione fermata: serve la tua decisione", tone: "error" });
    // The green light is not the person's ok: only their approval merges it, as their act.
    expect(s.candidate.humanApproval).toBeNull();
    approveCandidate(s.document, s.candidate.id, "Persona", "base");
    expect(readiness(s)).toEqual({ kind: "merge", by: "person" });

    const declined = ready(diff);
    stopDestructiveMerge(declined.document, declined.candidate, destructiveChange(declined.candidate)!);
    declineDestructiveMerge(declined.candidate);
    expect(declined.candidate.merge!.stop!.acknowledgedAt).not.toBeNull();
    expect(readiness(declined)).toMatchObject({ kind: "wait" });
    expect(() => declineDestructiveMerge(ready().candidate)).toThrow(/unione fermata/);
  });

  it("reads an incompatible change and deleted files, and leaves ordinary changes alone", () => {
    expect(deletedFiles("diff --git a/x.ts b/x.ts\ndeleted file mode 100644\ndiff --git a/y.ts b/y.ts\n+y")).toEqual(["x.ts"]);
    const s = ready("diff --git a/y.ts b/y.ts\n+const deleteFromCart = 1;\n-DROP TABLE old;");
    expect(destructiveChange(s.candidate)).toBeNull();
    s.candidate.commit = { type: "feat", scope: null, description: "d", breaking: "l'API degli ordini cambia", message: "feat!: d", conventions: {} as never, correctedBy: null };
    expect(destructiveChange(s.candidate)?.reasons).toEqual(["Modifica incompatibile."]);
    // An interface candidate already waits for the person: the Coordinator's stop does not apply to it.
    const ui = setup(["web/index.css"], undefined, "diff --git a/web/old.css b/web/old.css\ndeleted file mode 100644");
    passGate(ui.document, ui.candidate.id);
    clearCandidate(ui.document, ui.candidate.id, "Coordinatore", "base");
    expect(readiness(ui)).toEqual({ kind: "person" });
  });

  it("stops a merge when the pull request changed after the check", () => {
    const status = { number: 21, state: "OPEN" as const, mergedAt: null, checks: "success" as const };
    expect(pullRequestDrift("abc", { ...status, headSHA: "abc", mergeable: true })).toBeNull();
    expect(pullRequestDrift("abc", status)).toBeNull();
    expect(pullRequestDrift("abc", { ...status, headSHA: "def" })).toMatch(/altro lavoro/);
    expect(pullRequestDrift("abc", { ...status, headSHA: "abc", mergeable: false })).toMatch(/conflitti/);
  });

  it("keeps a stop on conflicts with the base apart, so the next move is the Coordinator's realignment (negozio, pull request #25)", () => {
    const s = setup(["NOTE.md"]);
    s.candidate.pullRequest = { url: "https://github.com/emanueledenaro/negozio/pull/25", number: 25, branch: "chore/issue-24-trama-c4e84cfe", headSHA: "ddcdddb", at: "2026-09-29T16:17:50.531Z" };
    const status = { number: 25, state: "OPEN" as const, mergedAt: null, checks: "success" as const, headSHA: "ddcdddb" };
    expect(stopOnDrift(s.document, s.candidate, "person", "ddcdddb", { ...status, mergeable: true })).toBeNull();
    expect(s.candidate.merge ?? null).toBeNull();
    expect(stopOnDrift(s.document, s.candidate, "person", "ddcdddb", { ...status, mergeable: false })).toBe("GitHub trova conflitti tra la pull request #25 e la base.");
    expect(s.candidate.merge).toMatchObject({ status: "stopped", baseConflict: true, detail: "GitHub trova conflitti tra la pull request #25 e la base." });
    expect(pullRequestConflicted(s.candidate)).toBe(true);
    // Another push on the pull request's branch is not a conflict with the base.
    expect(stopOnDrift(s.document, s.candidate, "person", "ddcdddb", { ...status, headSHA: "eeeeeee", mergeable: false })).toMatch(/altro lavoro/);
    expect(s.candidate.merge?.baseConflict).toBeUndefined();
    expect(pullRequestConflicted(s.candidate)).toBe(false);
    // A stop recorded before the cause was kept apart is read from its words, in either language.
    s.candidate.merge = { ...s.candidate.merge!, detail: "GitHub finds conflicts between pull request #25 and the base." };
    expect(pullRequestConflicted(s.candidate)).toBe(true);
    // A merged pull request has nothing left to realign.
    s.candidate.pullRequest.mergedAt = "2026-09-29T17:00:00Z";
    expect(pullRequestConflicted(s.candidate)).toBe(false);
  });
});
