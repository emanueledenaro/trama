import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";
import { workState } from "./core/workPhase";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: Record<string, unknown> };

describe("verified candidate in the chat (V05)", () => {
  it("blocks a candidate on a failed check with its original output, verifies the correction as a new candidate and reviews it from a distinct thread", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
      publish: () => undefined,
      openExternal: async () => undefined,
      applyTheme: () => undefined,
      notify: () => undefined,
      setOpenAtLogin: () => undefined,
      aiHeroResourceDirectory: join(root, "resources/AIHero"),
      demoResourceDirectory: "",
      codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    });
    await controller.start();
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const document = controller.snapshot.project!.document;
    const reports = () => controller!.snapshot.project!.candidateReports;

    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
    const decision = document.decisions[0]!;
    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree", "integrateCandidate"],
      limits: [],
    });
    const specialist = findSpecialist(document, "Ada")!;

    // The work leaves trailing whitespace in a tracked file: git_diff_check fails on this exact candidate.
    await controller.send("[assegna] [spazi]", null, null, null);
    const work = specialist.assignments[0]!;
    await until(() => work.status === "completed");
    await controller.send(`[candidato:${work.id}:${decision.id}:tutte]`, null, null, null);
    const failed = document.candidates[0]!;
    expect(failed).toMatchObject({ assignmentId: work.id, requiredChecks: ["git_status", "git_diff_check"], requiredDecisionIds: [decision.id] });
    expect(failed.baseSHA).toBe((await git(["rev-parse", "HEAD"], repo)).trim());
    expect(failed.changedFiles).toContain("Sources/Orders/CancelPaidOrder.swift");
    const evidence = failed.evidence.git_diff_check!;
    expect(evidence).toMatchObject({ result: "fail", snapshotId: failed.snapshotId, command: expect.stringContaining("diff --check HEAD") });
    // The original output of git, unchanged.
    expect(evidence.output).toContain("Sources/Orders/CancelPaidOrder.swift");
    expect(evidence.output).toContain("trailing whitespace.");
    expect(reports()[failed.id]?.state).toBe("building");
    expect(failed.evidence.git_status?.result).toBe("pass");
    expect(reports()[failed.id]?.blockers).toEqual([{ code: "CHECK_FAILED", detail: "git_diff_check" }]);
    // The Coordinator's green light is refused and the chat says so.
    expect(failed.clearance).toBeNull();
    expect(document.events.some((e) => e.content.type === "coordinatorText" && e.content.text.includes("candidate_not_verified"))).toBe(true);
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "candidate" && e.content.referenceId === failed.id)).toBe(true);

    // The correction is new work: a new candidate with new evidence; the failed one keeps its evidence.
    await controller.send("[assegna] [correggi-spazi]", null, null, null);
    const fix = specialist.assignments[1]!;
    await until(() => fix.status === "completed");
    await controller.send(`[candidato:${fix.id}:${decision.id}:tutte]`, null, null, null);
    const corrected = document.candidates[1]!;
    expect(corrected.id).not.toBe(failed.id);
    expect(corrected.snapshotId).not.toBe(failed.snapshotId);
    expect(corrected.evidence.git_diff_check).toMatchObject({ result: "pass", snapshotId: corrected.snapshotId });
    expect(failed.evidence.git_diff_check?.result).toBe("fail");

    // The technical review comes from a read-only thread distinct from the author's, and is no human review nor a merge.
    const review = corrected.technicalReview!;
    expect(review).toMatchObject({ verdict: "approved", authorThreadId: fix.threadId });
    expect(review.reviewerThreadId).not.toBe(fix.threadId);
    expect(review.reviewerThreadId).not.toBe(document.coordinator.threadId);
    const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Request);
    const reviewer = requests.find((r) => r.method === "turn/start" && r.params.threadId === review.reviewerThreadId)!;
    expect(reviewer.params).toMatchObject({ cwd: fix.workspace!.worktreeRoot });
    expect(reviewer.params).not.toHaveProperty("permissions");
    expect(reviewer.params).not.toHaveProperty("sandboxPolicy");
    expect(String((reviewer.params.input as { text: string }[])[0]!.text)).toContain(`Revisione tecnica del candidato ${corrected.id}`);
    expect(corrected).toMatchObject({ humanApproval: null, pullRequest: null });
    // Verified and approved, the candidate gets the Coordinator's green light; new evidence withdraws it.
    expect(reports()[corrected.id]).toMatchObject({ state: "decided", blockers: [], clearanceInvalidated: false });
    expect(corrected.clearance).toMatchObject({ actor: "Coordinatore" });
    await controller.send(`[riverifica:${corrected.id}:git_status]`, null, null, null);
    expect(reports()[corrected.id]).toMatchObject({ state: "verified", clearanceInvalidated: true });

    // The failed candidate is still the old work: checked again, it fails again and stays blocked.
    await controller.send(`[riverifica:${failed.id}:git_diff_check]`, null, null, null);
    expect(failed.evidence.git_diff_check?.result).toBe("fail");
    expect(reports()[failed.id]?.state).toBe("building");
  }, 60_000);
});

