import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import type { GitHubCapabilities, GitHubIssue, PullRequestLink } from "@shared/domain";
import { redactSensitiveData, repositoryLocator } from "./redaction";

const REMOTE_PREFIXES = ["git@github.com:", "https://github.com/", "ssh://git@github.com/"];

/**
 * Folders where Homebrew puts `gh`. An app opened from the Finder does not inherit the terminal's PATH, so
 * Trama looks there too (P10).
 */
export const GH_FALLBACK_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"];

/** PATH with the Homebrew folders after the inherited ones, without duplicates. */
export function ghSearchPath(path = process.env.PATH ?? ""): string {
  return [...new Set([...path.split(delimiter).filter(Boolean), ...GH_FALLBACK_DIRECTORIES])].join(delimiter);
}

/** Environment for `gh`: authentication always comes from gh itself, never from inherited tokens. */
export function ghEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // spawn looks the command up in this PATH, so a gh from Homebrew is found also when Trama starts from the Finder.
    PATH: ghSearchPath(),
    GH_HOST: "github.com",
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    GH_PAGER: "cat",
    NO_COLOR: "1",
    CLICOLOR: "0",
    TERM: "dumb",
  };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "CLICOLOR_FORCE"]) {
    delete env[name];
  }
  return env;
}

export function parseGitHubRemote(url: string): string | null {
  const trimmed = url.trim();
  const prefix = REMOTE_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) return null;
  const repository = trimmed.slice(prefix.length).replace(/\.git$/, "").replace(/\/$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null;
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { ...options, maxBuffer: 16 * 1_048_576 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

/** The local folder of each repository Trama read, so a placeholder can name the file that holds a removed value. */
const localRoots = new Map<string, string>();

export async function readGitHubRepository(root: string): Promise<string | null> {
  try {
    const url = await run("git", ["-c", "core.hooksPath=/dev/null", "-C", root, "remote", "get-url", "origin"], { timeout: 3_000 });
    const repository = parseGitHubRemote(url);
    if (repository) localRoots.set(repository.toLowerCase(), root);
    return repository;
  } catch {
    return null;
  }
}

/**
 * The texts as Trama may publish them on `repository` (issue #391): personal and business data become placeholders
 * with the file and line of the local copy that holds them. Every issue, comment and merge message passes here.
 */
async function publishable<T extends string[]>(repository: string, ...texts: T): Promise<T> {
  const root = localRoots.get(repository.toLowerCase());
  const locate = root ? repositoryLocator(root) : undefined;
  return (await Promise.all(texts.map((text) => redactSensitiveData(text, locate)))) as T;
}

/** Issue references in a pull request: `#12` in its title or body (not `owner/repo#12`) and `issue-12` in its branch. */
export function linkedIssueNumbers(title: string, body: string | null, headRef: string): number[] {
  const numbers = new Set<number>();
  for (const match of `${title}\n${body ?? ""}`.matchAll(/(?<![\w/&])#(\d+)\b/g)) numbers.add(Number(match[1]));
  for (const match of headRef.matchAll(/(?:^|[/_-])(?:issues?|gh)[-_]?(\d+)(?=$|[/_-])/gi)) numbers.add(Number(match[1]));
  return [...numbers].filter((n) => n > 0).sort((a, b) => a - b);
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  html_url: string;
  user?: { login?: string } | null;
  labels?: ({ name?: string } | string)[];
  updated_at: string;
  pull_request?: unknown;
}

export async function listIssues(repository: string): Promise<GitHubIssue[]> {
  return (await listIssuesAndPullLinks(repository)).issues;
}

/**
 * The issues of every state, and the issues each pull request of every state names in its title or body: GitHub lists
 * pull requests with the issues, so a closed or merged one still takes its issue out of triage (issue #231).
 */
export async function listIssuesAndPullLinks(repository: string): Promise<{ issues: GitHubIssue[]; pullRequestLinks: PullRequestLink[] }> {
  const issues: GitHubIssue[] = [];
  const pullRequestLinks: PullRequestLink[] = [];
  for (let page = 1; page <= 10; page++) {
    const output = await run("gh", ["api", "--method", "GET", `repos/${repository}/issues?state=all&per_page=100&page=${page}`], {
      env: ghEnvironment(),
      timeout: 20_000,
    });
    const rows = JSON.parse(output) as RawIssue[];
    for (const row of rows) {
      if (row.pull_request) {
        const linkedIssues = linkedIssueNumbers(row.title, row.body, "").filter((n) => n !== row.number);
        if (linkedIssues.length) pullRequestLinks.push({ number: row.number, linkedIssues });
        continue;
      }
      issues.push({
        number: row.number,
        title: row.title,
        state: row.state === "closed" ? "closed" : "open",
        body: row.body ?? "",
        url: row.html_url,
        author: row.user?.login ?? null,
        labels: (row.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        updatedAt: row.updated_at,
      });
    }
    if (rows.length < 100) break;
  }
  return { issues, pullRequestLinks };
}

/** Opens an issue; `labels` are applied when the person's gh session may set them. Returns the issue GitHub created. */
export async function createIssue(repository: string, rawTitle: string, rawBody: string, labels: string[] = []): Promise<{ number: number; url: string; id?: number }> {
  const [title, body] = await publishable(repository, rawTitle, rawBody);
  const output = await run(
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${repository}/issues`,
      "--raw-field",
      `title=${title}`,
      "--raw-field",
      `body=${body}`,
      ...labels.flatMap((label) => ["--raw-field", `labels[]=${label}`]),
    ],
    { env: ghEnvironment(), timeout: 20_000 },
  );
  const issue = JSON.parse(output) as { id?: unknown; number?: unknown; html_url?: unknown };
  if (typeof issue.number !== "number" || typeof issue.html_url !== "string") throw new Error("GitHub non ha restituito la issue creata.");
  return { number: issue.number, url: issue.html_url, ...(typeof issue.id === "number" ? { id: issue.id } : {}) };
}

/** Marks issue `number` as blocked by the issue with database id `blockingId`: GitHub's native issue dependency. */
export async function addBlockedBy(repository: string, number: number, blockingId: number): Promise<void> {
  await run("gh", ["api", "--method", "POST", `repos/${repository}/issues/${number}/dependencies/blocked_by`, "--field", `issue_id=${blockingId}`], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

/** Rewrites the title and body of an issue. */
export async function updateIssueText(repository: string, number: number, rawTitle: string, rawBody: string): Promise<void> {
  const [title, body] = await publishable(repository, rawTitle, rawBody);
  await run("gh", ["api", "--method", "PATCH", `repos/${repository}/issues/${number}`, "--raw-field", `title=${title}`, "--raw-field", `body=${body}`], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

/** Adds labels to an issue, keeping the ones it has. */
export async function addIssueLabels(repository: string, number: number, labels: string[]): Promise<void> {
  await run("gh", ["api", "--method", "POST", `repos/${repository}/issues/${number}/labels`, ...labels.flatMap((label) => ["--raw-field", `labels[]=${label}`])], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

/** Removes a label from an issue; a label the issue does not have is not an error. */
export async function removeIssueLabel(repository: string, number: number, label: string): Promise<void> {
  try {
    await run("gh", ["api", "--method", "DELETE", `repos/${repository}/issues/${number}/labels/${encodeURIComponent(label)}`], {
      env: ghEnvironment(),
      timeout: 20_000,
    });
  } catch (error) {
    if (!/HTTP 404|Not Found/i.test((error as Error).message)) throw error;
  }
}

export interface IssueDetail {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  comments: string[];
}

export async function readIssue(repository: string, number: number): Promise<IssueDetail> {
  const issue = JSON.parse(
    await run("gh", ["api", "--method", "GET", `repos/${repository}/issues/${number}`], { env: ghEnvironment(), timeout: 20_000 }),
  ) as RawIssue;
  const comments: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const rows = JSON.parse(
      await run("gh", ["api", "--method", "GET", `repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`], {
        env: ghEnvironment(),
        timeout: 20_000,
      }),
    ) as { body?: string | null }[];
    comments.push(...rows.map((r) => r.body ?? ""));
    if (rows.length < 100) break;
  }
  return { number: issue.number, title: issue.title, state: issue.state === "closed" ? "closed" : "open", body: issue.body ?? "", comments };
}

export async function commentOnIssue(repository: string, number: number, rawBody: string): Promise<void> {
  const [body] = await publishable(repository, rawBody);
  await run("gh", ["api", "--method", "POST", `repos/${repository}/issues/${number}/comments`, "--raw-field", `body=${body}`], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

export async function updateIssueBody(repository: string, number: number, rawBody: string): Promise<void> {
  const [body] = await publishable(repository, rawBody);
  await run("gh", ["api", "--method", "PATCH", `repos/${repository}/issues/${number}`, "--raw-field", `body=${body}`], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

export async function closeIssue(repository: string, number: number): Promise<void> {
  await run(
    "gh",
    ["api", "--method", "PATCH", `repos/${repository}/issues/${number}`, "--raw-field", "state=closed", "--raw-field", "state_reason=completed"],
    { env: ghEnvironment(), timeout: 20_000 },
  );
}

/**
 * Merges a pull request with a merge commit (issue #247). `sha` is the head Trama pushed: GitHub refuses the merge when
 * the branch moved since, so a changed candidate never merges with an old green light. Branch protection stays in force:
 * Trama never asks for an administrator's bypass. A repository that allows only squash or rebase gets that method.
 */
export async function mergePullRequest(repository: string, number: number, input: { sha: string; title: string; message: string }): Promise<{ sha: string | null; method: string }> {
  const [title, message] = await publishable(repository, input.title, input.message);
  let refusal: Error | null = null;
  for (const method of ["merge", "squash", "rebase"]) {
    try {
      const output = await run(
        "gh",
        [
          "api",
          "--method",
          "PUT",
          `repos/${repository}/pulls/${number}/merge`,
          "--raw-field",
          `merge_method=${method}`,
          "--raw-field",
          `sha=${input.sha}`,
          "--raw-field",
          `commit_title=${title}`,
          "--raw-field",
          `commit_message=${message}`,
        ],
        { env: ghEnvironment(), timeout: 30_000 },
      );
      const merged = JSON.parse(output) as { merged?: boolean; sha?: string; message?: string };
      if (merged.merged === false) throw new Error(merged.message ?? "GitHub non ha unito la pull request.");
      return { sha: typeof merged.sha === "string" ? merged.sha : null, method };
    } catch (error) {
      refusal = error as Error;
      // Only a method the repository does not allow is tried again with the next one.
      if (!/not allowed|merge_method/i.test(refusal.message)) break;
    }
  }
  throw new Error(`GitHub non ha unito la pull request #${number}: ${refusal?.message.split("\n")[0] ?? "errore sconosciuto"}`);
}

/** State of a pull request and the rollup of its checks, from gh. */
export async function readPullRequestStatus(repository: string, number: number): Promise<import("./tickets").PullRequestStatus> {
  const raw = JSON.parse(
    await run("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,state,mergedAt,statusCheckRollup,headRefOid,mergeable,mergeCommit"], {
      env: ghEnvironment(),
      timeout: 20_000,
    }),
  ) as {
    number: number;
    state: string;
    mergedAt: string | null;
    statusCheckRollup?: { conclusion?: string | null; state?: string | null; status?: string | null }[];
    headRefOid?: string | null;
    mergeable?: string | null;
    mergeCommit?: { oid?: string | null } | null;
  };
  return {
    number: raw.number,
    state: raw.state === "MERGED" ? "MERGED" : raw.state === "CLOSED" ? "CLOSED" : "OPEN",
    mergedAt: raw.mergedAt,
    checks: checksConclusion(raw.statusCheckRollup ?? []),
    headSHA: raw.headRefOid ?? null,
    mergeable: raw.mergeable === "MERGEABLE" ? true : raw.mergeable === "CONFLICTING" ? false : null,
    mergeSHA: raw.mergeCommit?.oid ?? null,
  };
}

export function checksConclusion(rollup: { conclusion?: string | null; state?: string | null; status?: string | null }[]): "success" | "failure" | "pending" | "none" {
  if (!rollup.length) return "none";
  const outcomes = rollup.map((c) => (c.conclusion ?? c.state ?? "").toUpperCase());
  if (outcomes.some((o) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(o))) return "failure";
  if (rollup.some((c) => (c.status ?? "").toUpperCase() !== "COMPLETED" && !c.state) || outcomes.some((o) => o === "" || o === "PENDING" || o === "EXPECTED")) {
    return "pending";
  }
  return "success";
}

/** Turns a gh failure into a status the person can act on. */
export function classifyGitHubError(message: string): { status: GitHubCapabilities["status"]; message: string } {
  if (/ENOENT|command not found|not recognized/i.test(message)) {
    return { status: "ghMissing", message: "GitHub CLI (gh) non è installato. Installalo ed esegui gh auth login." };
  }
  if (/not logged|auth login|authentication required|HTTP 401/i.test(message)) {
    return { status: "signedOut", message: "GitHub CLI non ha un accesso valido. Esegui gh auth login nel terminale." };
  }
  if (/SAML|SSO/i.test(message)) {
    return { status: "sso", message: "L'organizzazione richiede SSO: autorizza il token di gh per l'organizzazione (gh auth refresh)." };
  }
  if (/rate limit|HTTP 429|secondary rate/i.test(message)) {
    return { status: "rateLimited", message: "GitHub ha applicato un limite di richieste. Trama riprova più tardi." };
  }
  if (/HTTP 404|Not Found/i.test(message)) {
    return { status: "notFound", message: "Il repository non esiste o il tuo account non vi ha accesso (repository privato)." };
  }
  return { status: "error", message: message.split("\n")[0] ?? message };
}

export async function readGitHubCapabilities(repository: string): Promise<GitHubCapabilities> {
  const empty: GitHubCapabilities = {
    status: "error",
    message: null,
    login: null,
    private: null,
    canRead: false,
    canPush: false,
    canAdmin: false,
    canReadChecks: false,
    rateRemaining: null,
  };
  try {
    const user = JSON.parse(await run("gh", ["api", "user"], { env: ghEnvironment(), timeout: 15_000 })) as { login?: string };
    const repo = JSON.parse(await run("gh", ["api", `repos/${repository}`], { env: ghEnvironment(), timeout: 15_000 })) as {
      private?: boolean;
      permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
    };
    const rate = await run("gh", ["api", "rate_limit", "--jq", ".resources.core.remaining"], { env: ghEnvironment(), timeout: 15_000 }).catch(() => "");
    const canRead = repo.permissions?.pull ?? true;
    return {
      status: "ready",
      message: null,
      login: user.login ?? null,
      private: repo.private ?? null,
      canRead,
      canPush: repo.permissions?.push === true,
      canAdmin: repo.permissions?.admin === true,
      canReadChecks: canRead,
      rateRemaining: rate.trim() ? Number(rate.trim()) : null,
    };
  } catch (error) {
    return { ...empty, ...classifyGitHubError((error as Error).message) };
  }
}
