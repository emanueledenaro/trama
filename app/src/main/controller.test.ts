import { workState } from "./core/workPhase";
import { openGrillingQuestions } from "@shared/grilling";
import { chmod, cp, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, ProjectDocument } from "@shared/domain";
import { chatEvents, decisionDependents, dialogEvents, findGoal, projectGoals } from "@shared/goals";
import { activityLog } from "@shared/activity";
import { deriveTimelineRows } from "@shared/timeline";
import { waitingForYou } from "@shared/waitingForYou";
import { TramaController } from "./controller";
import { QUIT_NOTE } from "./core/document";
import { AppStorage } from "./core/storage";
import { developers } from "./core/team";

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

/**
 * Interrupts a running Coordinator turn once Trama handed it to the provider: before that there is no turn to
 * interrupt, and the fake server's "[attesa]" turn would run forever.
 */
async function interruptOnceSent(document: ProjectDocument, requestId: string): Promise<void> {
  await until(() =>
    document.events.some((e) => e.requestId === requestId && e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore"),
  );
  await controller!.interrupt();
}

/**
 * Answers a grilling and confirms the shared understanding with the step's button, within a mandate that allows
 * planning (W04): the next move is the Coordinator's plan.
 */
async function confirmUnderstanding(document: ProjectDocument): Promise<void> {
  await controller!.grantMandate({ requestId: null, objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
  await controller!.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
  for (const question of [...document.decisionRequests]) await controller!.answerDecision(question.id, 1, null);
  await controller!.send("[passo:confirmUnderstanding] Riassumi quello che abbiamo deciso", null, null, null);
  await controller!.takeStep(document.requests.at(-1)!.id);
}

const automaticRequests = (document: ProjectDocument) => document.requests.filter((r) => r.step?.by === "trama");

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

  it("does not prepare the AI Hero method on opening when the person postponed the step (B02)", async () => {
    const { project } = await setup();
    const { existsSync } = await import("node:fs");
    await controller!.updateSettings({ autoPrepareMethod: true });
    await controller!.updateOnboarding({ skipStep: "aiHero" });
    await controller!.openProject(project);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    expect(existsSync(join(project, ".agents/skills/AIHERO-VERSION.md"))).toBe(false);
    // Choosing afterwards takes the step back, and the next opening prepares it.
    await controller!.updateOnboarding({ methodChoice: true });
    await controller!.openProject(project);
    await until(() => existsSync(join(project, ".agents/skills/AIHERO-MANIFEST.json")));
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

  it("opens the Coordinator of a project opened while the previous one's was still starting (F01)", async () => {
    await setup();
    const first = await mkdtemp(join(tmpdir(), "trama-first-"));
    const second = await mkdtemp(join(tmpdir(), "trama-second-"));
    for (const path of [first, second]) await cp(join(root, "resources/DemoProject"), path, { recursive: true });
    const gate = join(await mkdtemp(join(tmpdir(), "trama-gate-")), "initialize");
    process.env.FAKE_CODEX_INITIALIZE_GATE = gate;
    try {
      // The first project's Coordinator waits for its app-server to start; the person opens another project meanwhile.
      await controller!.openProject(first);
      await until(() => existsSync(`${gate}.held`));
      await controller!.openProject(second);
      const project = controller!.snapshot.project!;
      expect(project.rootPath).toBe(await realpath(second));
      await writeFile(gate, "");
      // Well within the 15 s an app-server request may take: the second project does not wait on the first one's.
      await until(() => project.phase.kind === "ready", 5_000);
    } finally {
      delete process.env.FAKE_CODEX_INITIALIZE_GATE;
    }
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
    // The project mandate proposed at the opening (issue #244) waits in Aspetta te and is not part of this exchange.
    const kinds = project.document.events.filter((e) => !(e.content.type === "card" && e.content.kind === "mandate")).map((e) => e.content.type);
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
    expect(developers(document)).toHaveLength(0);
  });

  it("keeps one chat with one composer and tags each message with the goal it was sent under (U01)", async () => {
    const { data } = await setup();
    const first = await controller!.createGoal({
      title: "Revisione degli ordini",
      outcome: "Gli ordini pagati annullati vanno in revisione",
      examples: [{ kind: "accepted", text: "Ordine 42: stato review" }],
    });
    const second = await controller!.createGoal({ title: "Catalogo più veloce", outcome: "La ricerca risponde in meno di un secondo", examples: [] });
    const project = controller!.snapshot.project!;
    const document = project.document;

    // One draft and one selection, whatever goal the chat is filtered on.
    expect(findGoal(document, first)!.dialog).toBeUndefined();
    controller!.saveDraft("bozza della chat");
    await controller!.selectModel("gpt-5.5", "high", "codex");
    expect(document.composerDraft).toBe("bozza della chat");
    expect(document).toMatchObject({ selectedModel: "gpt-5.5", selectedEffort: "high" });
    // An Antigravity name with its level, as agy lists it, is stored as catalogue model plus level (issue #209).
    await controller!.selectModel("Gemini 3.8 Flash (High)", null, "antigravity");
    expect(document).toMatchObject({ selectedProvider: "antigravity", selectedModel: "Gemini 3.8 Flash", selectedEffort: "high" });
    await controller!.selectModel("gpt-5.5", "high", "codex");

    await controller!.send("Da dove partiamo?", null, null, null, [], null, first);
    const request = document.requests.at(-1)!;
    expect(request.goalId).toBe(first);
    expect(document.composerDraft).toBe("");
    const goalEvents = chatEvents(document.events, first);
    expect(goalEvents.map((e) => e.content.type)).toEqual(["card", "personMessage", "activity", "activity", "coordinatorText"]);
    const reply = goalEvents.at(-1)!.content;
    expect(reply).toMatchObject({ text: expect.stringContaining(`Messaggio sull'obiettivo ${first}`) });
    expect(chatEvents(document.events, second).map((e) => e.content.type)).toEqual(["card"]);
    // The whole chat shows every goal's messages, in the order they were recorded.
    expect(chatEvents(document.events, null)).toEqual(document.events);

    // A message queued under one goal keeps that goal even if the person changes the filter. "[attesa]" keeps the
    // first turn running until it is interrupted: a reply that ends by itself could finish between two checks.
    const running = controller!.send("[attesa] Primo messaggio", null, null, null, [], null, null);
    await until(() => project.runningRequestId !== null);
    const firstId = project.runningRequestId!;
    await controller!.send("In coda per il secondo obiettivo", null, null, null, [], null, second);
    expect(controller!.snapshot.project!.queuedMessages.map((q) => [q.text, q.goalId])).toEqual([["In coda per il secondo obiettivo", second]]);
    await interruptOnceSent(document, firstId);
    await running;
    await until(() => document.requests.some((r) => r.text === "In coda per il secondo obiettivo" && r.state === "completed"));
    const queued = document.requests.find((r) => r.text === "In coda per il secondo obiettivo")!;
    expect(queued.goalId).toBe(second);
    expect(document.requests.find((r) => r.id === firstId)!.goalId ?? null).toBeNull();

    // Goals, their messages and the selection survive a restart.
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
    expect(chatEvents(reopened.events, first)).toHaveLength(goalEvents.length);
    expect(reopened.selectedModel).toBe("gpt-5.5");
  });

  it("links a decision asked in a goal dialog to that goal and answers there", async () => {
    await setup();
    const goalId = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
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

  // Root ignores chmod 0o500, so the failed save this test needs cannot happen when the suite runs as root.
  it.skipIf(process.getuid?.() === 0)("saves a goal before reporting it and keeps nothing when the save fails (UX01)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    const storage = new AppStorage(data);

    // Success is reported only once the goal is on disk, without waiting for the deferred save.
    const id = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    expect(findGoal((await storage.loadDocument(project.id)).document!, id)).toMatchObject({ title: "Revisione" });
    await controller!.updateGoal(id, { title: "Revisione degli ordini" });
    expect(findGoal((await storage.loadDocument(project.id)).document!, id)!.title).toBe("Revisione degli ordini");

    const goalsBefore = structuredClone(document.goals);
    const eventsBefore = document.events.length;
    const projects = dirname(storage.documentPath(project.id));
    await chmod(projects, 0o500);
    try {
      await expect(controller!.createGoal({ title: "Catalogo", outcome: "Ricerca veloce", examples: [] })).rejects.toThrow(/non è stato salvato/);
      await expect(controller!.updateGoal(id, { title: "Titolo perso" })).rejects.toThrow(/non è stato salvato/);
    } finally {
      await chmod(projects, 0o700);
    }
    expect(document.goals).toEqual(goalsBefore);
    expect(document.events).toHaveLength(eventsBefore);
    expect(findGoal((await storage.loadDocument(project.id)).document!, id)!.title).toBe("Revisione degli ordini");
  });

  it("saves the focus before showing it and passes it to the next task on pause (W02)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const storage = new AppStorage(data);
    const first = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    const second = await controller!.createGoal({ title: "Catalogo", outcome: "Ricerca veloce", examples: [] });
    expect(controller!.snapshot.project!.focus.focus).toMatchObject({ id: `goal:${first}`, title: "Revisione", phaseLabel: "da avviare" });
    await controller!.changeFocus("pause", `goal:${first}`);
    expect((await storage.loadDocument(project.id)).document!.focus).toEqual({ taskId: `goal:${second}`, pausedTaskIds: [`goal:${first}`] });
    const view = controller!.snapshot.project!.focus;
    expect(view.focus?.id).toBe(`goal:${second}`);
    expect(view.queue).toMatchObject([{ id: `goal:${first}`, status: "paused" }]);
    await controller!.changeFocus("focus", `goal:${first}`);
    expect(controller!.snapshot.project!.focus.focus?.id).toBe(`goal:${first}`);
    await expect(controller!.changeFocus("pause", "goal:G-00000000")).rejects.toThrow(/non è aperto/);
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

  it("prepares a plan for a request as a spec: the seams first, and no decision cards (M04)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("Come si annulla un ordine pagato?", null, null, null);
    const request = project.document.requests[0]!;
    controller!.orderPlan({ requestId: request.id, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: request.text, issueNumber: null });
    const plan = project.document.plans[0]!;
    await until(() => plan.status !== "planning");
    expect(plan.status).toBe("seams");
    expect(plan.spec).toMatchObject({ seams: [{ existing: true, tests: "Un ordine pagato annullato va in revisione" }], seamsAnswer: null, sections: null });
    expect(plan.proposal).toBeNull();
    // to-spec does not interview the person: the plan asks no decision.
    expect(plan.decisionRequestIds).toHaveLength(0);
    expect(project.document.decisionRequests).toHaveLength(0);
  });

  it("lets the person correct a plan and cancel one being prepared (T06)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("Come si annulla un ordine pagato?", null, null, null);
    const requestId = project.document.requests[0]!.id;
    controller!.orderPlan({ requestId, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Annullamento", issueNumber: null });
    const plan = project.document.plans[0]!;
    await until(() => plan.status !== "planning");
    // The person corrects the seams in their own words; the planner writes the spec with the correction.
    expect(() => controller!.answerSeams({ planId: plan.id, confirmed: false, note: " " })).toThrow(/cosa cambiare/);
    controller!.answerSeams({ planId: plan.id, confirmed: false, note: "Testa anche il rimborso manuale" });
    expect(() => controller!.answerSeams({ planId: plan.id, confirmed: true, note: null })).toThrow(/non aspetta/);
    await until(() => plan.status !== "planning");
    expect(plan.status).toBe("ready");
    expect(plan.spec?.seamsAnswer).toMatchObject({ confirmed: false, note: "Testa anche il rimborso manuale" });
    expect(plan.spec?.seams.map((s) => s.seam)).toEqual(["L'interfaccia di CancelPaidOrder: annullare un ordine pagato", "Il rimborso manuale del supporto"]);
    expect(plan.spec?.sections?.furtherNotes).toContain("Correzione: Testa anche il rimborso manuale");
    const sections = plan.spec!.sections!;
    expect(() => controller!.editPlan({ planId: plan.id, sections: { ...sections, solution: " " } })).toThrow(/titolo, problema e soluzione/);
    controller!.editPlan({ planId: plan.id, sections: { ...sections, userStories: ["Come supporto, voglio rivedere l'ordine, così che decida io", ""] } });
    expect(plan.spec?.sections?.userStories).toEqual(["Come supporto, voglio rivedere l'ordine, così che decida io"]);
    expect(plan.editedAt).toBeTruthy();

    const second = controller!.orderPlan({ requestId, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Altro", issueNumber: null });
    controller!.cancelPlan(second.id);
    expect(second.status).toBe("failed");
    expect(second.failure).toMatch(/Annullato/);
    await new Promise((r) => setTimeout(r, 300));
    expect(second.status).toBe("failed");
    expect(second.proposal).toBeNull();
    expect(second.spec ?? null).toBeNull();
  });

  it("keeps one active plan per goal: a new plan stops and supersedes the one still being prepared (U01)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const goal = await controller!.createGoal({ title: "Revisione", outcome: "Gli ordini pagati annullati vanno in revisione", examples: [] });
    await controller!.send("Come si annulla un ordine pagato?", null, null, null, [], null, goal);
    const requestId = project.document.requests.at(-1)!.id;
    const first = controller!.orderPlan({ requestId, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Primo", issueNumber: null });
    const second = controller!.orderPlan({ requestId, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Secondo", issueNumber: null });
    expect(first).toMatchObject({ status: "superseded", supersededBy: second.id });
    await until(() => second.status !== "planning");
    // The replaced planner's late answer does not bring the old plan back.
    await new Promise((r) => setTimeout(r, 300));
    expect(first.status).toBe("superseded");
    expect(first.spec ?? null).toBeNull();
    expect(second.status).toBe("seams");
  });

  it("gives the Coordinator thread the original grill-with-docs, grilling, domain-modeling and ask-trama skills once, also when it is already open (M02, M03, M07)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    const skill = ["grill-with-docs", "grilling", "domain-modeling", "ask-trama"].map((name) => `skill:${name}:${join(root, `resources/AIHero/skills/${name}/SKILL.md`)}`);
    const received = async () => {
      await controller!.send("[ricevuti]", null, null, null);
      return JSON.parse((document.events.at(-1)!.content as { text: string }).text) as string[];
    };
    // A new Codex thread receives the skill as a native skill input in its first turn, the study.
    expect(await received()).toEqual([...skill, "rules"]);
    // A thread opened before M03 holds the earlier rules: it receives the skills once, like other late rules.
    document.coordinator.rulesSent = "the M02 rules";
    expect(await received()).toEqual([...skill, "rules", ...skill, "rules"]);
    expect(await received()).toEqual([...skill, "rules", ...skill, "rules"]);
  });

  it("grills a request in rounds and starts the plan only when no question is open (M01)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    await controller!.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
    const subject = document.requests[0]!.id;
    const round1 = document.decisionRequests;
    expect(round1.map((q) => q.grilling)).toEqual([
      { subjectRequestId: subject, round: 1, number: 1, recommendedIndex: 1 },
      { subjectRequestId: subject, round: 1, number: 2, recommendedIndex: 1 },
    ]);
    const rows = deriveTimelineRows(document.events, document.requests, null, new Set(), document.decisionRequests);
    expect(rows.filter((r) => r.kind === "grillingRound")).toEqual([expect.objectContaining({ round: 1, questionIds: round1.map((q) => q.id) })]);

    // The Coordinator cannot start the plan while the round is open.
    await controller!.grantMandate({ requestId: null, objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    await controller!.send("[piano]", null, null, null);
    expect(document.plans).toHaveLength(0);
    expect(document.events.at(-1)!.content).toMatchObject({ text: expect.stringContaining("grilling_open") });

    // The next round waits for the whole frontier; the answers stay recorded as Pact decisions.
    await controller!.answerDecision(round1[0]!.id, 0, null);
    await controller!.send("[grilling:2]", null, null, null);
    expect(document.events.at(-1)!.content).toMatchObject({ text: expect.stringContaining("still has open questions") });
    await controller!.answerDecision(round1[1]!.id, 1, null);
    await controller!.send("[grilling:2]", null, null, null);
    const round2 = document.decisionRequests[2]!;
    expect(round2.grilling).toMatchObject({ subjectRequestId: subject, round: 2, number: 1 });
    await controller!.send("[piano]", null, null, null);
    expect(document.plans).toHaveLength(0);
    await controller!.answerDecision(round2.id, 1, null);
    expect(document.decisions.map((d) => d.value)).toEqual(["Solo il supporto", "Anche il cliente", "Anche il cliente"]);

    await controller!.send("[piano]", null, null, null);
    expect(document.plans).toHaveLength(1);
    await until(() => document.plans[0]!.status !== "planning");
  });

  it("closes a turn with the one next step the work allows, and with none after a greeting (W01)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    // A greeting has no work: Trama refuses the step and shows no button.
    await controller!.send("[passo:preparePlan] Ciao", null, null, null);
    const greeting = document.requests[0]!;
    expect(greeting.nextStep).toBeUndefined();
    expect(document.events.at(-1)!.content).toMatchObject({ text: expect.stringContaining("No move is allowed now") });

    // A request for work: the grilling round, then one step, the person's answers.
    await controller!.send("[grilling:1] [passo:answerQuestions] Gli ordini pagati annullati vanno in revisione", null, null, null);
    const work = document.requests[1]!;
    expect(work.nextStep).toMatchObject({ move: "answerQuestions", reason: "Il lavoro aspetta questo passo." });
    await until(() => Boolean(project.nextSteps[work.id]));
    expect(project.nextSteps).toEqual({
      [work.id]: expect.objectContaining({ label: "Rispondi alle 2 domande", actor: "person", targetId: document.decisionRequests[0]!.id }),
    });

    // Each turn gives the Coordinator the phase; the answer starts a new turn, whose reply declared no step.
    await controller!.answerDecision(document.decisionRequests[0]!.id, 0, null);
    const sent = document.events.filter((e) => e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore").at(-1);
    expect(sent?.content).toMatchObject({ detail: expect.stringContaining("fase: chiarimento") });
    await until(() => Object.keys(project.nextSteps).length === 0);
  });

  it("stops an automatic move at the person's stop, and the stopped work goes on no further (W04)", async () => {
    process.env.FAKE_CODEX_AUTOMATIC = "wait";
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await confirmUnderstanding(document);
      await until(() => automaticRequests(document).length === 1, 20_000);
      const move = automaticRequests(document)[0]!;
      expect(move).toMatchObject({ state: "running", step: { move: "preparePlan", by: "trama" }, text: "Prepara il piano." });
      // The status line names the move that runs and carries its stop (issue #241).
      await until(() => controller!.snapshot.project!.statusLine?.runningMove?.requestId === move.id, 20_000);
      expect(controller!.snapshot.project!.statusLine).toMatchObject({ state: "working", text: expect.stringContaining("Sto preparando il piano") });
      await interruptOnceSent(document, move.id);
      await until(() => move.state === "interrupted" && project.runningRequestId === null, 20_000);
      await new Promise((r) => setTimeout(r, 300));
      expect(automaticRequests(document)).toHaveLength(1);
      expect(document.plans).toEqual([]);
      // The move is not a row of the chat (issue #241): Activity lists it as stopped, and the status line has no stop left.
      const rows = deriveTimelineRows(document.events, document.requests, null, new Set(), document.decisionRequests);
      expect(rows.some((r) => ("requestId" in r && r.requestId === move.id) || ("event" in r && r.event.requestId === move.id))).toBe(false);
      expect(activityLog(document.requests, document.events)).toEqual([expect.objectContaining({ requestId: move.id, label: "Prepara il piano", outcome: "stopped" })]);
      expect(controller!.snapshot.project!.statusLine?.runningMove).toBeNull();
    } finally {
      delete process.env.FAKE_CODEX_AUTOMATIC;
    }
  }, 60_000);

  it("does not retry a move the Coordinator did not make, and starts nothing while its provider is blocked (W04)", async () => {
    process.env.FAKE_CODEX_AUTOMATIC = "idle";
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await confirmUnderstanding(document);
      await until(() => automaticRequests(document)[0]?.state === "completed" && project.runningRequestId === null, 20_000);
      await new Promise((r) => setTimeout(r, 300));
      // The automatic turn ended without a plan: one move per event, no loop.
      expect(automaticRequests(document)).toHaveLength(1);
      expect(document.plans).toEqual([]);

      // With the provider blocked, a new event of the person starts nothing either.
      controller!.snapshot.providers.codex.account = { kind: "blocked", message: "Limite di utilizzo raggiunto.", until: null };
      await controller!.send("Ci sei?", null, null, null);
      await new Promise((r) => setTimeout(r, 300));
      expect(automaticRequests(document)).toHaveLength(1);
      expect(workState(document, document.requests.at(-1)!.id).moves.map((m) => m.move)).toEqual(["preparePlan"]);
    } finally {
      delete process.env.FAKE_CODEX_AUTOMATIC;
    }
  }, 60_000);

  it("holds every automatic move in pause, keeps the pause after a restart, and Riprendi starts the move with a round (A05)", async () => {
    process.env.FAKE_CODEX_AUTOMATIC = "idle";
    try {
      const { data } = await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await controller!.pauseContinuousWork(true);
      expect(controller!.snapshot.project!.statusLine).toMatchObject({ paused: true });
      await confirmUnderstanding(document);
      await new Promise((r) => setTimeout(r, 300));
      // In pause the Coordinator's move stays a move: nothing automatic starts, the round included.
      expect(automaticRequests(document)).toEqual([]);
      await controller!.runRound();
      expect(automaticRequests(document)).toEqual([]);
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
      await until(() => state?.project?.phase.kind === "ready");
      const reopened = controller.snapshot.project!;
      expect(reopened.document.continuousWork?.paused).toBe(true);
      expect(reopened.statusLine).toMatchObject({ paused: true });
      await new Promise((r) => setTimeout(r, 300));
      expect(automaticRequests(reopened.document)).toEqual([]);

      // Riprendi runs a round at once: the Coordinator's move starts, and Activity says the round started it.
      await controller.pauseContinuousWork(false);
      await until(() => automaticRequests(reopened.document)[0]?.state === "completed" && reopened.runningRequestId === null, 20_000);
      expect(automaticRequests(reopened.document)[0]!.step).toMatchObject({ move: "preparePlan", by: "trama", trigger: "round" });
      const rounds = reopened.document.continuousWork!.rounds;
      expect(rounds.at(-1)!.detail).toBe('Avviata la mossa "Prepara il piano".');
      expect(activityLog(reopened.document.requests, reopened.document.events, rounds).map((e) => e.kind)).toEqual(["move", "round"]);

      // The move was not made: the next round does not repeat it and opens no provider turn.
      const requests = reopened.document.requests.length;
      await controller.runRound();
      await new Promise((r) => setTimeout(r, 300));
      expect(reopened.document.requests).toHaveLength(requests);
      expect(reopened.document.continuousWork!.rounds).toHaveLength(rounds.length);
    } finally {
      delete process.env.FAKE_CODEX_AUTOMATIC;
    }
  }, 90_000);

  it("writes the recap asked with the command or in the chat from the records, without a provider turn (A03)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    const requests = document.requests.length;
    await controller!.send("/riepilogo", null, null, null);
    await controller!.send("A che punto siamo?", null, null, null);
    expect(document.requests).toHaveLength(requests);
    const cards = document.events.filter((e) => e.content.type === "card" && e.content.kind === "recap");
    expect(cards).toHaveLength(2);
    expect(document.events.filter((e) => e.content.type === "personMessage").map((e) => (e.content as { text: string }).text)).toEqual(["/riepilogo", "A che punto siamo?"]);
    const recaps = document.recap!.recaps;
    expect(recaps.map((r) => r.reason)).toEqual(["request", "request"]);
    expect(recaps[0]).toMatchObject({ milestones: [], doing: controller!.snapshot.project!.statusLine!.text });
    // A longer message is the Coordinator's, as any other.
    await controller!.send("Fammi un riepilogo delle scelte sul checkout e poi prepara il piano", null, null, null);
    expect(document.requests).toHaveLength(requests + 1);
  }, 60_000);

  it("writes one recap for a milestone, and tells it once (A03)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    const goalId = await controller!.createGoal({ title: "Resi senza telefonate", outcome: "Il cliente apre un reso da solo", examples: [] });
    await new Promise((r) => setTimeout(r, 100));
    expect(document.recap?.recaps ?? []).toEqual([]);
    await controller!.updateGoal(goalId, { status: "achieved" });
    await until(() => (document.recap?.recaps.length ?? 0) > 0);
    // More changes after the milestone do not tell it again.
    await controller!.updateGoal(goalId, { title: "Resi senza telefonate al supporto" });
    await controller!.send("/riepilogo", null, null, null);
    await new Promise((r) => setTimeout(r, 100));
    const recaps = document.recap!.recaps;
    expect(recaps.map((r) => r.reason)).toEqual(["milestone", "request"]);
    expect(recaps[0]!.milestones).toEqual(["Obiettivo raggiunto: Resi senza telefonate"]);
    expect(recaps[1]!.milestones).toEqual([]);
    const card = document.events.find((e) => e.content.type === "card" && e.content.kind === "recap");
    expect(card?.content).toMatchObject({ title: "Riepilogo: un traguardo", referenceId: recaps[0]!.id });
    expect(card?.goalId).toBeUndefined();
  }, 60_000);

  it("runs no round on a project without open work (A05)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    await controller!.send("Ciao", null, null, null);
    const requests = document.requests.length;
    await controller!.runRound();
    await new Promise((r) => setTimeout(r, 200));
    expect(document.requests).toHaveLength(requests);
    expect(document.continuousWork?.rounds ?? []).toEqual([]);
  }, 60_000);

  it("retries a turn after a temporary 429 with a growing wait, without writing the message again (P10)", async () => {
    process.env.TRAMA_PROVIDER_RETRY_MS = "40";
    process.env.FAKE_CODEX_RATE_LIMITS = "2";
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await controller!.send("[limite-temporaneo] Come funziona l'annullamento?", null, null, null);
      const first = document.requests[0]!;
      expect(first.state).toBe("failed");
      expect(project.providerRetry).toMatchObject({ requestId: first.id, attempt: 1, maxAttempts: 5, provider: "ChatGPT" });
      // A temporary limit does not block the provider.
      expect(controller!.snapshot.codex.account?.kind).toBe("chatgpt");
      await until(() => document.requests.at(-1)?.state === "completed", 10_000);
      expect(document.requests.map((r) => [r.state, r.retry?.attempt ?? null])).toEqual([
        ["failed", null],
        ["failed", 1],
        ["completed", 2],
      ]);
      expect(document.requests[2]!.retry?.of).toBe(document.requests[1]!.id);
      expect(project.providerRetry ?? null).toBeNull();
      // One message of the person; the retries are Trama's lines, and no activity shows the provider's JSON.
      expect(document.events.filter((e) => e.content.type === "personMessage")).toHaveLength(1);
      const activities = document.events.flatMap((e) => (e.content.type === "activity" ? [e.content] : []));
      expect(activities.map((a) => a.title)).toContain("Nuovo tentativo automatico (2 di 5)");
      const failed = activities.filter((a) => a.title === "Il turno non è riuscito");
      expect(failed).toHaveLength(2);
      for (const activity of failed) {
        expect(activity.detail).toMatch(/^Limite temporaneo del provider\. /);
        expect(activity.detail).not.toContain("{");
      }
    } finally {
      delete process.env.TRAMA_PROVIDER_RETRY_MS;
      delete process.env.FAKE_CODEX_RATE_LIMITS;
    }
  }, 60_000);

  it("stops the automatic retries at the person's request, and a new message replaces them (P10)", async () => {
    process.env.TRAMA_PROVIDER_RETRY_MS = "60000";
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await controller!.send("[limite-temporaneo] Ci sei?", null, null, null);
      expect(project.providerRetry).toMatchObject({ attempt: 1 });
      controller!.stopProviderRetry();
      expect(project.providerRetry).toBeNull();
      expect(document.events.at(-1)?.content).toMatchObject({ type: "activity", title: "Tentativi automatici fermati" });

      // Riprova repeats the failed turn at once, as Trama's line; the fake provider is available again.
      await controller!.retryRequest(document.requests[0]!.id);
      expect(document.requests.map((r) => [r.state, r.retry?.attempt ?? null])).toEqual([
        ["failed", null],
        ["completed", 0],
      ]);
      expect(document.events.filter((e) => e.content.type === "personMessage")).toHaveLength(1);
    } finally {
      delete process.env.TRAMA_PROVIDER_RETRY_MS;
    }
  }, 60_000);

  it("waits out a network outage and resumes the turn by itself, telling the Coordinator to reconcile first (C11)", async () => {
    process.env.TRAMA_PROVIDER_RETRY_MS = "40";
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "requests.jsonl");
    process.env.FAKE_CODEX_LOG = log;
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await controller!.send("[rete-assente] Come si annulla un ordine?", null, null, null);
      const first = document.requests[0]!;
      expect(first.state).toBe("failed");
      expect(project.providerRetry).toMatchObject({ requestId: first.id, reason: "unreachable", attempt: 1, maxAttempts: 5 });
      await until(() => document.requests.at(-1)?.state === "completed", 10_000);
      expect(document.requests.map((r) => [r.state, r.retry?.attempt ?? null])).toEqual([
        ["failed", null],
        ["completed", 1],
      ]);
      expect(document.events.filter((e) => e.content.type === "personMessage")).toHaveLength(1);
      const activities = document.events.flatMap((e) => (e.content.type === "activity" ? [e.content] : []));
      expect(activities.find((a) => a.title === "Il turno non è riuscito")?.detail).toMatch(/^Provider non raggiungibile\. /);
      expect(activities.find((a) => a.title === "Nuovo tentativo automatico (1 di 5)")?.detail).toContain("rete");
      // The repeated turn is told that part of the first attempt may be done already.
      const { readFile } = await import("node:fs/promises");
      const turns = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method: string; params: { input?: { text: string }[] } })
        .filter((entry) => entry.method === "turn/start" && entry.params.input?.[0]?.text.includes("[rete-assente]"));
      expect(turns.map((t) => t.params.input![0]!.text.includes("## Resumed turn"))).toEqual([false, true]);
    } finally {
      delete process.env.TRAMA_PROVIDER_RETRY_MS;
      delete process.env.FAKE_CODEX_LOG;
    }
  }, 60_000);

  it("waits for a used up quota with account checks only, and resumes the turn when it comes back (C11)", async () => {
    process.env.TRAMA_PROVIDER_RETRY_MS = "10";
    const quota = join(await mkdtemp(join(tmpdir(), "trama-quota-")), "exhausted");
    process.env.FAKE_CODEX_QUOTA_FILE = quota;
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await writeFile(quota, "");
      await controller!.send("Riprendi il piano degli annullamenti", null, null, null);
      const first = document.requests[0]!;
      expect(first.state).toBe("failed");
      expect(project.providerRetry).toMatchObject({ requestId: first.id, reason: "quotaExhausted", attempt: 1 });
      // Several checks of the account pass, with no new turn: no burst of retries while the quota is used up.
      await until(() => controller!.snapshot.providers.codex.account?.kind === "blocked");
      await new Promise((r) => setTimeout(r, 1_000));
      expect(document.requests).toHaveLength(1);
      expect(project.providerRetry).toMatchObject({ requestId: first.id, reason: "quotaExhausted", attempt: 1 });

      const { rm } = await import("node:fs/promises");
      await rm(quota);
      await until(() => document.requests.at(-1)?.state === "completed", 10_000);
      expect(document.requests.map((r) => [r.state, r.retry?.attempt ?? null])).toEqual([
        ["failed", null],
        ["completed", 1],
      ]);
      expect(project.providerRetry ?? null).toBeNull();
      const activities = document.events.flatMap((e) => (e.content.type === "activity" ? [e.content] : []));
      expect(activities.find((a) => a.title === "Nuovo tentativo automatico (1 di 5)")?.detail).toBe(
        "La quota di ChatGPT è di nuovo disponibile: Trama riprende il messaggio.",
      );
    } finally {
      delete process.env.TRAMA_PROVIDER_RETRY_MS;
      delete process.env.FAKE_CODEX_QUOTA_FILE;
    }
  }, 60_000);

  it("stops waiting for a quota when the person sends a new message (C11)", async () => {
    process.env.TRAMA_PROVIDER_RETRY_MS = "1000";
    const quota = join(await mkdtemp(join(tmpdir(), "trama-quota-")), "exhausted");
    process.env.FAKE_CODEX_QUOTA_FILE = quota;
    try {
      await setup();
      const project = controller!.snapshot.project!;
      const document = project.document;
      await writeFile(quota, "");
      await controller!.send("Primo messaggio", null, null, null);
      expect(project.providerRetry).toMatchObject({ reason: "quotaExhausted" });
      // The check of the account after the failure ends first, so it cannot mark the provider blocked again later.
      await until(() => controller!.snapshot.providers.codex.account?.kind === "blocked");
      const { rm } = await import("node:fs/promises");
      await rm(quota);
      await controller!.refreshCodex();
      await until(() => controller!.snapshot.providers.codex.account?.kind === "chatgpt" && controller!.snapshot.providers.codex.models.length > 0);
      await controller!.send("Lascia stare, parliamo d'altro", null, null, null);
      expect(project.providerRetry ?? null).toBeNull();
      // Waking the computer brings no cancelled wait back.
      controller!.resumeAfterSleep();
      await new Promise((r) => setTimeout(r, 300));
      // The first message is not repeated after the newer one.
      expect(document.requests.map((r) => [r.text, r.state])).toEqual([
        ["Primo messaggio", "failed"],
        ["Lascia stare, parliamo d'altro", "completed"],
      ]);
    } finally {
      delete process.env.TRAMA_PROVIDER_RETRY_MS;
      delete process.env.FAKE_CODEX_QUOTA_FILE;
    }
  }, 60_000);

  it("ends a running turn on Esci with its reason, and the reopened project resumes it only when asked (C11)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    void controller!.send("[attesa] Prepara il piano degli annullamenti", null, null, null);
    await until(() => project.runningRequestId !== null);
    const turnId = project.runningRequestId!;
    await until(() =>
      document.events.some((e) => e.requestId === turnId && e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore"),
    );
    const goalId = await controller!.createGoal({ title: "Annullamenti", outcome: "Gli ordini annullati tornano in revisione.", examples: [] });
    await controller!.send("Poi controlla i test", null, null, null);
    await controller!.send("Per l'obiettivo: rileggi gli esempi", null, null, null, [], null, goalId);
    await controller!.stop();
    expect(document.requests.find((r) => r.id === turnId)).toMatchObject({ state: "interrupted", failure: QUIT_NOTE });
    // The messages still in the queue go back to the chat's one draft, in order, instead of vanishing (U01).
    expect(document.composerDraft).toBe("Poi controlla i test\n\nPer l'obiettivo: rileggi gli esempi");
    expect(findGoal(document, goalId)!.dialog).toBeUndefined();

    // After the restart the provider answers: the resumed turn can end.
    process.env.FAKE_CODEX_NO_WAIT = "1";
    try {
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
      const reopened = controller.snapshot.project!;
      const interrupted = reopened.document.requests.find((r) => r.id === turnId)!;
      expect(interrupted).toMatchObject({ state: "interrupted", failure: QUIT_NOTE });
      const rows = deriveTimelineRows(reopened.document.events, reopened.document.requests, null, new Set(), reopened.document.decisionRequests);
      expect(rows.find((r) => r.kind === "failure" && r.requestId === turnId)).toMatchObject({ interrupted: true, message: QUIT_NOTE });
      // Esci asks for an explicit resume: nothing starts by itself on reopening.
      await new Promise((r) => setTimeout(r, 300));
      expect(reopened.document.requests).toHaveLength(1);
      expect(reopened.providerRetry ?? null).toBeNull();

      await controller.retryRequest(turnId);
      const resumed = reopened.document.requests[1]!;
      expect(resumed).toMatchObject({ text: interrupted.text, state: "completed", retry: { of: turnId, attempt: 0 } });
      expect(reopened.document.events.some((e) => e.requestId === resumed.id && e.content.type === "activity" && e.content.title === "Turno ripreso")).toBe(true);
      expect(reopened.document.events.filter((e) => e.content.type === "personMessage" && e.content.text === interrupted.text)).toHaveLength(1);
    } finally {
      delete process.env.FAKE_CODEX_NO_WAIT;
    }
  }, 60_000);

  it("tells the Coordinator when its previous reply closed with a generic confirmation question (W04)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    const sentDetail = (requestId: string) =>
      document.events.find((e) => e.requestId === requestId && e.content.type === "activity" && e.content.title === "Messaggio inviato al Coordinatore")
        ?.content;
    await controller!.send("[chiede-conferma] Guarda il modulo Orders", null, null, null);
    await until(() => project.runningRequestId === null && document.requests.length === 1, 20_000);
    await controller!.send("Ci sei?", null, null, null);
    await until(() => project.runningRequestId === null && document.requests.length === 2, 20_000);
    expect(sentDetail(document.requests[1]!.id)).toMatchObject({ detail: expect.stringContaining("richiamo: domanda di conferma generica") });
    // The reply that followed ends with a fact: the next turn carries no reminder.
    await controller!.send("Grazie", null, null, null);
    await until(() => project.runningRequestId === null && document.requests.length === 3, 20_000);
    expect(sentDetail(document.requests[2]!.id)).not.toMatchObject({ detail: expect.stringContaining("richiamo") });
  }, 60_000);

  it("proposes the project mandate when a project opens without one, and not again once it is granted (issue #244)", async () => {
    const { project: path } = await setup();
    const document = controller!.snapshot.project!.document;
    expect(document.mandateRequests).toHaveLength(1);
    const [request] = document.mandateRequests;
    expect(request).toMatchObject({ projectCycle: true, requestId: null, resolution: null, authorizedActions: ["plan", "executeInWorktree", "openPullRequest", "integrateCandidate", "composeTeam"] });
    expect(document.events.filter((e) => e.content.type === "card" && e.content.kind === "mandate").map((e) => e.content)).toEqual([
      expect.objectContaining({ title: "Mandato di progetto", referenceId: request!.id }),
    ]);
    // Opening it again while the proposal waits asks nothing more.
    await controller!.closeProject();
    await controller!.openProject(path);
    expect(controller!.snapshot.project!.document.mandateRequests).toHaveLength(1);

    await controller!.grantMandate({ ...request!, requestId: request!.id });
    const granted = controller!.snapshot.project!.document;
    expect(granted.mandate).toMatchObject({ status: "granted", version: 1 });
    await controller!.closeProject();
    await controller!.openProject(path);
    expect(controller!.snapshot.project!.document.mandateRequests).toHaveLength(1);
  });

  it("restricts the mandate without revoking it and tells the Coordinator (issue #244)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    const [request] = document.mandateRequests;
    await controller!.grantMandate({ ...request!, requestId: request!.id });
    await controller!.restrictMandate({ scopeModuleIds: request!.scopeModuleIds, authorizedActions: ["plan", "executeInWorktree"] });
    expect(document.mandate).toMatchObject({ status: "granted", version: 2, authorizedActions: ["plan", "executeInWorktree"] });
    expect(document.mandate!.history.map((h) => h.version)).toEqual([1]);
    const message = document.events.findLast((e) => e.content.type === "personMessage")!.content;
    expect(message).toMatchObject({ text: expect.stringContaining("Ho ristretto il mandato") });
  });

  it("stops a command a fixed ban covers, whatever the mandate, and puts it in Aspetta te (issue #244)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    const [request] = document.mandateRequests;
    await controller!.grantMandate({ ...request!, requestId: request!.id });
    await controller!.send("[vietato:git push --force origin main]", null, null, null);
    await until(() => project.runningRequestId === null && document.requests.at(-1)!.state !== "running", 20_000);
    expect(document.requests.at(-1)!.state).toBe("interrupted");
    expect(document.fixedBanRefusals).toEqual([
      expect.objectContaining({ ban: "forcePush", action: "git push --force origin main", by: { kind: "coordinator" }, acknowledgedAt: null }),
    ]);
    expect(waitingForYou(document).map((i) => i.kind)).toEqual(["fixedBan"]);
    expect(document.events.some((e) => e.content.type === "activity" && e.content.title.startsWith("Azione fermata da un divieto fisso"))).toBe(true);
    controller!.acknowledgeFixedBan(document.fixedBanRefusals![0]!.id);
    expect(waitingForYou(document)).toEqual([]);
  });

  it("supersedes a pending mandate request with a newer one, which alone can be granted (W14)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    await controller!.send("[chiedi-mandato:Primo]", null, null, null);
    await controller!.send("[chiedi-mandato:Secondo]", null, null, null);
    // The project mandate proposed at the opening (issue #244) is the oldest request: the Coordinator's first supersedes it.
    const [project, first, second] = document.mandateRequests;
    expect(project).toMatchObject({ projectCycle: true, resolution: { kind: "superseded", supersededBy: first!.id } });
    expect(first!.resolution).toMatchObject({ kind: "superseded", supersededBy: second!.id });
    expect(second!.resolution).toBeNull();
    // The Coordinator learns which request the new one replaced.
    expect(document.events.at(-1)!.content).toMatchObject({ text: expect.stringContaining(first!.id) });
    // Every card stays in the history.
    expect(document.events.filter((e) => e.content.type === "card" && e.content.kind === "mandate")).toHaveLength(3);

    const input = { objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan" as const], limits: [] };
    await expect(controller!.grantMandate({ ...input, requestId: first!.id })).rejects.toThrow(/superata/);
    expect(document.mandate).toBeNull();
    await controller!.grantMandate({ ...input, requestId: second!.id });
    expect(document.mandate?.version).toBe(1);
    expect(second!.resolution).toMatchObject({ kind: "granted", version: 1 });

    // Declining the superseded card later must not revoke the mandate granted from the newer one.
    await expect(controller!.rejectMandateRequest(first!.id, "vecchia")).rejects.toThrow(/superata/);
    expect(document.mandate?.status).toBe("granted");
    expect(first!.resolution?.kind).toBe("superseded");
  });

  it("rejects a mandate proposal without touching the mandate in force (U03)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    await controller!.grantMandate({
      requestId: null,
      objectives: ["o"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["plan", "executeInWorktree"],
      limits: [],
    });
    await controller!.send("[chiedi-mandato:Solo piani]", null, null, null);
    const request = document.mandateRequests.at(-1)!;
    await expect(controller!.rejectMandateRequest(request.id, "  ")).rejects.toThrow(/perché/);
    expect(request.resolution).toBeNull();

    await controller!.rejectMandateRequest(request.id, "Serve ancora il worktree");
    expect(document.mandate).toMatchObject({ status: "granted", version: 1, authorizedActions: ["plan", "executeInWorktree"] });
    expect(request.resolution).toMatchObject({ kind: "rejected", version: null });
    const told = document.events.filter((e) => e.content.type === "personMessage").at(-1)!.content;
    expect(told).toMatchObject({ text: expect.stringContaining("resta la versione 1") });
    await expect(controller!.rejectMandateRequest(request.id, "di nuovo")).rejects.toThrow(/già una risposta/);

    // Revoking is a separate act on the mandate in force.
    await controller!.revokeMandate("Pausa");
    expect(document.mandate?.status).toBe("revoked");
  });

  it("refuses prepare_plan without a mandate and runs it within one", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    await controller!.send("[piano]", null, null, null);
    expect(project.document.plans).toHaveLength(0);
    await controller!.grantMandate({ requestId: null, objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    await controller!.send("[piano]", null, null, null);
    expect(project.document.plans[0]?.orderedBy).toBe("coordinator");
    await until(() => project.document.plans[0]!.status === "seams");
  });

  // A grilling round, two planner turns and a restart: slower than the default timeout on a loaded machine.
  it("writes the spec with to-spec once the person confirms the seams, keeps it in Trama and after a restart (M04)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    await controller!.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
    for (const question of [...document.decisionRequests]) await controller!.answerDecision(question.id, 1, null);
    await controller!.grantMandate({ requestId: null, objectives: ["o"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    await controller!.send("[piano]", null, null, null);
    const plan = document.plans[0]!;
    await until(() => plan.status !== "planning");

    // to-spec's seam check: nothing is written or published before the person's answer.
    expect(plan.status).toBe("seams");
    expect(plan.spec).toMatchObject({ seamsAnswer: null, sections: null, issue: null });
    await expect(controller!.publishPlanSpec(plan.id)).rejects.toThrow(/spec pronta/);
    controller!.answerSeams({ planId: plan.id, confirmed: true, note: null });
    expect(plan.status).toBe("planning");
    await until(() => plan.status !== "planning");

    expect(plan.status).toBe("ready");
    expect(plan.spec!.sections).toMatchObject({ title: "Ordini pagati annullati in revisione", userStories: [expect.stringMatching(/^Come persona del supporto/), expect.any(String)] });
    // Both skills reached the planner as Codex skill inputs, and the spec turn had the person's answer.
    expect(plan.spec!.sections!.furtherNotes).toBe("Skill ricevute: to-spec, codebase-design. Risposta sui seam: Confermati come proposti.");
    expect(plan.spec!.seams).toHaveLength(1);
    expect(plan.spec!.affectedModuleIDs).toHaveLength(1);
    // Without GitHub the spec stays in Trama, and publishing it says why.
    expect(plan.spec!.issue).toBeNull();
    await expect(controller!.publishPlanSpec(plan.id)).rejects.toThrow(/GitHub non è collegato/);
    const activities = document.events.flatMap((e) => (e.content.type === "activity" ? [e.content.title] : []));
    expect(activities).toContain(`Seam del piano ${plan.id} confermati`);

    // M05: the written spec goes to the slicer, which runs to-tickets; the breakdown waits for the person.
    await until(() => plan.slicing?.status === "proposed");
    expect(plan.slicing!.tickets.map((t) => [t.id, t.blockedBy])).toEqual([
      ["S1", []],
      ["S2", ["S1"]],
      ["S3", ["S1"]],
    ]);
    expect(plan.slicing!.tickets[0]!.whatToBuild).toContain("Skill ricevute: to-tickets. Issue genitore: nessuna.");
    await expect(controller!.answerSlices({ planId: plan.id, confirmed: false, note: " " })).rejects.toThrow(/cosa cambiare/);
    // A correction starts a new round with the previous breakdown and the person's words.
    await controller!.answerSlices({ planId: plan.id, confirmed: false, note: "Aggiungi il rimborso del supporto" });
    expect(plan.slicing!.status).toBe("drafting");
    await until(() => plan.slicing?.status === "proposed");
    expect(plan.slicing!.tickets).toHaveLength(4);
    expect(plan.slicing!.tickets[3]).toMatchObject({ blockedBy: ["S2"], whatToBuild: "Correzione ricevuta: Aggiungi il rimborso del supporto" });
    await controller!.answerSlices({ planId: plan.id, confirmed: true, note: null });
    // Without GitHub the slices stay in Trama, as the plan's slices.
    expect(plan.slicing).toMatchObject({ status: "approved", publishFailure: null });
    expect(plan.slicing!.tickets.every((t) => t.issue === null)).toBe(true);
    await expect(controller!.publishPlanSlices(plan.id)).rejects.toThrow(/GitHub non è collegato/);
    expect(controller!.snapshot.project!.sliceViews![plan.id]!.map((v) => v.state)).toEqual(["ready", "blocked", "blocked", "blocked"]);

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
    const reopened = controller.snapshot.project!.document.plans[0]!;
    expect(reopened).toMatchObject({ id: plan.id, status: "ready", spec: { seams: plan.spec!.seams, sections: plan.spec!.sections, issue: null } });
    expect(reopened.slicing).toEqual(plan.slicing);
  }, 60_000);

  it("publishes the spec as a GitHub issue with the ready-for-agent label when GitHub is connected (M04)", async () => {
    const bin = await mkdtemp(join(tmpdir(), "trama-bin-"));
    const log = join(bin, "gh.log");
    const { symlink } = await import("node:fs/promises");
    const { existsSync, readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const calls = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    await symlink(join(root, "test-fixtures/fake-gh.mjs"), join(bin, "gh"));
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    process.env.FAKE_GH_LOG = log;
    try {
      const { project: projectPath } = await setup();
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/trama-fixture/ordini-finti.git"], { cwd: projectPath });
      await controller!.refreshGitHub();
      const project = controller!.snapshot.project!;
      expect(project.github).toMatchObject({ repository: "trama-fixture/ordini-finti", status: "ready" });
      await controller!.send("Gli ordini pagati annullati vanno in revisione", null, null, null);
      const plan = controller!.orderPlan({ requestId: project.document.requests[0]!.id, orderedBy: "person", kind: "agreedTicket", moduleIds: [], summary: "Revisione", issueNumber: null });
      await until(() => plan.status === "seams");
      controller!.answerSeams({ planId: plan.id, confirmed: true, note: null });
      await until(() => plan.status === "ready" && plan.spec?.issue !== null);

      expect(plan.spec!.issue).toMatchObject({ number: 7, url: "https://github.com/trama-fixture/ordini-finti/issues/7" });
      const created = calls().find((c) => c.includes("POST"))!;
      expect(created).toContain("repos/trama-fixture/ordini-finti/issues");
      expect(created).toContain("title=Ordini pagati annullati in revisione");
      expect(created).toContain("labels[]=ready-for-agent");
      expect(created.find((a) => a.startsWith("body="))).toMatch(/^body=## Problem Statement\n\nUn ordine pagato/);

      // A correction of the published spec updates its issue.
      controller!.editPlan({ planId: plan.id, sections: { ...plan.spec!.sections!, title: "Revisione degli ordini pagati annullati" } });
      await until(() => calls().some((c) => c.includes("PATCH")));
      const patched = calls().find((c) => c.includes("PATCH"))!;
      expect(patched).toContain("repos/trama-fixture/ordini-finti/issues/7");
      expect(patched).toContain("title=Revisione degli ordini pagati annullati");
      expect(plan.spec!.publishFailure).toBeNull();

      // M05: the approved slices become issues in dependency order, with the spec as parent and native blocking links.
      await until(() => plan.slicing?.status === "proposed");
      expect(plan.slicing!.tickets[0]!.whatToBuild).toContain("Issue genitore: 7.");
      await controller!.answerSlices({ planId: plan.id, confirmed: true, note: null });
      expect(plan.slicing!.tickets.map((t) => t.issue?.number)).toEqual([8, 9, 10]);
      expect(plan.slicing!.publishFailure).toBeNull();
      const tickets = calls().filter((c) => c.includes("POST") && c.includes("repos/trama-fixture/ordini-finti/issues")).slice(1);
      expect(tickets.map((c) => c.find((a) => a.startsWith("title=")))).toEqual(plan.slicing!.tickets.map((t) => `title=${t.title}`));
      for (const ticket of tickets) expect(ticket).toContain("labels[]=ready-for-agent");
      expect(tickets[1]!.find((a) => a.startsWith("body="))).toMatch(/^body=## Parent\n\n#7\n\n## What to build\n\n.*## Blocked by\n\n- #8$/s);
      const links = calls().filter((c) => c.some((a) => a.endsWith("/dependencies/blocked_by")));
      expect(links.map((c) => [c.find((a) => a.includes("/dependencies/")), c.at(-1)])).toEqual([
        ["repos/trama-fixture/ordini-finti/issues/9/dependencies/blocked_by", "issue_id=1008"],
        ["repos/trama-fixture/ordini-finti/issues/10/dependencies/blocked_by", "issue_id=1008"],
      ]);
      // The spec's issue, the parent, is not modified by the publication.
      expect(calls().filter((c) => c.includes("PATCH"))).toHaveLength(1);
    } finally {
      // Background GitHub refreshes must reach the fake gh only: stop, wait until it has been quiet, then restore PATH.
      await controller?.stop();
      controller = null;
      const logSize = () => (existsSync(log) ? readFileSync(log, "utf8").length : 0);
      let before = -1;
      let after = logSize();
      while (after !== before) {
        await new Promise((r) => setTimeout(r, 1_000));
        before = after;
        after = logSize();
      }
      process.env.PATH = path;
      delete process.env.FAKE_GH_LOG;
    }
  });

  it("closes a turn left running in a project the person leaves, and ignores its late end (C02)", async () => {
    const { project: firstPath } = await setup();
    const first = controller!.snapshot.project!;
    const sending = controller!.send("[attesa] Spiegami gli ordini", null, null, null);
    await until(() => first.document.requests.length === 1);
    const request = first.document.requests[0]!;
    await until(() => first.streaming?.requestId === request.id);

    const second = await mkdtemp(join(tmpdir(), "trama-project-"));
    await cp(join(root, "resources/DemoProject"), second, { recursive: true });
    await controller!.openProject(second);
    await sending;
    expect(request).toMatchObject({ state: "interrupted", failure: "Hai lasciato il progetto mentre il Coordinatore rispondeva." });
    const own = first.document.events.filter((e) => e.requestId === request.id).map((e) => e.content);
    expect(own.some((c) => c.type === "activity" && c.title === "Il turno non è riuscito")).toBe(false);
    expect(own.filter((c) => c.type === "activity" && c.title === "Turno interrotto")).toHaveLength(1);
    expect(controller!.snapshot.project!.document.requests).toHaveLength(0);

    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    await controller!.openProject(firstPath);
    const reopened = controller!.snapshot.project!.document;
    expect(reopened).not.toBe(first.document);
    expect(reopened.requests[0]).toMatchObject({ id: request.id, state: "interrupted", failure: request.failure });
  });

  it("withdraws a grilling question with a reason: the Coordinator reads why and the plan may start (W03)", async () => {
    await setup();
    const document = controller!.snapshot.project!.document;
    await controller!.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
    const subject = document.requests[0]!.id;
    const [first, second] = document.decisionRequests;
    await controller!.answerDecision(first!.id, 0, null);
    // One question still open: the work is still in clarification and the plan cannot start.
    expect(openGrillingQuestions(document, subject)).toHaveLength(1);
    expect(workState(document, subject).phase).toBe("clarification");

    await expect(controller!.withdrawDecision(second!.id, "  ")).rejects.toThrow(/motivo/);
    await controller!.withdrawDecision(second!.id, "La email la decidiamo dopo");
    expect(second!.withdrawal?.reason).toBe("La email la decidiamo dopo");
    expect(second!.outcome).toBeNull();
    // Trama writes the withdrawal to the Coordinator as the person's message, like an answer.
    const told = document.requests.at(-1)!;
    expect(told).toMatchObject({
      text: "Ho ritirato la domanda 2 del chiarimento, turno 1: «Il cliente riceve una email?». Motivo: La email la decidiamo dopo. Non conta più come domanda aperta.",
      state: "completed",
    });
    expect(document.events.some((e) => e.content.type === "personMessage" && e.content.text === told.text)).toBe(true);
    // The answered question and its decision stay; the withdrawn one records none.
    expect(document.decisions.map((d) => d.value)).toEqual(["Solo il supporto"]);
    await expect(controller!.withdrawDecision(first!.id, "ci ho ripensato")).rejects.toThrow(/decisione nuova/);

    // The withdrawn question no longer counts as open: the next step is the person's confirmation of the shared understanding, then the plan.
    expect(openGrillingQuestions(document, subject)).toHaveLength(0);
    const moves = workState(document, subject).moves.map((m) => m.move);
    expect(moves).not.toContain("answerQuestions");
    expect(moves).toContain("confirmUnderstanding");
  });

  it("writes the withdrawal of a question to the dialog it was asked in (W03)", async () => {
    await setup();
    const goalId = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    const document = controller!.snapshot.project!.document;
    await controller!.send("[chiedi-decisione]", null, null, null, [], null, goalId);
    await controller!.withdrawDecision(document.decisionRequests[0]!.id, "Non è il momento");
    expect(document.requests.at(-1)).toMatchObject({ goalId, text: expect.stringContaining("Motivo: Non è il momento.") });
    expect(findGoal(document, goalId)!.decisionIds).toEqual([]);
  });

  it("archives and restores a goal, saved before it is reported (W03)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const storage = new AppStorage(data);
    const saved = async (id: string) => findGoal((await storage.loadDocument(project.id)).document!, id);
    const id = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    await controller!.archiveGoal(id, true);
    expect((await saved(id))!.archivedAt).toEqual(expect.any(String));
    expect((await saved(id))!.status).toBe("open");
    await controller!.archiveGoal(id, false);
    expect((await saved(id))!.archivedAt).toBeNull();

    // A goal whose dialog has a turn running is not put away under it.
    const running = controller!.send("[attesa] Spiegami gli ordini", null, null, null, [], null, id);
    await until(() => project.runningRequestId !== null);
    await expect(controller!.archiveGoal(id, true)).rejects.toThrow(/sta rispondendo/);
    await interruptOnceSent(project.document, project.runningRequestId!);
    await running;
  });

  it("deletes an empty goal dialog and keeps one with history (W03)", async () => {
    const { data } = await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    const storage = new AppStorage(data);
    const empty = await controller!.createGoal({ title: "Doppione", outcome: "Creato per sbaglio", examples: [] });
    const used = await controller!.createGoal({ title: "Revisione", outcome: "Ordini in revisione", examples: [] });
    await controller!.send("Da dove partiamo?", null, null, null, [], null, used);
    await expect(controller!.deleteGoal(used)).rejects.toThrow(/ha già una cronologia/);
    // The Coordinator's first proposal has its card in the project dialog: it is history too.
    const proposed = document.goals!.find((g) => g.origin === "coordinator")!;
    await expect(controller!.deleteGoal(proposed.id)).rejects.toThrow(/ha già una cronologia/);

    await controller!.deleteGoal(empty);
    expect(findGoal(document, empty)).toBeNull();
    expect(dialogEvents(document.events, empty)).toEqual([]);
    expect(findGoal((await storage.loadDocument(project.id)).document!, empty)).toBeNull();
    expect(findGoal((await storage.loadDocument(project.id)).document!, used)).not.toBeNull();
  });

  it("deletes a queued message before it leaves, never one that reports a recorded choice (W03)", async () => {
    await setup();
    const project = controller!.snapshot.project!;
    const document = project.document;
    await controller!.send("[chiedi-decisione]", null, null, null);
    const question = document.decisionRequests[0]!;
    const running = controller!.send("[attesa] Spiegami gli ordini", null, null, null);
    await until(() => project.runningRequestId !== null);
    const runningId = project.runningRequestId!;
    await controller!.send("Messaggio da togliere", null, null, null);
    controller!.saveDraft("Bozza che resta");
    await controller!.answerDecision(question.id, 0, null);
    const queued = controller!.snapshot.project!.queuedMessages;
    expect(queued.map((q) => [q.text, q.goalId, q.removable])).toEqual([
      ["Messaggio da togliere", null, true],
      [expect.stringContaining("Ho risposto alla domanda"), null, false],
    ]);
    expect(() => controller!.deleteQueuedMessage(queued[1]!.id)).toThrow(/già registrata/);
    controller!.deleteQueuedMessage(queued[0]!.id);
    expect(controller!.snapshot.project!.queuedMessages.map((q) => q.id)).toEqual([queued[1]!.id]);
    expect(() => controller!.deleteQueuedMessage(queued[0]!.id)).toThrow(/non è più in coda/);

    await interruptOnceSent(document, runningId);
    await running;
    await until(() => document.requests.some((r) => r.text.startsWith("Ho risposto alla domanda") && r.state === "completed"));
    expect(document.requests.some((r) => r.text === "Messaggio da togliere")).toBe(false);
    expect(document.events.some((e) => e.content.type === "personMessage" && e.content.text === "Messaggio da togliere")).toBe(false);
    expect(controller!.snapshot.project!.queuedMessages).toEqual([]);
    // The answer Trama wrote for the person left the draft the person was writing.
    expect(document.composerDraft).toBe("Bozza che resta");
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

describe("the learning loop (ADR 0014)", () => {
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
    expect((await git(["log", "--format=%s"], project)).trim()).toBe("chore: start the project");
  });
});
