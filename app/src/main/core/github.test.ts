import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commentOnIssue,
  createIssue,
  ghEnvironment,
  ghSearchPath,
  linkedIssueNumbers,
  listIssuesAndPullLinks,
  mergePullRequest,
  parseGitHubRemote,
  readGitHubRepository,
  updateIssueBody,
  updateIssueText,
} from "./github";
import { git } from "./process";

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

describe("what Trama publishes on GitHub (issue #391)", () => {
  /** A gh that writes each call's arguments to a log and answers every write as GitHub would. */
  const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.REDACTION_GH_LOG, JSON.stringify(args) + "\\n");
const endpoint = args.find((a, i) => i > 0 && !a.startsWith("-") && !["--method", "--raw-field", "--field"].includes(args[i - 1])) || "";
process.stdout.write(JSON.stringify(endpoint.endsWith("/merge") ? { merged: true, sha: "abc" } : { id: 1001, number: 1, html_url: "https://github.com/bottega/negozio/issues/1" }));
`;

  it("replaces personal and business data with a placeholder and the file and line where it lives, in every write", async () => {
    const bin = await mkdtemp(join(tmpdir(), "trama-gh-"));
    await writeFile(join(bin, "gh"), FAKE_GH, { mode: 0o755 });
    const log = join(bin, "gh.log");
    const repo = await mkdtemp(join(tmpdir(), "trama-negozio-"));
    await mkdir(join(repo, "config"));
    await writeFile(
      join(repo, "config/negozio.json"),
      ["{", '  "ragioneSociale": "Bottega Rossi srl",', '  "partitaIva": "01234567897",', '  "pec": "bottegarossi@pec.it",', '  "sdi": "M5UXCR1",', '  "shop": "bottega-rossi.myshopify.com"', "}", ""].join("\n"),
    );
    await git(["init", "-q", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["remote", "add", "origin", "https://github.com/bottega/negozio.git"], repo, false);
    const saved = { path: process.env.PATH, log: process.env.REDACTION_GH_LOG };
    process.env.PATH = `${bin}:${saved.path}`;
    process.env.REDACTION_GH_LOG = log;
    try {
      expect(await readGitHubRepository(repo)).toBe("bottega/negozio");
      // Made at run time, so the source holds no string a secret scanner takes for a real token.
      const token = ["shpat", "0123456789abcdef".repeat(2)].join("_");
      const text = [
        "Il checkout mostra ancora P.IVA 01234567897, codice SDI: M5UXCR1 e la PEC bottegarossi@pec.it.",
        "Il negozio è bottega-rossi.myshopify.com, la sede in Via Garibaldi 12, 20121 Milano.",
        `Il token ${token} è nel log.`,
      ].join("\n");
      await createIssue("bottega/negozio", "Dati fiscali visibili per 01234567897", text, ["needs-triage"]);
      await updateIssueText("bottega/negozio", 1, "Titolo", text);
      await updateIssueBody("bottega/negozio", 1, text);
      await commentOnIssue("bottega/negozio", 1, text);
      await mergePullRequest("bottega/negozio", 2, { sha: "abc", title: "fix: hide the VAT number", message: text });
      const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(5);
      const published = calls.flat().join("\n");
      for (const secret of ["01234567897", "M5UXCR1", "bottegarossi@pec.it", "bottega-rossi.myshopify.com", "Via Garibaldi 12", token]) {
        expect(published).not.toContain(secret);
      }
      const body = calls[0]!.find((arg) => arg.startsWith("body="))!;
      expect(body).toContain("P.IVA [partita IVA rimossa, vedi config/negozio.json:3]");
      expect(body).toContain("codice SDI: [codice SDI rimosso, vedi config/negozio.json:5]");
      expect(body).toContain("la PEC [PEC rimossa, vedi config/negozio.json:4].");
      expect(body).toContain("Il negozio è [dominio del negozio rimosso, vedi config/negozio.json:6]");
      expect(body).toContain("la sede in [indirizzo rimosso].");
      expect(body).toContain("Il token [token rimosso] è nel log.");
      expect(calls[0]).toContain("title=Dati fiscali visibili per [partita IVA rimossa, vedi config/negozio.json:3]");
      expect(calls[0]).toContain("labels[]=needs-triage");
      // Nothing else changes: the text around the data and the merge's own fields stay as written.
      expect(calls[4]).toContain("commit_title=fix: hide the VAT number");
      expect(calls[4]).toContain("sha=abc");
    } finally {
      process.env.PATH = saved.path;
      if (saved.log === undefined) delete process.env.REDACTION_GH_LOG;
      else process.env.REDACTION_GH_LOG = saved.log;
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
