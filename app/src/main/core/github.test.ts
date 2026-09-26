import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ghEnvironment, ghSearchPath, linkedIssueNumbers, listIssuesAndPullLinks, parseGitHubRemote } from "./github";

describe("github", () => {
  it("reads the issues a merged pull request names from the issues list (issue #231)", async () => {
    const bin = await mkdtemp(join(tmpdir(), "trama-gh-"));
    await symlink(join(process.cwd(), "test-fixtures/fake-gh.mjs"), join(bin, "gh"));
    const saved = { path: process.env.PATH, merged: process.env.FAKE_GH_MERGED_PULL };
    process.env.PATH = `${bin}:${saved.path}`;
    process.env.FAKE_GH_MERGED_PULL = "1";
    try {
      const read = await listIssuesAndPullLinks("o/r");
      expect(read.issues.map((i) => i.number)).toEqual([7]);
      expect(read.pullRequestLinks).toEqual([{ number: 8, linkedIssues: [7] }]);
    } finally {
      process.env.PATH = saved.path;
      if (saved.merged === undefined) delete process.env.FAKE_GH_MERGED_PULL;
      else process.env.FAKE_GH_MERGED_PULL = saved.merged;
    }
  });

  it("finds the issues a pull request names in its title, body and branch (issue #231)", () => {
    expect(linkedIssueNumbers("W16: avatar animati (#187)", "Closes #187\nVedi anche owner/repo#9 e &#39;", "feature/w16-animated-agent-avatars")).toEqual([187]);
    expect(linkedIssueNumbers("fix", null, "bugfix/issue-231-fixed-role-duties")).toEqual([231]);
    expect(linkedIssueNumbers("fix", "", "feature/gh-12_x")).toEqual([12]);
    expect(linkedIssueNumbers("v1.2", "", "release/v1.2.0")).toEqual([]);
  });

  it("accepts only github.com remotes", () => {
    expect(parseGitHubRemote("git@github.com:emanueledenaro/trama.git")).toBe("emanueledenaro/trama");
    expect(parseGitHubRemote("https://github.com/a/b\n")).toBe("a/b");
    expect(parseGitHubRemote("ssh://git@github.com/a/b.git")).toBe("a/b");
    expect(parseGitHubRemote("https://gitlab.com/a/b")).toBeNull();
    expect(parseGitHubRemote("https://github.com/a/b/c")).toBeNull();
  });

  it("drops inherited tokens", () => {
    process.env.GITHUB_TOKEN = "x";
    expect(ghEnvironment().GITHUB_TOKEN).toBeUndefined();
    delete process.env.GITHUB_TOKEN;
  });

  it("looks for gh in Homebrew's folders too, as an app opened from the Finder has no terminal PATH", () => {
    expect(ghSearchPath("/usr/bin:/bin").split(":")).toEqual(["/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"]);
    // The inherited order comes first and nothing repeats.
    expect(ghSearchPath("/usr/local/bin:/usr/bin").split(":")).toEqual(["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin", "/home/linuxbrew/.linuxbrew/bin"]);
    const path = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      expect(ghEnvironment().PATH).toContain("/opt/homebrew/bin");
    } finally {
      process.env.PATH = path;
    }
  });
});

describe("checksConclusion", () => {
  it("is green only when every check succeeded or was skipped", async () => {
    const { checksConclusion } = await import("./github");
    expect(checksConclusion([])).toBe("none");
    expect(checksConclusion([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "SKIPPED" }])).toBe("success");
    expect(checksConclusion([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: null }])).toBe("pending");
    expect(checksConclusion([{ status: "COMPLETED", conclusion: "FAILURE" }])).toBe("failure");
    expect(checksConclusion([{ state: "SUCCESS" }])).toBe("success");
  });
});

describe("classifyGitHubError (T03)", () => {
  it("tells apart the failures the person can act on", async () => {
    const { classifyGitHubError } = await import("./github");
    expect(classifyGitHubError("spawn gh ENOENT").status).toBe("ghMissing");
    expect(classifyGitHubError("To get started with GitHub CLI, please run:  gh auth login").status).toBe("signedOut");
    expect(classifyGitHubError("Resource protected by organization SAML enforcement").status).toBe("sso");
    expect(classifyGitHubError("HTTP 403: API rate limit exceeded").status).toBe("rateLimited");
    expect(classifyGitHubError("gh: Not Found (HTTP 404)").status).toBe("notFound");
    expect(classifyGitHubError("boom\nmore").message).toBe("boom");
  });
});
