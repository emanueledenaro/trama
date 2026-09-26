import type { Candidate, CommitConventions, PactDecision, SpecialistAssignment } from "@shared/domain";
import { commitHeader, parseCommitMessage, requireValidCommitMessage } from "./conventions";
import { ghEnvironment } from "./github";
import { git, runProcess } from "./process";
import { candidateTrailer } from "./quality";
import { reviewWorktree } from "./workspace";

/**
 * The body of Trama's pull request (Q01): what changes, the checks Trama ran with their outcome, the seams the developer
 * says it tested (a statement, not evidence), the limits and the linked issue. The title is the commit's header.
 */
export function pullRequestBody(candidate: Candidate, assignment: SpecialistAssignment, decisions: PactDecision[], issue: number | null = null): string {
  const commitBody = candidate.commit ? parseCommitMessage(candidate.commit.message, candidate.commit.conventions).commit?.body : null;
  const lines = [
    "## Cosa cambia",
    "",
    commitBody ?? assignment.objective,
    "",
    ...candidate.changedFiles.map((path) => `- \`${path}\``),
    "",
    "## Verifiche eseguite da Trama",
    "",
    ...candidate.requiredChecks.map((check) => {
      const evidence = candidate.evidence?.[check];
      return `- \`${check}\`: ${evidence ? (evidence.result === "pass" ? "superata" : "non superata") : "non eseguita"}`;
    }),
  ];
  if (candidate.technicalReview) {
    lines.push(`- Revisione tecnica: ${candidate.technicalReview.verdict === "approved" ? "approvata" : "modifiche richieste"}. ${candidate.technicalReview.summary}`.trimEnd());
  }
  if (candidate.testedSeams !== undefined) {
    lines.push("", "## Seam testati, secondo lo sviluppatore", "");
    if (candidate.testedSeams === null) lines.push("Lo sviluppatore non ha riportato i seam testati.");
    else if (!candidate.testedSeams.length) lines.push("La spec non ha seam confermati.");
    else lines.push(...candidate.testedSeams.map((s) => `- ${s.seam}: ${s.tests ? `test ${s.tests}` : "nessun test riportato"}${s.agreed ? "" : ", fuori dai seam confermati"}`));
    lines.push("", "È una dichiarazione dello sviluppatore, non un'evidenza: contano le verifiche eseguite da Trama.");
  }
  lines.push(
    "",
    "## Decisioni del Patto",
    "",
    ...candidate.requiredDecisionIds.map((id) => {
      const decision = decisions.find((d) => d.id === id);
      return `- ${id} v${candidate.decisionVersions[id]}: ${decision?.value ?? "decisione non trovata"}`;
    }),
  );
  const limits = [
    ...candidate.unresolvedChoices.map((c) => `Scelta non risolta: ${c}`),
    ...candidate.externalEffects.map((e) => `Effetto esterno: ${e}`),
    ...(candidate.testedSeams ?? []).filter((s) => s.agreed && !s.tests).map((s) => `Seam senza test riportato: ${s.seam}`),
    ...(candidate.commit?.breaking ? [`Modifica incompatibile: ${candidate.commit.breaking}`] : []),
  ];
  lines.push("", "## Limiti", "", ...(limits.length ? limits.map((l) => `- ${l}`) : ["Nessun limite noto a Trama. Le verifiche coprono solo i controlli elencati sopra."]));
  lines.push("", "## Issue", "", issue ? `Refs #${issue}` : "Nessuna issue collegata.");
  lines.push("", `Candidato ${candidate.id} dell'incarico ${assignment.id}, preparato in Trama.`);
  return lines.join("\n");
}

/**
 * Commits the captured candidate in its own worktree with a valid Conventional Commits message, pushes its branch and
 * opens a pull request titled with the commit's header. The candidate must still match the worktree byte for byte.
 */
