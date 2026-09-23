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
