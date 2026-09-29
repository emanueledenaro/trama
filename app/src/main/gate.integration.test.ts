import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TechnicalReview } from "@shared/domain";
import { NO_SPEC, NOTHING_TO_REPORT } from "@shared/gate";
import { secretNote } from "./core/gate";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_CODEX_GATE_HOLD;
});

async function until(check: () => boolean, timeout = 20_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: Record<string, unknown> };

const host = {
  publish: () => undefined,
  openExternal: async () => undefined,
  applyTheme: () => undefined,
  notify: () => undefined,
  setOpenAtLogin: () => undefined,
  aiHeroResourceDirectory: join(root, "resources/AIHero"),
  demoResourceDirectory: "",
  codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
};

/** The example project, with a Node test that fails once the developer's NOTE.md exists: a regression on purpose. */
async function repository(nodeSuite: boolean): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  if (nodeSuite) {
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "ordini", version: "1.0.0", private: true, scripts: { test: "node check.js" } }, null, 2));
    await writeFile(join(repo, "package-lock.json"), JSON.stringify({ name: "ordini", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "ordini", version: "1.0.0" } } }, null, 2));
    await writeFile(join(repo, "check.js"), "const { existsSync } = require('node:fs');\nprocess.exit(existsSync(__dirname + '/NOTE.md') ? 1 : 0);\n");
    await writeFile(join(repo, ".gitignore"), "node_modules/\n");
    // The checkout's dependencies, which Trama lends to the worktrees (none here, but the folder must exist).
    await mkdir(join(repo, "node_modules"));
  }
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  return repo;
}

async function openTeam(repo: string) {
  controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), host);
  await controller.start();
  await controller.updateSettings({ continuousWork: false });
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
    authorizedActions: ["executeInWorktree", "integrateCandidate"],
    limits: [],
  });
  return { project, document, decision: document.decisions[0]! };
}

const readLog = async (log: string) =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Request);

