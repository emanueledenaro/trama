import { describe, expect, it } from "vitest";
import { SANDBOX_EXEC, sandboxedSpawn, sandboxProfile, systemPlaces } from "./operatorSandbox";

const plan = {
  hidden: ["/Users/ada/Library/Application Support/Trama", "/Applications/Trama.app", ...systemPlaces("/Users/ada").hidden],
  readOnly: systemPlaces("/Users/ada").readOnly,
};

describe("the sandbox of the Operator's commands on macOS (issue #597)", () => {
  it("keeps out Trama's data and installation, Apple Events, the window server and Launch Services", () => {
    const { profile, params } = sandboxProfile(plan, (path) => (path.startsWith("/var/") ? `/private${path}` : null));
    expect(profile).toMatch(/^\(version 1\)\n\(allow default\)/);
    expect(profile).toContain("(deny appleevent-send)");
    expect(profile).toContain('(global-name "com.apple.windowserver.active")');
    expect(profile).toContain('(global-name "com.apple.coreservices.launchservicesd")');
    expect(profile).toContain('(deny iokit-open (iokit-user-client-class "IOHIDParamUserClient"))');
    expect(profile).toContain('(literal "/usr/bin/osascript")');
    expect(profile).toContain('(literal "/bin/launchctl")');
    // The folders travel as parameters: no path is ever written into the rules.
    expect(profile).not.toContain("Trama.app");
    expect(profile).toMatch(/\(deny file-read\* file-write\* process-exec \(subpath \(param "HIDDEN_0"\)\)/);
    expect(params).toContain("HIDDEN_0=/Users/ada/Library/Application Support/Trama");
    expect(params).toContain("HIDDEN_1=/Applications/Trama.app");
    expect(params.filter((p) => p.startsWith("READONLY_")).map((p) => p.split("=")[1])).toContain("/Users/ada/Library/LaunchAgents");
    expect(params.filter((p) => p === "-D")).toHaveLength(params.length / 2);
  });

  it("keeps the project open when it sits inside Trama's data, after the rules that hide the rest", () => {
    const { profile, params } = sandboxProfile({ hidden: ["/Users/ada/Trama"], readOnly: [], open: ["/Users/ada/Trama/Examples/Demo"] }, () => null);
    expect(params).toContain("OPEN_1=/Users/ada/Trama/Examples/Demo");
    expect(profile.trim().split("\n").at(-1)).toBe('(allow file-read* file-write* process-exec (subpath (param "OPEN_1")))');
    // A project that holds Trama's data opens nothing of it.
    expect(sandboxProfile({ hidden: ["/Users/ada/Trama"], readOnly: [], open: ["/Users/ada"] }, () => null).profile).not.toContain("(allow file-read*");
  });

  it("names both the written and the real path of a folder", () => {
    const { params } = sandboxProfile({ hidden: ["/var/trama"], readOnly: [] }, (path) => (path === "/var/trama" ? "/private/var/trama" : null));
    expect(params).toEqual(["-D", "HIDDEN_0=/var/trama", "-D", "HIDDEN_1=/private/var/trama"]);
  });

  it("wraps the command on macOS and leaves it as it is elsewhere", () => {
    const command = `echo "a b" && ls`;
    const mac = sandboxedSpawn(command, plan, "darwin", () => null);
    expect(mac.file).toBe(SANDBOX_EXEC);
    expect(mac.args.slice(-3)).toEqual(["/bin/sh", "-c", command]);
    expect(mac.args[mac.args.indexOf("-p") + 1]).toContain("(deny appleevent-send)");
    expect(sandboxedSpawn(command, plan, "linux")).toEqual({ file: "/bin/sh", args: ["-c", command] });
    expect(sandboxedSpawn(command, null, "darwin")).toEqual({ file: "/bin/sh", args: ["-c", command] });
  });
});

describe("a sandbox that does not start runs nothing (issue #597)", () => {
  it("stops the command before it starts, and asks the Mac once per profile", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { shellCommandRunner } = await import("./operatorCommands");
    const folder = await mkdtemp(join(tmpdir(), "trama-sandbox-"));
    const probed: string[] = [];
    const runner = shellCommandRunner({
      sandbox: () => plan,
      platform: "darwin",
      probe: async (given) => {
        probed.push(given.hidden[0]!);
        return "sandbox-exec: profile not valid";
      },
    });
    const options = { cwd: folder, signal: new AbortController().signal, timeoutMs: 5_000 };
    await expect(runner.run("touch ran", options)).rejects.toThrow(/did not start, so nothing ran: sandbox-exec: profile not valid/);
    await expect(runner.run("touch ran", options)).rejects.toThrow(/did not start/);
    expect(existsSync(join(folder, "ran"))).toBe(false);
    expect(probed).toHaveLength(1);
  });
});
