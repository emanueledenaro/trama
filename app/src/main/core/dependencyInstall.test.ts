import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installNodeDependencies } from "./dependencyInstall";

async function worktree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trama-deps-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
}

const manifest = JSON.stringify({ name: "sito", dependencies: { astro: "^5.0.0" }, devDependencies: { typescript: "^5.0.0" } });

describe("npm dependencies of a project created from nothing (2 October 2026)", () => {
  it("installs them in the worktree without install scripts and writes the lockfile npm produced", async () => {
    const root = await worktree({ "package.json": manifest, ".gitignore": "node_modules/\n" });
    const calls: string[][] = [];
    const outcome = await installNodeDependencies(
      root,
      async (_npm, args, cwd) => {
        calls.push(args);
        await mkdir(join(cwd, "node_modules", "astro"), { recursive: true });
        await writeFile(join(cwd, "package-lock.json"), "{}");
      },
      "/usr/bin/npm",
    );
    expect(calls).toEqual([["install", "--ignore-scripts", "--no-audit", "--no-fund"]]);
    expect(outcome).toEqual({ ok: true, packages: 2, lockfileChanged: true });
    expect(existsSync(join(root, "node_modules", "astro"))).toBe(true);
  });

  it("uses npm ci with a lockfile, and refuses while node_modules is not ignored", async () => {
    const ignored = await worktree({ "package.json": manifest, "package-lock.json": "{}", ".gitignore": "node_modules/\n" });
    const calls: string[][] = [];
    expect(await installNodeDependencies(ignored, async (_npm, args) => void calls.push(args), "/usr/bin/npm")).toEqual({ ok: true, packages: 2, lockfileChanged: false });
    expect(calls.map((args) => args[0])).toEqual(["ci"]);
    const tracked = await worktree({ "package.json": manifest });
    const refused = await installNodeDependencies(tracked, async () => undefined, "/usr/bin/npm");
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.reason).toContain(".gitignore");
  });

  it("brings the lockfile up to date with npm install when the developer added a dependency", async () => {
    const root = await worktree({ "package.json": manifest, "package-lock.json": "{}", ".gitignore": "node_modules/\n" });
    const calls: string[] = [];
    const outcome = await installNodeDependencies(
      root,
      async (_npm, args, cwd) => {
        calls.push(args[0]!);
        if (args[0] === "ci") throw Object.assign(new Error("ci"), { stderr: "npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync." });
        await writeFile(join(cwd, "package-lock.json"), '{"lockfileVersion":3}');
      },
      "/usr/bin/npm",
    );
    expect(calls).toEqual(["ci", "install"]);
    expect(outcome).toEqual({ ok: true, packages: 2, lockfileChanged: true });
  });

  it("says why when npm fails or is missing", async () => {
    const root = await worktree({ "package.json": manifest, ".gitignore": "node_modules/\n" });
    const usage = Array.from({ length: 30 }, (_, i) => `npm error   --option-${i}`).join("\n");
    const failed = await installNodeDependencies(root, async () => Promise.reject(Object.assign(new Error("x"), { stderr: `npm error code E404\nnpm error 404 Not Found\n${usage}` })), "/usr/bin/npm");
    expect(!failed.ok && failed.reason).toContain("E404");
    expect(await installNodeDependencies(root, async () => undefined, null)).toMatchObject({ ok: false });
  });
});
