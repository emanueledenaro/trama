import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import type { CommandResult, CommandRunner } from "./core/operatorCommands";
import { git } from "./core/process";
import { SecretLock } from "./core/secretLock";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
});

interface FakeShell extends CommandRunner {
  ran: string[];
  cwds: string[];
  hang: boolean;
  started: boolean;
  answers: Record<string, CommandResult>;
}

function fakeShell(): FakeShell {
  const shell: FakeShell = {
    ran: [],
    cwds: [],
    hang: false,
    started: false,
    answers: {},
    async run(command, { cwd, signal }) {
      shell.ran.push(command);
      shell.cwds.push(cwd);
      if (shell.hang) {
        shell.started = true;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      return shell.answers[command] ?? { exitCode: 0, output: "", timedOut: false };
    },
  };
  return shell;
}

async function open(shell: CommandRunner, askLimitMs?: number): Promise<TramaController> {
  controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
    publish: () => undefined,
    openExternal: async () => undefined,
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: "",
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    commandRunner: shell,
    secretLock: new SecretLock({ home: "/Users/ada", realpath: () => null }),
    ...(askLimitMs ? { askLimitMs } : {}),
  });
  const repo = await mkdtemp(join(tmpdir(), "trama-operator-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  await controller.start();
  await controller.openProject(repo);
  await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading", 20_000);
  return controller;
}

async function until(check: () => boolean, timeout = 40_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const replies = (c: TramaController) => c.snapshot.project!.document.events.flatMap((e) => (e.content.type === "coordinatorText" ? [e.content.text] : []));
const answer = (c: TramaController, count: number) => {
  const text = replies(c).filter((r) => r.startsWith("Operatore: "))[count]!.slice("Operatore: ".length);
  return JSON.parse(text) as { kind?: string; source?: string; report?: string; commandsRun?: string[]; error?: { code: string } };
};
const chatLines = (c: TramaController) => c.snapshot.project!.document.events.flatMap((e) => (e.content.type === "card" && e.content.kind === "contextNotice" ? [e.content.title] : []));

describe("the Operator runs commands on the Mac with secrets locked (issue #409)", () => {
  it("exists in every project, runs what is safe, stops what touches a secret and asks before what cannot be undone", async () => {
    const shell = fakeShell();
    shell.answers["ls docs"] = { exitCode: 0, output: "guida.md\n", timedOut: false };
    const c = await open(shell);
    const document = () => c.snapshot.project!.document;
    expect(document().mandate).toBeNull();
    const operator = document().team.specialists.find((s) => s.role === "operator");
    expect(operator).toMatchObject({ name: "Operatore", status: expect.not.stringMatching(/removed/) });

    await c.send("[operatore:ls docs ;; cat ~/.ssh/id_rsa ;; cat .env ;; rm -rf build ;; printenv]", null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    const result = answer(c, 0);
    expect(result).toMatchObject({ kind: "data", source: "operator", commandsRun: ["ls docs"] });
    expect(result.report).toContain("ls docs: eseguito (0) guida.md");
    expect(result.report).toContain("cat ~/.ssh/id_rsa: rifiutato (locked)");
    expect(result.report).toContain("cat .env: rifiutato (locked)");
    expect(result.report).toContain("rm -rf build: rifiutato (waiting_for_person)");
    expect(result.report).toContain("printenv: rifiutato (locked)");
    // Nothing locked or waiting ever reached the shell.
    expect(shell.ran).toEqual(["ls docs"]);

    // Every command is a row of Activity, in the Operator's name; the chat has a line for the one that ran and the one that waits.
    const steps = document().accessSteps!;
    expect(steps.map((s) => [s.agent, s.kind, s.target, s.outcome])).toEqual([
      ["Operatore", "command", "ls docs", "done"],
      ["Operatore", "command", "cat ~/.ssh/id_rsa", "refused"],
      ["Operatore", "command", "cat .env", "refused"],
      ["Operatore", "command", "rm -rf build", "waiting"],
      ["Operatore", "command", "printenv", "refused"],
    ]);
    // A command that only reads stays in Activity (issue #583).
    expect(chatLines(c).some((title) => title.includes("ls docs"))).toBe(false);
    expect(chatLines(c).some((title) => title.startsWith("Operatore aspetta il tuo sì"))).toBe(true);

    // The locked commands wait in "Aspetta te" with the secrets ban and the place; the deletion waits for a yes.
    expect(document().fixedBanRefusals!.map((r) => [r.ban, r.by.kind])).toEqual([["secrets", "operator"], ["secrets", "operator"], ["secrets", "operator"]]);
    expect(document().fixedBanRefusals![0]!.action).toBe("cat ~/.ssh/id_rsa (~/.ssh)");
    const waiting = (c.snapshot.project!.waiting ?? []).map((item) => item.kind);
    expect(waiting.filter((kind) => kind === "fixedBan")).toHaveLength(3);
    expect(waiting.filter((kind) => kind === "commandApproval")).toHaveLength(1);

    // The person says yes: Trama runs the deletion itself, once, and Activity has a second row for it.
    const approval = document().commandApprovals![0]!;
    expect(approval).toMatchObject({ command: "rm -rf build", reason: "delete", status: "waiting" });
    await c.confirmCommandApproval(approval.id);
    expect(shell.ran).toEqual(["ls docs", "rm -rf build"]);
    expect(chatLines(c)).toContain("Operatore ha lanciato un comando: rm -rf build");
    expect(document().commandApprovals![0]!.status).toBe("done");
    expect(document().accessSteps!.at(-1)).toMatchObject({ agent: "Operatore", kind: "command", target: "rm -rf build", outcome: "done" });
    expect((c.snapshot.project!.waiting ?? []).some((item) => item.kind === "commandApproval")).toBe(false);
    await expect(c.confirmCommandApproval(approval.id)).rejects.toThrow();
  }, 90_000);

  it("never runs a command the person said no to", async () => {
    const shell = fakeShell();
    const c = await open(shell);
    await c.send("[operatore:rm -rf cache]", null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    const approval = c.snapshot.project!.document.commandApprovals![0]!;
    c.declineCommandApproval(approval.id);
    expect(c.snapshot.project!.document.commandApprovals![0]!.status).toBe("declined");
    expect(shell.ran).toEqual([]);
    expect(() => c.declineCommandApproval(approval.id)).toThrow();
  }, 90_000);

  it("runs a yes again through the lock: a command that became locked does not start", async () => {
    const shell = fakeShell();
    const c = await open(shell);
    await c.send("[operatore:rm -rf cache]", null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    const approval = c.snapshot.project!.document.commandApprovals![0]!;
    approval.command = "rm ~/.ssh/known_hosts";
    await c.confirmCommandApproval(approval.id);
    expect(shell.ran).toEqual([]);
    expect(c.snapshot.project!.document.fixedBanRefusals!.at(-1)).toMatchObject({ ban: "secrets", by: { kind: "operator" } });
  }, 90_000);

  it("refuses at once when the switch is off", async () => {
    const shell = fakeShell();
    const c = await open(shell);
    await c.setComputerAccess(false);
    await c.send("[operatore:ls]", null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    expect(answer(c, 0).error?.code).toBe("access_off");
    expect(shell.ran).toEqual([]);
    expect(c.snapshot.project!.document.accessSteps!.map((s) => [s.kind, s.outcome])).toEqual([["command", "refused"]]);
  }, 90_000);

  it("stops the command in progress the moment the switch goes off", async () => {
    const shell = fakeShell();
    shell.hang = true;
    const c = await open(shell);
    const turn = c.send("[operatore:sleep 100]", null, null, null);
    await until(() => shell.started);
    await c.setComputerAccess(false);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    expect(answer(c, 0).error?.code).toBe("stopped");
    await turn;
    const change = c.snapshot.project!.document.accessChanges!.at(-1)!;
    expect(change).toMatchObject({ on: false, by: "person" });
    expect(change.stopped.every((action) => action.agent === "Operatore")).toBe(true);
    expect(change.stopped.length).toBeGreaterThan(0);
    expect(c.computerAccess.actions()).toEqual([]);
  }, 90_000);

  it("keeps the reads in Activity, tells in the chat what changes something, and does not count a search without results as an error (issue #583)", async () => {
    const shell = fakeShell();
    shell.answers['rg "gta" docs'] = { exitCode: 1, output: "", timedOut: false };
    shell.answers["cat missing.txt"] = { exitCode: 1, output: "", timedOut: false };
    const c = await open(shell);
    await c.send('[operatore:cat README.md ;; find . -name "*.md" ;; rg "gta" docs ;; cat missing.txt ;; mkdir build ;; sed -i s/a/b/ NOTE.md]', null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    expect(shell.ran).toEqual(["cat README.md", 'find . -name "*.md"', 'rg "gta" docs', "cat missing.txt", "mkdir build", "sed -i s/a/b/ NOTE.md"]);
    const lines = chatLines(c);
    expect(lines).toEqual(["Operatore ha lanciato un comando: mkdir build", "Operatore ha lanciato un comando: sed -i s/a/b/ NOTE.md"]);
    const steps = c.snapshot.project!.document.accessSteps!;
    expect(steps.map((s) => [s.target, s.outcome, s.detail])).toEqual([
      ["cat README.md", "done", null],
      ['find . -name "*.md"', "done", null],
      ['rg "gta" docs', "done", "nothing"],
      ["cat missing.txt", "failed", "exit:1"],
      ["mkdir build", "done", null],
      ["sed -i s/a/b/ NOTE.md", "done", null],
    ]);
  }, 90_000);

  it("hands back what the Operator did, with the reason, and stops its command when its time limit runs out (issue #583)", async () => {
    const shell = fakeShell();
    shell.hang = true;
    const c = await open(shell, 600);
    await c.send("[operatore:sleep 100]", null, null, null);
    await until(() => replies(c).some((r) => r.startsWith("Operatore: ")));
    const result = answer(c, 0) as ReturnType<typeof answer> & { stoppedBy?: string; note?: string };
    expect(result).toMatchObject({ kind: "data", source: "operator", stoppedBy: "timeLimit" });
    expect(result.error).toBeUndefined();
    expect(result.note).toContain("time limit");
    // The command in progress ended with the session: no action is left running and the switch did not move.
    expect(c.computerAccess.actions()).toEqual([]);
    expect(c.snapshot.project!.document.accessChanges ?? []).toEqual([]);
  }, 90_000);
});
