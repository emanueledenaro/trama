import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { NO_SPEC } from "./core/audit";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_CODEX_AUDIT_GATE;
  delete process.env.FAKE_CODEX_LOG_CHECKS;
  delete process.env.FAKE_CODEX_LIGHT_MODEL;
});

async function until(check: () => boolean, timeout = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: Record<string, unknown> };

const notified: { title: string; body: string }[] = [];
const host = {
  publish: () => undefined,
  openExternal: async () => undefined,
  applyTheme: () => undefined,
  notify: (title: string, body: string) => void notified.push({ title, body }),
  setOpenAtLogin: () => undefined,
  aiHeroResourceDirectory: join(root, "resources/AIHero"),
  demoResourceDirectory: "",
  codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
};

describe("focus mode on a candidate (F01)", () => {
  it("runs the real checks, then code-review's two axes in parallel and read-only, and keeps the report after a restart", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    // A light model in the catalogue: the axes run on it, and the Coordinator's model is the stronger one (F02).
    process.env.FAKE_CODEX_LIGHT_MODEL = "gpt-5.5-mini";
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    const dataDir = await mkdtemp(join(tmpdir(), "trama-data-"));
    controller = new TramaController(dataDir, host);
    await controller.start();
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const project = controller.snapshot.project!;
    const document = project.document;

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
    await controller.send("[assegna]", null, null, null);
    const work = specialist.assignments[0]!;
    await until(() => work.status === "completed");
    await controller.send(`[candidato:${work.id}:${decision.id}:tutte]`, null, null, null);
    const candidate = document.candidates[0]!;
    // The assignment's issue is the spec the Spec axis reads (skill step 2).
    work.issueNumber = 12;
    project.github.issues.push({ number: 12, title: "Annullare un ordine pagato", state: "open", body: "Un ordine pagato annullato va in revisione.", url: "u", author: null, labels: [], updatedAt: "" });
    const checksBefore = (await readFile(log, "utf8")).length;
    const untouched = JSON.parse(JSON.stringify({ evidence: candidate.evidence, clearance: candidate.clearance, humanApproval: candidate.humanApproval }));

    // The fake axes answer only once the test opens their gate: the test sees the examination while it runs.
    const gates = await mkdtemp(join(tmpdir(), "trama-gates-"));
    process.env.FAKE_CODEX_AUDIT_GATE = join(gates, "first");
    // The end of each check joins the request log, so the log shows what ran before what.
    process.env.FAKE_CODEX_LOG_CHECKS = "1";
    const auditLog = async () =>
      (await readFile(log, "utf8"))
        .slice(checksBefore)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Request);
    const auditId = controller.startFocusAudit(candidate.id);
    const audit = document.audits!.find((a) => a.id === auditId)!;
    expect(audit).toMatchObject({ target: { kind: "candidate", candidateId: candidate.id }, fixedPoint: candidate.baseSHA, status: "checking" });
    expect(() => controller!.startFocusAudit(candidate.id)).toThrow("già in corso");

    // Two axes, each its own session, both with a turn started while neither can answer: they run at once.
    await until(() => audit.standards.threadId !== null && audit.spec.threadId !== null);
    const axisThreads = [audit.standards.threadId!, audit.spec.threadId!];
    expect(axisThreads[0]).not.toBe(axisThreads[1]);
    const turnStarted = (entries: Request[], threadId: string) => entries.findIndex((r) => r.method === "turn/start" && r.params.threadId === threadId);
    let entries = await auditLog();
    for (const start = Date.now(); axisThreads.some((threadId) => turnStarted(entries, threadId) < 0); entries = await auditLog()) {
      if (Date.now() - start > 15_000) throw new Error("timeout: both axis turns never started");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(audit).toMatchObject({ status: "reviewing", standards: { status: "running", finishedAt: null }, spec: { status: "running", finishedAt: null } });
    // The real checks came first, in the sandbox, as Trama's evidence on this snapshot: every check ended before either axis opened.
    expect(candidate.requiredChecks.length).toBeGreaterThan(0);
    expect(audit.checks.map((c) => [c.check, c.result, c.snapshotId])).toEqual(candidate.requiredChecks.map((check) => [check, "pass", candidate.snapshotId]));
    const checksEnded = entries.flatMap((r, index) => (r.method === "sandbox/ended" ? [index] : []));
    const axesOpened = entries.flatMap((r, index) =>
      r.method === "thread/start" && String(r.params.developerInstructions).includes("reviewer of focus mode") ? [index] : [],
    );
    expect(checksEnded).toHaveLength(candidate.requiredChecks.length);
    expect(axesOpened).toHaveLength(2);
    // Both axes open under the read-only profile; the turns then leave it unnamed (Codex 0.155).
    for (const index of axesOpened) expect(entries[index]!.params).toMatchObject({ permissions: "trama_read" });
    expect(Math.max(...checksEnded)).toBeLessThan(Math.min(...axesOpened));
    await writeFile(join(gates, "first"), "");
    await until(() => audit.status === "done");

    expect(audit.specSource).toBe("Issue #12");
    expect(audit.standards).toMatchObject({ status: "done", findings: 1, worst: expect.stringContaining("Mysterious Name") });
    expect(audit.spec).toMatchObject({ status: "done", findings: 2 });
    expect(audit.standards.report).toContain(`git diff ${candidate.baseSHA}`);
    expect(audit.spec.report).toContain("Fonte: Issue #12");
    expect(audit.summary).toBe(
      `Standards: 1 rilievo, il più grave: Possibile Mysterious Name in ${candidate.changedFiles[0]}. Spec: 2 rilievi, il più grave: Il criterio sull'ordine non pagato non ha un test.`,
    );
    // F02: each finding ends in one of three states. Trama reread the line the Standards axis named; the stronger model
    // confirmed the serious Spec finding Trama could not run; the minor one, whose command is not one of Trama's checks,
    // stays a hypothesis.
    expect(audit.standards.model).toBe("gpt-5.5-mini");
    expect(audit.standards.items).toEqual([
      expect.objectContaining({ status: "verified", evidence: { kind: "fileLine", file: candidate.changedFiles[0], line: 1, quote: expect.stringMatching(/\S/) }, confirmation: null }),
    ]);
    const [serious, minor] = audit.spec.items!;
    expect(serious).toMatchObject({ severity: "serious", status: "confirmed", confirmation: { model: "gpt-5.5", confirmed: true } });
    expect(minor).toMatchObject({ severity: "minor", status: "hypothesis", evidence: { kind: "command", command: "make check" } });
    const confirmations = (await auditLog()).filter((r) => r.method === "thread/start" && String(r.params.developerInstructions).includes("second reader of focus mode"));
    expect(confirmations.map((r) => r.params)).toEqual([expect.objectContaining({ model: "gpt-5.5", cwd: work.workspace!.worktreeRoot, ephemeral: true })]);
    const requests = (await readFile(log, "utf8"))
      .slice(checksBefore)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Request);
    const skillPath = join(root, "resources/AIHero/skills/code-review/SKILL.md");
    for (const threadId of [audit.standards.threadId, audit.spec.threadId]) {
      const turn = requests.find((r) => r.method === "turn/start" && r.params.threadId === threadId)!;
      // The review thread runs under its read-only profile; the turn does not name it again (Codex 0.155).
      expect(turn.params).toMatchObject({ cwd: work.workspace!.worktreeRoot });
      expect(turn.params).not.toHaveProperty("permissions");
      expect(turn.params).not.toHaveProperty("sandboxPolicy");
      const input = turn.params.input as { type: string; name?: string; path?: string; text?: string }[];
      expect(input).toContainEqual(expect.objectContaining({ type: "skill", name: "code-review", path: skillPath }));
      expect(input[0]!.text).toContain("## Trama binding for the code-review skill");
    }
    // The candidate itself is untouched: focus mode reads only, and its checks leave evidence, green light and approval as they are.
    expect(JSON.parse(JSON.stringify({ evidence: candidate.evidence, clearance: candidate.clearance, humanApproval: candidate.humanApproval }))).toEqual(untouched);
    expect(candidate.pullRequest).toBeNull();

    // Without a spec the Spec axis does not run and says so in the skill's words.
    work.issueNumber = null;
    process.env.FAKE_CODEX_AUDIT_GATE = join(gates, "second");
    const secondId = controller.startFocusAudit(candidate.id);
    const second = document.audits!.find((a) => a.id === secondId)!;
    // The person leaves the project during the examination: the project stays loaded until it ends, and opens again with it.
    const other = await mkdtemp(join(tmpdir(), "trama-other-"));
    await cp(join(root, "resources/DemoProject"), other, { recursive: true });
    await git(["init", "-b", "main"], other, false);
    await controller.openProject(other);
    expect(second.status).not.toBe("done");
    expect(controller.snapshot.backgroundProjects.map((p) => p.id)).toContain(project.id);
    await writeFile(join(gates, "second"), "");
    await until(() => second.status === "done");
    await until(() => !controller!.snapshot.backgroundProjects.some((p) => p.id === project.id));
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    expect(controller.snapshot.project!.document.audits!.find((a) => a.id === secondId)).toMatchObject({ status: "done" });
    expect(second.specSource).toBeNull();
    expect(second.spec).toMatchObject({ status: "skipped", report: NO_SPEC, threadId: null });
    expect(second.summary).toContain(`Spec: ${NO_SPEC}.`);

    // The report is saved in the project and opens again after a restart.
    const saved = JSON.parse(JSON.stringify(document.audits));
    await controller.stop();
    controller = new TramaController(dataDir, host);
    await controller.start();
    await until(() => controller!.snapshot.project?.phase.kind === "ready" || controller!.snapshot.project?.phase.kind === "unavailable");
    expect(controller.snapshot.project!.document.audits).toEqual(saved);
  }, 60_000);
});

