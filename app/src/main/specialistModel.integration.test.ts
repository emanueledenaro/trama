import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: Record<string, unknown> };

describe("the agent's model chosen by the person (issue #455)", () => {
  it("saves the choice, writes it in Activity, runs the next assignment on it and refuses an unknown provider or a removed agent", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const requests = async (): Promise<Request[]> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Request);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
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
    const document = controller.snapshot.project!.document;
    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    const ada = findSpecialist(document, "Ada")!;

    // Saved, and written in Activity with the provider, the model and the effort.
    await controller.setSpecialistModelByPerson(ada.id, { provider: "codex", model: "gpt-5.5-fast", effort: "low" });
    expect(ada.chosenModel).toMatchObject({ provider: "codex", model: "gpt-5.5-fast", effort: "low" });
    const saved = document.events.at(-1)!.content;
    expect(saved).toMatchObject({ type: "activity", title: "Modello di Ada scelto dalla persona" });
    expect(saved.type === "activity" ? saved.detail : null).toContain("gpt-5.5-fast, sforzo low");

    // An unknown provider is refused and the choice stays as it was.
    await expect(controller.setSpecialistModelByPerson(ada.id, { provider: "nope" as never, model: "x", effort: null })).rejects.toMatchObject({
      code: "unknown_provider",
    });
    expect(ada.chosenModel?.model).toBe("gpt-5.5-fast");

    // The Coordinator names no model: the assignment runs on the person's, with its effort.
    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller.send("[assegna]", null, null, null);
    const assignment = ada.assignments[0]!;
    expect(assignment).toMatchObject({ provider: "codex", model: "gpt-5.5-fast", effort: "low", modelReason: "Modello scelto dalla persona per questo agente." });
    await until(() => assignment.turns.length > 0);
    const turn = (await requests()).filter((r) => r.method === "turn/start" && r.params.model === "gpt-5.5-fast").at(-1)!;
    expect(turn.params).toMatchObject({ model: "gpt-5.5-fast", effort: "low" });
    await until(() => !["preparing", "running", "stopRequested"].includes(assignment.status), 20_000);

    // A removed agent keeps no settings.
    await controller.removeSpecialistByPerson(ada.id, "Non serve più");
    await expect(controller.setSpecialistModelByPerson(ada.id, { provider: "codex", model: "gpt-5.5", effort: null })).rejects.toMatchObject({
      code: "specialist_removed",
    });
    await expect(controller.setSpecialistModelByPerson("S-NOPE", null)).rejects.toMatchObject({ code: "unknown_specialist" });
  }, 40_000);
});
