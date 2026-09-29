import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";

const root = join(import.meta.dirname, "../..");
const controllers: TramaController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

async function start(data: string, systemLanguages: string[]): Promise<TramaController> {
  const controller = new TramaController(data, {
    publish: () => undefined,
    openExternal: async () => undefined,
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    systemLanguages: () => systemLanguages,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: join(root, "resources/DemoProject"),
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
  });
  controllers.push(controller);
  await controller.start();
  return controller;
}

describe("interface language (issue #301)", () => {
  it("starts in the system's language, then keeps the person's choice", async () => {
    const data = await mkdtemp(join(tmpdir(), "trama-language-"));
    const first = await start(data, ["en-US"]);
    expect(first.snapshot.language).toBe("en");
    expect(first.snapshot.settings.language).toBeUndefined();

    await first.updateSettings({ language: "it" });
    expect(first.snapshot.language).toBe("it");
    expect(JSON.parse(await readFile(join(data, "settings.json"), "utf8")).language).toBe("it");
    await first.stop();

    // The choice outlives a restart, whatever the system says.
    const second = await start(data, ["en-US"]);
    expect(second.snapshot.language).toBe("it");
  });

  it("speaks Italian when the system's language is not one Trama has", async () => {
    const controller = await start(await mkdtemp(join(tmpdir(), "trama-language-")), ["de-DE"]);
    expect(controller.snapshot.language).toBe("it");
  });

  it("refuses a language Trama does not have", async () => {
    const controller = await start(await mkdtemp(join(tmpdir(), "trama-language-")), ["it-IT"]);
    await expect(controller.updateSettings({ language: "fr" as never })).rejects.toThrow();
    expect(controller.snapshot.language).toBe("it");
  });

  it("writes the controller's refusals in the person's language", async () => {
    const controller = await start(await mkdtemp(join(tmpdir(), "trama-language-")), ["en-US"]);
    await expect(controller.updateSettings({ language: "fr" as never })).rejects.toThrow("Language not available.");
    await expect(controller.updateSettings({ sharedDevelopers: 2.5 })).rejects.toThrow("The number of shared developers must be a whole number.");
    await expect(controller.prioritizeProject("missing", "up")).rejects.toThrow("The project is not among the recent ones.");
    await expect(controller.startExercise("missing" as never)).rejects.toThrow("Unknown exercise.");

    await controller.updateSettings({ language: "it" });
    await expect(controller.updateSettings({ sharedDevelopers: 2.5 })).rejects.toThrow("Il numero di sviluppatori condivisi deve essere un numero intero.");
    await expect(controller.prioritizeProject("missing", "up")).rejects.toThrow("Il progetto non è tra quelli recenti.");
  });
});
