import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { codexPermissionProfiles, deniedReadFolders, expandHome, isReadable, privatePathsInCommand, readableRoots, sandboxGitEnvironment, toolchainRoots } from "./readScope";

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
        [
          "/usr/bin",
          "/bin",
          "/opt/homebrew/bin",
          "/opt/node22/bin",
          "/home/rita/.nvm/versions/node/v22.1.0/bin",
          "/home/rita/.local/bin",
          "/home/rita",
          "/home/rita/.codex/bin",
          "relative/bin",
          // A project's own bin, as direnv adds it, never opens the project around it.
          "/home/rita/progetti/altro/bin",
          "/workspace/altro/node_modules/.bin",
          "/workspace/altro/bin",
        ],
        home,
        codexHome,
      ),
    ).toEqual([
      "/usr",
      "/bin",
      "/opt/homebrew",
      "/opt/node22",
      "/home/rita/.nvm/versions/node/v22.1.0",
      "/home/rita/.local/bin",
      "/home/rita/progetti/altro/bin",
      "/workspace/altro/node_modules/.bin",
      "/workspace/altro/bin",
    ]);
  });

  it("hides every top-level folder that is not the platform's from a sandbox that works by denial", () => {
    expect(deniedReadFolders(home, codexHome, ["bin", "usr", "etc", "tmp", "home", "workspace", "mnt", "Users", "Volumes", "System", "private"])).toEqual([
      home,
      codexHome,
      "/home",
      "/workspace",
      "/mnt",
      "/Users",
      "/Volumes",
    ]);
    expect(deniedReadFolders("/Users/rita", "/Users/rita/.codex", ["Users", "Applications"])).toEqual(["/Users/rita", "/Users/rita/.codex", "/Users"]);
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

describe("git in a sandboxed shell (issue #391)", () => {
  it("reads no global file, so a hidden ~/.gitconfig does not break it, and signs commits as the person", async () => {
    // The sandbox hides the home folder; here ~/.gitconfig cannot be read because it is a folder.
    const hiddenHome = await mkdtemp(join(tmpdir(), "trama-home-"));
    await mkdir(join(hiddenHome, ".gitconfig"));
    const repo = await mkdtemp(join(tmpdir(), "trama-sandbox-git-"));
    const run = (args: string[], extra: Record<string, string>) =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, HOME: hiddenHome, XDG_CONFIG_HOME: join(hiddenHome, ".config"), ...extra } });
    const env = sandboxGitEnvironment({ name: "Rita Bianchi", email: "rita@bottegarossi.it" });
    expect(run(["init", "-q"], env)).toMatchObject({ status: 0, stderr: "" });
    // As before the fix: git without the sandbox's environment trips on the hidden file.
    expect(run(["status", "--short"], {}).stderr).toMatch(/unable to access .*\.gitconfig/);

    expect(env).toEqual({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Rita Bianchi",
      GIT_AUTHOR_EMAIL: "rita@bottegarossi.it",
      GIT_COMMITTER_NAME: "Rita Bianchi",
      GIT_COMMITTER_EMAIL: "rita@bottegarossi.it",
    });
    expect(run(["status", "--short"], env)).toMatchObject({ status: 0, stderr: "" });
    await writeFile(join(repo, "a.txt"), "uno\n");
    expect(run(["add", "a.txt"], env)).toMatchObject({ status: 0, stderr: "" });
    expect(run(["commit", "-q", "-m", "chore: add a"], env)).toMatchObject({ status: 0, stderr: "" });
    expect(run(["log", "-1", "--format=%an <%ae>"], env).stdout.trim()).toBe("Rita Bianchi <rita@bottegarossi.it>");
    // Without an identity git still reads no global file.
    expect(sandboxGitEnvironment(null)).toEqual({ GIT_CONFIG_GLOBAL: "/dev/null" });
  });
});
