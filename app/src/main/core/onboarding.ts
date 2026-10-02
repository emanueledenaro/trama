import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Candidate, ConflictAssessment, WorktreeSession } from "@shared/domain";
import { EXERCISE_REFERENCE_PREFIX, type GitHubCliState, parseGhAuthStatus } from "@shared/onboarding";
import { assessConflict } from "./conflicts";
import { ghEnvironment } from "./github";
import { t } from "./personLanguage";
import { git, runProcess } from "./process";

/** Reads `gh auth status` for github.com. A missing gh is a state, not an error. */
export async function readGitHubCliStatus(): Promise<GitHubCliState> {
  try {
    const result = await runProcess("gh", ["auth", "status", "--hostname", "github.com"], { env: ghEnvironment(), timeoutMs: 15_000 });
    if (result.timedOut) return { status: "error", account: null, detail: t("main.onboarding.ghTimeout"), checkedAt: new Date().toISOString() };
    return parseGhAuthStatus(result);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") return { status: "missing", account: null, detail: null, checkedAt: new Date().toISOString() };
    return { status: "error", account: null, detail: (error as Error).message, checkedAt: new Date().toISOString() };
  }
}

/**
 * Clones `owner/name` into `destination` (B02). With gh logged in, `gh repo clone` uses its session, so private
 * repositories work; otherwise plain `git clone` over https, which reaches public repositories. Hooks never run.
 */
export async function cloneRepository(repository: string, destination: string, useGh: boolean): Promise<void> {
  const env = { ...(useGh ? ghEnvironment() : process.env), GIT_TERMINAL_PROMPT: "0" };
  const [command, args] = useGh
    ? ["gh", ["repo", "clone", repository, destination, "--", "--quiet", "-c", "core.hooksPath=/dev/null"]]
    : ["git", ["-c", "core.hooksPath=/dev/null", "clone", "--quiet", "--", `https://github.com/${repository}.git`, destination]];
  const result = await runProcess(command, args, { env, timeoutMs: 10 * 60_000 });
  if (result.timedOut) throw new Error(t("main.onboarding.cloneTimeout", { repository }));
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1)?.trim();
    throw new Error(
      /not found|could not read|Authentication failed|terminal prompts disabled/i.test(result.stderr) && !useGh
        ? t("main.onboarding.cloneNeedsAccess", { repository })
        : reason
          ? t("main.onboarding.cloneFailedReason", { repository, reason })
          : t("main.onboarding.cloneFailed", { repository }),
    );
  }
}

/** The name of the GitHub repository of a project Trama creates: the folder's name, in the characters GitHub keeps. */
export const repositoryName = (folder: string) =>
  folder
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[.-]+/, "") || "project";

/**
 * Creates the private GitHub repository of a project Trama just created and pushes its first commit (2 October 2026):
 * the person works on GitHub, and without it the slices could not become issues nor the work a pull request. Hooks
 * never run. Returns the repository as `owner/name`.
 */
export async function createGitHubRepository(root: string, folder: string): Promise<string> {
  const name = repositoryName(folder);
  const result = await runProcess("gh", ["repo", "create", name, "--private", "--source", root, "--remote", "origin", "--push"], {
    cwd: root,
    env: { ...ghEnvironment(), GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 2 * 60_000,
  });
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(result.stderr.trim().split("\n").at(-1)?.trim() || t("main.onboarding.repositoryCreateFailed", { name }));
  }
  const url = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1];
  return url ?? name;
}

/** Pushes `main` of a project Trama created to its new GitHub repository, with gh's credentials; the reason when it fails. */
export async function pushToGitHub(root: string): Promise<string | null> {
  const result = await runProcess("git", ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "origin", "HEAD"], {
    cwd: root,
    env: { ...ghEnvironment(), GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 2 * 60_000,
  });
  return result.timedOut || result.exitCode !== 0 ? result.stderr.trim().split("\n").at(-1)?.trim() || "git push failed" : null;
}

