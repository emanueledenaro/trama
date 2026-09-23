import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { git } from "./core/process";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("team flow", () => {
  it("proposes, confirms, assigns within the mandate and stops work", async () => {
    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
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
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const project = controller.snapshot.project!;
    const document = project.document;

    await controller.send("[proponi-team]", null, null, null);
    const proposal = document.team.proposals[0]!;
    expect(proposal.members[0]!.name).toBe("Ada");
    await controller.answerTeamProposal(proposal.id, null, null);
    expect(document.team.specialists.map((s) => s.name)).toEqual(["Ada"]);

    // Without a mandate the assignment is refused and nothing starts.
    await controller.send("[assegna]", null, null, null);
    expect(document.events.at(-1)!.content).toMatchObject({ text: expect.stringContaining("mandate_missing") });

    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller.send("[assegna]", null, null, null);
    const specialist = document.team.specialists[0]!;
    const assignment = specialist.assignments[0]!;
    await until(() => assignment.status === "completed");
    expect(assignment.result).toBe("Ho scritto NOTE.md nel worktree.");
    expect(existsSync(join(assignment.workspace!.worktreeRoot, "NOTE.md"))).toBe(true);
    expect(existsSync(join(repo, "NOTE.md"))).toBe(false);
    expect(document.events.some((e) => e.assignmentId === assignment.id && e.content.type === "activity" && e.content.title === "Incarico concluso")).toBe(
      true,
    );

    // Candidate: declared on the finished work, verified, reviewed and cleared within the mandate.
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
    await controller.send(`[candidato:${assignment.id}:${decision.id}]`, null, null, null);
    const candidate = document.candidates[0]!;
    expect(candidate.changedFiles).toEqual(["NOTE.md"]);
    expect(candidate.evidence.git_status?.result).toBe("pass");
    expect(candidate.technicalReview?.verdict).toBe("approved");
    expect(candidate.technicalReview?.reviewerThreadId).not.toBe(assignment.threadId);
    expect(candidate.clearance).not.toBeNull();
    expect(controller.snapshot.project!.candidateReports[candidate.id]?.state).toBe("decided");
    await controller.approveCandidateByPerson(candidate.id);
    expect(candidate.humanApproval?.actor).toBe("Persona");
    await expect(controller.publishCandidateByPerson(candidate.id)).rejects.toThrow(/remoto GitHub/);

    // The next message carries the team report once.
    expect(assignment.reportedStatus).toBe("completed");

    await controller.send("[assegna] [lento]", null, null, null);
    const slow = specialist.assignments[1]!;
    await until(() => slow.status === "running");
    await controller.stopSpecialistWork(slow.id);
    await until(() => slow.status === "stopped");
    expect(slow.stops[0]!.confirmedAt).not.toBeNull();
    expect(specialist.status).toBe("stopped");
  }, 30_000);

  it("runs a read-only check for the Coordinator", async () => {
    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
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
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    await controller.send("[verifica]", null, null, null);
    const titles = controller.snapshot.project!.document.events.flatMap((e) => (e.content.type === "activity" ? [e.content.title] : []));
    expect(titles).toContain("Verifica stato Git: superata");
  });
});

describe("switching project (C07)", () => {
  it("keeps the previous project's authorized work running and its history separate", async () => {
    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    const makeRepo = async () => {
      const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
      await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
      await git(["init", "-b", "main"], repo, false);
      await git(["add", "."], repo, false);
      await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
      return repo;
    };
    const first = await makeRepo();
    const second = await makeRepo();
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
    await controller.openProject(first);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const document = controller.snapshot.project!.document;
    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    await controller.grantMandate({
      requestId: null,
      objectives: ["Nota"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller.send("[assegna] [lento]", null, null, null);
    const assignment = document.team.specialists[0]!.assignments[0]!;
    await until(() => assignment.status === "running");
    const eventsBefore = document.events.length;

    await controller.openProject(second);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const other = controller.snapshot.project!;
    expect(other.rootPath).not.toBe(controller.snapshot.backgroundProjects[0]?.rootPath);
    expect(controller.snapshot.backgroundProjects).toMatchObject([{ runningAssignments: 1 }]);
    expect(assignment.status).toBe("running");
    expect(other.document.events.some((e) => e.assignmentId === assignment.id)).toBe(false);
    expect(other.runningWork).toEqual([]);

    await controller.openProject(first);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    expect(controller.snapshot.project!.document).toBe(document);
    expect(controller.snapshot.backgroundProjects).toEqual([]);
    expect(document.events.length).toBeGreaterThanOrEqual(eventsBefore);
    await controller.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped");
  }, 30_000);
});
