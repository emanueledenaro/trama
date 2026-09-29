import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activityLog } from "@shared/activity";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { developers, findSpecialist } from "./core/team";
import { sliceViews } from "./core/slices";
import { workState } from "./core/workPhase";
import { translator } from "@shared/i18n";

const t = translator("it");

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
    // This flow is the manual one: the Coordinator moves only when asked (W04 is off).
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const project = controller.snapshot.project!;
    const document = project.document;

    await controller.send("[proponi-team]", null, null, null);
    const proposal = document.team.proposals[0]!;
    expect(proposal.members[0]!.name).toBe("Ada");
    await controller.answerTeamProposal(proposal.id, null, null);
    expect(developers(document).map((s) => s.name)).toEqual(["Ada"]);

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
    const specialist = findSpecialist(document, "Ada")!;
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
    // With a GitHub remote, the mandate without openPullRequest still stops the push, visibly (issue #273).
    project.github.repository = "o/r";
    await expect(controller.publishCandidateByPerson(candidate.id)).rejects.toThrow(/mandato non permette di aprire pull request/);
    expect(document.events.at(-1)!.content).toMatchObject({ type: "activity", title: "Pubblicazione fermata dal mandato", tone: "error" });
    expect((document.events.at(-1)!.content as { detail: string }).detail).toContain(assignment.workspace!.branch);
    expect((await git(["rev-list", `${assignment.workspace!.baseSHA}..HEAD`], assignment.workspace!.worktreeRoot)).trim()).toBe("");
    expect(controller.snapshot.project!.candidateReports[candidate.id]?.quality?.find((i) => i.code === "MANDATE")?.passed).toBe(false);
    project.github.repository = null;

    // The next message carries the team report once.
    expect(assignment.reportedStatus).toBe("completed");

    await controller.send("[assegna] [lento]", null, null, null);
    const slow = specialist.assignments[1]!;
    await until(() => slow.status === "running");
    await controller.stopSpecialistWork(slow.id);
    await until(() => slow.status === "stopped");
    expect(slow.stops[0]!.confirmedAt).not.toBeNull();
    expect(specialist.status).toBe("stopped");
    // With continuous work off, Trama never started a move by itself.
    expect(document.requests.some((r) => r.step?.by === "trama")).toBe(false);
  }, 30_000);

  it("goes on by itself within the mandate and asks the person only for what is theirs (W04)", async () => {
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
    await until(() => controller!.snapshot.project?.phase.kind === "ready", 30_000);
    const project = controller.snapshot.project!;
    const document = project.document;
    const automatic = () => document.requests.filter((r) => r.step?.by === "trama");
    const idle = () => until(() => project.runningRequestId === null && !controller!.snapshot.project!.queuedMessages.length, 20_000);

    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    await controller.grantMandate({
      requestId: null,
      objectives: ["Ordini in revisione"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["plan", "executeInWorktree"],
      limits: [],
    });
    await controller.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
    for (const question of [...document.decisionRequests]) await controller.answerDecision(question.id, 1, null);
    // Every question is answered: within the mandate the Coordinator confirms the shared understanding by itself (A06).
    await until(() => (document.autonomousSteps ?? []).some((s) => s.move === "confirmUnderstanding"), 20_000);
    expect(document.requests.some((r) => r.step?.move === "confirmUnderstanding")).toBe(false);

    // Trama starts the plan by itself: a line in the chat, not a message of the person.
    await until(() => document.plans.length === 1, 20_000);
    const plan = document.plans[0]!;
    const planning = automatic()[0]!;
    await until(() => planning.state === "completed", 20_000);
    expect(planning).toMatchObject({ text: "Prepara il piano.", step: { move: "preparePlan", by: "trama" }, state: "completed" });
    expect(plan.requestId).toBe(planning.id);
    const line = document.events.find((e) => e.requestId === planning.id && e.content.type === "card");
    expect(line?.content).toMatchObject({ kind: "automaticStep", title: "Prepara il piano", referenceId: planning.id });
    expect(document.events.some((e) => e.requestId === planning.id && e.content.type === "personMessage")).toBe(false);
    const sent = document.events.find((e) => e.requestId === planning.id && e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore");
    expect(sent?.content).toMatchObject({ detail: expect.stringContaining("mossa automatica: Prepara il piano") });

    // The seams to-spec proposes (M04) and the slices to-tickets proposes (M05) are confirmed by the Coordinator within the
    // mandate, each recorded as its own step and told in Activity (A06): the person pressed no button.
    await until(() => plan.slicing?.status === "approved", 30_000);
    expect(plan.spec!.seamsAnswer).toMatchObject({ confirmed: true, by: "coordinator" });
    expect(plan.slicing!.approvedBy).toBe("coordinator");
    // The squads came with the team the person confirmed (A10): one for the area of Ada's module.
    expect((document.autonomousSteps ?? []).map((s) => s.move)).toEqual(["formSquads", "confirmUnderstanding", "confirmSeams", "confirmSlices"]);
    expect(document.team.squads?.map((s) => [s.name, s.moduleIds, s.developerIds])).toEqual([["Orders", ["Sources/Orders"], [findSpecialist(document, "Ada")!.id]]]);
    // Activity tells them from the records; the chat keeps no line for them (Q6).
    const told = activityLog(t, document.requests, document.events, [], [], document.autonomousSteps).filter((e) => e.kind === "step").map((e) => e.label);
    expect(told).toEqual([
      "Fette confermate dal Coordinatore",
      "Seam confermati dal Coordinatore",
      "Comprensione confermata dal Coordinatore",
      "Squadre formate dal Coordinatore",
    ]);
    expect(document.events.some((e) => e.content.type === "activity" && /dal Coordinatore$/.test(e.content.title))).toBe(false);

    // Then Trama assigns the first unblocked slice, and once Ada ends it runs the checks and the review, up to the person's candidate.
    const specialist = findSpecialist(document, "Ada")!;
    await until(() => document.candidates[0]?.technicalReview?.verdict === "approved", 30_000);
    expect(automatic().map((r) => r.step!.move).slice(0, 3)).toEqual(["preparePlan", "assignWork", "verifyCandidate"]);
    const first = specialist.assignments[0]!;
    expect(first.requestId).toBe(automatic()[1]!.id);
    expect(first.slice).toEqual({ planId: plan.id, sliceId: "S1" });
    expect(document.candidates[0]!.evidence.git_status?.result).toBe("pass");
    // The verified slice unblocks the two that depended on it, and Ada, free again, takes the next one in autonomy (W08):
    // no Coordinator turn assigns it. S3 is on the same module, so it waits for S2.
    await until(() => specialist.assignments.some((a) => a.slice?.sliceId === "S2"), 20_000);
    const picked = specialist.assignments.find((a) => a.slice?.sliceId === "S2")!;
    expect(picked).toMatchObject({
      selfPicked: true,
      requestId: plan.requestId,
      moduleIds: ["Sources/Orders"],
      dependencies: [first.id],
      requiredChecks: first.requiredChecks,
      seams: first.seams,
    });
    expect(document.events.some((e) => e.content.type === "activity" && e.content.title === "Ada prende in autonomia la fetta S2")).toBe(true);
    expect(sliceViews(document, plan)[0]!.state).toBe("done");
    await controller.updateSettings({ continuousWork: false });
    await idle();
  }, 60_000);

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
    const assignment = findSpecialist(document, "Ada")!.assignments[0]!;
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

describe("switching project with shared capacity (issue #39)", () => {
  const makeRepo = async (remote: string | null = null) => {
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    if (remote) await git(["remote", "add", "origin", remote], repo, false);
    return repo;
  };
  const makeController = async (data?: string) => {
    data ??= await mkdtemp(join(tmpdir(), "trama-data-"));
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
    return data;
  };
  const open = async (repo: string) => {
    await controller!.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    return controller!.snapshot.project!;
  };
  const teamWithMandate = async () => {
    const document = controller!.snapshot.project!.document;
    await controller!.send("[proponi-team]", null, null, null);
    await controller!.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    await controller!.grantMandate({
      requestId: null,
      objectives: ["Nota"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    return document;
  };

  it("queues work beyond the shared limit and starts it in its own project when a slot frees up", async () => {
    await makeController();
    await controller!.updateSettings({ sharedDevelopers: 1 });
    const first = await makeRepo();
    const second = await makeRepo();
    const a = await open(first);
    const firstDocument = await teamWithMandate();
    await controller!.send("[assegna] [lento]", null, null, null);
    const running = findSpecialist(firstDocument, "Ada")!.assignments[0]!;
    await until(() => running.status === "running");

    const b = await open(second);
    const secondDocument = await teamWithMandate();
    await controller!.send("[assegna] [lento]", null, null, null);
    const waiting = findSpecialist(secondDocument, "Ada")!.assignments[0]!;
    await until(() => secondDocument.events.some((e) => e.assignmentId === waiting.id && e.content.type === "activity" && e.content.title === "In attesa di uno sviluppatore libero"));
    expect(waiting.status).toBe("preparing");
    expect(controller!.snapshot.sharedCapacity).toEqual({ running: 1, limit: 1, waiting: 1 });
    // Opening projects never ranks them: the order stays the Product Owner's.
    expect(controller!.snapshot.settings.projectPriority).toBeUndefined();

    // Back in the first project, the second one keeps its place in line in the background.
    await open(first);
    expect(controller!.snapshot.backgroundProjects.map((p) => p.id)).toEqual([b.id]);
    const overview = await controller!.projectsOverview();
    expect(overview.find((o) => o.id === b.id)).toMatchObject({ waitingForCapacity: 1, attention: "running", ci: null });
    expect(overview.map((o) => o.priority).sort()).toEqual([1, 2]);

    // The freed slot goes to the second project's work, which runs and writes in its own history.
    await controller!.stopSpecialistWork(running.id);
    await until(() => running.status === "stopped");
    await until(() => waiting.status === "running");
    expect(controller!.snapshot.project!.id).toBe(a.id);
    expect(secondDocument.events.some((e) => e.assignmentId === waiting.id && e.content.type === "activity" && e.content.title === "Avvio dell'incarico")).toBe(true);
    expect(firstDocument.events.some((e) => e.assignmentId === waiting.id)).toBe(false);
    expect(controller!.snapshot.sharedCapacity).toEqual({ running: 1, limit: 1, waiting: 0 });

    await open(second);
    await controller!.stopSpecialistWork(waiting.id);
    await until(() => waiting.status === "stopped");
  }, 40_000);

  it("gives a freed slot to the project the Product Owner ranked first, whatever was opened last", async () => {
    await makeController();
    await controller!.updateSettings({ sharedDevelopers: 1 });
    const repos = [await makeRepo(), await makeRepo(), await makeRepo()];
    const holder = await open(repos[0]!);
    const holderDocument = await teamWithMandate();
    await controller!.send("[assegna] [lento]", null, null, null);
    const running = findSpecialist(holderDocument, "Ada")!.assignments[0]!;
    await until(() => running.status === "running");
    const queued: { id: string; assignment: () => ReturnType<typeof findSpecialist> }[] = [];
    for (const repo of repos.slice(1)) {
      const project = await open(repo);
      const document = await teamWithMandate();
      await controller!.send("[assegna] [lento]", null, null, null);
      await until(() => findSpecialist(document, "Ada")!.assignments[0]?.status === "preparing");
      queued.push({ id: project.id, assignment: () => findSpecialist(document, "Ada") });
    }
    expect(controller!.snapshot.sharedCapacity.waiting).toBe(2);
    // The person puts the project opened last first; opening the other one again does not move it.
    const last = queued[1]!;
    await controller!.prioritizeProject(last.id, "up");
    await controller!.prioritizeProject(last.id, "up");
    await controller!.prioritizeProject(last.id, "up");
    const order = controller!.snapshot.settings.projectPriority!;
    expect(order[0]).toBe(last.id);
    await open(repos[1]!);
    await open(repos[0]!);
    expect(controller!.snapshot.settings.projectPriority).toEqual(order);
    await controller!.updateSettings({ projectPriority: [] });
    expect(controller!.snapshot.settings.projectPriority).toEqual(order);

    await controller!.stopSpecialistWork(running.id);
    await until(() => last.assignment()!.assignments[0]!.status === "running");
    expect(queued[0]!.assignment()!.assignments[0]!.status).toBe("preparing");
    expect(controller!.snapshot.project!.id).toBe(holder.id);

    // A higher shared limit starts the rest of the line at once.
    await controller!.updateSettings({ sharedDevelopers: 2 });
    await until(() => queued[0]!.assignment()!.assignments[0]!.status === "running");
    for (const [index, repo] of repos.slice(1).entries()) {
      await open(repo);
      const assignment = queued[index]!.assignment()!.assignments[0]!;
      await controller!.stopSpecialistWork(assignment.id);
      await until(() => assignment.status === "stopped");
    }
  }, 60_000);

  it("keeps the shared limit and the order of the projects after a restart", async () => {
    const data = await makeController();
    const a = await open(await makeRepo());
    const b = await open(await makeRepo());
    await controller!.updateSettings({ sharedDevelopers: 3 });
    const order = [...(await controller!.projectsOverview())].sort((x, y) => x.priority - y.priority).map((o) => o.id);
    await controller!.prioritizeProject(order[1]!, "up");
    await controller!.stop();
    await makeController(data);
    expect(controller!.snapshot.settings.sharedDevelopers).toBe(3);
    expect(controller!.snapshot.sharedCapacity.limit).toBe(3);
    expect(controller!.snapshot.settings.projectPriority).toEqual([order[1], order[0]]);
    expect([a.id, b.id].sort()).toEqual([...order].sort());
  }, 30_000);

  it("saves a late draft into the project it was written in", async () => {
    await makeController();
    const first = await makeRepo();
    const second = await makeRepo();
    const a = await open(first);
    const b = await open(second);
    // The first project has no running work, so it was saved and let go when the person left it.
    await controller!.saveDraft("Bozza scritta nel primo progetto", a.id);
    expect(controller!.snapshot.project!.document.composerDraft ?? "").toBe("");
    await controller!.saveDraft("Bozza del secondo", b.id);
    const reopened = await open(first);
    expect(reopened.document.composerDraft).toBe("Bozza scritta nel primo progetto");
    expect((await open(second)).document.composerDraft).toBe("Bozza del secondo");
  }, 30_000);

  it("keeps the example project the example when the person comes back to it by its folder", async () => {
    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    controller = new TramaController(data, {
      publish: () => undefined,
      openExternal: async () => undefined,
      applyTheme: () => undefined,
      notify: () => undefined,
      setOpenAtLogin: () => undefined,
      aiHeroResourceDirectory: join(root, "resources/AIHero"),
      demoResourceDirectory: join(root, "resources/DemoProject"),
      codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    });
    await controller.start();
    await controller.updateSettings({ continuousWork: false });
    await controller.openDemo();
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const demo = controller.snapshot.project!;
    await open(await makeRepo());
    // The sidebar and the overview reopen a recent project by its folder only.
    const back = await open(demo.rootPath);
    expect(back.id).toBe(demo.id);
    expect(back.isDemo).toBe(true);
    expect(controller.snapshot.recentProjects.find((p) => p.id === demo.id)).toMatchObject({ isDemo: true, name: "Progetto di esempio" });
  }, 30_000);

  it("keeps two folders with the same remote as two projects", async () => {
    await makeController();
    // One remote for both copies; not on GitHub, so the test opens no connection.
    const remote = join(tmpdir(), "negozio-condiviso.git");
    const first = await makeRepo(remote);
    const second = await makeRepo(remote);
    const a = await open(first);
    await controller!.saveDraft("Solo nella prima copia", a.id);
    const b = await open(second);
    expect(b.id).not.toBe(a.id);
    expect(b.document).not.toBe(a.document);
    expect(b.document.composerDraft ?? "").toBe("");
    expect(controller!.snapshot.recentProjects.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect((await open(first)).document.composerDraft).toBe("Solo nella prima copia");
  }, 30_000);
});

describe("quit and provider waits (C11)", () => {
  async function running() {
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
    // "[lento:sempre]": a resumed turn too runs until stopped, so a stop never races its end.
    await controller.send("[assegna] [lento:sempre]", null, null, null);
    const assignment = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => assignment.status === "running");
    return { data, document, assignment };
  }

  it("Esci stops running work in a controlled way and keeps it on disk", async () => {
    const { data, document, assignment } = await running();
    await controller!.stop();
    controller = null;
    expect(assignment.status).toBe("stopped");
    expect(assignment.stops.at(-1)?.reason).toMatch(/Esci/);
    const { AppStorage } = await import("./core/storage");
    const saved = (await new AppStorage(data).loadDocument(document.projectId)).document!;
    expect(findSpecialist(saved, "Ada")!.assignments[0]!.status).toBe("stopped");
  }, 30_000);

  /** Trama opened again on the same data, as after a restart. */
  async function reopen(data: string) {
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
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    return controller.snapshot.project!.document;
  }

  it("resumes the work Esci stopped when Trama opens again, within the mandate, with a check of what is done (issue #249)", async () => {
    const { data, assignment } = await running();
    await controller!.stop();
    const document = await reopen(data);
    const resumed = findSpecialist(document, "Ada")!.assignments[0]!;
    expect(resumed.id).toBe(assignment.id);
    await until(() => resumed.status === "running");
    expect(resumed.turns).toHaveLength(2);
    expect(document.events.some((e) => e.assignmentId === resumed.id && e.content.type === "activity" && e.content.title === "Incarico ripreso alla riapertura")).toBe(
      true,
    );
    await controller!.stopSpecialistWork(resumed.id);
    await until(() => resumed.status === "stopped");
  }, 45_000);

  it("gives a project saved with the team of before its squads when it opens again, without losing a developer (A10)", async () => {
    const { data } = await running();
    await controller!.stop();
    // The saved document as Trama wrote it before squads: no squads, no squad leads, no formation step.
    const projects = join(data, "Projects");
    for (const file of await readdir(projects)) {
      const path = join(projects, file);
      const saved = JSON.parse(await readFile(path, "utf8"));
      delete saved.team.squads;
      saved.team.specialists = saved.team.specialists.filter((s: { role: string }) => s.role !== "squadLead");
      saved.autonomousSteps = (saved.autonomousSteps ?? []).filter((s: { move: string }) => s.move !== "formSquads");
      await writeFile(path, JSON.stringify(saved));
    }
    const document = await reopen(data);
    await until(() => (document.team.squads ?? []).length > 0);
    const ada = findSpecialist(document, "Ada")!;
    expect(document.team.squads!.map((s) => [s.name, s.developerIds])).toEqual([["Orders", [ada.id]]]);
    expect(developers(document).map((s) => s.name)).toEqual(["Ada"]);
    expect(document.autonomousSteps?.filter((s) => s.move === "formSquads")).toHaveLength(1);
  }, 45_000);

  it("keeps the work of a project in Pause stopped after a restart (issue #249)", async () => {
    const { data, assignment } = await running();
    await controller!.pauseContinuousWork(true);
    await controller!.stop();
    const document = await reopen(data);
    expect(document.continuousWork?.paused).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    const kept = findSpecialist(document, "Ada")!.assignments[0]!;
    expect(kept).toMatchObject({ id: assignment.id, status: "stopped" });
    expect(kept.turns).toHaveLength(1);
  }, 45_000);

  it("resumes only waiting work when the provider is available again", async () => {
    const { assignment } = await running();
    await controller!.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped");
    await controller!.resumeWaitingWork("codex");
    expect(assignment.status).toBe("stopped");
    assignment.waitingForProvider = { provider: "codex", until: null, since: new Date().toISOString() };
    await controller!.resumeWaitingWork("codex");
    expect(assignment.waitingForProvider).toBeNull();
    await until(() => assignment.status === "running");
    await controller!.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped");
    // The resumed turn was still running when the stop arrived: it ended interrupted, not completed by itself.
    expect(assignment.turns.map((t) => t.outcome)).toEqual(["interrupted", "interrupted"]);
  }, 30_000);
});

describe("describeFailure", () => {
  it("names network failures", async () => {
    const { describeFailure } = await import("./controller");
    expect(describeFailure("getaddrinfo ENOTFOUND api.example.com")).toMatch(/^Rete non raggiungibile/);
    expect(describeFailure("modello non valido")).toBe("modello non valido");
  });
});

describe("a checkout that lags its branch on GitHub (negozio, chore/pre-apertura)", () => {
  it("starts the work from the branch as it is on the remote and keeps its candidate current, without touching the checkout", async () => {
    // The person's checkout on chore/pre-apertura, and the realignment with main pushed from another clone on 27 September.
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "chore/pre-apertura"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "chore(deps): riallinea package-lock.json"], repo, false);
    await git(["remote", "add", "origin", remote], repo, false);
    await git(["push", "-q", "-u", "origin", "chore/pre-apertura"], repo, false);
    const local = (await git(["rev-parse", "HEAD"], repo)).trim();
    const other = await mkdtemp(join(tmpdir(), "trama-other-"));
    await git(["clone", "-q", "-b", "chore/pre-apertura", remote, other], tmpdir(), false);
    await writeFile(join(other, "RIALLINEAMENTO.md"), "Integra main remoto mantenendo la pre-apertura\n");
    await git(["add", "."], other, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "merge: integra main remoto mantenendo la pre-apertura"], other, false);
    await git(["push", "-q", "origin", "HEAD:chore/pre-apertura"], other, false);
    const onGitHub = (await git(["rev-parse", "HEAD"], other)).trim();

    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    const open = async () => {
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
      return controller;
    };
    await open();
    const document = controller!.snapshot.project!.document;
    await controller!.send("[proponi-team]", null, null, null);
    await controller!.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller!.recordDecision({ id: null, value: "La pre-apertura resta attiva", acceptedExample: "Checkout spento", rationale: "Il negozio non è aperto" });
    await controller!.grantMandate({ requestId: null, objectives: ["Pre-apertura"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["executeInWorktree"], limits: [] });

    await controller!.send("[assegna]", null, null, null);
    const assignment = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => assignment.status === "completed");
    // The work starts from chore/pre-apertura as it is on GitHub, with the realignment the checkout never pulled.
    expect(assignment.workspace!.baseSHA).toBe(onGitHub);
    expect(existsSync(join(assignment.workspace!.worktreeRoot, "RIALLINEAMENTO.md"))).toBe(true);
    // The person's checkout, its branch and its files stay as they were (the method's own files aside).
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(local);
    expect((await git(["rev-parse", "refs/heads/chore/pre-apertura"], repo)).trim()).toBe(local);
    expect((await git(["status", "--porcelain", "--untracked-files=no"], repo)).trim()).toBe("");

    // Its candidate is built on the current base: nothing asks to rebuild it on the checkout's older head.
    await controller!.send(`[candidato:${assignment.id}:${document.decisions[0]!.id}]`, null, null, null);
    const candidate = document.candidates[0]!;
    expect(candidate.baseSHA).toBe(onGitHub);
    await until(() => Boolean(controller!.snapshot.project!.candidateReports[candidate.id]));
    expect(controller!.snapshot.project!.candidateReports[candidate.id]!.blockers.map((b) => b.code)).not.toContain("BASE_CHANGED");

    // Trama opens again on the same project: the candidate is still current, before any work or reading of GitHub.
    await controller!.stop();
    await open();
    const reports = () => controller!.snapshot.project!.candidateReports[candidate.id];
    await until(() => Boolean(reports()));
    await new Promise((r) => setTimeout(r, 500));
    expect(reports()!.blockers.map((b) => b.code)).not.toContain("BASE_CHANGED");
  }, 45_000);
});
