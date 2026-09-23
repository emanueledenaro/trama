import { execFile } from "node:child_process";
import type { GitHubIssue } from "@shared/domain";

const REMOTE_PREFIXES = ["git@github.com:", "https://github.com/", "ssh://git@github.com/"];

/** Environment for `gh`: authentication always comes from gh itself, never from inherited tokens. */
export function ghEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
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

export async function readGitHubRepository(root: string): Promise<string | null> {
  try {
    const url = await run("git", ["-c", "core.hooksPath=/dev/null", "-C", root, "remote", "get-url", "origin"], { timeout: 3_000 });
    return parseGitHubRemote(url);
  } catch {
    return null;
  }
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
  const issues: GitHubIssue[] = [];
  for (let page = 1; page <= 10; page++) {
    const output = await run("gh", ["api", "--method", "GET", `repos/${repository}/issues?state=all&per_page=100&page=${page}`], {
      env: ghEnvironment(),
      timeout: 20_000,
    });
    const rows = JSON.parse(output) as RawIssue[];
    for (const row of rows) {
      if (row.pull_request) continue;
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
  return issues;
}

export async function createIssue(repository: string, title: string, body: string): Promise<void> {
  await run(
    "gh",
    ["api", "--method", "POST", `repos/${repository}/issues`, "--raw-field", `title=${title}`, "--raw-field", `body=${body}`],
    { env: ghEnvironment(), timeout: 20_000 },
  );
}

export interface IssueDetail {
  number: number;
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
  return { number: issue.number, state: issue.state === "closed" ? "closed" : "open", body: issue.body ?? "", comments };
}

export async function commentOnIssue(repository: string, number: number, body: string): Promise<void> {
  await run("gh", ["api", "--method", "POST", `repos/${repository}/issues/${number}/comments`, "--raw-field", `body=${body}`], {
    env: ghEnvironment(),
    timeout: 20_000,
  });
}

export async function updateIssueBody(repository: string, number: number, body: string): Promise<void> {
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

/** State of a pull request and the rollup of its checks, from gh. */
export async function readPullRequestStatus(repository: string, number: number): Promise<import("./tickets").PullRequestStatus> {
  const raw = JSON.parse(
    await run("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,state,mergedAt,statusCheckRollup"], {
      env: ghEnvironment(),
      timeout: 20_000,
    }),
  ) as { number: number; state: string; mergedAt: string | null; statusCheckRollup?: { conclusion?: string | null; state?: string | null; status?: string | null }[] };
  return {
    number: raw.number,
    state: raw.state === "MERGED" ? "MERGED" : raw.state === "CLOSED" ? "CLOSED" : "OPEN",
    mergedAt: raw.mergedAt,
    checks: checksConclusion(raw.statusCheckRollup ?? []),
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
