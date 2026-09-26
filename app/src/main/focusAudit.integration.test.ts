import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
});

async function until(check: () => boolean, timeout = 15_000): Promise<void> {
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

describe("focus mode on a candidate (F01)", () => {
  it("runs the real checks, then code-review's two axes in parallel and read-only, and keeps the report after a restart", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
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
    const auditId = controller.startFocusAudit(candidate.id);
    const audit = document.audits!.find((a) => a.id === auditId)!;
    expect(audit).toMatchObject({ target: { kind: "candidate", candidateId: candidate.id }, fixedPoint: candidate.baseSHA, status: "checking" });
    expect(() => controller!.startFocusAudit(candidate.id)).toThrow("già in corso");

    // Two axes, each its own session, both open and running at once: neither can answer until the gate opens.
    await until(() => audit.standards.threadId !== null && audit.spec.threadId !== null);
    expect(audit).toMatchObject({ status: "reviewing", standards: { status: "running" }, spec: { status: "running" } });
    expect(audit.standards.threadId).not.toBe(audit.spec.threadId);
    // The real checks came first, in the sandbox, as Trama's evidence on this snapshot: all of them ended before the axes started.
    expect(candidate.requiredChecks.length).toBeGreaterThan(0);
    expect(audit.checks.map((c) => [c.check, c.result, c.snapshotId])).toEqual(candidate.requiredChecks.map((check) => [check, "pass", candidate.snapshotId]));
    await writeFile(join(gates, "first"), "");
    await until(() => audit.status === "done");

    expect(audit.specSource).toBe("Issue #12");
    expect(audit.standards).toMatchObject({ status: "done", findings: 1, worst: expect.stringContaining("Mysterious Name") });
    expect(audit.spec).toMatchObject({ status: "done", findings: 1 });
    expect(audit.standards.report).toContain(`git diff ${candidate.baseSHA}`);
    expect(audit.spec.report).toContain("Fonte: Issue #12");
    expect(audit.summary).toBe(
      `Standards: 1 rilievo, il più grave: Possibile Mysterious Name in ${candidate.changedFiles[0]}. Spec: 1 rilievo, il più grave: Il criterio sull'ordine non pagato non ha un test.`,
    );
    const requests = (await readFile(log, "utf8"))
      .slice(checksBefore)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Request);
    const skillPath = join(root, "resources/AIHero/skills/code-review/SKILL.md");
    for (const threadId of [audit.standards.threadId, audit.spec.threadId]) {
      const turn = requests.find((r) => r.method === "turn/start" && r.params.threadId === threadId)!;
      expect(turn.params).toMatchObject({ cwd: work.workspace!.worktreeRoot, sandboxPolicy: { type: "readOnly", networkAccess: false } });
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
