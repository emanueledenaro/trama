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

async function openDemo(): Promise<TramaController> {
  const data = await mkdtemp(join(tmpdir(), "trama-data-"));
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  const opened = new TramaController(data, {
    publish: () => undefined,
    openExternal: async () => undefined,
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: "",
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
  });
  controller = opened;
  await opened.start();
  await opened.updateSettings({ continuousWork: false });
  await opened.openProject(repo);
  await until(() => opened.snapshot.project?.phase.kind === "ready");
  return opened;
}

describe("the agent's model chosen by the person (issue #455)", () => {
  it("saves the choice, tells it in Activity and runs the next assignment on it over the Coordinator's", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const requests = async (): Promise<Request[]> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Request);
    const trama = await openDemo();
    const document = trama.snapshot.project!.document;
    await trama.send("[proponi-team]", null, null, null);
    await trama.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    const ada = findSpecialist(document, "Ada")!;

    await trama.setSpecialistModelByPerson(ada.id, "codex", "gpt-5.5-fast", "low");
    expect(ada.chosenModel).toMatchObject({ provider: "codex", model: "gpt-5.5-fast", effort: "low" });
    expect(document.events.at(-1)!.content).toMatchObject({
      type: "activity",
      title: "Modello di Ada cambiato",
      detail: "ChatGPT, GPT-5.5 Fast, sforzo Basso. Vale dai prossimi incarichi; quello in corso non cambia.",
    });

    await trama.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await trama.send("[assegna]", null, null, null);
    const assignment = ada.assignments[0]!;
    expect(assignment).toMatchObject({ provider: "codex", model: "gpt-5.5-fast", effort: "low", modelReason: "Modello scelto dalla persona nella scheda dell'agente." });
    await until(() => assignment.status === "completed");
    const turn = (await requests()).filter((r) => r.method === "turn/start" && r.params.cwd === assignment.workspace!.worktreeRoot).at(-1)!;
    expect(turn.params).toMatchObject({ model: "gpt-5.5-fast", effort: "low" });
    // The latest assignment's model is recorded apart: it never overwrites the person's choice.
    expect(ada.chosenModel).toMatchObject({ model: "gpt-5.5-fast", effort: "low" });

    // Leaving the choice to the Coordinator again is told in Activity too.
    await trama.setSpecialistModelByPerson(ada.id, "codex", null, null);
    expect(ada.chosenModel).toBeNull();
    expect(document.events.at(-1)!.content).toMatchObject({ type: "activity", title: "Il modello di Ada torna al Coordinatore" });
  }, 30_000);

  it("refuses a provider Trama does not know, a model the catalogue lacks and an agent that left the team", async () => {
    const trama = await openDemo();
    const document = trama.snapshot.project!.document;
    await trama.send("[proponi-team]", null, null, null);
    await trama.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    const ada = findSpecialist(document, "Ada")!;
    const events = document.events.length;

    await expect(trama.setSpecialistModelByPerson(ada.id, "nobody" as never, "gpt-5.5", null)).rejects.toThrow("Trama non conosce il provider nobody.");
    await expect(trama.setSpecialistModelByPerson(ada.id, "codex", "gpt-0", null)).rejects.toThrow("Il modello gpt-0 non è nel catalogo di ChatGPT.");
    expect(ada.chosenModel ?? null).toBeNull();
    expect(document.events.length).toBe(events);

    await trama.removeSpecialistByPerson(ada.id, "Non serve più");
    await expect(trama.setSpecialistModelByPerson(ada.id, "codex", "gpt-5.5", null)).rejects.toThrow(/was removed from the team/);
    await expect(trama.setSpecialistModelByPerson("S-nobody", "codex", "gpt-5.5", null)).rejects.toThrow(/Unknown specialist/);
  }, 30_000);
});
