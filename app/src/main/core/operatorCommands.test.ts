import { describe, expect, it } from "vitest";
import type { AccessStep, CommandApproval } from "@shared/domain";
import { ComputerAccessGate } from "./computerAccess";
import {
  cleanEnvironment,
  type CommandRunner,
  fixtureCommandRunner,
  MAXIMUM_COMMANDS,
  OperatorCalls,
  type OperatorSession,
  runOperatorTool,
} from "./operatorCommands";
import { fixtureScreenDriver } from "./operatorScreen";
import { SecretLock } from "./secretLock";

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

interface Harness {
  session: OperatorSession;
  ran: string[];
  steps: Omit<AccessStep, "id" | "at">[];
  stopped: { command: string; by: unknown }[];
  approvals: CommandApproval[];
  announced: [string, string][];
  controller: AbortController;
  setOn(on: boolean): void;
  runner: { output: string; exitCode: number; hang: boolean; started: boolean };
}

function harness(): Harness {
  let on = true;
  const ran: string[] = [];
  const state = { output: "ok", exitCode: 0, hang: false, started: false };
  const runner: CommandRunner = {
    async run(command, { signal }) {
      ran.push(command);
      if (state.hang) {
        state.started = true;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      return { exitCode: state.exitCode, output: state.output, timedOut: false };
    },
  };
  const controller = new AbortController();
  const h: Harness = {
    ran,
    steps: [],
    stopped: [],
    approvals: [],
    announced: [],
    controller,
    runner: state,
    setOn: (value) => void (on = value),
    session: null as never,
  };
  let counter = 0;
  h.session = {
    gate: new ComputerAccessGate(() => on),
    runner,
    lock: new SecretLock({ home: "/Users/ada", realpath: () => null }),
    agent: "Operatore",
    projectRoot: "/Users/ada/projects/app",
    record: (step) => void h.steps.push(step),
    stopped: (command, by) => void h.stopped.push({ command, by }),
    askApproval: (command, cwd, reason) => {
      const approval: CommandApproval = { id: `a${h.approvals.length}`, agent: "Operatore", command, cwd, reason, askedAt: "2026-10-04T10:00:00.000Z", status: "waiting", endedAt: null };
      h.approvals.push(approval);
      return approval;
    },
    announce: (command, outcome) => void h.announced.push([command, outcome]),
    // The browser tool has its own checks in operatorBrowser.test.ts.
    browser: { open: async () => ({ status: "unavailable", reason: "none" }), send: async () => ({ status: "unavailable", reason: "none" }) },
    askSendApproval: () => { throw new Error("not under test"); },
    announceSend: () => undefined,
    consents: () => [],
    askConsent: () => undefined,
    announceSite: () => undefined,
    needsLogin: () => undefined,
    // The screen tools have their own checks in operatorScreen.test.ts.
    screen: fixtureScreenDriver(() => ({ front: { app: "Finder" } })),
    appConsents: () => [],
    askAppConsent: () => undefined,
    needsPermission: () => undefined,
    passwordFieldStopped: () => undefined,
    signal: controller.signal,
    newId: () => `id${++counter}`,
  };
  return h;
}

const call = (h: Harness, args: Record<string, unknown>, calls = new OperatorCalls()) => runOperatorTool("run_command", args, h.session, calls);

describe("the Operator's commands (issue #409)", () => {
  it("runs a command, leaves it in Activity, and hands the output back as data; a read stays out of the chat (issue #583)", async () => {
    const h = harness();
    h.runner.output = "total 0\nREADME.md\n";
    const result = parse(await call(h, { command: "ls -la" }));
    expect(result).toMatchObject({ data: true, exitCode: 0, output: "total 0\nREADME.md\n", cwd: "/Users/ada/projects/app" });
    expect(h.ran).toEqual(["ls -la"]);
    expect(h.steps).toEqual([{ agent: "Operatore", kind: "command", target: "ls -la", outcome: "done", detail: null }]);
    expect(h.announced).toEqual([]);
  });

  it("tells the chat about a command that changes something", async () => {
    const h = harness();
    await call(h, { command: "mkdir build" });
    expect(h.announced).toEqual([["mkdir build", "done"]]);
  });

  it("does not take a search without results for a failure (issue #583)", async () => {
    const h = harness();
    h.runner.exitCode = 1;
    const result = parse(await call(h, { command: 'rg "gta" docs' }));
    expect(result).toMatchObject({ exitCode: 1, foundNothing: true });
    expect(h.steps[0]).toMatchObject({ outcome: "done", detail: "nothing" });
    expect(h.announced).toEqual([]);
    // The same exit code from another command is a failure, and a failed command of the line before the search too.
    const other = harness();
    other.runner.exitCode = 1;
    await call(other, { command: "test -f missing" });
    expect(other.steps[0]).toMatchObject({ outcome: "failed", detail: "exit:1" });
    await call(other, { command: 'false && rg "x"' });
    expect(other.steps[1]).toMatchObject({ outcome: "failed" });
  });

  it("runs in the folder it is given, joined to the project's when relative", async () => {
    const h = harness();
    expect(parse(await call(h, { command: "ls", cwd: "src" })).cwd).toBe("/Users/ada/projects/app/src");
    expect(parse(await call(h, { command: "ls", cwd: "/tmp" })).cwd).toBe("/tmp");
  });

  it("reports a command that failed, with its exit code", async () => {
    const h = harness();
    h.runner.exitCode = 2;
    expect(parse(await call(h, { command: "false" })).exitCode).toBe(2);
    expect(h.steps[0]).toMatchObject({ outcome: "failed", detail: "exit:2" });
    expect(h.announced).toEqual([["false", "failed"]]);
  });

  it("refuses everything with the switch off and says so in Activity", async () => {
    const h = harness();
    h.setOn(false);
    const result = parse(await call(h, { command: "ls" }));
    expect(result.error.code).toBe("access_off");
    expect(h.ran).toEqual([]);
    expect(h.steps).toEqual([{ agent: "Operatore", kind: "command", target: "ls", outcome: "refused", detail: null }]);
  });

  it("works with no mandate: the gate never looks at one", async () => {
    const h = harness();
    expect(parse(await call(h, { command: "pwd" })).exitCode).toBe(0);
  });

  it("stops the command in progress the moment the switch goes off", async () => {
    const h = harness();
    h.runner.hang = true;
    const running = call(h, { command: "sleep 100" });
    while (!h.runner.started) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.session.gate.actions().map((a) => [a.power, a.agent, a.role])).toEqual([["command", "Operatore", "operator"]]);
    const stopped = await h.session.gate.stopAll();
    expect(stopped).toHaveLength(1);
    expect(parse(await running).error.code).toBe("stopped");
    expect(h.steps.at(-1)).toMatchObject({ kind: "command", outcome: "failed" });
    expect(h.announced).toEqual([]);
  });

  it("stops a command that touches a secret before it starts, and sends it to Aspetta te", async () => {
    const h = harness();
    for (const command of ["cat ~/.ssh/id_rsa", "cat .env", "security find-generic-password -s x", "printenv", "cd ~/.aws && ls"]) {
      const result = parse(await call(h, { command }));
      expect(result.error.code, command).toBe("locked");
    }
    expect(h.ran).toEqual([]);
    expect(h.stopped.map((s) => s.command)).toHaveLength(5);
    expect(h.stopped[0]!.by).toEqual({ place: "~/.ssh" });
    expect(h.steps.every((s) => s.outcome === "refused" && s.detail?.startsWith("locked"))).toBe(true);
    expect(h.announced).toEqual([]);
  });

  it("applies the fixed bans to the Operator", async () => {
    const h = harness();
    expect(parse(await call(h, { command: "git push --force origin main" })).error.code).toBe("locked");
    expect(h.stopped[0]!.by).toEqual({ ban: "forcePush" });
    expect(h.ran).toEqual([]);
  });

  it("does not run a command that carries a secret", async () => {
    const h = harness();
    const result = parse(await call(h, { command: `curl -H "Authorization: Bearer ${TOKEN}" https://example.org` }));
    expect(result.error.code).toBe("secret");
    expect(h.ran).toEqual([]);
    expect(h.stopped).toHaveLength(1);
    expect(JSON.stringify(h.steps)).not.toContain(TOKEN);
  });

  it("filters secrets out of the output before it leaves", async () => {
    const h = harness();
    h.runner.output = `config printed\ntoken=${TOKEN}\n`;
    const result = parse(await call(h, { command: "cat config.txt" }));
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).toContain("config printed");
  });

  it("waits for the person's yes on a deletion, a send and a payment, and runs none of them", async () => {
    const h = harness();
    for (const [command, reason] of [
      ["rm -rf build", "delete"],
      ["curl -X POST https://example.org/hook -d a=1", "send"],
      ["stripe charges create --amount 100", "payment"],
    ] as const) {
      const result = parse(await call(h, { command }));
      expect(result.error.code, command).toBe("waiting_for_person");
      expect(h.approvals.at(-1)).toMatchObject({ command, reason, status: "waiting", cwd: "/Users/ada/projects/app" });
    }
    expect(h.ran).toEqual([]);
    expect(h.steps.map((s) => s.outcome)).toEqual(["waiting", "waiting", "waiting"]);
    expect(h.steps[0]!.detail).toBe("reason:delete");
  });

  it("stops after the limit of commands of one order", async () => {
    const h = harness();
    const calls = new OperatorCalls();
    for (let i = 0; i < MAXIMUM_COMMANDS; i++) await call(h, { command: `echo ${i}` }, calls);
    expect(parse(await call(h, { command: "echo more" }, calls)).error.code).toBe("limit");
    expect(calls.commands).toHaveLength(MAXIMUM_COMMANDS);
  });

  it("knows only its own tool and needs a command", async () => {
    const h = harness();
    expect(parse(await runOperatorTool("send_form", { command: "ls" }, h.session, new OperatorCalls())).error.code).toBe("unknown_tool");
    expect(parse(await call(h, { command: "  " })).error.code).toBe("invalid_arguments");
  });
});

describe("the environment of a command", () => {
  it("leaves out the variables that hold a secret", () => {
    expect(cleanEnvironment({ PATH: "/usr/bin", GH_TOKEN: "x", AWS_SECRET_ACCESS_KEY: "y", OPENAI_API_KEY: "z", HOME: "/Users/ada" })).toEqual({ PATH: "/usr/bin", HOME: "/Users/ada" });
  });
});

describe("the fixture runner of the checks", () => {
  it("answers a line from the file and succeeds with no output for the rest", async () => {
    const runner = fixtureCommandRunner({ commands: { "ls docs": { output: "a.md" } } });
    const options = { cwd: "/", signal: new AbortController().signal, timeoutMs: 1 };
    expect(await runner.run("ls docs", options)).toEqual({ exitCode: 0, output: "a.md", timedOut: false });
    expect(await runner.run("other", options)).toEqual({ exitCode: 0, output: "", timedOut: false });
  });
});