/** The marker file the AI Hero setup writes in a project. */
export const hasAiHero = (projectRoot: string): boolean => existsSync(join(projectRoot, ".agents", "skills", "AIHERO-VERSION.md"));

// @model-text: the simulated colleague's identity, commits and files are content of the exercise repository.
const COLLEAGUE = ["-c", "user.name=Collega simulato (esercizio di Trama)", "-c", "user.email=esercizio@trama.local"];
const COMPATIBLE_FILE = "ESERCIZIO-COLLEGA.md";

async function commitVariant(
  repository: string,
  branch: string,
  baseSHA: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  await git(["checkout", "--quiet", "--force", "-B", branch, baseSHA], repository, false);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(repository, path);
    if (relative(repository, target).startsWith("..")) throw new Error(t("main.onboarding.unsafePath", { path }));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await git(["add", "-A", "--", ...Object.keys(files)], repository, false);
  await git([...COLLEAGUE, "commit", "--no-gpg-sign", "--no-verify", "--quiet", "-m", message], repository, false);
  return (await git(["rev-parse", "--verify", "HEAD"], repository)).trim();
}

/**
 * The conflict exercise (C14): a separate local clone of the example project plays a colleague.
 * Two commits on the candidate's base, one on a file the candidate does not touch and one that
 * rewrites a file it changes, are compared with the candidate through `git merge-tree`, with a
 * local source only. The checkout, the worktree and any remote stay untouched.
 */
export async function simulateColleagueChanges(input: {
  candidate: Candidate;
  session: WorktreeSession;
  exerciseRoot: string;
  cacheRoot: string;
  probeRoot: string;
}): Promise<ConflictAssessment[]> {
  const { candidate, session } = input;
  const target = [...candidate.changedFiles].sort()[0];
  if (!target) throw new Error(t("main.onboarding.nothingToCompare"));
  const repository = join(input.exerciseRoot, "Negozio-collega-simulato");
  await rm(repository, { recursive: true, force: true });
  await mkdir(input.exerciseRoot, { recursive: true });
  await git(["clone", "--quiet", "--no-checkout", "--", session.sourceRoot, repository], input.exerciseRoot, false, 120_000);
  // @model-text: exercise repository content.
  await writeFile(join(repository, ".git", "description"), "Copia locale dell'esercizio di conflitto di Trama: non è un collaboratore reale.\n");

  let compatibleFile = COMPATIBLE_FILE;
  for (let n = 2; candidate.changedFiles.includes(compatibleFile); n += 1) compatibleFile = `ESERCIZIO-COLLEGA-${n}.md`;
  // @model-text: exercise repository content.
  const compatibleSHA = await commitVariant(
    repository,
    "esercizio/compatibile",
    session.baseSHA,
    { [compatibleFile]: "# Nota del collega simulato\n\nModifica di esercizio su un file che il candidato non tocca.\n" },
    "Esercizio: modifica compatibile di un collega simulato",
  );
  // @model-text: exercise repository content.
  const incompatibleSHA = await commitVariant(
    repository,
    "esercizio/incompatibile",
    session.baseSHA,
    {
      [target]: [
        "Questo file è stato riscritto dal collega simulato dell'esercizio di conflitto di Trama.",
        "Le stesse righe cambiano anche nel candidato: la fusione non può scegliere da sola.",
        "",
      ].join("\n"),
    },
    "Esercizio: modifica incompatibile di un collega simulato",
  );

  const compare = (sha: string, label: string) =>
    assessConflict({
      candidateId: candidate.id,
      snapshotId: candidate.snapshotId,
      session,
      changedFiles: candidate.changedFiles,
      remoteSHA: sha,
      references: [`${EXERCISE_REFERENCE_PREFIX} · ${label}`],
      source: { kind: "local", path: repository },
      cacheRoot: input.cacheRoot,
      probeRoot: input.probeRoot,
    });
  return [await compare(compatibleSHA, t("main.onboarding.compatibleLabel")), await compare(incompatibleSHA, t("main.onboarding.incompatibleLabel"))];
}
