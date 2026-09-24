import { describe, expect, it } from "vitest";
import { ghEnvironment, parseGitHubRemote } from "./github";

describe("github", () => {
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