describe("focus mode on a module or the whole project, full screen (F03)", () => {
  it("fails clearly on a bad fixed point or an empty diff, examines the module from the person's point, and holds notifications while the work goes on", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    process.env.FAKE_CODEX_LIGHT_MODEL = "gpt-5.5-mini";
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    // Without Package.swift the checkout's checks are git's own: the fake Codex runs checks for real, and a runner with
    // Swift would build and test the package before the axes open.
    await rm(join(repo, "Package.swift"));
    const commit = (message: string) => git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", message], repo, false);
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await commit("init");
    const orders = join(repo, "Sources/Orders", (await readdir(join(repo, "Sources/Orders")))[0]!);
    await writeFile(orders, `${await readFile(orders, "utf8")}\n// Paid orders go to review.\n`);
    await git(["add", "."], repo, false);
    await commit("feat: send paid orders to review (#12)");
    const dataDir = await mkdtemp(join(tmpdir(), "trama-data-"));
    controller = new TramaController(dataDir, host);
    await controller.start();
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const project = controller.snapshot.project!;
    const document = project.document;

    // Step 1 of code-review happens before anything starts: a point that does not exist, or no change, is a clear error.
    await expect(controller.startScopedFocusAudit({ kind: "project" }, "release-9")).rejects.toThrow('Il punto fisso "release-9" non esiste in questo repository');
    await expect(controller.startScopedFocusAudit({ kind: "module", moduleId: "Sources/Payments" }, "HEAD~1")).rejects.toThrow("Nessun cambiamento nel modulo Payments");
    await expect(controller.startScopedFocusAudit({ kind: "project" }, "HEAD")).rejects.toThrow("Nessun cambiamento tra il punto fisso");
    expect(document.audits ?? []).toEqual([]);
    expect(await controller.focusFixedPoints()).toEqual(["HEAD~1"]);

    const gates = await mkdtemp(join(tmpdir(), "trama-gates-"));
    process.env.FAKE_CODEX_AUDIT_GATE = join(gates, "module");
    // The issue the commit cites is the Spec. A later reading of GitHub replaces the list, so it goes in just before
    // the examination reads it, and the rest of the test starts only once both axes are open.
    await until(() => project.github.status !== "loading");
    project.github.issues.push({ number: 12, title: "Ordini pagati in revisione", state: "open", body: "Un ordine pagato annullato va in revisione.", url: "u", author: null, labels: [], updatedAt: "" });
    const auditId = await controller.startScopedFocusAudit({ kind: "module", moduleId: "Sources/Orders" }, "HEAD~1");
    const audit = document.audits!.find((a) => a.id === auditId)!;
    expect(audit).toMatchObject({
      target: { kind: "module", moduleId: "Sources/Orders", moduleName: "Orders", path: "Sources/Orders" },
      fixedPointRef: "HEAD~1",
      fixedPoint: (await git(["rev-parse", "HEAD~1"], repo)).trim(),
      snapshotId: (await git(["rev-parse", "HEAD"], repo)).trim(),
      changedFiles: [orders.slice(repo.length + 1)],
    });
    expect(audit.commits).toEqual([expect.stringContaining("feat: send paid orders to review (#12)")]);

    // Full screen: the person is in focus mode, and notifications wait until they leave it.
    controller.enterFocusMode(auditId);
    expect(controller.snapshot.focusMode).toEqual({ projectId: project.id, auditId, pausedNotifications: 0 });
    const notify = (title: string) => (controller as unknown as { notify(title: string, body: string): void }).notify(title, "dettaglio");
    notify("Trama: conflitto tra due worktree");
    expect(notified).toEqual([]);
    expect(controller.snapshot.focusMode?.pausedNotifications).toBe(1);
    // The checks ran on the checkout at the pinned HEAD; both axes are open and wait for their gate.
    await until(() => audit.standards.threadId !== null && audit.spec.threadId !== null);
    expect(audit.specSource).toBe("Issue #12 citata nei commit");
    expect(audit.checks.map((c) => [c.check, c.result])).toEqual([
      ["git_status", "pass"],
      ["git_diff_check", "pass"],
    ]);

    // The authorized work goes on while focus mode is open.
    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller.send("[assegna]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "completed");
    expect(controller.snapshot.focusMode?.auditId).toBe(auditId);
    expect(audit.status).toBe("reviewing");

    // The axes read the project; the Spec axis read the issue a commit cites.
    await writeFile(join(gates, "module"), "");
    await until(() => audit.status === "done");
    expect(audit.checks.length).toBeGreaterThan(0);
    expect(audit.checks.every((c) => c.snapshotId === audit.snapshotId)).toBe(true);
    expect(audit.standards.report).toContain(`git diff ${audit.fixedPoint}`);
    expect(audit.standards.items).toEqual([expect.objectContaining({ status: "verified" })]);
    const requests = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Request);
    const axisTurn = requests.find((r) => r.method === "turn/start" && r.params.threadId === audit.standards.threadId)!;
    expect(axisTurn.params).toMatchObject({ cwd: repo });
    const text = (axisTurn.params.input as { text?: string }[])[0]!.text!;
    expect(text).toContain("the person opened focus mode on the module `Sources/Orders` of the project");
    expect(text).toContain("Focus mode, asse Standards del modulo Orders (`Sources/Orders`).");

    // Leaving focus mode delivers what waited; several notifications arrive as one summary.
    controller.exitFocusMode();
    expect(controller.snapshot.focusMode).toBeNull();
    expect(notified).toEqual([{ title: "Trama: conflitto tra due worktree", body: "dettaglio" }]);
    controller.enterFocusMode(auditId);
    notify("Trama: conflitto con #4");
    notify("Trama: aggiornamenti condivisi");
    controller.exitFocusMode();
    expect(notified.at(-1)).toEqual({
      title: "Trama: novità durante l'esame approfondito",
      body: "2 notifiche sono arrivate durante l'esame approfondito: conflitto con #4; aggiornamenti condivisi.",
    });
    expect(notified).toHaveLength(2);
    notify("Trama: dopo");
    expect(notified).toHaveLength(3);
  }, 60_000);
});
