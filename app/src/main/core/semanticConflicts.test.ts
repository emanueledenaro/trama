import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate, ProjectDocument, WorktreeSession } from "@shared/domain";
import { inspectCandidate } from "./candidates";
import { combineWorktrees } from "./conflicts";
import { emptyDocument } from "./document";
import { git } from "./process";
import {
  carryOverHypotheses,
  pendingScenarios,
  recordSemanticHypothesis,
  semanticAssessmentCurrent,
  semanticAssessmentId,
  SemanticRiskError,
  settleScenario,
} from "./semanticConflicts";
import { prepareWorktree, reviewWorktree } from "./workspace";

async function repository() {
  const repo = await mkdtemp(join(tmpdir(), "trama-semantic-"));
  await git(["init", "-b", "main"], repo, false);
  await writeFile(join(repo, "prezzi.txt"), "prezzo 10\n");
  await writeFile(join(repo, "ordini.txt"), "totale somma\n");
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qam", "init"], repo, false);
  const root = await mkdtemp(join(tmpdir(), "trama-semantic-wt-"));
  return { repo, ada: await prepareWorktree(repo, "Ada", root), bea: await prepareWorktree(repo, "Bea", root) };
}

/** A developer with one finished assignment in `session` and its candidate, declared at `minute`, that passed node_test. */
async function developerWork(document: ProjectDocument, name: string, session: WorktreeSession, minute: number): Promise<Candidate> {
  const review = await reviewWorktree(session);
  const assignmentId = `A-${name}`;
  let specialist = document.team.specialists.find((s) => s.id === `S-${name}`);
  if (!specialist) {
    specialist = {
      id: `S-${name}`,
      name,
      competence: "Node",
      reason: "",
      moduleIds: [],
      role: "developer",
      origin: "teamProposal",
      color: "blue",
      tag: "Node",
      createdAt: "",
      status: "available",
      model: "gpt-6-luna",
      tools: ["commands", "edits"],
      updatedAt: "",
      lastUpdate: "",
      removal: null,
      assignments: [],
    };
    document.team.specialists.push(specialist);
  }
  if (!specialist.assignments.some((a) => a.id === assignmentId)) {
    specialist.assignments.push({ id: assignmentId, specialistId: `S-${name}`, status: "completed", workspace: session, tools: ["commands", "edits"], objective: `Lavoro di ${name}` } as never);
  }
  const at = new Date(Date.UTC(2026, 8, 28, 10, minute)).toISOString();
  const candidate = {
    id: `C-${name}-${minute}`,
    assignmentId,
    specialistId: `S-${name}`,
    snapshotId: review.snapshotId,
    baseSHA: session.baseSHA,
    diff: "",
    changedFiles: review.changedFiles,
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["node_test"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: at,
    updatedAt: at,
    evidence: { node_test: { check: "node_test", result: "pass", command: "npm test", output: "", snapshotId: review.snapshotId, decisionVersions: {}, recordedAt: at } },
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  } satisfies Candidate;
  document.candidates.push(candidate);
  return candidate;
}

async function twoCandidatesInDifferentFiles() {
  const { repo, ada, bea } = await repository();
  await writeFile(join(ada.worktreeRoot, "ordini.txt"), "totale arrotondato\n");
  await writeFile(join(bea.worktreeRoot, "prezzi.txt"), "prezzo 9.99\n");
  const document = emptyDocument("p");
  const older = await developerWork(document, "Bea", bea, 1);
  const newer = await developerWork(document, "Ada", ada, 2);
  return { repo, ada, bea, document, older, newer };
}

const explanation = "Bea arrotonda i prezzi, Ada il totale: insieme il totale perde un centesimo.";

describe("semantic hypotheses between the team's candidates (issue #40)", () => {
  it("records an AI's reading as a hypothesis that blocks nothing, once per pair and snapshots", async () => {
    const { document, older, newer } = await twoCandidatesInDifferentFiles();
    const first = recordSemanticHypothesis(document, { candidate: older, other: newer, explanation, check: "node_test" }, new Date("2026-09-28T12:00:00Z"));
    // The newer candidate carries the assessment, whichever side the AI named first.
    expect(first).toMatchObject({
      created: true,
      assessment: {
        id: semanticAssessmentId(newer, older),
        candidateId: newer.id,
        otherCandidateId: older.id,
        otherSnapshotId: older.snapshotId,
        classification: "hypothesis",
        conflictingFiles: [],
        semantic: { explanation, analyzedAt: "2026-09-28T12:00:00.000Z", check: "node_test", scenario: null },
      },
    });
    expect(inspectCandidate(document, newer, null).map((b) => b.code)).not.toContain("SEMANTIC_CONFLICT");
    // The same report again does not add a warning; a new reading updates the one there.
    const again = recordSemanticHypothesis(document, { candidate: newer, other: older, explanation: `${explanation} `, check: "node_test" });
    expect(again.created).toBe(false);
    const reread = recordSemanticHypothesis(document, { candidate: newer, other: older, explanation: "Altra lettura.", check: "node_test" }, new Date("2026-09-28T12:05:00Z"));
    expect(reread.created).toBe(false);
    expect(document.conflicts).toHaveLength(1);
    expect(document.conflicts![0]!.semantic).toMatchObject({ explanation: "Altra lettura.", analyzedAt: "2026-09-28T12:05:00.000Z" });
    expect(pendingScenarios(document).map((a) => a.id)).toEqual([semanticAssessmentId(newer, older)]);
  });

  it("refuses the same files, the same work and a check the two candidates do not share", async () => {
    const { document, older, newer } = await twoCandidatesInDifferentFiles();
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof SemanticRiskError ? error.code : String(error);
      }
      return null;
    };
    expect(refusal(() => recordSemanticHypothesis(document, { candidate: newer, other: { ...older, changedFiles: ["ordini.txt"] }, explanation, check: "node_test" }))).toBe("same_files");
    expect(refusal(() => recordSemanticHypothesis(document, { candidate: newer, other: newer, explanation, check: "node_test" }))).toBe("same_work");
    expect(refusal(() => recordSemanticHypothesis(document, { candidate: newer, other: older, explanation, check: "node_typecheck" }))).toBe("check_not_shared");
    expect(refusal(() => recordSemanticHypothesis(document, { candidate: newer, other: older, explanation: " ", check: "node_test" }))).toBe("missing_explanation");
    expect(document.conflicts ?? []).toEqual([]);
  });

  it("merges the two candidates in a separate copy with both changes, leaving the worktrees and the checkout as they were", async () => {
    const { repo, ada, bea, older, newer } = await twoCandidatesInDifferentFiles();
    const combined = await combineWorktrees(
      { session: ada, snapshotId: newer.snapshotId },
      { session: bea, snapshotId: older.snapshotId },
      await mkdtemp(join(tmpdir(), "trama-scenario-")),
    );
    expect(combined.status).toBe("clean");
    if (combined.status !== "clean") return;
    expect(await readFile(join(combined.path, "ordini.txt"), "utf8")).toBe("totale arrotondato\n");
    expect(await readFile(join(combined.path, "prezzi.txt"), "utf8")).toBe("prezzo 9.99\n");
    await combined.remove();
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    expect((await git(["status", "--porcelain"], ada.worktreeRoot)).trim()).toBe("M ordini.txt");
    expect((await git(["status", "--porcelain"], bea.worktreeRoot)).trim()).toBe("M prezzi.txt");
  });

  it("becomes evidence and blocks the newer candidate only when the combined candidate fails where each side passed", async () => {
    const { document, older, newer } = await twoCandidatesInDifferentFiles();
    const { assessment } = recordSemanticHypothesis(document, { candidate: newer, other: older, explanation, check: "node_test" });
    settleScenario(document, assessment, { result: "pass", command: "npm test", output: "" }, new Date("2026-09-28T12:10:00Z"));
    expect(assessment.classification).toBe("hypothesis");
    expect(assessment.semantic!.scenario).toMatchObject({ result: "pass", ranAt: "2026-09-28T12:10:00.000Z" });
    expect(inspectCandidate(document, newer, null).map((b) => b.code)).not.toContain("SEMANTIC_CONFLICT");

    settleScenario(document, assessment, { result: "notRun", command: "", output: "La sandbox non è disponibile." });
    expect(assessment.classification).toBe("hypothesis");
    expect(assessment.detail).toContain("La sandbox non è disponibile.");
    // A scenario that did not start is tried again when the Coordinator reports the risk again.
    recordSemanticHypothesis(document, { candidate: newer, other: older, explanation, check: "node_test" });
    expect(pendingScenarios(document).map((a) => a.id)).toEqual([assessment.id]);

    // A failure where one side never passed alone may come from that side: it proves nothing.
    newer.evidence.node_test = { ...newer.evidence.node_test!, result: "fail" };
    settleScenario(document, assessment, { result: "fail", command: "npm test", output: "FAIL totale" });
    expect(assessment.classification).toBe("hypothesis");
    expect(inspectCandidate(document, newer, null).map((b) => b.code)).not.toContain("SEMANTIC_CONFLICT");

    newer.evidence.node_test = { ...newer.evidence.node_test!, result: "pass" };
    settleScenario(document, assessment, { result: "fail", command: "npm test", output: "FAIL totale" });
    expect(assessment.classification).toBe("semantic");
    expect(inspectCandidate(document, newer, null).find((b) => b.code === "SEMANTIC_CONFLICT")?.detail).toContain(older.id);
    // The older candidate can still be merged first.
    expect(inspectCandidate(document, older, null).map((b) => b.code)).not.toContain("SEMANTIC_CONFLICT");
  });

  it("makes the scenario obsolete when a candidate changes and tries only the new pair again, keeping the AI's reading", async () => {
    const { document, ada, older, newer } = await twoCandidatesInDifferentFiles();
    const { assessment } = recordSemanticHypothesis(document, { candidate: newer, other: older, explanation, check: "node_test" }, new Date("2026-09-28T12:00:00Z"));
    settleScenario(document, assessment, { result: "fail", command: "npm test", output: "FAIL totale" });
    expect(assessment.classification).toBe("semantic");
    expect(carryOverHypotheses(document)).toEqual([]);

    // Ada corrects her work: a new candidate of the same assignment.
    await writeFile(join(ada.worktreeRoot, "ordini.txt"), "totale arrotondato riga per riga\n");
    const corrected = await developerWork(document, "Ada", ada, 3);
    expect(semanticAssessmentCurrent(document, assessment)).toBe(false);
    expect(inspectCandidate(document, corrected, null).map((b) => b.code)).not.toContain("SEMANTIC_CONFLICT");
    const [carried, ...rest] = carryOverHypotheses(document, new Date("2026-09-28T13:00:00Z"));
    expect(rest).toEqual([]);
    expect(carried).toMatchObject({
      id: semanticAssessmentId(corrected, older),
      candidateId: corrected.id,
      classification: "hypothesis",
      semantic: { explanation, analyzedAt: "2026-09-28T12:00:00.000Z", scenario: null, carriedFrom: assessment.id },
    });
    expect(pendingScenarios(document).map((a) => a.id)).toEqual([carried!.id]);
    // Carrying over again finds the pair already there: no duplicate warning.
    expect(carryOverHypotheses(document)).toEqual([]);
    expect(document.conflicts).toHaveLength(2);
  });
});