describe("the candidate gate (W10)", () => {
  it("runs every reviewer in parallel on the diff and sends a blocking finding back to the developer", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const { project, document, decision } = await openTeam(await repository(false));
    const ada = findSpecialist(document, "Ada")!;
    // "[bloccante]" leaves a line in the note that the performance reviewer blocks.
    await controller!.send("[assegna] [bloccante]", null, null, null);
    const work = ada.assignments[0]!;
    await until(() => work.status === "completed");
    // The assignment's issue is the spec the spec reviewer reads.
    work.issueNumber = 12;
    project.github.issues.push({ number: 12, title: "Annullare un ordine pagato", state: "open", body: "Un ordine pagato annullato va in revisione.", url: "u", author: null, labels: [], updatedAt: "" });
    const authorTurns = () => document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === work.id)!.turns.length;
    expect(authorTurns()).toBe(1);

    // The reviewers answer only once the test lets them: every session is open at the same time.
    const hold = join(await mkdtemp(join(tmpdir(), "trama-hold-")), "go");
    process.env.FAKE_CODEX_GATE_HOLD = hold;
    const before = (await readLog(log)).length;
    const sent = controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    await until(() => (document.gates ?? []).length === 1);
    const gate = document.gates![0]!;
    const candidate = document.candidates[0]!;
    expect(gate).toMatchObject({ candidateId: candidate.id, baseSHA: candidate.baseSHA, snapshotId: candidate.snapshotId });
    const sessionRoles = ["specReviewer", "security", "performance", "ux", "devops", "documentation"] as const;
    const threadOf = (role: string) => gate.reviews.find((r) => r.role === role)!.threadId;
    await until(() => sessionRoles.every((role) => threadOf(role) !== null));
    let entries = (await readLog(log)).slice(before);
    const started = (threadId: string) => entries.some((r) => r.method === "turn/start" && r.params.threadId === threadId);
    for (const start = Date.now(); !sessionRoles.every((role) => started(threadOf(role)!)); entries = (await readLog(log)).slice(before)) {
      if (Date.now() - start > 20_000) throw new Error("timeout: the reviewer turns never all started");
      await new Promise((r) => setTimeout(r, 20));
    }
    // Six sessions of their own, all running at once, each read-only in the candidate's worktree.
    expect(new Set(sessionRoles.map(threadOf)).size).toBe(6);
    for (const role of sessionRoles) expect(gate.reviews.find((r) => r.role === role)).toMatchObject({ status: "running", finishedAt: null });
    // The real checks came first: the git_status evidence is on this snapshot before any reviewer opened.
    expect(candidate.evidence.git_status).toMatchObject({ result: "pass", snapshotId: candidate.snapshotId });
    // While the reviewers work the candidate cannot reach the person.
    expect(controller!.snapshot.project!.candidateReports[candidate.id]!.blockers.map((b) => b.code)).toEqual(["GATE_RUNNING"]);
    const skillPath = join(root, "resources/AIHero/skills/code-review/SKILL.md");
    for (const role of sessionRoles) {
      const turn = entries.find((r) => r.method === "turn/start" && r.params.threadId === threadOf(role))!;
      expect(turn.params).toMatchObject({ cwd: work.workspace!.worktreeRoot });
      const input = turn.params.input as { type: string; name?: string; path?: string }[];
      const withSkill = input.some((item) => item.type === "skill" && item.name === "code-review" && item.path === skillPath);
      expect(withSkill).toBe(!["security", "performance"].includes(role));
    }
    await writeFile(hold, "");
    await sent;

    // Performance blocks; the others sign nothing to report. The review carries the gate's verdict and the green light waits.
    expect(gate.status).toBe("blocked");
    const performance = gate.reviews.find((r) => r.role === "performance")!;
    expect(performance.findings).toEqual([expect.objectContaining({ severity: "blocking", title: "Ciclo senza limite in NOTE.md", file: "NOTE.md:2" })]);
    for (const role of ["specReviewer", "security", "ux", "devops", "documentation"]) {
      expect(gate.reviews.find((r) => r.role === role)).toMatchObject({ status: "done", findings: [], report: NOTHING_TO_REPORT });
    }
    expect(gate.reviews.find((r) => r.role === "cleanCode")).toMatchObject({ status: "done", threadId: candidate.technicalReview!.reviewerThreadId });
    expect(gate.reviews.find((r) => r.role === "regressionGuardian")).toMatchObject({ status: "done", findings: [expect.objectContaining({ title: "Nessuna suite da confrontare" })] });
    expect(candidate.technicalReview).toMatchObject({ verdict: "changesRequested", gateId: gate.id });
    expect(candidate.technicalReview!.summary).toContain("Prestazioni: 1 rilievo bloccante");
    expect(candidate.clearance).toBeNull();
    expect(controller!.snapshot.project!.candidateReports[candidate.id]!.blockers).toEqual([
      { code: "GATE_BLOCKED", detail: "Prestazioni: Ciclo senza limite in NOTE.md" },
    ]);

    // The finding goes back to the developer: the reviewer's message lands in Ada's work, and Ada resumes in the same session.
    const message = document.events.find((e) => e.assignmentId === work.id && e.content.type === "activity" && e.content.title.startsWith("Prestazioni a Ada"));
    expect(message).toMatchObject({ origin: "specialist", content: { detail: expect.stringContaining("Ciclo senza limite in NOTE.md") } });
    expect(gate.returned).toMatchObject({ assignmentId: work.id, waiting: null });
    const authorThread = work.threadId;
    await until(() => authorTurns() === 2 && work.status === "completed");
    // Trama asks to resume the author's own session (the fake Codex cannot, so it opens a new one) in the same worktree.
    const requests = await readLog(log);
    expect(requests.some((r) => r.method === "thread/resume" && r.params.threadId === authorThread)).toBe(true);
    const turnText = (r: Request) => (r.params.input as { type: string; text?: string }[]).map((i) => i.text ?? "").join("\n");
    const resumed = requests.filter((r) => r.method === "turn/start" && r.params.cwd === work.workspace!.worktreeRoot && turnText(r).startsWith(`Riprendi l'incarico ${work.id}`));
    expect(resumed).toHaveLength(1);
    const resumedText = turnText(resumed[0]!);
    expect(resumedText).toContain(`Rilievi bloccanti dei revisori sul candidato ${candidate.id}`);
    expect(resumedText).toContain("Prestazioni: Ciclo senza limite in NOTE.md (NOTE.md:2)");
    expect(await readFile(join(work.workspace!.worktreeRoot, "NOTE.md"), "utf8")).not.toContain("[rilievo-bloccante]");

    // The corrected work is a new candidate: every figure signs, the gate passes and the Coordinator's green light follows.
    delete process.env.FAKE_CODEX_GATE_HOLD;
    await controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    const corrected = document.candidates[1]!;
    const second = document.gates![1]!;
    expect(second).toMatchObject({ candidateId: corrected.id, status: "passed", returned: null });
    expect(corrected.technicalReview).toMatchObject({ verdict: "approved", gateId: second.id });
    expect(corrected.clearance).not.toBeNull();

    // Without a spec the spec reviewer does not run and says so in code-review's words.
    work.issueNumber = null;
    await controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    expect(document.gates![2]!.reviews.find((r) => r.role === "specReviewer")).toMatchObject({ status: "skipped", report: NO_SPEC, threadId: null });
  }, 120_000);

  it("lets a second review of the same candidate wait for the running gate instead of failing (issue #389)", async () => {
    const { document, decision } = await openTeam(await repository(false));
    const ada = findSpecialist(document, "Ada")!;
    await controller!.send("[assegna]", null, null, null);
    const work = ada.assignments[0]!;
    await until(() => work.status === "completed");
    // The reviewers answer only once the test lets them, as a gate that outlasts the provider's tool call.
    const hold = join(await mkdtemp(join(tmpdir(), "trama-hold-")), "go");
    process.env.FAKE_CODEX_GATE_HOLD = hold;
    const sent = controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    await until(() => (document.gates ?? []).length === 1 && document.gates![0]!.status === "reviewing");
    const candidate = document.candidates[0]!;
    // The Coordinator calls review_candidate again, as after its first call was cut off by the provider's timeout.
    const again = (controller as unknown as { reviewCandidate(id: string, requestId: string | null): Promise<TechnicalReview> }).reviewCandidate(candidate.id, null);
    await writeFile(hold, "");
    await sent;
    const review = await again;
    expect(document.gates).toHaveLength(1);
    expect(review).toMatchObject({ id: candidate.technicalReview!.id, gateId: document.gates![0]!.id, verdict: "approved" });
  });

  it("never sends a secret in the diff to a model: Trama's scan blocks the candidate and the developer gets it back", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const { document, decision } = await openTeam(await repository(false));
    await controller!.send("[assegna] [segreto]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "completed");
    const before = (await readLog(log)).length;
    await controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    const candidate = document.candidates[0]!;
    const gate = document.gates![0]!;
    expect(candidate.diff).toContain("sk-prova-0123456789abcdefghij");
    // No reviewer session opened, and no request after the declaration carries the key.
    expect(gate.reviews.filter((r) => r.threadId !== null)).toEqual([]);
    const after = (await readLog(log)).slice(before);
    expect(after.filter((r) => JSON.stringify(r).includes("sk-prova-0123456789abcdefghij"))).toEqual([]);
    expect(gate.status).toBe("blocked");
    expect(gate.reviews.find((r) => r.role === "security")!.findings).toEqual([expect.objectContaining({ severity: "blocking", title: "Segreto nel diff: chiave API in NOTE.md" })]);
    for (const role of ["specReviewer", "cleanCode", "performance", "ux", "devops", "documentation"]) {
      expect(gate.reviews.find((r) => r.role === role)).toMatchObject({ status: "skipped", report: secretNote() });
    }
    expect(candidate.technicalReview).toMatchObject({ verdict: "changesRequested", gateId: gate.id });
    expect(candidate.clearance).toBeNull();
    // The developer resumes with Trama's finding and writes the note without the key.
    expect(gate.returned).toMatchObject({ assignmentId: work.id, waiting: null });
    await until(() => work.turns.length === 2 && work.status === "completed");
    expect(await readFile(join(work.workspace!.worktreeRoot, "NOTE.md"), "utf8")).not.toContain("sk-prova");
  }, 120_000);

  it("keeps the findings until the developer is free, and sends them back at the next event of the work", async () => {
    const { document, decision } = await openTeam(await repository(false));
    await controller!.send("[assegna] [bloccante]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "completed");
    // Ada is at work on something else when the gate blocks: the findings wait, and the work stays completed.
    await controller!.send("[assegna] [lento]", null, null, null);
    const other = findSpecialist(document, "Ada")!.assignments.find((a) => a.id !== work.id)!;
    await until(() => other.status === "running");
    await controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    const gate = document.gates![0]!;
    expect(gate.status).toBe("blocked");
    expect(gate.returned).toMatchObject({ assignmentId: work.id, waiting: expect.stringContaining("altro incarico") });
    expect(work.status).toBe("completed");
    // The other work ends, an event of the work: the findings go back and Ada resumes.
    await controller!.stopSpecialistWork(other.id);
    await until(() => gate.returned?.waiting === null);
    await until(() => work.turns.length === 2 && work.status === "completed");
    expect(work.gateReturn).toMatchObject({ gateId: gate.id });
  }, 120_000);

  it("keeps the findings of a project the person left, and sends them back when it opens again", async () => {
    const repo = await repository(false);
    const { document, decision } = await openTeam(repo);
    await controller!.send("[assegna] [bloccante]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "completed");
    const hold = join(await mkdtemp(join(tmpdir(), "trama-hold-")), "go");
    process.env.FAKE_CODEX_GATE_HOLD = hold;
    const sent = controller!.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    await until(() => (document.gates ?? [])[0]?.reviews.find((r) => r.role === "performance")?.threadId != null);
    // The person opens another project while the reviewers work.
    await controller!.openProject(await repository(false));
    await writeFile(hold, "");
    await sent;
    // The gate goes on in the background with the project it belongs to.
    const gate = document.gates![0]!;
    await until(() => gate.returned !== null);
    expect(gate.status).toBe("blocked");
    expect(gate.returned).toMatchObject({ waiting: expect.stringContaining("non è aperto") });
    expect(work.status).toBe("completed");
    // Opened again, the project sends the findings back and Ada resumes in her worktree.
    await controller!.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const reopened = controller!.snapshot.project!.document;
    const reopenedGate = reopened.gates!.find((g) => g.id === gate.id)!;
    const reopenedWork = findSpecialist(reopened, "Ada")!.assignments.find((a) => a.id === work.id)!;
    await until(() => reopenedGate.returned?.waiting === null);
    await until(() => reopenedWork.turns.length === 2 && reopenedWork.status === "completed");
  }, 120_000);

  it("compares the suite on the base and on the candidate, and a regression blocks the candidate", async () => {
    const { document, decision } = await openTeam(await repository(true));
    await controller!.send("[assegna] [test-node]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    expect(work.requiredChecks).toEqual(["git_status", "node_test"]);
    await until(() => work.status === "completed");
    await controller!.send(`[candidato:${work.id}:${decision.id}:tutte]`, null, null, null);
    const candidate = document.candidates[0]!;
    const gate = document.gates![0]!;
    // Trama's own check fails on the candidate; on the base, in a detached checkout, the same suite passes.
    expect(candidate.evidence.node_test?.result).toBe("fail");
    expect(gate.suite).toEqual([{ check: "node_test", base: "pass", candidate: "fail", baseOutput: null }]);
    expect(gate).toMatchObject({ status: "blocked", checksFailed: ["node_test"], returned: null });
    expect(gate.reviews.find((r) => r.role === "regressionGuardian")!.findings).toEqual([expect.objectContaining({ severity: "blocking", title: "Regressione: test Node" })]);
    // The reviewers of the diff did not start; the debugger diagnoses the failure, marked as a regression (W11).
    expect(gate.reviews.filter((r) => r.threadId !== null)).toEqual([]);
    expect(document.duties!.failures.find((f) => f.candidateId === candidate.id && f.check === "node_test")).toMatchObject({ regression: true });
    expect(candidate.technicalReview).toMatchObject({ verdict: "changesRequested", gateId: gate.id });
    expect(candidate.clearance).toBeNull();
    // The base checkout is gone: only the project's own worktrees remain.
    const worktrees = await git(["worktree", "list", "--porcelain"], work.workspace!.worktreeRoot);
    expect(worktrees).not.toContain("/Gate/base-");
  }, 120_000);
});
