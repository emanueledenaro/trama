import { existsSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { developers, findSpecialist } from "./core/team";
import { sliceViews } from "./core/slices";
import { workState } from "./core/workPhase";

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
    // Every question is answered, but the shared understanding is the person's to confirm: nothing starts.
    await idle();
    expect(automatic()).toEqual([]);

    await controller.send("[passo:confirmUnderstanding] Riassumi quello che abbiamo deciso", null, null, null);
    const summary = document.requests.at(-1)!;
    await until(() => Boolean(project.nextSteps[summary.id]));
    expect(project.nextSteps[summary.id]).toMatchObject({ move: "confirmUnderstanding", label: "Conferma la comprensione" });
    expect(automatic()).toEqual([]);
    await controller.takeStep(summary.id);
    const confirmation = document.requests.find((r) => r.step?.move === "confirmUnderstanding")!;
    expect(confirmation).toMatchObject({ text: "Confermo la comprensione condivisa: procedi.", step: { by: "person" } });

    // Trama starts the plan by itself: a line in the chat, not a message of the person.
    await until(() => document.plans.length === 1 && document.plans[0]!.status === "seams", 20_000);
    const plan = document.plans[0]!;
    const planning = automatic()[0]!;
    expect(planning).toMatchObject({ text: "Prepara il piano.", step: { move: "preparePlan", by: "trama" }, state: "completed" });
    expect(plan.requestId).toBe(planning.id);
    const line = document.events.find((e) => e.requestId === planning.id && e.content.type === "card");
    expect(line?.content).toMatchObject({ kind: "automaticStep", title: "Prepara il piano", referenceId: planning.id });
    expect(document.events.some((e) => e.requestId === planning.id && e.content.type === "personMessage")).toBe(false);
    const sent = document.events.find((e) => e.requestId === planning.id && e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore");
    expect(sent?.content).toMatchObject({ detail: expect.stringContaining("mossa automatica: Prepara il piano") });

    // The plan proposes the seams to test (to-spec, M04): confirming them is the person's, so the work waits.
    await idle();
    expect(automatic()).toHaveLength(1);
    expect(workState(document, document.requests.at(-1)!.id).moves).toEqual([expect.objectContaining({ move: "confirmSeams", actor: "person" })]);
    controller.answerSeams({ planId: plan.id, confirmed: true, note: null });

    // The spec written, to-tickets splits it (M05): the breakdown is the person's to approve, so the work waits again.
    await until(() => plan.slicing?.status === "proposed", 20_000);
    await idle();
    expect(automatic()).toHaveLength(1);
    expect(workState(document, document.requests.at(-1)!.id)).toMatchObject({ phase: "slices", moves: [{ move: "confirmSlices", actor: "person" }] });
    await controller.answerSlices({ planId: plan.id, confirmed: true, note: null });

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
