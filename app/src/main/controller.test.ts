import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "@shared/domain";
import { decisionDependents, dialogEvents, findGoal, projectGoals } from "@shared/goals";
import { TramaController } from "./controller";

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

async function setup() {
  const data = await mkdtemp(join(tmpdir(), "trama-data-"));
  const project = await mkdtemp(join(tmpdir(), "trama-project-"));
  await cp(join(root, "resources/DemoProject"), project, { recursive: true });
  let state: AppState | null = null;
  controller = new TramaController(data, {
    publish: (s) => {
      state = s;
    },
    openExternal: async () => undefined,
    applyTheme: () => undefined,
      notify: () => undefined,
      setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
      demoResourceDirectory: join(root, "resources/DemoProject"),
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
  });
  await controller.start();
  await until(() => state?.codex.account?.kind === "chatgpt");
  await controller.updateSettings({ autoPrepareMethod: false });
  await controller.openProject(project);
  await until(() => controller!.snapshot.project?.phase.kind === "ready");
  return { data, project };
}

describe("TramaController", () => {
  it("prepares the AI Hero method when a project without it opens (T04)", async () => {
    const { project } = await setup();
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(project, ".agents/skills/AIHERO-VERSION.md"))).toBe(false);
    await controller!.updateSettings({ autoPrepareMethod: true });
    await controller!.openProject(project);
    await until(() => existsSync(join(project, ".agents/skills/AIHERO-MANIFEST.json")));
    const events = controller!.snapshot.project!.document.events;
    await until(() => events.some((e) => e.content.type === "activity" && e.content.title.startsWith("Metodo di lavoro AI Hero")));
  });

  it("creates a project from an idea as a Git repository and remembers the idea (T10)", async () => {
    await setup();
    const parent = await mkdtemp(join(tmpdir(), "trama-parent-"));
    await controller!.createProject(parent, "Ricette", "Un'app per salvare ricette di famiglia");
    await until(() => controller!.snapshot.project?.name === "Ricette" && controller!.snapshot.project.phase.kind === "ready");
    const project = controller!.snapshot.project!;
    expect(project.document.createdFromIdea).toBe("Un'app per salvare ricette di famiglia");
    expect(project.snapshot.headSHA).toMatch(/^[0-9a-f]{40}$/);
  });

  it("studies the project, answers a message and records references", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const study = project.document.events.find((e) => e.content.type === "card" && e.content.kind === "study");
    expect(study?.content).toMatchObject({ title: "Studio del progetto" });
    expect(project.document.coordinator.threadId).toMatch(/^thread-\d+-1$/);

    await controller!.send("Come funziona l'annullamento?", "Sources/Orders", null, null);
    const request = project.document.requests[0]!;
    expect(request.state).toBe("completed");
    const kinds = project.document.events.map((e) => e.content.type);
    // The study card, then the first goal the Coordinator proposed in it (UX07).
    expect(kinds).toEqual(["card", "card", "personMessage", "activity", "activity", "coordinatorText"]);
    const reply = project.document.events.at(-1)!.content;
    expect(reply).toMatchObject({ references: ["Sources/Orders/CancelPaidOrder.swift"] });
  });

  it("proposes a first goal after the study of a project without goals", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    expect(document.goals).toHaveLength(1);
    expect(document.goals![0]).toMatchObject({ status: "proposed", origin: "coordinator" });
    expect(document.goals![0]!.examples.map((e) => e.kind)).toEqual(["accepted", "refused"]);
    const card = document.events.find((e) => e.content.type === "card" && e.content.kind === "goal");
    expect(card?.content).toMatchObject({ referenceId: document.goals![0]!.id });
    expect(card?.goalId ?? null).toBeNull();
    // Proposing a goal grants nothing and starts nothing.
    expect(document.mandate).toBeNull();
    expect(document.team.specialists).toHaveLength(0);
  });

  it("keeps two goal dialogs apart from the project dialog and gives the Coordinator the goal", async () => {
    const { data } = await setup();
    const first = controller!.createGoal({
      title: "Revisione degli ordini",
      outcome: "Gli ordini pagati annullati vanno in revisione",
      examples: [{ kind: "accepted", text: "Ordine 42: stato review" }],
    });
    const second = controller!.createGoal({ title: "Catalogo più veloce", outcome: "La ricerca risponde in meno di un secondo", examples: [] });
    const project = controller!.snapshot.project!;
    const document = project.document;

    controller!.saveDraft("bozza del primo", first);
    controller!.saveDraft("bozza del progetto", null);
    await controller!.selectModel("gpt-5.5", "high", "codex", second);
    expect(findGoal(document, first)!.dialog.composerDraft).toBe("bozza del primo");
    expect(document.composerDraft).toBe("bozza del progetto");
    expect(findGoal(document, second)!.dialog).toMatchObject({ selectedModel: "gpt-5.5", selectedEffort: "high" });
    expect(document.selectedEffort).toBeNull();

    await controller!.send("Da dove partiamo?", null, null, null, [], null, first);
    const request = document.requests.at(-1)!;
    expect(request.goalId).toBe(first);
    expect(findGoal(document, first)!.dialog.composerDraft).toBe("");
    expect(document.composerDraft).toBe("bozza del progetto");
    const goalEvents = dialogEvents(document.events, first);
    expect(goalEvents.map((e) => e.content.type)).toEqual(["card", "personMessage", "activity", "activity", "coordinatorText"]);
    const reply = goalEvents.at(-1)!.content;
    expect(reply).toMatchObject({ text: expect.stringContaining(`Dialogo dell'obiettivo ${first}`) });
    expect(dialogEvents(document.events, second).map((e) => e.content.type)).toEqual(["card"]);
    expect(dialogEvents(document.events, null).some((e) => e.content.type === "personMessage")).toBe(false);

    // A message queued in one dialog stays there even if the person moves on before it leaves.
    const running = controller!.send("Primo messaggio", null, null, null, [], null, null);
    await until(() => project.runningRequestId !== null);
    await controller!.send("In coda per il secondo obiettivo", null, null, null, [], null, second);
    await running;
    await until(() => document.requests.filter((r) => r.state === "completed").length === 3);
    const queued = document.requests.find((r) => r.text === "In coda per il secondo obiettivo")!;
    expect(queued.goalId).toBe(second);
    expect(document.requests.find((r) => r.text === "Primo messaggio")!.goalId ?? null).toBeNull();

    // Goals, dialogs and drafts survive a restart.
    await controller!.stop();
    let state: AppState | null = null;
    controller = new TramaController(data, {
      publish: (s) => {
        state = s;
      },
      openExternal: async () => undefined,
      applyTheme: () => undefined,
      notify: () => undefined,
      setOpenAtLogin: () => undefined,
      aiHeroResourceDirectory: join(root, "resources/AIHero"),
      demoResourceDirectory: join(root, "resources/DemoProject"),
      codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    });
    await controller.start();
    await until(() => state?.project?.document !== undefined);
    const reopened = controller.snapshot.project!.document;
    expect(projectGoals(reopened).map((g) => g.id)).toEqual(projectGoals(document).map((g) => g.id));
    expect(dialogEvents(reopened.events, first)).toHaveLength(goalEvents.length);
    expect(findGoal(reopened, second)!.dialog.selectedModel).toBe("gpt-5.5");
  });

  it("links a decision asked in a goal dialog to that goal and answers there", async () => {
    await setup();
    const goalId = controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    const document = controller!.snapshot.project!.document;
    await controller!.send("[chiedi-decisione]", null, null, null, [], null, goalId);
    const question = document.decisionRequests[0]!;
    expect(question.goalId).toBe(goalId);
    await controller!.answerDecision(question.id, 0, null);
    const decisionId = question.outcome!.decisionId;
    expect(findGoal(document, goalId)!.decisionIds).toEqual([decisionId]);
    const answer = document.requests.at(-1)!;
    expect(answer.goalId).toBe(goalId);
    expect(decisionDependents(document, decisionId).goals.map((g) => g.id)).toEqual([goalId]);
  });

  it("refuses a message to a goal that does not exist", async () => {
    await setup();
    await expect(controller!.send("Ciao", null, null, null, [], null, "G-00000000")).rejects.toThrow(/non trovato/);
  });

  it("turns a request_decision tool call into a card and a Pact decision", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("[chiedi-decisione]", null, null, null);
    const [request] = project.document.decisionRequests;
    expect(request?.question).toBe("Cosa succede a un ordine pagato annullato?");
    expect(project.document.events.some((e) => e.content.type === "card" && e.content.kind === "decision")).toBe(true);

    await controller!.answerDecision(request!.id, 0, null);
    expect(project.document.decisions[0]).toMatchObject({ value: "Va in revisione", version: 1 });
    const last = project.document.events.filter((e) => e.content.type === "personMessage").at(-1)!.content;
    expect(last).toMatchObject({ text: expect.stringContaining("Ho risposto alla domanda") });
  });

  it("warns once when the context passes the threshold", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("[pieno] uno", null, null, null);
    await controller!.send("[pieno] due", null, null, null);
    const notices = project.document.events.filter((e) => e.content.type === "card" && e.content.title === "Contesto oltre la soglia");
    expect(notices).toHaveLength(1);
    expect(project.contextUsage).toEqual({ usedTokens: 230_000, contextWindow: 258_000 });
    controller!.setContextThreshold(95);
    expect(project.document.coordinator.contextThreshold).toBe(95);
  });

  it("loads project skills and sends invoked ones", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await until(() => project.skills.length > 0);
    await controller!.send("Usa /tdd per il test", null, null, null);
    const activity = project.document.events.find((e) => e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore");
    expect(activity?.content).toMatchObject({ detail: expect.stringContaining("skill: tdd") });
  });

  it("loads project skills while the Codex usage is exhausted", async () => {
    process.env.FAKE_CODEX_LIMITS = "exhausted";
    try {
      const data = await mkdtemp(join(tmpdir(), "trama-data-"));
      const project = await mkdtemp(join(tmpdir(), "trama-project-"));
      await cp(join(root, "resources/DemoProject"), project, { recursive: true });
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
      await until(() => controller!.snapshot.codex.account?.kind === "blocked");
      await controller.updateSettings({ autoPrepareMethod: false });
      await controller.openProject(project);
      await until(() => (controller!.snapshot.project?.skills.length ?? 0) > 0);
    } finally {
      delete process.env.FAKE_CODEX_LIMITS;
    }
  });

  it("prepares a plan for a request and turns its questions into decision cards", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("Come si annulla un ordine pagato?", null, null, null);
    await controller!.preparePlanForRequest(project.document.requests[0]!.id);
    const plan = project.document.plans[0]!;
    await until(() => plan.status !== "planning");
    expect(plan.status).toBe("ready");
    expect(plan.proposal?.steps).toHaveLength(3);
    expect(plan.decisionRequestIds).toHaveLength(1);
    expect(project.document.decisionRequests[0]!.question).toBe("Il cliente riceve una email?");
  });

  it("lets the person correct a plan and cancel one being prepared (T06)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("Come si annulla un ordine pagato?", null, null, null);
    const requestId = project.document.requests[0]!.id;
    await controller!.preparePlanForRequest(requestId);
    const plan = project.document.plans[0]!;
    await until(() => plan.status !== "planning");
    expect(() => controller!.editPlan({ planId: plan.id, steps: [" "], proposedBehavior: "x", acceptedExample: "" })).toThrow(/almeno un passo/);
    controller!.editPlan({ planId: plan.id, steps: ["Blocca l'annullamento", ""], proposedBehavior: "Serve una revisione", acceptedExample: "Ordine 42" });
    expect(plan.proposal?.steps).toEqual(["Blocca l'annullamento"]);
    expect(plan.editedAt).toBeTruthy();

    const second = controller!.orderPlan({ requestId, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Altro", issueNumber: null });
    controller!.cancelPlan(second.id);
    expect(second.status).toBe("failed");
    expect(second.failure).toMatch(/Annullato/);
    await new Promise((r) => setTimeout(r, 300));
    expect(second.status).toBe("failed");
    expect(second.proposal).toBeNull();
  });

  it("refuses prepare_plan without a mandate and runs it within one", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("[piano]", null, null, null);
    expect(project.document.plans).toHaveLength(0);
    await controller!.grantMandate({ requestId: null, objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    await controller!.send("[piano]", null, null, null);
    expect(project.document.plans[0]?.orderedBy).toBe("coordinator");
    await until(() => project.document.plans[0]!.status === "ready");
  });

  it("persists the conversation and resumes it after a restart", async () => {
    const { data, project: path } = await setup();
    await controller!.send("Ciao", null, null, null);
    await controller!.stop();
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
    await until(() => controller!.snapshot.project?.phase.kind === "ready" || controller!.snapshot.project?.phase.kind === "unavailable");
    const project = controller.snapshot.project!;
    expect(project.rootPath.endsWith(path.split("/").at(-1)!)).toBe(true);
    expect(project.document.requests).toHaveLength(1);
    // The fake server forgets threads, so Trama starts a new one and says so.
    expect(project.document.events.some((e) => e.content.type === "card" && e.content.kind === "contextNotice")).toBe(true);
  });
});

