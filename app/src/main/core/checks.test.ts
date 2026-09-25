import { lstat, mkdir, mkdtemp, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableChecks, detectLocalSandbox, lendNodeDependencies, localSandboxedCommand, nodePackage, runReadOnlyCheck, sandboxedCommand } from "./checks";
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

  it("wraps Node checks in Trama's sandbox with the scratch folder as the only writable path", () => {
    const seatbelt = localSandboxedCommand({ kind: "seatbelt", executable: "/usr/bin/sandbox-exec" }, ["npm", "test"], "/tmp/s");
    expect(seatbelt.slice(0, 2)).toEqual(["/usr/bin/sandbox-exec", "-p"]);
    expect(seatbelt[2]).toContain('(allow network-outbound (remote ip "localhost:*"))');
    expect(seatbelt.slice(3, 5)).toEqual(["-D", "SCRATCH=/tmp/s"]);
    const bubblewrap = localSandboxedCommand({ kind: "bubblewrap", executable: "/usr/bin/bwrap" }, ["npm", "test"], "/tmp/s");
    expect(bubblewrap).toEqual(expect.arrayContaining(["--ro-bind", "/", "--unshare-net", "--bind", "/tmp/s"]));
    expect(bubblewrap.slice(-2)).toEqual(["npm", "test"]);
  });

  it("lets a Node test use 127.0.0.1 but not internet or the checkout", async (context) => {
    const sandbox = await detectLocalSandbox();
    if (!sandbox) return context.skip();
    const repo = await mkdtemp(join(tmpdir(), "trama-local-net-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node probe.mjs" } }));
    await writeFile(
      join(repo, "probe.mjs"),
      `import net from "node:net";
import { writeFileSync } from "node:fs";
const reach = (port, host) => new Promise((ok) => net.connect(port, host).on("connect", function () { this.destroy(); ok(true); }).on("error", () => ok(false)));
const server = net.createServer((c) => c.end()).listen(0, "127.0.0.1");
await new Promise((ok) => server.on("listening", ok));
console.log("loopback", await reach(server.address().port, "127.0.0.1"));
server.close();
console.log("internet", await reach(443, "1.1.1.1"));
try { writeFileSync("escaped.txt", "x"); console.log("write", true); } catch { console.log("write", false); }
`,
    );
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "probe"], repo, false);
    const result = await runReadOnlyCheck("node_test", repo, { codexExecutable: fake, scratchRoot: await mkdtemp(join(tmpdir(), "trama-scratch-")) });
    expect(result.output).toContain("loopback true");
    expect(result.output).toContain("internet false");
    expect(result.output).toContain("write false");
    expect(result.checkoutUnchanged).toBe(true);
  });
});
