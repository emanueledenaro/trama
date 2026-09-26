import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { skillInRouteBinding } from "./core/askTrama";
import { git } from "./core/process";

const root = join(import.meta.dirname, "../..");
const skillsDirectory = join(root, "resources/AIHero/skills");
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

type Request = { method: string; params: { threadId?: string; input?: { type: string; text?: string; name?: string; path?: string }[] } };

async function setup() {
  const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
  process.env.FAKE_CODEX_LOG = log;
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
  await controller.updateSettings({ continuousWork: false, autoPrepareMethod: false });
  await controller.openProject(repo);
  await until(() => controller!.snapshot.project?.phase.kind === "ready");
  const requests = async (): Promise<Request[]> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Request);
  const turnText = (request: Request) => request.params.input!.filter((i) => i.type === "text").map((i) => i.text).join("\n");
  return { project: controller.snapshot.project!, requests, turnText };
}

describe("Ask Trama in the conversation (M07)", () => {
  it("proposes a route for /ask-trama and starts its first flow in Trama once the person confirms", async () => {
    const { project, requests, turnText } = await setup();
    const document = project.document;
    // /ask-trama is in the composer without the method prepared, from the bundled skill.
    await until(() => project.skills.some((s) => s.name === "ask-trama"));
    expect(project.aiHeroPrepared).toBe(false);
    expect(project.skills.find((s) => s.name === "ask-trama")).toMatchObject({
      path: join(skillsDirectory, "ask-trama/SKILL.md"),
      description: "Ask which skill or flow fits your situation. A router over the skills in this repo.",
    });

    await controller!.send("/ask-trama Gli ordini pagati annullati devono andare in revisione.", null, null, null);
    const turn = (await requests()).filter((r) => r.method === "turn/start").at(-1)!;
    expect(turn.params.input!.filter((i) => i.type === "skill").map((i) => [i.name, i.path])).toContainEqual(["ask-trama", join(skillsDirectory, "ask-trama/SKILL.md")]);
    expect(turnText(turn)).toContain("## Ask Trama\nThe person wrote /ask-trama");
    const route = document.routes!.at(-1)!;
    expect(route).toMatchObject({ path: "mainFlow", boundary: "continue", status: "proposed" });
    expect(route.steps.map((s) => `${s.skill}:${s.kind}`)).toEqual([
      "grill-with-docs:flow",
      "prototype:skill",
      "to-spec:flow",
      "to-tickets:flow",
      "implement:flow",
      "code-review:flow",
    ]);
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "route" && e.content.referenceId === route.id)).toBe(true);
    // Nothing started yet: no grilling question before the person's confirmation.
    expect(document.decisionRequests).toEqual([]);

    const thread = document.coordinator.threadId;
    await controller!.answerRoute(route.id, true);
    expect(route.status).toBe("started");
    expect(document.coordinator.threadId).toBe(thread);
    const start = document.requests.at(-1)!;
    expect(start.text).toMatch(/^Avvia il percorso AT-[0-9A-F]{8} di Ask Trama: flusso principale, grill-with-docs → prototype → to-spec/);
    // The route's first step is grilling: round 1 is open, in Trama.
    expect(document.decisionRequests.map((q) => q.grilling?.round)).toEqual([1, 1]);
    // The bundled skill without a Trama flow arrives with its original text and its binding.
    const startTurn = (await requests()).filter((r) => r.method === "turn/start").at(-1)!;
    expect(startTurn.params.input!.filter((i) => i.type === "skill").map((i) => i.path)).toContain(join(skillsDirectory, "prototype/SKILL.md"));
    expect(turnText(startTurn)).toContain(`## Trama binding for the prototype skill\n${skillInRouteBinding("prototype")}`);
    await expect(controller!.answerRoute(route.id, false)).rejects.toThrow("Hai già risposto a questo percorso.");
  }, 30_000);

  it("refuses a step ask-trama does not name, and records a declined route", async () => {
    const { project } = await setup();
    const document = project.document;
    await controller!.send("/ask-trama [inventata] Voglio pubblicare.", null, null, null);
    expect(document.routes ?? []).toEqual([]);
    expect((document.events.at(-1)!.content as { text: string }).text).toContain("ask-trama does not name deploy");
    await controller!.send("/ask-trama Gli ordini pagati annullati.", null, null, null);
    const route = document.routes!.at(-1)!;
    await controller!.answerRoute(route.id, false);
    expect(route.status).toBe("declined");
    expect(document.requests.at(-1)!.text).toBe(`Non avvio il percorso ${route.id} di Ask Trama (${route.steps.map((s) => s.skill).join(" → ")}).`);
    expect(document.decisionRequests).toEqual([]);
  }, 30_000);

  it("opens a new Coordinator session at the boundary the route names", async () => {
    const { project, requests, turnText } = await setup();
    const document = project.document;

    // "/clear": a new session with the study and without the conversation, then the standalone skill.
    await controller!.send("/ask-trama [strumento] Voglio provare lo stato in revisione.", null, null, null);
    const clear = document.routes!.at(-1)!;
    expect(clear).toMatchObject({ path: "standalone", boundary: "clear", steps: [{ skill: "prototype", kind: "skill" }] });
    const first = document.coordinator.threadId;
    await controller!.answerRoute(clear.id, true);
    expect(document.coordinator.threadId).not.toBe(first);
    expect(document.coordinator.pendingHandover).toBeNull();
    const opening = (await requests()).filter((r) => r.method === "turn/start" && r.params.threadId === document.coordinator.threadId);
    expect(turnText(opening[0]!)).toContain("La persona ha aperto una sessione nuova senza la conversazione precedente");
    expect(turnText(opening[0]!)).not.toContain("Voglio provare lo stato in revisione");
    expect((document.events.at(-1)!.content as { text: string }).text).toContain(`Percorso ${clear.id} avviato. Skill ricevute:`);
    expect((document.events.at(-1)!.content as { text: string }).text).toContain(`skill:prototype:${join(skillsDirectory, "prototype/SKILL.md")}`);
    expect(document.events.some((e) => e.content.type === "card" && e.content.title === `Nuova sessione per il percorso ${clear.id}`)).toBe(true);

    // "/compact": a new session that receives Trama's transcript of the conversation.
    await controller!.send("/ask-trama [riassunto] Ora costruiamolo.", null, null, null);
    const compact = document.routes!.at(-1)!;
    const second = document.coordinator.threadId;
    await controller!.answerRoute(compact.id, true);
    expect(document.coordinator.threadId).not.toBe(second);
    const handover = (await requests()).filter((r) => r.method === "turn/start" && r.params.threadId === document.coordinator.threadId);
    expect(turnText(handover[0]!)).toContain("## Conversazione finora");
    expect(turnText(handover[0]!)).toContain("Ora costruiamolo.");
    expect(document.events.some((e) => e.content.type === "card" && e.content.title === `Riassunto per il percorso ${compact.id}`)).toBe(true);
  }, 30_000);
});