describe("learning ported from Hermes (ADR 0014)", () => {
  it("keeps memory in Trama's folder and recalls earlier dialogs only outside the live thread", async () => {
    const { data, project: root } = await setup();
    const { existsSync, readFileSync } = await import("node:fs");
    await controller!.send("Come funziona l'annullamento?", null, null, null);
    await controller!.send("[memoria] ricorda pnpm", null, null, null);
    const project = controller!.snapshot.project!;
    const reply = project.document.events.at(-1)!.content as { text: string };
    // Every message is still in the live thread: discovery returns nothing from it.
    expect(reply.text).toContain("No matching sessions found");
    const learning = controller!.snapshot.learning!;
    expect(learning.memory.entries).toEqual(["Il progetto usa pnpm 9"]);
    expect(existsSync(join(root, "MEMORY.md"))).toBe(false);
    const files = (await import("node:fs")).readdirSync(join(data, "Learning", "Projects"));
    expect(readFileSync(join(data, "Learning", "Projects", files[0]!, "MEMORY.md"), "utf8")).toBe("Il progetto usa pnpm 9");
    expect(project.document.coordinator.learning).toMatchObject({ turnsSinceMemory: 0, memoryMigrated: true });
  });

  it("runs an unattended review that adds, proposes and creates, and denies other tools", async () => {
    await setup();
    await controller!.send("[memoria] ricorda pnpm", null, null, null);
    const project = controller!.snapshot.project!;
    const internal = controller as unknown as { runLearningReview(p: unknown, scope: { memory: boolean; skills: boolean }): Promise<void> };
    await internal.runLearningReview(project, { memory: true, skills: true });
    const learning = controller!.snapshot.learning!;
    expect(learning.user.entries).toEqual(["La persona preferisce risposte brevi in italiano"]);
    // An unattended review may not remove: the removal waits for the person.
    expect(learning.memory.entries).toEqual(["Il progetto usa pnpm 9"]);
    expect(learning.proposals).toHaveLength(1);
    expect(learning.skills).toMatchObject([{ name: "release-flow", createdBy: "agent", state: "active" }]);
    const run = learning.reviews[0]!;
    expect(run).toMatchObject({ trigger: "memory+skills", status: "completed", toolCalls: 3 });
    expect(run.actions).toEqual(["User profile updated", expect.stringContaining("staged for your approval"), "Skill 'release-flow' created"]);
    const card = project.document.events.at(-1)!.content;
    expect(card).toMatchObject({ type: "activity", title: "Revisione dell'esperienza" });

    controller!.resolveLearningProposal(learning.proposals[0]!.id, true);
    expect(controller!.snapshot.learning!.memory.entries).toEqual([]);
    controller!.changeLearnedSkill({ name: "release-flow", action: "pin" });
    expect(() => controller!.changeLearnedSkill({ name: "release-flow", action: "archive" })).toThrow("fissata");
    controller!.changeLearnedSkill({ name: "release-flow", action: "unpin" });
    controller!.changeLearnedSkill({ name: "release-flow", action: "archive" });
    expect(controller!.snapshot.learning!.archivedSkills).toEqual(["release-flow"]);
    controller!.changeLearnedSkill({ name: "release-flow", action: "restore" });
    expect(controller!.editLearnedMemory({ target: "user", action: "replace", oldText: "brevi", content: "La persona preferisce risposte dirette" })).toEqual({ success: true, error: null });
  });

  it("stops a review whose provider runs its own tool, and saves nothing", async () => {
    await setup();
    await controller!.send("[comando] prova", null, null, null);
    const project = controller!.snapshot.project!;
    const internal = controller as unknown as { runLearningReview(p: unknown, scope: { memory: boolean; skills: boolean }): Promise<void> };
    await internal.runLearningReview(project, { memory: true, skills: true });
    const learning = controller!.snapshot.learning!;
    expect(learning.reviews[0]).toMatchObject({ status: "failed", error: "The review used a tool outside memory and skills.", actions: [] });
    expect(learning.user.entries).toEqual([]);
    expect(learning.skills).toEqual([]);
  });

  it("gives a skill-only review no memory tool", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const internal = controller as unknown as { runLearningReview(p: unknown, scope: { memory: boolean; skills: boolean }): Promise<void> };
    await internal.runLearningReview(project, { memory: false, skills: true });
    const learning = controller!.snapshot.learning!;
    expect(learning.user.entries).toEqual([]);
    expect(learning.reviews[0]).toMatchObject({ trigger: "skills", actions: ["Skill 'release-flow' created"] });
  });

  it("moves the old single-text memory into MEMORY.md once", async () => {
    const { data, project } = await setup();
    await controller!.closeProject();
    const { readFile, writeFile, readdir } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const id = controller!.snapshot.recentProjects[0]!.id;
    const documentPath = join(data, "Projects", `${createHash("sha256").update(id).digest("hex")}.json`);
    const saved = JSON.parse(await readFile(documentPath, "utf8"));
    saved.coordinator.memory = { text: "Primo fatto\n\nSecondo fatto", updatedAt: null, revision: 2 };
    delete saved.coordinator.learning;
    await writeFile(documentPath, JSON.stringify(saved));
    const { existsSync } = await import("node:fs");
    if (existsSync(join(data, "Learning", "Projects"))) {
      for (const dir of await readdir(join(data, "Learning", "Projects"))) await (await import("node:fs/promises")).rm(join(data, "Learning", "Projects", dir), { recursive: true });
    }
    await controller!.openProject(project);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    expect(controller!.snapshot.learning!.memory.entries).toEqual(["Primo fatto", "Secondo fatto"]);
  });
});