export async function publishCandidate(input: {
  candidate: Candidate;
  assignment: SpecialistAssignment;
  repository: string;
  baseBranch: string;
  /** The Conventional Commits message; its header is the pull request's title. */
  message: string;
  conventions: CommitConventions;
  body: string;
}): Promise<{ url: string; number: number; branch: string }> {
  const workspace = input.assignment.workspace;
  if (!workspace) throw new Error("L'incarico non ha un worktree da pubblicare.");
  const root = workspace.worktreeRoot;
  // A retry after a timeout finds the pull request or the commit of the first attempt instead of repeating them.
  // The snapshot is computed against the base, so it matches whether or not the candidate is already committed;
  // files the candidate excludes (dotfiles, build output) may stay untracked without blocking a retry.
  const review = await reviewWorktree(workspace);
  if (review.snapshotId !== input.candidate.snapshotId) {
    throw new Error("Il worktree è cambiato dopo la dichiarazione del candidato: serve un nuovo candidato con nuove verifiche.");
  }
  // Trama refuses to write a message that breaks Conventional Commits or the project's rules (Q01).
  requireValidCommitMessage(input.message, input.conventions);
  const marker = candidateTrailer(input.candidate.id);
  if (!input.message.split("\n").includes(marker)) throw new Error(`Il messaggio di commit non porta il marcatore del candidato (${marker}).`);
  const title = commitHeader(input.message);
  // Commits before Q01 carried the marker as a sentence.
  const legacyMarker = `Candidato ${input.candidate.id} preparato con Trama.`;
  const committed = (
    await git(["log", "--format=%H", "--fixed-strings", `--grep=${marker}`, `--grep=${legacyMarker}`, `${workspace.baseSHA}..HEAD`], root)
  ).trim();
  if (!committed) {
    await git(["add", "--", ...input.candidate.changedFiles], root, false);
    await git(["commit", "--no-verify", "--cleanup=whitespace", "-m", input.message], root, false);
  }
  const push = await runProcess("git", ["-c", "core.hooksPath=/dev/null", "push", "-u", "origin", workspace.branch], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000,
  });
  if (push.exitCode !== 0) throw new Error(`git push non riuscito: ${push.stderr.trim().split("\n").at(-1) ?? push.exitCode}`);
  // An open pull request of this branch now carries the candidate; a closed or merged one belongs to earlier work.
  // GitHub refuses a second pull request for the same branch, so an unreadable list is safe to skip.
  const afterPush = await findPullRequest(input.repository, workspace.branch).catch(() => null);
  if (afterPush?.state === "open") return { url: afterPush.url, number: afterPush.number, branch: workspace.branch };
  if (afterPush) {
    throw new Error(`La pull request #${afterPush.number} di questo branch è già chiusa: il nuovo candidato richiede un nuovo incarico.`);
  }
  const created = await runProcess(
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${input.repository}/pulls`,
      "--raw-field",
      `title=${title}`,
      "--raw-field",
      `body=${input.body}`,
      "--raw-field",
      `head=${workspace.branch}`,
      "--raw-field",
      `base=${input.baseBranch}`,
    ],
    { env: ghEnvironment(), timeoutMs: 30_000 },
  );
  if (created.exitCode !== 0) throw new Error(`GitHub non ha creato la pull request: ${created.stderr.trim() || created.stdout.trim()}`);
  const json = JSON.parse(created.stdout) as { html_url: string; number: number };
  return { url: json.html_url, number: json.number, branch: workspace.branch };
}

/** The pull request already opened from `branch`, if any, in any state. */
export async function findPullRequest(repository: string, branch: string): Promise<{ url: string; number: number; state: string } | null> {
  const owner = repository.split("/")[0]!;
  const listed = await runProcess(
    "gh",
    ["api", "--method", "GET", `repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`],
    { env: ghEnvironment(), timeoutMs: 30_000 },
  );
  if (listed.exitCode !== 0) throw new Error(`GitHub non ha elencato le pull request: ${listed.stderr.trim() || listed.stdout.trim()}`);
  const rows = JSON.parse(listed.stdout) as { html_url: string; number: number; state: string }[];
  return rows[0] ? { url: rows[0].html_url, number: rows[0].number, state: rows[0].state } : null;
}
