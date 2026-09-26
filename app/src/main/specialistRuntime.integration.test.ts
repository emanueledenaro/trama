import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

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

/** HEAD, the index entries and the status of the project checkout. */
async function checkoutState(repo: string): Promise<string[]> {
  return Promise.all([
    git(["rev-parse", "HEAD"], repo),
    git(["ls-files", "--stage"], repo),
    git(["--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=all"], repo),
  ]);
}

describe("specialist runtime (V04)", () => {
  it("runs the assignment in a thread Trama owns, in its worktree without network, and resumes it with the model the person chose", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const requests = async (): Promise<Request[]> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Request);
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
    // The AI Hero method is still being written into the checkout after the project is ready: wait for it to finish,
    // or the snapshot below catches half an installation (it raced with the presence work G01 starts on open).
    await until(() => document.events.some((e) => e.content.type === "activity" && e.content.title.startsWith("Metodo di lavoro AI Hero")));
    const before = await checkoutState(repo);

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
    // "[lento:sempre]": the resumed turn too runs until stopped, so the stop below never races its end.
    await controller.send("[assegna] [lento:sempre]", null, null, null);
    const specialist = findSpecialist(document, "Ada")!;
    const assignment = specialist.assignments[0]!;
    await until(() => assignment.status === "running");
    const worktree = assignment.workspace!.worktreeRoot;
    expect(worktree.startsWith(repo)).toBe(false);
    expect(assignment.workspace!.branch).toMatch(/^feature\/[a-z0-9-]+-trama-[0-9a-f]{8}$/);

    // Its own thread, distinct from the Coordinator's, opened in the worktree with the Coordinator's instructions.
    const opened = (await requests()).filter((r) => r.method === "thread/start" && r.params.cwd === worktree);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.params).toMatchObject({ model: assignment.model, sandbox: "workspace-write", approvalPolicy: "never" });
    expect(opened[0]!.params.developerInstructions).toContain("Instructions from the Coordinator:\n[lento:sempre] Scrivi una nota");
    expect(assignment.threadId).toBeTruthy();
    expect(assignment.threadId).not.toBe(document.coordinator.threadId);
    // The turn writes only in the worktree, without network.
    const turn = (await requests()).filter((r) => r.method === "turn/start" && r.params.cwd === worktree).at(-1)!;
    expect(turn.params.model).toBe(assignment.model);
    expect(turn.params.sandboxPolicy).toMatchObject({ type: "workspaceWrite", writableRoots: [worktree], networkAccess: false });
    await until(() => existsSync(join(worktree, "NOTE.md")));

    // Stop: first requested, then confirmed when the turn ends; the turn and its history stay.
    await controller.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped");
    const stop = assignment.stops[0]!;
    expect(stop.requestedBy).toBe("Persona");
    expect(stop.confirmedAt! >= stop.requestedAt).toBe(true);
    expect(assignment.turns[0]).toMatchObject({ number: 1, outcome: "interrupted" });

    // The person picks another model: the next turn runs with it, in the same worktree and on the same thread.
    await controller.changeAssignmentProvider(assignment.id, "codex", "gpt-5.5-fast");
    const thread = assignment.threadId;
    await controller.resumeSpecialistWork(assignment.id);
    await until(() => assignment.status === "running" && assignment.turns.length === 2);
    expect(assignment.workspace!.worktreeRoot).toBe(worktree);
    const resumed = (await requests()).filter((r) => r.method === "thread/resume").at(-1)!;
    expect(resumed.params).toMatchObject({ threadId: thread, cwd: worktree, model: "gpt-5.5-fast", sandbox: "workspace-write" });
    const second = (await requests()).filter((r) => r.method === "turn/start" && r.params.cwd === worktree).at(-1)!;
    expect(second.params).toMatchObject({ model: "gpt-5.5-fast", sandboxPolicy: { type: "workspaceWrite", writableRoots: [worktree], networkAccess: false } });
    expect(assignment.turns[1]).toMatchObject({ number: 2, model: "gpt-5.5-fast" });
    await controller.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped");
    expect(assignment.turns.map((t) => t.outcome)).toEqual(["interrupted", "interrupted"]);

    // The project checkout and its index are exactly as before.
    expect(existsSync(join(repo, "NOTE.md"))).toBe(false);
    expect(await checkoutState(repo)).toEqual(before);
  }, 30_000);
});