describe("import from the SwiftUI app", () => {
  it("imports recent projects and a conversation without touching the Swift files", async () => {
    const { createHash } = await import("node:crypto");
    const { readFile, writeFile, mkdir } = await import("node:fs/promises");
    const legacy = await mkdtemp(join(tmpdir(), "trama-swift-"));
    const project = await mkdtemp(join(tmpdir(), "trama-project-"));
    await cp(join(root, "resources/DemoProject"), project, { recursive: true });
    const id = "0A1B2C3D-0000-0000-0000-000000000000";
    await mkdir(join(legacy, "Projects"));
    const documentPath = join(legacy, "Projects", `${createHash("sha256").update(id).digest("hex")}.json`);
    const swift = JSON.stringify({
      conversation: { events: [{ id: "E1", sequence: 1, origin: "person", createdAt: 0, content: { personMessage: { text: "Ciao dalla versione Swift", moduleID: "", moduleName: "" } } }] },
      coordinator: { memory: { text: "Nota", updatedAt: 0, revision: 1 } },
    });
    await writeFile(documentPath, swift);
    await writeFile(join(legacy, "recent-projects.json"), JSON.stringify([{ id, name: "Negozio", path: project, isDemo: false, lastOpenedAt: 0 }]));

    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    controller = new TramaController(
      data,
      {
        publish: () => undefined,
        openExternal: async () => undefined,
        applyTheme: () => undefined,
        notify: () => undefined,
        setOpenAtLogin: () => undefined,
        aiHeroResourceDirectory: "",
        demoResourceDirectory: "",
        codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
      },
      legacy,
    );
    await controller.start();
    expect(controller.snapshot.recentProjects.map((p) => p.id)).toEqual([id]);
    await controller.openProject(project);
    const document = controller.snapshot.project!.document;
    expect(document.events[0]!.content).toMatchObject({ text: "Ciao dalla versione Swift" });
    expect(document.coordinator.memory.text).toBe("Nota");
    expect(await readFile(documentPath, "utf8")).toBe(swift);
  });
});

describe("initializeRepository", () => {
  it("makes a new project a Git repository with a first commit", async () => {
    const { initializeRepository } = await import("./controller");
    const { writeFile } = await import("node:fs/promises");
    const { git } = await import("./core/process");
    const project = await mkdtemp(join(tmpdir(), "trama-new-"));
    await writeFile(join(project, "README.md"), "# Nuovo\n");
    await initializeRepository(project);
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], project)).trim()).toBe("main");
    expect((await git(["log", "--format=%s"], project)).trim()).toBe("Start the project");
  });
});
