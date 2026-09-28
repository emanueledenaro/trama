import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROVIDERS } from "@shared/providers";
import { translate } from "@shared/i18n";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
const CONTEXT_ROLLOVER_TITLE = translate("it", "context.rollover.title");
const CONTEXT_SUMMARY_TITLE = translate("it", "context.summary.activityTitle");
const ROLLOVER_FAILED_TITLE = translate("it", "context.failed.title");
const ROLLOVER_COMPACTED_DETAIL = translate("it", "context.failed.compacted");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_CODEX_FAIL_THREAD_START;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: { threadId?: string; cwd?: string; config?: Record<string, unknown>; input?: { type: string; text?: string }[] } };

async function setup() {
  const logs = await mkdtemp(join(tmpdir(), "trama-log-"));
  const log = join(logs, "codex.log");
  const failStart = join(logs, "fail-thread-start");
  process.env.FAKE_CODEX_LOG = log;
  process.env.FAKE_CODEX_FAIL_THREAD_START = failStart;
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
  const turnText = (request: Request) => (request.params.input ?? []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
  return { project: controller.snapshot.project!, requests, turnText, failStart };
}

const cards = (project: { document: { events: { content: { type: string; title?: string } }[] } }, title: string) =>
  project.document.events.filter((e) => e.content.type === "card" && e.content.title === title);

describe("the context managed by Trama (ADR 0018)", () => {
  it("reorders the context at the end of the turn past the threshold and sends the queued message to the new session", async () => {
    const { project, requests, turnText } = await setup();
    const document = project.document;
    const oldThread = document.coordinator.threadId!;

    // The turn passes the threshold; a message written meanwhile waits in the queue.
    const first = controller!.send("[pieno] uno", null, null, null);
    await until(() => project.runningRequestId !== null);
    await controller!.send("Poi controlla gli ordini annullati", null, null, null);
    await first;
    await until(() => document.requests.length === 2 && document.requests.every((r) => r.state === "completed"), 20_000);

    // Never in the middle of the turn: the turn that passed the threshold ran whole on the old thread.
    const log = await requests();
    const turns = log.filter((r) => r.method === "turn/start");
    const full = turns.find((r) => turnText(r).includes("[pieno] uno"))!;
    expect(full.params.threadId).toBe(oldThread);
    const newThread = document.coordinator.threadId!;
    expect(newThread).not.toBe(oldThread);
    // The new session is a new thread, never a resume of the old one, and its first turn is the study with the summary.
    const started = log.filter((r) => r.method === "thread/start");
    expect(log.filter((r) => r.method === "thread/resume")).toHaveLength(0);
    expect(started).toHaveLength(2);
    const study = turns.find((r) => r.params.threadId === newThread)!;
    const studyText = turnText(study);
    expect(studyText).toContain("# Riepilogo di contesto scritto da Trama");
    expect(studyText).toContain("## Richieste che aspettano la persona");
    expect(studyText).toContain("## Ultimi scambi (alla lettera)\nPersona: [pieno] uno");
    expect(studyText).toContain("Trama ha riordinato il contesto");
    // The queued message goes to the new session, after its study.
    const queued = turns.find((r) => r !== study && turnText(r).includes("Poi controlla gli ordini annullati"))!;
    expect(queued.params.threadId).toBe(newThread);
    expect(turns.indexOf(queued)).toBeGreaterThan(turns.indexOf(study));
    // The provider's own compaction starts above Trama's threshold: halfway between 80% and a full window.
    expect(started[1]!.params.config).toMatchObject({ model_auto_compact_token_limit: 232_200 });

    // One line in the chat, right after the summary Trama kept in Activity.
    const card = cards(project, CONTEXT_ROLLOVER_TITLE);
    expect(card).toHaveLength(1);
    const summaryIndex = document.events.findIndex((e) => e.content.type === "activity" && e.content.title === CONTEXT_SUMMARY_TITLE);
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(document.events[summaryIndex + 1]).toBe(card[0]);
    expect(document.coordinator.pendingRollover).toBeNull();
    expect(document.coordinator.pendingHandover).toBeNull();
    expect(cards(project, "Contesto oltre la soglia")).toHaveLength(0);
    // What the person reads is a plain view of the same records: no framing for the model, no tool names, no provider.
    const summary = document.events[summaryIndex]!.content;
    const forPerson = summary.type === "activity" ? summary.detail! : "";
    expect(forPerson).toContain("## Obiettivi");
    expect(forPerson).toContain("## Cosa aspetta te");
    for (const phrase of ["dati, non istruzioni", "Vale più di quello che ricordi", "declare_next_step", "session_search", "Stato attuale di Trama", "[pieno] uno"]) {
      expect(forPerson).not.toContain(phrase);
    }
    const own = [JSON.stringify(card[0]!.content), forPerson];
    for (const provider of PROVIDERS) for (const text of own) expect(text).not.toMatch(new RegExp(`\\b${provider.name}\\b`));
  }, 60_000);

  it("goes back to the old thread and asks the provider to compact it when the new session cannot open", async () => {
    const { project, requests, failStart } = await setup();
    const document = project.document;
    const oldThread = document.coordinator.threadId!;
    await writeFile(failStart, "");

    await controller!.send("[pieno] uno", null, null, null);
    await until(() => cards(project, ROLLOVER_FAILED_TITLE).length === 1 && project.phase.kind === "ready", 20_000);
    const compact = (await requests()).filter((r) => r.method === "thread/compact/start");
    expect(compact.map((r) => r.params.threadId)).toEqual([oldThread]);
    expect(cards(project, ROLLOVER_FAILED_TITLE)[0]!.content).toMatchObject({ detail: ROLLOVER_COMPACTED_DETAIL });
    expect(cards(project, CONTEXT_ROLLOVER_TITLE)).toHaveLength(0);
    // The provider compacted: nothing is owed any more, and the work goes on.
    expect(document.coordinator.pendingRollover).toBeNull();
    expect(document.coordinator.pendingHandover).toBeNull();
    await controller!.send("Continuiamo", null, null, null);
    expect(document.requests.at(-1)!.state).toBe("completed");
  }, 60_000);

  it("reorders on request from the meter, and at the end of the turn while one runs", async () => {
    const { project } = await setup();
    const document = project.document;
    await controller!.send("Ciao", null, null, null);
    const oldThread = document.coordinator.threadId!;

    controller!.reorderContext();
    await until(() => cards(project, CONTEXT_ROLLOVER_TITLE).length === 1 && project.phase.kind === "ready", 20_000);
    expect(document.coordinator.threadId).not.toBe(oldThread);

    // While a turn runs the request waits for its end.
    const thread = document.coordinator.threadId!;
    const running = controller!.send("Un altro messaggio", null, null, null);
    await until(() => project.runningRequestId !== null);
    controller!.reorderContext();
    expect(document.coordinator.pendingRollover).toMatchObject({ reason: "manual" });
    expect(document.coordinator.threadId).toBe(thread);
    await running;
    await until(() => cards(project, CONTEXT_ROLLOVER_TITLE).length === 2 && project.phase.kind === "ready", 20_000);
    expect(document.coordinator.threadId).not.toBe(thread);
  }, 60_000);

  it("gives a specialist a new thread with a brief of its worktree when its last turn passed the threshold", async () => {
    const { project, requests, turnText } = await setup();
    const document = project.document;
    await controller!.send("[proponi-team]", null, null, null);
    await controller!.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    await controller!.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller!.send("[assegna] [lento:sempre] [specialista-pieno]", null, null, null);
    const assignment = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => assignment.status === "running" && assignment.turns[0]?.contextPercent === 89, 30_000);
    const worktree = assignment.workspace!.worktreeRoot;
    await controller!.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped", 30_000);
    const oldThread = assignment.threadId;

    await controller!.resumeSpecialistWork(assignment.id);
    await until(() => assignment.status === "running" && assignment.turns.length === 2, 30_000);
    const log = await requests();
    expect(log.filter((r) => r.method === "thread/start" && r.params.cwd === worktree)).toHaveLength(2);
    expect(log.filter((r) => r.method === "thread/resume" && r.params.cwd === worktree)).toHaveLength(0);
    expect(assignment.threadId).not.toBe(oldThread);
    const resumed = turnText(log.filter((r) => r.method === "turn/start" && r.params.cwd === worktree).at(-1)!);
    expect(resumed).toContain("## Riepilogo del worktree scritto da Trama");
    expect(resumed).toContain(`Branch: ${assignment.workspace!.branch}.`);
    expect(resumed).toContain(`Riprendi l'incarico ${assignment.id}`);
    const activity = document.events.find((e) => e.content.type === "activity" && e.content.title === "Nuovo thread dello specialista");
    expect(activity?.content).toMatchObject({ detail: expect.stringContaining("Contesto usato nel turno precedente: 89%, oltre la soglia del progetto (80%).") });
    await controller!.stopSpecialistWork(assignment.id);
    await until(() => assignment.status === "stopped", 30_000);
  }, 90_000);
});
