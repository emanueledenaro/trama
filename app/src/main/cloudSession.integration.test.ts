import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { TramaController } from "./controller";
import { grantMandate } from "./core/pact";
import { git } from "./core/process";
import { activeDevelopers, assign, confirmTeam, findAssignment, proposeTeam, stopOrphanedAssignments } from "./core/team";

/**
 * A19 (issue #260) with the controller. The cloud session is the declared fixture transport (`TRAMA_CLOUD_FIXTURE`):
 * no real session opens, the link is fixed. What runs for real: the choice of the place, the conditions read from git,
 * the assignment's branch and the count among the developers in parallel. No real provider turn starts: the local work
 * here runs on the fake Codex.
 */
const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.TRAMA_CLOUD_FIXTURE;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function project() {
  const data = await mkdtemp(join(tmpdir(), "trama-data-"));
  const base = await mkdtemp(join(tmpdir(), "trama-cloud-"));
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  await git(["init", "--bare", "-b", "main", origin], base, false);
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "chore: start"], repo, false);
  await git(["remote", "add", "origin", origin], repo, false);
  await git(["push", "-u", "origin", "main"], repo, false);
  process.env.TRAMA_CLOUD_FIXTURE = "1";
  controller = new TramaController(data, {
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
  const state = controller.snapshot.project!;
  state.github.repository = "acme/shop";
  const document = state.document;
  grantMandate(document, {
    objectives: ["Ordini"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree", "openPullRequest"],
    limits: [],
  });
  confirmTeam(document, proposeTeam(document, { requestId: null, summary: null, members: [{ name: "Ada", competence: "Ordini", reason: "r", moduleIds: ["Sources/Orders"] }] }).id, null, null);
  return { document };
}

function slice(document: ProjectDocument, provider: "claudeAgent" | "codex"): SpecialistAssignment {
  const assignment = assign(
    document,
    {
      specialist: "Ada",
      kind: "agreedTicket",
      objective: "Lo stato in revisione",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: provider === "codex" ? "gpt-6-luna" : "claude-sonnet-5",
      provider,
      tools: ["commands", "edits"],
      requiredChecks: ["git_status"],
      instructions: "Scrivi una nota",
    },
    1,
    null,
  );
  // The work of a slice (Q24): the plan itself is not needed to choose the place.
  assignment.slice = { planId: "P-1", sliceId: "S1" };
  return assignment;
}

describe("a slice in a Claude Code cloud session (A19)", () => {
  it("starts in the cloud in automatic, on the assignment's branch, and counts among the parallel developers", async () => {
    const { document } = await project();
    controller!.snapshot.providers.claudeAgent = { account: { kind: "authenticated", label: null }, models: [], checking: false };
    const assignment = slice(document, "claudeAgent");
    await controller!.startAssignment(assignment.id);
    const started = findAssignment(document, assignment.id)!;
    expect(started.place).toMatchObject({ where: "cloud", chosenBy: "coordinator" });
    expect(started.status).toBe("running");
    expect(started.workspace).toBeNull();
    expect(started.cloud).toMatchObject({ provider: "claudeAgent", status: "working", url: "https://claude.ai/code/session_fixture", baseBranch: "main" });
    expect(started.cloud!.branch).toMatch(/^feature\/lo-stato-in-revisione-trama-[0-9a-f]{8}$/);
    expect(activeDevelopers(document)).toBe(1);
    // Closing Trama does not stop it (Q28).
    expect(stopOrphanedAssignments(document, "crash")).toEqual([]);
    // The person stops it: Trama no longer follows the session.
    await controller!.stopSpecialistWork(assignment.id);
    expect(findAssignment(document, assignment.id)).toMatchObject({ status: "stopped", cloud: { status: "stopped" } });
  });

  it("keeps Codex work local with the reason and the step", async () => {
    const { document } = await project();
    const assignment = slice(document, "codex");
    const start = controller!.startAssignment(assignment.id);
    await until(() => findAssignment(document, assignment.id)!.place !== undefined);
    expect(findAssignment(document, assignment.id)!.place).toMatchObject({ where: "local", cloudBlocked: { reason: expect.stringMatching(/Codex Cloud/) } });
    await start;
    expect(findAssignment(document, assignment.id)!.cloud).toBeUndefined();
    expect(findAssignment(document, assignment.id)!.workspace).not.toBeNull();
  });

  it("offers the person's move before a resume and saves the project's setting", async () => {
    const { document } = await project();
    controller!.updateProjectSettings({ workPlace: "local" });
    expect(document.settings?.workPlace).toBe("local");
    expect(() => controller!.updateProjectSettings({ workPlace: "remote" as never })).toThrow(/Automatico/);
    const assignment = slice(document, "claudeAgent");
    controller!.moveAssignmentPlace(assignment.id, "cloud");
    expect(findAssignment(document, assignment.id)!.placeChoice).toBe("cloud");
  });
});