/**
 * Issue #204, the live run with Codex: a developer ends its work in the worktree, Trama starts the checks by itself (W04),
 * and the Coordinator passes the assignment id to verify_candidate. The fake Codex replays that turn.
 */
describe("the checks after an ended assignment (issue #204)", () => {
  async function liveRun(marker: "[luna]" | "[luna-segue]") {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
      publish: () => undefined,
      openExternal: async () => undefined,
      applyTheme: () => undefined,
      notify: () => undefined,
      setOpenAtLogin: () => undefined,
      aiHeroResourceDirectory: join(root, "resources/AIHero"),
      demoResourceDirectory: "",
      codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    });
    await controller.start();
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const project = controller.snapshot.project!;
    const document = project.document;
    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await until(() => project.runningRequestId === null, 20_000);
    await controller.send(`[assegna] ${marker}`, null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    const automatic = () => document.requests.find((r) => r.step?.by === "trama" && r.step.move === "verifyCandidate");
    await until(() => automatic()?.state === "completed" && project.runningRequestId === null, 30_000);
    const turns = async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Request)
        .filter((r) => r.method === "turn/start")
        .map((r) => String((r.params.input as { text: string }[])[0]!.text));
    return { project, document, work, move: automatic()!, turns };
  }

  const toolResults = (document: ProjectDocument, requestId: string, tool: string) =>
    document.events.filter((e) => e.requestId === requestId && e.content.type === "activity" && e.content.title.includes(tool));

  it("does not stop in silence when the Coordinator verifies the assignment instead of a candidate", async () => {
    const { project, document, work, move, turns } = await liveRun("[luna]");
    expect(work.status).toBe("completed");
    // The automatic move told the Coordinator what to verify and that the assignment is declared first.
    const sent = (await turns()).find((text) => text.includes("Mossa automatica di Trama: verifyCandidate"))!;
    expect(sent).toContain(`Incarichi conclusi senza candidato: ${work.id}.`);
    expect(sent).toContain("chiama prima declare_candidate");
    // Twice the assignment id, as in the live run: each refusal names the move to make first, and nothing is declared.
    expect(toolResults(document, move.id, "verify_candidate").length).toBeGreaterThanOrEqual(2);
    const reply = document.events.findLast((e) => e.requestId === move.id && e.content.type === "coordinatorText")!;
    expect(reply.content).toMatchObject({ text: expect.stringContaining(`First call declare_candidate with assignment ${work.id}`) });
    expect(document.candidates).toEqual([]);

    // The work waits for the person, who sees why and the move to take again.
    const reason = `La mossa automatica non è riuscita: l'incarico ${work.id} è concluso ma il suo candidato non è stato dichiarato.`;
    expect(move.step).toEqual({ move: "verifyCandidate", by: "trama", stalled: reason });
    await until(() => Boolean(project.nextSteps[move.id]));
    expect(project.nextSteps[move.id]).toMatchObject({ move: "verifyCandidate", actor: "coordinator", label: "Esegui le verifiche", reason });
    await new Promise((r) => setTimeout(r, 300));
    expect(document.requests.filter((r) => r.step?.by === "trama")).toHaveLength(1);

    // The person takes it: the Coordinator's new turn reads the same guidance in the phase of the work.
    await controller!.takeStep(move.id);
    const retry = document.requests.find((r) => r.step?.by === "person" && r.step.move === "verifyCandidate")!;
    expect(retry).toMatchObject({ text: "Esegui le verifiche del lavoro.", state: "completed" });
    expect((await turns()).some((text) => text.includes(`Incarichi conclusi senza candidato: ${work.id}.`) && !text.includes("Mossa automatica"))).toBe(true);
    // Its turn did not make the move either: Trama starts it once more after the person's message, and shows it again.
    const again = () => document.requests.filter((r) => r.step?.by === "trama");
    await until(() => again().length === 2 && again()[1]!.state === "completed" && project.runningRequestId === null, 20_000);
    expect(again()[1]!.step?.stalled).toBe(reason);
  }, 60_000);

  it("declares the candidate and verifies it when the Coordinator follows what verify_candidate answers", async () => {
    const { document, work, move } = await liveRun("[luna-segue]");
    const candidate = document.candidates[0]!;
    expect(candidate.assignmentId).toBe(work.id);
    expect(candidate.evidence.git_status?.result).toBe("pass");
    expect(candidate.technicalReview?.verdict).toBe("approved");
    expect(move.step).toEqual({ move: "verifyCandidate", by: "trama" });
    expect(move.nextStep).toBeUndefined();
    expect(workState(document, document.requests.at(-1)!.id)).toMatchObject({ phase: "candidate", moves: [{ move: "reviewCandidate", actor: "person" }] });
  }, 60_000);
});
