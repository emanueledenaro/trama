import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectDocument, SpecialistAssignment, TeamRole } from "@shared/domain";
import { TramaController } from "./controller";
import { git } from "./core/process";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
const saved = { CODEX_HOME: process.env.CODEX_HOME, FAKE_CODEX_LOG: process.env.FAKE_CODEX_LOG, FAKE_CODEX_MEMORY_PROBE: process.env.FAKE_CODEX_MEMORY_PROBE };
afterEach(async () => {
  await controller?.stop();
  controller = null;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function until(check: () => boolean, timeout = 40_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const work = (document: ProjectDocument, role: TeamRole): SpecialistAssignment[] =>
  document.team.specialists.filter((s) => s.role === role).flatMap((s) => s.assignments);

describe("agents stay in the project (issue #206)", () => {
  it("replays the live proof: Clean Code greps Codex's memory, the sandbox refuses it and Trama records the attempt", async () => {
    // Codex's home with a global memory that talks about another project.
    const codexHome = await mkdtemp(join(tmpdir(), "trama-codex-home-"));
    await mkdir(join(codexHome, "memories"));
    const memory = join(codexHome, "memories", "MEMORY.md");
    await writeFile(memory, "ordini: nota privata di un altro progetto\n");
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.CODEX_HOME = codexHome;
    process.env.FAKE_CODEX_LOG = log;
    process.env.FAKE_CODEX_MEMORY_PROBE = "1";

    const repo = await mkdtemp(join(tmpdir(), "trama-scope-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "demo", private: true, scripts: { test: "node -e \"process.exit(1)\"" } }));
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
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading", 20_000);
    const document = controller.snapshot.project!.document;
    await controller.grantMandate({
      requestId: null,
      objectives: ["Correggere i bug"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });

    // As on 26 September: a failed check, its diagnosis and fix, then the free team's architecture review (A-B25D3B7D).
    await controller.send("[verifica:node_test]", null, null, null);
    await until(() => work(document, "cleanCode")[0]?.status === "completed", 60_000);
    const [review] = work(document, "cleanCode");

    // The review ran `rg ... ~/.codex/memories/MEMORY.md`; the sandbox hid the file, so nothing from it came back.
    const outcome = review!.duty?.outcome;
    expect(outcome?.kind).toBe("architecture");
    expect(outcome?.kind === "architecture" && outcome.topRecommendation).not.toContain("Memoria letta");
    expect(JSON.stringify(document)).not.toContain("nota privata");

    // Trama records and shows the attempt in the review's activity.
    const attempts = document.events.filter(
      (e) => e.assignmentId === review!.id && e.content.type === "activity" && e.content.title === "Lettura fuori dal progetto bloccata",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.content).toMatchObject({ tone: "error" });
    expect(attempts[0]!.content.type === "activity" && attempts[0]!.content.detail).toContain(memory);

    // Every Codex session of the project ran with memories off and a profile that reads only its folders.
    const requests = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
    const sessions = requests.filter((r) => r.method === "thread/start" || r.method === "thread/resume");
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    for (const session of sessions) {
      const config = session.params.config as Record<string, { filesystem?: Record<string, string> } & Record<string, unknown>>;
      expect(config.features).toMatchObject({ memories: false });
      expect(session.params.sandbox).toBeUndefined();
      const readable = Object.keys(config["permissions.trama_read"]!.filesystem!);
      expect(readable).toEqual(expect.arrayContaining([":minimal", repo, join(root, "resources/AIHero/skills")]));
      expect(readable.some((path) => codexHome.startsWith(path) || path.startsWith(codexHome))).toBe(false);
    }
    for (const turn of requests.filter((r) => r.method === "turn/start")) {
      expect(turn.params.sandboxPolicy).toBeUndefined();
      expect(["trama_read", "trama_write"]).toContain(turn.params.permissions);
    }
  }, 90_000);
});
