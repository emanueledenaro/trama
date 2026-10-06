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
