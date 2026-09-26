import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_REFUSED_TITLE } from "@shared/codex";
import { TramaController } from "./controller";
import { git } from "./core/process";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_STUDY_GH;
});

const newController = (dataDir: string) =>
  new TramaController(dataDir, {
    publish: () => undefined,
    openExternal: async () => undefined,
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: "",
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
  });

async function until(check: () => boolean, timeout = 40_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the Coordinator uses Trama's tools, never the provider's (issue #228)", () => {
  it("records a refusal during the project study as an activity", async () => {
    process.env.FAKE_CODEX_STUDY_GH = "1";
    const repo = await mkdtemp(join(tmpdir(), "trama-provider-tools-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    controller = newController(await mkdtemp(join(tmpdir(), "trama-data-")));
    await controller.start();
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading", 20_000);
    const refused = controller.snapshot.project!.document.events.filter((e) => e.content.type === "activity" && e.content.title === TOOL_REFUSED_TITLE);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.content).toMatchObject({ detail: expect.stringContaining("Richiesta: gh issue list") });
  }, 90_000);

  it("records the refused gh command as an activity and reads the issues with read_issues on the next turn", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-provider-tools-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    controller = newController(await mkdtemp(join(tmpdir(), "trama-data-")));
    await controller.start();
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading", 20_000);
    const document = controller.snapshot.project!.document;
    const replies = () => document.events.flatMap((e) => (e.content.type === "coordinatorText" ? [e.content.text] : []));

    await controller.send("[issue-gh] leggi le issue", null, null, null);
    await until(() => replies().some((text) => text.startsWith("github")));
    const refused = document.events.filter((e) => e.content.type === "activity" && e.content.title === TOOL_REFUSED_TITLE);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.content).toMatchObject({
      tone: "error",
      detail: expect.stringContaining("Gli strumenti GitHub del provider sono bloccati: per le issue usa read_issues di Trama."),
    });

    await controller.send("[issue-gh] leggi le issue", null, null, null);
    await until(() => replies().some((text) => text.startsWith("trama:")));
    expect(document.events.some((e) => e.content.type === "activity" && e.content.title === "Strumento di Trama: read_issues")).toBe(true);
  }, 90_000);
});
