import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexPermissionProfiles, expandHome, isReadable, privatePathsInCommand, readableRoots, toolchainRoots } from "./readScope";

const home = "/home/rita";
const codexHome = "/home/rita/.codex";

describe("read scope of agent sessions (issue #206)", () => {
  it("expands the home folder only at the start of a path", () => {
    expect(expandHome("~/.codex/memories/MEMORY.md", home)).toBe("/home/rita/.codex/memories/MEMORY.md");
    expect(expandHome("$HOME/x", home)).toBe("/home/rita/x");
    expect(expandHome("${HOME}", home)).toBe(home);
    expect(expandHome("src/~/x", home)).toBe("src/~/x");
  });

  it("reads inside the roots and refuses the rest, symlinks and .. included", async () => {
    const base = await mkdtemp(join(tmpdir(), "trama-scope-"));
    const project = join(base, "project");
    const outside = join(base, "codex-home");
    await mkdir(project);
    await mkdir(outside);
    await writeFile(join(outside, "MEMORY.md"), "privato");
    await symlink(outside, join(project, "memoria"));
    const roots = readableRoots(project);
    expect(isReadable(roots, project, "Sources/Orders/CancelPaidOrder.swift")).toBe(true);
    expect(isReadable(roots, project, join(project, "README.md"))).toBe(true);
    expect(isReadable(roots, project, join(outside, "MEMORY.md"))).toBe(false);
    expect(isReadable(roots, project, "../codex-home/MEMORY.md")).toBe(false);
    expect(isReadable(roots, project, "memoria/MEMORY.md")).toBe(false);
    expect(isReadable(roots, project, "~/.codex/memories/MEMORY.md", base)).toBe(false);
    expect(isReadable([...roots, ...readableRoots(outside)], project, "memoria/MEMORY.md")).toBe(true);
  });

  it("lets a shell reach the toolchains on PATH but never the home folder or Codex's home", () => {
    expect(
      toolchainRoots(
        ["/usr/bin", "/bin", "/opt/homebrew/bin", "/home/rita/.nvm/versions/node/v22.1.0/bin", "/home/rita/.local/bin", "/home/rita", "/home/rita/.codex/bin", "relative/bin"],
        home,
        codexHome,
      ),
    ).toEqual(["/usr", "/bin", "/opt/homebrew", "/home/rita/.nvm/versions/node/v22.1.0", "/home/rita/.local/bin"]);
  });

  it("names the private paths a shell command reaches outside the roots", () => {
    const roots = ["/home/rita/progetti/negozio", "/Applications/Trama.app/Contents/Resources/AIHero/skills"];
    const cwd = roots[0]!;
    expect(
      privatePathsInCommand(`/bin/bash -lc 'rg -n -i "ordini|improve-codebase-architecture|architecture review" ~/.codex/memories/MEMORY.md'`, cwd, roots, home, codexHome),
    ).toEqual(["/home/rita/.codex/memories/MEMORY.md"]);
    expect(privatePathsInCommand("cat ../altro/.env --config=$HOME/.ssh/config /etc/hosts", cwd, roots, home, codexHome)).toEqual([
      "/home/rita/progetti/altro/.env",
      "/home/rita/.ssh/config",
    ]);
    expect(privatePathsInCommand("git -C /home/rita/progetti/negozio status && npm test", cwd, roots, home, codexHome)).toEqual([]);
    expect(privatePathsInCommand("cat /tmp/x.log", cwd, roots, home, "/var/codex")).toEqual([]);
    expect(privatePathsInCommand("cat /var/codex/memories/MEMORY.md", cwd, roots, home, "/var/codex")).toEqual(["/var/codex/memories/MEMORY.md"]);
  });

  it("builds Codex profiles that read only the roots and write only the worktree, without network", () => {
    const worktree = "/data/Worktrees/a1";
    expect(codexPermissionProfiles([worktree, "/home/rita/negozio"], worktree)).toEqual({
      "permissions.trama_read": { filesystem: { ":minimal": "read", [worktree]: "read", "/home/rita/negozio": "read" }, network: { enabled: false } },
      "permissions.trama_write": { filesystem: { ":minimal": "read", [worktree]: "write", "/home/rita/negozio": "read" }, network: { enabled: false } },
    });
    expect(Object.keys(codexPermissionProfiles(["/home/rita/negozio"], null))).toEqual(["permissions.trama_read"]);
  });
});
