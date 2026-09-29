import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { InterfaceShot } from "@shared/domain";
import { detectLocalSandbox, lendNodeDependencies, localSandboxedCommand, nodePackage, sandboxedCommand } from "./checks";
import { t } from "./personLanguage";
import { git, runProcess } from "./process";

/**
 * The screenshots of a candidate that changes the interface (issue #247): before, on the candidate's base, and after, on
 * the candidate, each in light and in dark. Trama cannot know how every project draws its screens, so the project says
 * it: the script `screenshots` of its package.json saves PNG files in the folder `TRAMA_SCREENSHOTS_DIR`, in the theme
 * `TRAMA_THEME` (`light` or `dark`). Trama runs it in its sandbox, network only on loopback, as it runs the checks, and
 * keeps the files in its own data folder. Without the script the candidate still waits for the person, who reads why
 * there are no screenshots.
 */

export const SCREENSHOT_SCRIPT = "screenshots";

/** The most screens one run keeps: the person compares them, and the card stays readable. */
export const MAX_SCREENS = 6;

export const SHOT_TIMEOUT_MS = 180_000;

const THEMES = ["light", "dark"] as const;

export interface ShotsResult {
  status: "ready" | "unavailable" | "failed";
  reason: string | null;
  shots: InterfaceShot[];
}

/** Whether the checkout declares the screenshot script. */
export const hasScreenshotScript = (root: string): boolean => Boolean(nodePackage(root)?.scripts[SCREENSHOT_SCRIPT]);

/** The screen's name from the file the script saved: lowercase letters, digits and hyphens. */
export const screenName = (file: string): string =>
  file
    .replace(/\.png$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || t("main.shots.defaultName");

/** Runs the script once in `root`, in one theme, and returns the PNG files it saved, sorted by name. */
async function runScript(root: string, theme: (typeof THEMES)[number], scratch: string, codexExecutable: string, timeoutMs: number): Promise<{ files: string[]; failure: string | null }> {
  const pkg = nodePackage(root)!;
  const out = join(scratch, `out-${theme}`);
  await rm(out, { recursive: true, force: true });
  for (const sub of [out, join(scratch, "tmp"), join(scratch, "xdg"), join(scratch, "npm")]) await mkdir(sub, { recursive: true, mode: 0o700 });
  const inner = ["/usr/bin/env", `TRAMA_SCREENSHOTS_DIR=${out}`, `TRAMA_THEME=${theme}`, "npm", "--prefix", join(root, pkg.dir), "run", "--silent", SCREENSHOT_SCRIPT];
  const local = await detectLocalSandbox();
  const [executable, ...args] = local ? localSandboxedCommand(local, inner, scratch) : sandboxedCommand(codexExecutable, inner, scratch);
  const result = await runProcess(executable!, args, { cwd: scratch, timeoutMs });
  if (result.timedOut) return { files: [], failure: t("main.shots.timeout", { script: SCREENSHOT_SCRIPT, seconds: String(Math.round(timeoutMs / 1000)) }) };
  if (result.exitCode !== 0) {
    const line = `${result.stderr}\n${result.stdout}`.trim().split("\n").filter(Boolean).at(-1) ?? t("main.push.exitCode", { code: String(result.exitCode ?? "?") });
    return { files: [], failure: t("main.shots.failed", { script: SCREENSHOT_SCRIPT, detail: line }) };
  }
  const files = (await readdir(out).catch(() => [] as string[])).filter((f) => /\.png$/i.test(f)).sort().slice(0, MAX_SCREENS);
  return { files: files.map((f) => join(out, f)), failure: files.length ? null : t("main.shots.noPng", { script: SCREENSHOT_SCRIPT }) };
}

/**
 * Captures the four sides of the comparison: the base and the candidate, light and dark. The base gets a temporary
 * worktree of the project at the candidate's base commit, removed at the end. `outputDir` receives the PNG files.
 */
export async function captureInterfaceShots(input: {
  projectRoot: string;
  candidateRoot: string;
  baseSHA: string;
  outputDir: string;
  scratchRoot: string;
  codexExecutable: string;
  timeoutMs?: number;
}): Promise<ShotsResult> {
  if (!hasScreenshotScript(input.candidateRoot)) {
    return {
      status: "unavailable",
      reason: t("main.shots.noScript", { script: SCREENSHOT_SCRIPT }),
      shots: [],
    };
  }
  const key = createHash("sha256").update(`${input.candidateRoot}\n${input.baseSHA}`).digest("hex").slice(0, 16);
  const scratch = join(input.scratchRoot, `shots-${key}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const resolvedScratch = await realpath(scratch);
  const baseRoot = join(resolvedScratch, "base");
  await mkdir(input.outputDir, { recursive: true });
  const shots: InterfaceShot[] = [];
  const notes: string[] = [];
  try {
    await git(["worktree", "add", "--detach", "--quiet", baseRoot, input.baseSHA], input.projectRoot, false);
    const sides: { side: InterfaceShot["side"]; root: string }[] = [
      { side: "before", root: baseRoot },
      { side: "after", root: input.candidateRoot },
    ];
    for (const { side, root } of sides) {
      if (!hasScreenshotScript(root)) {
        notes.push(t("main.shots.baseWithoutScript", { script: SCREENSHOT_SCRIPT }));
        continue;
      }
      // The sandbox has no network: the dependencies are the project checkout's, when it has them.
      if (existsSync(join(input.projectRoot, nodePackage(root)!.dir, "node_modules"))) {
        const refused = await lendNodeDependencies(root, input.projectRoot);
        if (refused) return { status: "failed", reason: refused, shots };
      }
      for (const theme of THEMES) {
        const run = await runScript(root, theme, join(resolvedScratch, side), input.codexExecutable, input.timeoutMs ?? SHOT_TIMEOUT_MS);
        if (run.failure) {
          return {
            status: "failed",
            reason: t("main.shots.sideFailed", {
              side: t(side === "before" ? "main.shots.before" : "main.shots.after"),
              theme: t(theme === "light" ? "main.shots.light" : "main.shots.dark"),
              failure: run.failure,
            }),
            shots,
          };
        }
        for (const file of run.files) {
          const name = screenName(file.split("/").at(-1)!);
          const path = join(input.outputDir, `${side}-${theme}-${name}.png`);
          await copyFile(file, path);
          shots.push({ side, theme, name, path });
        }
      }
    }
  } catch (error) {
    return { status: "failed", reason: t("main.shots.notPrepared", { detail: (error as Error).message.split("\n")[0] ?? "" }), shots };
  } finally {
    await git(["worktree", "remove", "--force", baseRoot], input.projectRoot, false).catch(() => undefined);
    await rm(resolvedScratch, { recursive: true, force: true }).catch(() => undefined);
  }
  return { status: "ready", reason: notes.join(" ") || null, shots };
}
