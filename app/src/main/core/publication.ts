import type { Candidate, CommitConventions, PactDecision, ProjectMandate, SpecialistAssignment } from "@shared/domain";
import { commitHeader, parseCommitMessage, requireValidCommitMessage } from "./conventions";
import { ghEnvironment } from "./github";
import { t } from "./personLanguage";
import { git, runProcess } from "./process";
import { fixedPushRefusal, pushAuthorization, pushBranch, type PushRecord, pushRefusal, PushRefusedError } from "./push";
import { candidateTrailer } from "./quality";
import { redactSensitiveData, repositoryLocator } from "./redaction";
import { differentFrom, mergeState, reviewWorktree } from "./workspace";

/**
 * @model-text: the pull request body is project content written into the repository, in the project's language.
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
 * Nothing is committed or pushed unless the mandate allows opening pull requests; every push is reported to `onPush`
 * (issue #273).
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
  /** The project's mandate now: publishing needs `openPullRequest`. */
  mandate: ProjectMandate | null;
  onPush: (record: PushRecord) => void;
}): Promise<{ url: string; number: number; branch: string; headSHA: string }> {
  const workspace = input.assignment.workspace;
  if (!workspace) throw new Error(t("main.publication.noWorktree"));
  // The fixed bans hold before the mandate and before anything is committed (issue #244).
  const banned = fixedPushRefusal(workspace.branch, [input.baseBranch]);
  if (banned) {
    input.onPush({ outcome: "refused", branch: workspace.branch, remote: "origin", reason: banned.reason, ban: banned.ban });
    throw new PushRefusedError(banned.reason);
  }
  const refusal = pushRefusal(pushAuthorization(input.mandate));
  if (refusal) {
    input.onPush({ outcome: "refused", branch: workspace.branch, remote: "origin", reason: refusal });
    throw new PushRefusedError(refusal);
  }
  const root = workspace.worktreeRoot;
  // A retry after a timeout finds the pull request or the commit of the first attempt instead of repeating them.
  // The snapshot is computed against the base, so it matches whether or not the candidate is already committed;
  // files the candidate excludes (dotfiles, build output) may stay untracked without blocking a retry.
  const review = await reviewWorktree(workspace);
  if (review.snapshotId !== input.candidate.snapshotId) {
    throw new Error(t("main.publication.worktreeChanged"));
  }
  // The message, its header as the title and the body leave the machine without personal or business data (issue #391).
  const locate = repositoryLocator(root);
  const message = await redactSensitiveData(input.message, locate);
  const body = await redactSensitiveData(input.body, locate);
  // Trama refuses to write a message that breaks Conventional Commits or the project's rules (Q01).
  requireValidCommitMessage(message, input.conventions);
  const marker = candidateTrailer(input.candidate.id);
  if (!message.split("\n").includes(marker)) throw new Error(t("main.publication.missingMarker", { marker }));
  const title = commitHeader(message);
  // Commits before Q01 carried the marker as a sentence. @model-text: a pattern that reads git history.
  const legacyMarker = `Candidato ${input.candidate.id} preparato con Trama.`;
  const committed = (
    await git(["log", "--format=%H", "--fixed-strings", `--grep=${marker}`, `--grep=${legacyMarker}`, `${workspace.baseSHA}..HEAD`], root)
  ).trim();
  if (!committed) {
    // A realignment left as a merge in progress (MERGE_HEAD) is committed as that merge, with both parents: a reset
    // would drop the merge and turn it into a copy of the other branch's changes, and the conflict would come back.
    const merge = await mergeState(root);
    if (merge.unmergedFiles.length) throw new Error(t("main.publication.unmergedFiles", { files: merge.unmergedFiles.join(", ") }));
    // The index holds only the candidate: a file the specialist staged, a sensitive one included, is left out.
    if (!merge.mergeHead) await git(["reset", "--quiet", "--mixed", "HEAD"], root, false);
    await git(["add", "--", ...input.candidate.changedFiles], root, false);
    const staged = (await git(["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"], root)).split("\0").filter(Boolean);
    const outside = staged.filter((path) => !input.candidate.changedFiles.includes(path));
    // In a merge, a file the other branch brought as it is belongs to the merge, even one a candidate leaves out.
    const extra = merge.mergeHead ? await differentFrom(root, merge.mergeHead, outside) : outside;
    if (extra.length) throw new Error(t("main.publication.extraFiles", { files: extra.join(", ") }));
    // Work already committed in the worktree, as a merge the Coordinator concluded, leaves nothing to commit.
    if (staged.length || merge.mergeHead) await git(["commit", "--no-verify", "--cleanup=whitespace", "-m", message], root, false);
  }
  await pushBranch({ root, branch: workspace.branch, mandate: input.mandate, onRecord: input.onPush, mainBranches: [input.baseBranch] });
  // The commit Trama pushed: the only head a merge of this candidate accepts (issue #247).
  const headSHA = (await git(["rev-parse", "HEAD"], root)).trim();
  // An open pull request of this branch now carries the candidate; a closed or merged one belongs to earlier work.
  // GitHub refuses a second pull request for the same branch, so an unreadable list is safe to skip.
  const afterPush = await findPullRequest(input.repository, workspace.branch).catch(() => null);
  if (afterPush?.state === "open") return { url: afterPush.url, number: afterPush.number, branch: workspace.branch, headSHA };
  if (afterPush) {
    throw new Error(t("main.publication.pullRequestClosed", { number: String(afterPush.number) }));
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
      `body=${body}`,
      "--raw-field",
      `head=${workspace.branch}`,
      "--raw-field",
      `base=${input.baseBranch}`,
    ],
    { env: ghEnvironment(), timeoutMs: 30_000 },
  );
  if (created.exitCode !== 0) throw new Error(t("main.publication.createFailed", { detail: created.stderr.trim() || created.stdout.trim() }));
  const json = JSON.parse(created.stdout) as { html_url: string; number: number };
  return { url: json.html_url, number: json.number, branch: workspace.branch, headSHA };
}

/** The pull request already opened from `branch`, if any, in any state. */
export async function findPullRequest(repository: string, branch: string): Promise<{ url: string; number: number; state: string } | null> {
  const owner = repository.split("/")[0]!;
  const listed = await runProcess(
    "gh",
    ["api", "--method", "GET", `repos/${repository}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`],
    { env: ghEnvironment(), timeoutMs: 30_000 },
  );
  if (listed.exitCode !== 0) throw new Error(t("main.publication.listFailed", { detail: listed.stderr.trim() || listed.stdout.trim() }));
  const rows = JSON.parse(listed.stdout) as { html_url: string; number: number; state: string }[];
  return rows[0] ? { url: rows[0].html_url, number: rows[0].number, state: rows[0].state } : null;
}
