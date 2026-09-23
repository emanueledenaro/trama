import type { Candidate, PactDecision, SpecialistAssignment } from "@shared/domain";
import { ghEnvironment } from "./github";
import { git, runProcess } from "./process";
import { reviewWorktree } from "./workspace";

export function pullRequestBody(candidate: Candidate, assignment: SpecialistAssignment, decisions: PactDecision[]): string {
  const lines = [
    `Candidato ${candidate.id} dell'incarico ${assignment.id}, preparato in Trama.`,
    "",
    `Obiettivo: ${assignment.objective}`,
    "",
    "## Decisioni del Patto",
    ...candidate.requiredDecisionIds.map((id) => {
      const decision = decisions.find((d) => d.id === id);
      return `- ${id} v${candidate.decisionVersions[id]}: ${decision?.value ?? "decisione non trovata"}`;
    }),
    "",
    "## Verifiche eseguite da Trama",
    ...candidate.requiredChecks.map((check) => {
      const evidence = candidate.evidence[check];
      return `- ${check}: ${evidence ? (evidence.result === "pass" ? "superata" : "non superata") : "non eseguita"}`;
    }),
    "",
    "## File",
    ...candidate.changedFiles.map((path) => `- \`${path}\``),
  ];
  if (candidate.technicalReview) {
    lines.push("", `Revisione tecnica: ${candidate.technicalReview.verdict === "approved" ? "approvata" : "modifiche richieste"}. ${candidate.technicalReview.summary}`);
  }
  return lines.join("\n");
}

/**
 * Commits the captured candidate in its own worktree, pushes its trama/ branch and opens a pull request.
 * The candidate must still match the worktree byte for byte.
 */
export async function publishCandidate(input: {
  candidate: Candidate;
  assignment: SpecialistAssignment;
  repository: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number; branch: string }> {
  const workspace = input.assignment.workspace;
  if (!workspace) throw new Error("L'incarico non ha un worktree da pubblicare.");
  const root = workspace.worktreeRoot;
  // A retry after a timeout finds the pull request or the commit of the first attempt instead of repeating them.
  const existing = await findPullRequest(input.repository, workspace.branch).catch(() => null);
  if (existing) return { ...existing, branch: workspace.branch };
  const ahead = (await git(["rev-list", `${workspace.baseSHA}..HEAD`], root)).trim();
  if (ahead) {
    if ((await git(["status", "--porcelain"], root)).trim()) {
      throw new Error("Il worktree ha modifiche dopo il commit del candidato: serve un nuovo candidato con nuove verifiche.");
    }
  } else {
    const review = await reviewWorktree(workspace);
    if (review.snapshotId !== input.candidate.snapshotId) {
      throw new Error("Il worktree è cambiato dopo la dichiarazione del candidato: serve un nuovo candidato con nuove verifiche.");
    }
    await git(["add", "--", ...input.candidate.changedFiles], root, false);
    const commitArgs = ["commit", "--no-verify", "-m", input.title, "-m", `Candidato ${input.candidate.id} preparato con Trama.`];
    await git(commitArgs, root, false);
  }
  const push = await runProcess("git", ["-c", "core.hooksPath=/dev/null", "push", "-u", "origin", workspace.branch], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000,
  });
  if (push.exitCode !== 0) throw new Error(`git push non riuscito: ${push.stderr.trim().split("\n").at(-1) ?? push.exitCode}`);
  // GitHub refuses a second pull request for the same branch, so an unreadable list is safe to skip.
  const afterPush = await findPullRequest(input.repository, workspace.branch).catch(() => null);
  if (afterPush) return { ...afterPush, branch: workspace.branch };
  const created = await runProcess(
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${input.repository}/pulls`,
      "--raw-field",
      `title=${input.title}`,
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
export async function findPullRequest(repository: string, branch: string): Promise<{ url: string; number: number } | null> {
  const owner = repository.split("/")[0]!;
  const listed = await runProcess(
    "gh",
    ["api", "--method", "GET", `repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`],
    { env: ghEnvironment(), timeoutMs: 30_000 },
  );
  if (listed.exitCode !== 0) throw new Error(`GitHub non ha elencato le pull request: ${listed.stderr.trim() || listed.stdout.trim()}`);
  const rows = JSON.parse(listed.stdout) as { html_url: string; number: number }[];
  return rows[0] ? { url: rows[0].html_url, number: rows[0].number } : null;
}
