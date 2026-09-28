import { afterEach, describe, expect, it } from "vitest";
import type { CandidateGate } from "@shared/domain";
import { approveCandidate, candidateReport, clearCandidate, declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { mergeActivity, mergeBan, MERGE_RETRY_MS, mergeCommitTitle, mergeReadiness, mergeRoute, recordMerge, rejectCandidate } from "./merge";
import { decide, grantMandate } from "./pact";
import { setPersonLanguage } from "./personLanguage";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam } from "./team";

const BRANCHES = { head: "feature/negozio-trama-0a1b2c3d", base: "main" };

function setup(changedFiles: string[], actions: Parameters<typeof grantMandate>[1]["authorizedActions"] = ["executeInWorktree", "openPullRequest", "integrateCandidate"]) {
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
  const review = { snapshotId: "snap", baseSHA: "base", diff: "d", changedFiles, excludedSensitiveFiles: [], whitespaceErrors: [] };
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
