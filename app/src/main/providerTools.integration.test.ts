import { cp, mkdtemp, readFile } from "node:fs/promises";
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
  delete process.env.FAKE_CODEX_LOG;
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
  it("records options written in the reply instead of a card and sends the Coordinator back to request_decision", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
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
    const replies = () => document.events.filter((e) => e.content.type === "coordinatorText").length;
    const before = replies();

    await controller.send("[scelte] documenta anche docs/", null, null, null);
    await until(() => replies() > before);
    const problems = document.events.filter((e) => e.content.type === "activity" && e.content.title === "Scelta scritta nel testo invece che in una scheda");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.content).toMatchObject({ tone: "error", detail: "Rispondimi con 1, 2 o 3." });

    await controller.send("[scelte] allora?", null, null, null);
    await until(() => replies() > before + 1);
    const turns = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { method: string; params: { input?: Array<{ text?: string }> } });
    const last = turns.filter((t) => t.method === "turn/start").at(-1)!;
    expect(last.params.input![0]!.text).toContain("## Scelta scritta nel testo");
    expect(last.params.input![0]!.text).toContain("request_decision");
  }, 90_000);

  it("gives the current state every turn and flags a button named in the reply that the person does not have (issue #269)", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
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
    const replies = () => document.events.filter((e) => e.content.type === "coordinatorText").length;
    const before = replies();
    const turns = async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method: string; params: { input?: Array<{ text?: string }> } })
        .filter((t) => t.method === "turn/start");

    await controller.send("[pulsante] cosa devo fare?", null, null, null);
    await until(() => replies() > before);
    const first = (await turns()).at(-1)!.params.input![0]!.text!;
    expect(first).toContain("## Stato attuale di Trama");
    expect(first).toContain("Pulsanti che la persona vede ora: nessuno.");
    const flagged = document.events.filter((e) => e.content.type === "activity" && e.content.title === "Pulsante citato che ora non c'è");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.content).toMatchObject({
      tone: "error",
      detail: "Il Coordinatore ha nominato il pulsante «Verifica il candidato», che ora non c'è. Adesso non c'è un pulsante da premere.",
    });

    await controller.send("[pulsante] non lo trovo", null, null, null);
    await until(() => replies() > before + 1);
    const second = (await turns()).at(-1)!.params.input![0]!.text!;
    expect(second).toContain("## Pulsante che non c'è");
    expect(second).toContain("«Verifica il candidato»");
    // The corrected reply names no button: nothing new is flagged.
    expect(document.events.filter((e) => e.content.type === "activity" && e.content.title === "Pulsante citato che ora non c'è")).toHaveLength(1);
  }, 90_000);

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
