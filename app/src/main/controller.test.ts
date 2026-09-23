import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "@shared/domain";
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
  await controller.openProject(project);
  await until(() => controller!.snapshot.project?.phase.kind === "ready");
  return { data, project };
}

describe("TramaController", () => {
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
    expect(kinds).toEqual(["card", "personMessage", "activity", "activity", "coordinatorText"]);
    const reply = project.document.events.at(-1)!.content;
    expect(reply).toMatchObject({ references: ["Sources/Orders/CancelPaidOrder.swift"] });
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
