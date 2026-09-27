import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_CODEX_STUDY_GATE;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: { model?: string | null; input?: { type: string; text?: string }[] } };

async function requests(log: string): Promise<Request[]> {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Request);
}

const isStudy = (request: Request) =>
  request.method === "turn/start" && (request.params.input ?? []).some((i) => i.text?.startsWith("Studio del progetto scritto da Trama"));

async function newProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "trama-project-"));
  await cp(join(root, "resources/DemoProject"), project, { recursive: true });
  return project;
}

async function startController(data: string): Promise<TramaController> {
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
  await until(() => controller!.snapshot.codex.account?.kind === "chatgpt" && controller!.snapshot.providers.codex.models.length > 0);
  await controller.updateSettings({ autoPrepareMethod: false, continuousWork: false });
  return controller;
}

describe("the Coordinator's model (issue #205)", () => {
  it("studies a new project on the catalogue's default when the person has not chosen a model", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    await startController(await mkdtemp(join(tmpdir(), "trama-data-")));
    await controller!.openProject(await newProject());
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    // The fake catalogue marks gpt-5.5 as its default: no model name written in Trama wins over it.
    const sent = await requests(log);
    expect(sent.find((r) => r.method === "thread/start")?.params.model).toBe("gpt-5.5");
    expect(sent.filter(isStudy).map((r) => r.params.model)).toEqual(["gpt-5.5"]);
    expect(controller!.snapshot.project!.document.coordinator.threadModel).toBe("gpt-5.5");
  });

  it("restarts the study on the model the person chooses while it runs, and remembers it for the next project", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const gate = join(await mkdtemp(join(tmpdir(), "trama-gate-")), "study");
    process.env.FAKE_CODEX_STUDY_GATE = gate;
    const data = await mkdtemp(join(tmpdir(), "trama-data-"));
    await startController(data);
    await controller!.openProject(await newProject());
    const project = controller!.snapshot.project!;
    await until(() => existsSync(`${gate}.held`) && project.phase.kind === "studying");

    await controller!.selectModel("gpt-5.5-fast", "low", "codex");
    await writeFile(gate, "");
    await until(() => project.phase.kind === "ready");

    const sent = await requests(log);
    const threads = sent.filter((r) => r.method === "thread/start");
    expect(threads.map((r) => r.params.model)).toEqual(["gpt-5.5", "gpt-5.5-fast"]);
    // The study the person saw is the one on their model: the stopped one leaves no card behind.
    expect(sent.filter(isStudy).at(-1)?.params.model).toBe("gpt-5.5-fast");
    expect(project.document.coordinator.threadModel).toBe("gpt-5.5-fast");
    expect(project.document.events.filter((e) => e.content.type === "card" && e.content.kind === "study")).toHaveLength(1);
    expect(controller!.snapshot.settings.coordinatorModels?.codex).toEqual({ model: "gpt-5.5-fast", effort: "low" });

    // After a restart of Trama, a new project starts its study on the model the person chose.
    await controller!.stop();
    delete process.env.FAKE_CODEX_STUDY_GATE;
    await startController(data);
    // Trama reopens the last project first: its thread goes on with the model the person chose.
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    expect(controller!.snapshot.project!.document.coordinator.threadModel).toBe("gpt-5.5-fast");
    await writeFile(log, "");
    await controller!.openProject(await newProject());
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const next = await requests(log);
    expect(next.filter((r) => r.method === "thread/start").map((r) => r.params.model)).toEqual(["gpt-5.5-fast"]);
    expect(next.filter(isStudy).map((r) => r.params.model)).toEqual(["gpt-5.5-fast"]);
  });

  it("records the model of a turn as the thread's model", async () => {
    await startController(await mkdtemp(join(tmpdir(), "trama-data-")));
    await controller!.openProject(await newProject());
    const project = controller!.snapshot.project!;
    await until(() => project.phase.kind === "ready");
    expect(project.document.coordinator.threadModel).toBe("gpt-5.5");
    await controller!.selectModel("gpt-5.5-fast", "low", "codex");
    await controller!.send("Ciao", null, "gpt-5.5-fast", "low");
    await until(() => project.document.requests.at(-1)?.state === "completed");
    expect(project.document.coordinator.threadModel).toBe("gpt-5.5-fast");
  });
});
