import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { agentTempFolder, browserCacheRoots, codexPermissionProfiles, sandboxSearchPath,
  SYSTEM_READ_ROOTS, deniedReadFolders, expandHome, isReadable, privatePathsInCommand, readableRoots, sandboxGitEnvironment, toolchainRoots } from "./readScope";

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

  it("ignores paths inside script content (issue #563): -c/-e for code interpreters and heredocs for them", () => {
    const roots = ["/home/rita/progetti/negozio"];
    const cwd = roots[0]!;
    // Paths inside -c/-e for code interpreters should not be flagged
    expect(privatePathsInCommand('python -c "import os; os.chdir(\'../content/records.json\')"', cwd, roots, home, codexHome)).toEqual([]);
    // Home and Codex paths inside a script are real attempts and stay reported
    expect(privatePathsInCommand('python3 -c "open(\'~/.codex/memories/MEMORY.md\')"', cwd, roots, home, codexHome)).toEqual([
      "/home/rita/.codex/memories/MEMORY.md",
    ]);
    expect(privatePathsInCommand("python3 - <<'PY'\nopen('/home/rita/.ssh/id_rsa')\nPY", cwd, roots, home, codexHome)).toEqual(["/home/rita/.ssh/id_rsa"]);
    expect(privatePathsInCommand('python -c "import os; os.chdir(\'/home/rita/.ssh/config\')"', cwd, roots, home, codexHome)).toEqual(["/home/rita/.ssh/config"]);
    expect(privatePathsInCommand("python3 - <<'PY'\nopen('~/.codex/memories/MEMORY.md')\nPY", cwd, roots, home, codexHome)).toEqual(["/home/rita/.codex/memories/MEMORY.md"]);
    // The exact simulated case: heredoc inside zsh -lc, closing delimiter followed by the shell's quote
    expect(privatePathsInCommand('/bin/zsh -lc "python3 - <<\'PY\'\nopen(\'../content/records.json\')\nPY"', cwd, roots, home, codexHome)).toEqual([]);
    expect(privatePathsInCommand('/bin/zsh -lc "python3 - <<\'PY\'\\nopen(\'../content/records.json\')\\nPY"', cwd, roots, home, codexHome)).toEqual([]);
    expect(privatePathsInCommand('/bin/zsh -lc \'cat ~/.ssh/id_rsa\'', cwd, roots, home, codexHome)).toEqual(["/home/rita/.ssh/id_rsa"]);
    expect(privatePathsInCommand('node -e \'fs.readFileSync("../images/file.txt")\'', cwd, roots, home, codexHome)).toEqual([]);
    expect(privatePathsInCommand('ruby -e "File.read(\'../data/file.txt\')"', cwd, roots, home, codexHome)).toEqual([]);
    // Shell -c arguments are parsed for real reads, not stripped
    expect(privatePathsInCommand('/bin/zsh -lc \'cat ~/.codex/memories/MEMORY.md\'', cwd, roots, home, codexHome)).toEqual([
      "/home/rita/.codex/memories/MEMORY.md",
    ]);
    expect(privatePathsInCommand('/bin/bash -c "cat ../outro/.env"', cwd, roots, home, codexHome)).toEqual([
      "/home/rita/progetti/outro/.env",
    ]);
    // Heredocs for code interpreters should not be flagged
    expect(privatePathsInCommand('python3 - <<\'PY\'\nwith open(\'../content/records.json\') as f:\n    pass\nPY', cwd, roots, home, codexHome)).toEqual([]);
    expect(privatePathsInCommand('ruby - <<\'RB\'\nFile.read(\'../content/data.rb\')\nRB', cwd, roots, home, codexHome)).toEqual([]);
    // Heredocs for cat should still be analyzed
    expect(privatePathsInCommand('cat <<EOF\ndata\nEOF\ncat ../altro/.env', cwd, roots, home, codexHome)).toEqual([
      "/home/rita/progetti/altro/.env",
    ]);
    // Mixed: real read outside code interpreter block
    expect(privatePathsInCommand('python -c "x=1" && cat ~/.codex/memories/MEMORY.md', cwd, roots, home, codexHome)).toEqual([
      "/home/rita/.codex/memories/MEMORY.md",
    ]);
  });

  it("builds Codex profiles that read only the roots and write only the worktree, without network", () => {
    const worktree = "/data/Worktrees/a1";
    // The system folders a runtime reads as it starts, such as OpenSSL's configuration for node (2 October 2026).
    const system = Object.fromEntries(SYSTEM_READ_ROOTS.map((root) => [root, "read"]));
    expect(codexPermissionProfiles([worktree, "/home/rita/negozio"], worktree)).toEqual({
      "permissions.trama_read": { filesystem: { ":minimal": "read", ...system, [worktree]: "read", "/home/rita/negozio": "read" }, network: { enabled: false } },
      "permissions.trama_write": { filesystem: { ":minimal": "read", ...system, [worktree]: "write", "/home/rita/negozio": "read" }, network: { enabled: false } },
    });
    if (process.platform === "darwin") expect(SYSTEM_READ_ROOTS).toContain("/System/Library/OpenSSL");
    expect(Object.keys(codexPermissionProfiles(["/home/rita/negozio"], null))).toEqual(["permissions.trama_read"]);
  });

  it("keeps on a sandboxed shell's search path only the folders it may read, so a lookup by name reaches /bin", () => {
    const path = sandboxSearchPath(["/home/rita/.codeium/windsurf/bin", "/home/rita/.nvm/versions/node/v22/bin", "/opt/homebrew/bin", "relative/bin", "/usr/bin"], [
      "/home/rita/.nvm/versions/node/v22",
      "/opt/homebrew",
    ]);
    expect(path).toBe("/home/rita/.nvm/versions/node/v22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("gives a developer its own temporary folder outside the worktree and lets it read Playwright's browsers", async () => {
    const base = await mkdtemp(join(tmpdir(), "trama-tmp-"));
    const folder = agentTempFolder("/home/rita/worktrees/a1", base);
    expect(folder.startsWith(realpathSync(base))).toBe(true);
    expect(agentTempFolder("/home/rita/worktrees/a1", base)).toBe(folder);
    expect(agentTempFolder("/home/rita/worktrees/a2", base)).not.toBe(folder);
    const profiles = codexPermissionProfiles(["/home/rita/worktrees/a1"], "/home/rita/worktrees/a1", folder);
    expect(profiles["permissions.trama_write"]!.filesystem[folder]).toBe("write");
    expect(profiles["permissions.trama_read"]!.filesystem[folder]).toBeUndefined();
    const home = await mkdtemp(join(tmpdir(), "trama-home-"));
    expect(browserCacheRoots(home, {}, "darwin")).toEqual([]);
    await mkdir(join(home, "Library", "Caches", "ms-playwright"), { recursive: true });
    expect(browserCacheRoots(home, {}, "darwin")).toEqual([join(home, "Library", "Caches", "ms-playwright")]);
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
