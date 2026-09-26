import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Candidate, ConflictAssessment, WorktreeSession } from "@shared/domain";
import { EXERCISE_REFERENCE_PREFIX, type GitHubCliState, parseGhAuthStatus } from "@shared/onboarding";
import { assessConflict } from "./conflicts";
import { ghEnvironment } from "./github";
import { git, runProcess } from "./process";

/** Reads `gh auth status` for github.com. A missing gh is a state, not an error. */
export async function readGitHubCliStatus(): Promise<GitHubCliState> {
  try {
    const result = await runProcess("gh", ["auth", "status", "--hostname", "github.com"], { env: ghEnvironment(), timeoutMs: 15_000 });
    if (result.timedOut) return { status: "error", account: null, detail: "gh auth status non ha risposto entro 15 secondi.", checkedAt: new Date().toISOString() };
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
  if (result.timedOut) throw new Error(`La clonazione di ${repository} non è finita entro 10 minuti.`);
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split("\n").at(-1)?.trim();
    throw new Error(
      /not found|could not read|Authentication failed|terminal prompts disabled/i.test(result.stderr) && !useGh
        ? `${repository} non si clona senza accesso. Se è privato, collega GitHub CLI con gh auth login e riprova.`
        : `La clonazione di ${repository} non è riuscita${reason ? `: ${reason}` : "."}`,
    );
  }
}

/** The marker file the AI Hero setup writes in a project. */
export const hasAiHero = (projectRoot: string): boolean => existsSync(join(projectRoot, ".agents", "skills", "AIHERO-VERSION.md"));

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
    if (relative(repository, target).startsWith("..")) throw new Error(`Percorso non sicuro nell'esercizio: ${path}`);
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
  if (!target) throw new Error("Il candidato non cambia file: non c'è niente da confrontare.");
  const repository = join(input.exerciseRoot, "Negozio-collega-simulato");
  await rm(repository, { recursive: true, force: true });
  await mkdir(input.exerciseRoot, { recursive: true });
  await git(["clone", "--quiet", "--no-checkout", "--", session.sourceRoot, repository], input.exerciseRoot, false, 120_000);
  await writeFile(join(repository, ".git", "description"), "Copia locale dell'esercizio di conflitto di Trama: non è un collaboratore reale.\n");

  let compatibleFile = COMPATIBLE_FILE;
  for (let n = 2; candidate.changedFiles.includes(compatibleFile); n += 1) compatibleFile = `ESERCIZIO-COLLEGA-${n}.md`;
  const compatibleSHA = await commitVariant(
    repository,
    "esercizio/compatibile",
    session.baseSHA,
    { [compatibleFile]: "# Nota del collega simulato\n\nModifica di esercizio su un file che il candidato non tocca.\n" },
    "Esercizio: modifica compatibile di un collega simulato",
  );
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
  return [await compare(compatibleSHA, "modifica compatibile simulata"), await compare(incompatibleSHA, "modifica incompatibile simulata")];
}
