import { lstat, mkdir, mkdtemp, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableChecks, lendNodeDependencies, nodePackage, runReadOnlyCheck, sandboxedCommand } from "./checks";
import { git } from "./process";

const fake = join(import.meta.dirname, "../../../test-fixtures/fake-codex.mjs");

describe("read-only checks", () => {
  it("wraps the command in the Codex sandbox with a scratch-only profile", () => {
    const command = sandboxedCommand("/bin/codex", ["git", "status"], "/tmp/scratch");
    expect(command.slice(0, 6)).toEqual(["/bin/codex", "sandbox", "-P", "trama_check_sandbox_v1", "-C", "/tmp/scratch"]);
    expect(command).toContain("--");
    expect(command.slice(-2)).toEqual(["git", "status"]);
  });

  it("runs git_status and reports an unchanged checkout", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-check-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "x\n");
    expect(availableChecks(repo)).toEqual(["git_status", "git_diff_check"]);
    const result = await runReadOnlyCheck("git_status", repo, { codexExecutable: fake, scratchRoot: await mkdtemp(join(tmpdir(), "trama-scratch-")) });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("?? a.txt");
    expect(result.checkoutUnchanged).toBe(true);
    await expect(runReadOnlyCheck("swift_test", repo, { codexExecutable: fake, scratchRoot: tmpdir() })).rejects.toThrow(/does not apply/);
  });

  it("finds the Node package in the root or a direct subfolder and offers its scripts as checks", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-node-"));
    await git(["init", "-b", "main"], repo, false);
    await mkdir(join(repo, "app"));
    await writeFile(join(repo, "app", "package.json"), JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit" } }));
    expect(nodePackage(repo)).toEqual({ dir: "app", scripts: { test: "vitest run", typecheck: "tsc --noEmit" } });
    expect(availableChecks(repo)).toEqual(["git_status", "git_diff_check", "node_test", "node_typecheck"]);
  });

  it("lends the checkout's dependencies to a worktree only when the lockfiles match, keeping git status clean", async () => {
    const make = async (lock: string) => {
      const root = await mkdtemp(join(tmpdir(), "trama-deps-"));
      await git(["init", "-b", "main"], root, false);
      await writeFile(join(root, ".gitignore"), "node_modules/\n");
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e 0" } }));
      await writeFile(join(root, "package-lock.json"), lock);
      return root;
    };
    const project = await make("{\"v\":1}");
    await mkdir(join(project, "node_modules", "left-pad"), { recursive: true });
    await mkdir(join(project, "node_modules", ".vite"), { recursive: true });

    const worktree = await make("{\"v\":1}");
    const before = await git(["status", "--porcelain"], worktree);
    expect(await lendNodeDependencies(worktree, project)).toBeNull();
    expect((await lstat(join(worktree, "node_modules"))).isDirectory()).toBe(true);
    expect(await readlink(join(worktree, "node_modules", "left-pad"))).toBe(join(project, "node_modules", "left-pad"));
    await expect(lstat(join(worktree, "node_modules", ".vite"))).rejects.toThrow();
    expect(await git(["status", "--porcelain"], worktree)).toBe(before);

    const drifted = await make("{\"v\":2}");
    expect(await lendNodeDependencies(drifted, project)).toMatch(/package-lock\.json/);
    await expect(lstat(join(drifted, "node_modules"))).rejects.toThrow();
  });
});
