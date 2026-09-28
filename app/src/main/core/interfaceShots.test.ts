import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureInterfaceShots, screenName } from "./interfaceShots";

const root = join(import.meta.dirname, "../../..");
const codex = join(root, "test-fixtures/fake-codex.mjs");

async function shop(script: boolean) {
  const project = await mkdtemp(join(tmpdir(), "trama-shots-"));
  const run = (...args: string[]) => execFileSync("git", ["-C", project, ...args], { stdio: "ignore" });
  await mkdir(join(project, "web"));
  await writeFile(join(project, "web/index.css"), ":root { --accent: #336699; }\n");
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "negozio", private: true, scripts: script ? { screenshots: `node ${join(root, "test-fixtures/fake-screenshots.mjs")}` } : {} }),
  );
  run("init", "-q", "-b", "main");
  run("add", ".");
  run("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "-m", "shop");
  const base = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const candidate = join(await mkdtemp(join(tmpdir(), "trama-shots-wt-")), "wt");
  run("worktree", "add", "-q", "-b", "feature/accent", candidate);
  await writeFile(join(candidate, "web/index.css"), ":root { --accent: #cc3300; }\n");
  return { project, candidate, base };
}

describe("screenshots of an interface candidate (issue #247)", () => {
  it("captures the base and the candidate in light and in dark with the project's screenshot script", async () => {
    const { project, candidate, base } = await shop(true);
    const outputDir = await mkdtemp(join(tmpdir(), "trama-shots-out-"));
    const result = await captureInterfaceShots({ projectRoot: project, candidateRoot: candidate, baseSHA: base, outputDir, scratchRoot: await mkdtemp(join(tmpdir(), "trama-shots-scratch-")), codexExecutable: codex });
    expect(result).toMatchObject({ status: "ready", reason: null });
    expect(result.shots.map((s) => `${s.side}-${s.theme}-${s.name}`)).toEqual(["before-light-checkout", "before-dark-checkout", "after-light-checkout", "after-dark-checkout"]);
    const bytes = await Promise.all(result.shots.map((s) => readFile(s.path)));
    for (const png of bytes) expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    // Before and after differ where the candidate changed the accent; light and dark differ in the page.
    expect(bytes[0]!.equals(bytes[2]!)).toBe(false);
    expect(bytes[0]!.equals(bytes[1]!)).toBe(false);
    // The temporary worktree of the base is gone.
    expect(execFileSync("git", ["-C", project, "worktree", "list"], { encoding: "utf8" }).trim().split("\n")).toHaveLength(2);
  }, 60_000);

  it("says why there are no screenshots when the project declares no script", async () => {
    const { project, candidate, base } = await shop(false);
    const outputDir = join(await mkdtemp(join(tmpdir(), "trama-shots-out-")), "none");
    const result = await captureInterfaceShots({ projectRoot: project, candidateRoot: candidate, baseSHA: base, outputDir, scratchRoot: await mkdtemp(join(tmpdir(), "trama-shots-scratch-")), codexExecutable: codex });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toMatch(/script "screenshots"/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("names a screen from its file", () => {
    expect(screenName("01 Checkout, Dark.PNG")).toBe("01-checkout-dark");
    expect(screenName(".png")).toBe("schermata");
  });
});
