import { describe, expect, it } from "vitest";
import { descendantPids, protectedAppKind, protectedAppName } from "./protectedApps";

describe("the apps the Operator never controls (issue #597)", () => {
  it.each([
    ["Trama", "trama"],
    ["  trama ", "trama"],
    ["Electron", "trama"],
    ["Electron Helper (Renderer)", "trama"],
    ["Trama Helper (GPU)", "trama"],
    ["System Settings", "system"],
    ["System Preferences", "system"],
    ["Impostazioni di Sistema", "system"],
    ["Preferenze di Sistema", "system"],
    ["SecurityAgent", "system"],
    ["UserNotificationCenter", "system"],
    ["Keychain Access", "system"],
    ["Accesso Portachiavi", "system"],
    ["1Password", "passwords"],
    ["1Password 7", "passwords"],
    ["Bitwarden", "passwords"],
    ["LastPass", "passwords"],
    ["KeePassXC", "passwords"],
    ["Dashlane", "passwords"],
    ["Passwords", "passwords"],
  ])("%s is refused as %s", (name, kind) => {
    expect(protectedAppName(name)).toBe(kind);
  });

  it.each(["Finder", "Google Chrome", "Safari", "Notes", "Terminale", "Tramonto", "Settings Panel for Cats"])("%s is not protected", (name) => {
    expect(protectedAppName(name)).toBeNull();
  });

  it("knows Trama by bundle id, by pid and by an extra name", () => {
    expect(protectedAppKind({ name: "Whatever", bundleId: "dev.trama.app" })).toBe("trama");
    expect(protectedAppKind({ name: "Whatever", bundleId: "com.github.Electron" })).toBe("trama");
    expect(protectedAppKind({ name: "Whatever", bundleId: "com.apple.systempreferences" })).toBe("system");
    expect(protectedAppKind({ name: "Whatever", bundleId: "com.agilebits.onepassword7" })).toBe("passwords");
    expect(protectedAppKind({ name: "Whatever", pid: 10 }, { pids: [10, 11] })).toBe("trama");
    expect(protectedAppKind({ name: "Whatever", pid: 12 }, { pids: [10, 11] })).toBeNull();
    expect(protectedAppKind({ name: "Trama Beta" }, { pids: [], names: ["Trama Beta"] })).toBe("trama");
  });

  it("finds the processes that descend from a pid", () => {
    const rows = [
      { pid: 2, ppid: 1 },
      { pid: 10, ppid: 2 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 11 },
      { pid: 20, ppid: 1 },
    ];
    expect(descendantPids(10, rows).sort()).toEqual([10, 11, 12]);
    expect(descendantPids(99, rows)).toEqual([99]);
  });
});
