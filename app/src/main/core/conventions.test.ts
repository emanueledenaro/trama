import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  branchPrefix,
  commitDescription,
  conventionsFromText,
  DEFAULT_CONVENTIONS,
  deriveCommitScope,
  deriveCommitType,
  formatCommitMessage,
  isTramaBranch,
  parseCommitMessage,
  readProjectConventions,
  requireValidCommitMessage,
  validateBranchName,
  validateCommitMessage,
  workBranchName,
} from "./conventions";
import { git } from "./process";

const valid = (message: string) => expect(validateCommitMessage(message)).toEqual([]);
const invalid = (message: string, problem: RegExp) => expect(validateCommitMessage(message).join(" ")).toMatch(problem);

describe("Conventional Commits 1.0.0 (Q01)", () => {
  it("accepts the examples of the specification", () => {
    valid("feat: allow provided config object to extend other configs\n\nBREAKING CHANGE: `extends` key in config file is now used for extending other config files");
    valid("feat!: send an email to the customer when a product is shipped");
    valid("feat(api)!: send an email to the customer when a product is shipped");
    valid("chore!: drop support for Node 6\n\nBREAKING CHANGE: use JavaScript features not available in Node 6.");
    valid("docs: correct spelling of CHANGELOG");
    valid("feat(lang): add Polish language");
    valid(
      "fix: prevent racing of requests\n\nIntroduce a request id and a reference to latest request. Dismiss\nincoming responses other than from latest request.\n\nRemove timeouts which were used to mitigate the racing issue but are\nobsolete now.\n\nReviewed-by: Z\nRefs: #123",
    );
    valid("revert: let us never again speak of the noodle incident\n\nRefs: 676104e, a215868");
  });

  it("reads type, scope, the ! marker, body and footers (rules 1, 4, 6, 7, 8, 13)", () => {
    const { commit, problems } = parseCommitMessage("fix(parser)!: drop the old syntax\n\nThe why.\n\nSecond paragraph.\n\nRefs #133\nTrama-Candidate: C-1");
    expect(problems).toEqual([]);
    expect(commit).toMatchObject({ type: "fix", scope: "parser", breaking: true, description: "drop the old syntax", body: "The why.\n\nSecond paragraph." });
    expect(commit!.footers).toEqual([
      { token: "Refs", separator: " #", value: "133" },
      { token: "Trama-Candidate", separator: ": ", value: "C-1" },
    ]);
  });

  it("requires the colon and the space right after the type or scope (rules 1 and 5)", () => {
    invalid("feat:add search", /serve uno spazio/);
    invalid("feat : add search", /subito dopo il tipo/);
    invalid("add search", /iniziare con un tipo/);
    invalid("feat: ", /Manca la descrizione/);
    invalid("feat:  add search", /un solo spazio/);
    invalid("", /vuoto/);
  });

  it("wants a scope as a noun in parentheses (rule 4)", () => {
    invalid("feat(): add search", /ambito tra parentesi è vuoto/);
    invalid("feat(search box): add search", /senza spazi/);
    invalid("feat((search)): add search", /coppia di parentesi/);
  });

  it("starts the body after one blank line (rule 6)", () => {
    invalid("feat: add search\nthe body", /riga vuota/);
  });

  it("uses - in place of whitespace in footer tokens, except BREAKING CHANGE (rule 9)", () => {
    invalid("fix: x\n\nReviewed-by: Z\nSigned off by: Ada", /Signed off by.*Signed-off-by/);
    valid("fix: x\n\nBREAKING CHANGE: the old flag is gone");
  });

  it("lets a footer value span lines until the next token (rule 10)", () => {
    const { commit } = parseCommitMessage("fix: x\n\nBREAKING CHANGE: the old flag\nis gone for good\nRefs: #4");
    expect(commit!.footers).toEqual([
      { token: "BREAKING CHANGE", separator: ": ", value: "the old flag\nis gone for good" },
      { token: "Refs", separator: ": ", value: "#4" },
    ]);
    expect(commit!.breaking).toBe(true);
  });

  it("writes BREAKING CHANGE in uppercase with colon and space, and takes BREAKING-CHANGE as a synonym (rules 12, 15, 16)", () => {
    invalid("fix: x\n\nbreaking change: the flag is gone", /maiuscolo/);
    invalid("fix: x\n\nBreaking-Change: the flag is gone", /maiuscolo/);
    invalid("fix: x\n\nBREAKING CHANGE #4", /due punti, uno spazio/);
    invalid("fix: x\n\nBREAKING CHANGE: ", /descrivere/);
    const { commit, problems } = parseCommitMessage("fix: x\n\nBREAKING-CHANGE: the flag is gone");
    expect(problems).toEqual([]);
    expect(commit!.breaking).toBe(true);
  });

  it("does not treat the units as case sensitive (rule 15)", () => {
    valid("FEAT: add search");
    valid("Fix(Parser): handle empty input");
    expect(parseCommitMessage("feat: add search").commit!.breaking).toBe(false);
  });

  it("allows other types only when the project allows them (rule 14)", () => {
    invalid("wip: half done", /tipo "wip" non è tra quelli ammessi/);
    expect(validateCommitMessage("wip: half done", { ...DEFAULT_CONVENTIONS, types: [...DEFAULT_CONVENTIONS.types, "wip"] })).toEqual([]);
  });

  it("applies the project's scopes and header length", () => {
    const conventions = { ...DEFAULT_CONVENTIONS, scopes: ["app", "docs"], headerMaxLength: 30 };
    expect(validateCommitMessage("feat(app): add search", conventions)).toEqual([]);
    expect(validateCommitMessage("feat(web): add search", conventions).join(" ")).toMatch(/ambito "web"/);
    expect(validateCommitMessage("feat(app): add the search palette to the window", conventions).join(" ")).toMatch(/al massimo 30/);
  });

  it("refuses an invalid message with what is wrong", () => {
    expect(() => requireValidCommitMessage("Start the project")).toThrow(/Messaggio di commit non valido: .*iniziare con un tipo/);
    expect(() => requireValidCommitMessage("chore: start the project")).not.toThrow();
  });
});

describe("deriving the commit (Q01)", () => {
  it("takes the type from the kind of work, and from the files when they are only docs, tests, CI or build", () => {
    expect(deriveCommitType("newFeature", ["src/search.ts"])).toBe("feat");
    expect(deriveCommitType("agreedTicket", ["src/search.ts"])).toBe("feat");
    expect(deriveCommitType("decidedBehaviorCorrection", ["src/total.ts"])).toBe("fix");
    expect(deriveCommitType("tradeOff", ["src/total.ts"])).toBe("refactor");
    expect(deriveCommitType("newFeature", ["README.md", "docs/adr/0001-x.md"])).toBe("docs");
    expect(deriveCommitType("decidedBehaviorCorrection", ["src/total.test.ts"])).toBe("test");
    expect(deriveCommitType("agreedTicket", [".github/workflows/ci.yml"])).toBe("ci");
    expect(deriveCommitType("agreedTicket", ["package.json", "package-lock.json"])).toBe("build");
    expect(deriveCommitType("newFeature", ["README.md", "src/search.ts"])).toBe("feat");
    // A project that does not allow docs keeps the type of the work.
    expect(deriveCommitType("newFeature", ["README.md"], { ...DEFAULT_CONVENTIONS, types: ["feat", "fix"] })).toBe("feat");
  });

  it("takes the scope from the one module the work touches", () => {
    expect(deriveCommitScope(["src/Orders"])).toBe("orders");
    expect(deriveCommitScope(["app"])).toBe("app");
    expect(deriveCommitScope(["app", "docs"])).toBeNull();
    expect(deriveCommitScope(["root"])).toBeNull();
    expect(deriveCommitScope(["app"], { ...DEFAULT_CONVENTIONS, scopes: ["core"] })).toBeNull();
  });

  it("writes a short description: one line, lowercase start, no final period, cut on a word", () => {
    expect(commitDescription("Add the search palette.", 60)).toBe("add the search palette");
    expect(commitDescription("API keys in settings", 60)).toBe("API keys in settings");
    expect(commitDescription("Add the search palette\nwith details", 60)).toBe("add the search palette");
    expect(commitDescription("add the search palette to the main window", 20)).toBe("add the search");
  });

  it("formats header, body and footers as the specification lays them out", () => {
    const message = formatCommitMessage({
      type: "feat",
      scope: "search",
      description: "Add the search palette",
      breaking: "the old shortcut is gone",
      body: "People find a project in one keystroke.",
      footers: ["Refs: #12", "Trama-Candidate: C-1"],
    });
    expect(message).toBe(
      "feat(search)!: add the search palette\n\nPeople find a project in one keystroke.\n\nBREAKING CHANGE: the old shortcut is gone\nRefs: #12\nTrama-Candidate: C-1",
    );
    expect(validateCommitMessage(message)).toEqual([]);
    expect(formatCommitMessage({ type: "chore", scope: null, description: "start the project", breaking: null, body: null, footers: [] })).toBe("chore: start the project");
  });

  it("keeps the header within 72 characters", () => {
    const message = formatCommitMessage({ type: "feat", scope: "orders", description: "a ".repeat(80), breaking: null, body: null, footers: [] });
    expect(message.length).toBeLessThanOrEqual(72);
  });
});

describe("branches in Conventional Branch (Q01)", () => {
  it("maps the work to a type: feature, bugfix, hotfix when urgent, chore for docs and maintenance", () => {
    expect(branchPrefix("feat", false)).toBe("feature");
    expect(branchPrefix("perf", false)).toBe("feature");
    expect(branchPrefix("fix", false)).toBe("bugfix");
    expect(branchPrefix("fix", true)).toBe("hotfix");
    for (const type of ["docs", "chore", "build", "ci", "test", "refactor", "style"]) expect(branchPrefix(type, false)).toBe("chore");
    expect(branchPrefix("feat", false, { ...DEFAULT_CONVENTIONS, branchPrefixes: { ...DEFAULT_CONVENTIONS.branchPrefixes, feature: "feat" } })).toBe("feat");
  });

  it("names a branch with the issue number, recognizable as Trama's work", () => {
    const id = "1A2B3C4D-0000-4000-8000-000000000000";
    const branch = workBranchName("feature", "assignment-contract", id, 142);
    expect(branch).toBe("feature/issue-142-assignment-contract-trama-1a2b3c4d");
    expect(workBranchName("bugfix", "-correggi--il-totale-", id)).toBe("bugfix/correggi-il-totale-trama-1a2b3c4d");
    expect(validateBranchName(branch)).toEqual([]);
    expect(isTramaBranch(branch)).toBe(true);
    expect(isTramaBranch("trama/ada-1234abcd")).toBe(true);
    expect(isTramaBranch("feature/annullo-ordini")).toBe(false);
  });

  it("validates names: a known type, lowercase, digits, single hyphens, dots only in release versions", () => {
    expect(validateBranchName("feat/add-login")).toEqual([]);
    expect(validateBranchName("fix/header-bug")).toEqual([]);
    expect(validateBranchName("release/v1.2.0")).toEqual([]);
    expect(validateBranchName("chore/update-dependencies")).toEqual([]);
    expect(validateBranchName("wip/add-login").join(" ")).toMatch(/inizia con un tipo/);
    expect(validateBranchName("feature/").join(" ")).toMatch(/descrizione breve/);
    expect(validateBranchName("feature/Add-Login").join(" ")).toMatch(/solo minuscole/);
    expect(validateBranchName("feature/v1.2").join(" ")).toMatch(/i punti solo/);
    expect(validateBranchName("feature/new--login").join(" ")).toMatch(/non vanno ripetuti/);
    expect(validateBranchName("feature/-login").join(" ")).toMatch(/non vanno ripetuti/);
    expect(validateBranchName("release/v1..2").join(" ")).toMatch(/non vanno ripetuti/);
    expect(validateBranchName("release/1.2.").join(" ")).toMatch(/non vanno ripetuti/);
  });
});

describe("project conventions (Q01)", () => {
  it("defaults to Conventional Commits and feature/bugfix/hotfix when the project declares nothing", () => {
    expect(conventionsFromText({ instructions: [], commitlint: null, branches: ["main"] })).toEqual(DEFAULT_CONVENTIONS);
  });

  it("reads types and branch prefixes from AGENTS.md", () => {
    const conventions = conventionsFromText({
      instructions: [
        {
          path: "AGENTS.md",
          text: "I messaggi seguono Conventional Commits.\nTipi usati: `feat`, `fix`, `docs`, `chore`.\n- `feat/<descrizione>` per nuove funzioni;\n- `fix/<descrizione>` per correzioni.",
        },
      ],
      commitlint: null,
      branches: [],
    });
    expect(conventions.sources).toEqual(["AGENTS.md"]);
    expect(conventions.types).toEqual(["feat", "fix", "docs", "chore"]);
    expect(conventions.branchPrefixes).toEqual({ feature: "feat", bugfix: "fix", hotfix: "hotfix", release: "release", chore: "chore" });
  });

  it("reads commitlint rules without running the configuration", () => {
    const conventions = conventionsFromText({
      instructions: [],
      commitlint: {
        path: "commitlint.config.js",
        text: "module.exports = { extends: ['@commitlint/config-conventional'], rules: { 'type-enum': [2, 'always', ['feat', 'fix', 'docs']], 'scope-enum': [2, 'always', ['app', 'site']], 'header-max-length': [2, 'always', 72] } };",
      },
      branches: [],
    });
    expect(conventions).toMatchObject({ sources: ["commitlint.config.js"], types: ["feat", "fix", "docs"], scopes: ["app", "site"], headerMaxLength: 72 });
  });

  it("ignores commitlint rules turned off with severity 0", () => {
    const conventions = conventionsFromText({
      instructions: [],
      commitlint: { path: ".commitlintrc.json", text: JSON.stringify({ rules: { "type-enum": [0, "always", ["custom"]], "header-max-length": [0, "always", 20] } }) },
      branches: [],
    });
    expect(conventions.types).toEqual(DEFAULT_CONVENTIONS.types);
    expect(conventions.headerMaxLength).toBe(DEFAULT_CONVENTIONS.headerMaxLength);
    const warning = conventionsFromText({ instructions: [], commitlint: { path: ".commitlintrc.json", text: '{"rules":{"type-enum":[1,"always",["custom"]]}}' }, branches: [] });
    expect(warning.types).toEqual(["custom"]);
  });

  it("follows the prefixes of existing branches when nothing is declared", () => {
    const conventions = conventionsFromText({ instructions: [], commitlint: null, branches: ["main", "feat/a", "feat/b", "fix/c", "feature/d"] });
    expect(conventions.branchPrefixes).toEqual({ feature: "feat", bugfix: "fix", hotfix: "hotfix", release: "release", chore: "chore" });
    expect(conventions.sources).toEqual(["branch esistenti"]);
  });

  it("reads a real project: CONTRIBUTING.md, .commitlintrc.json and remote branches, never a symbolic link", async () => {
    const root = await mkdtemp(join(tmpdir(), "trama-conventions-"));
    await git(["init", "-q", "-b", "main"], root, false);
    await writeFile(join(root, "README.md"), "# x\n");
    await git(["add", "."], root, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "-m", "chore: init"], root, false);
    await git(["branch", "fix/old"], root, false);
    await writeFile(join(root, ".commitlintrc.json"), JSON.stringify({ rules: { "type-enum": [2, "always", ["feat", "fix"]] } }));
    await mkdir(join(root, ".github"));
    await writeFile(join(root, "elsewhere.md"), "Types: `feat`, `fix`, `wip`, `hack`\n");
    await symlink(join(root, "elsewhere.md"), join(root, "CONTRIBUTING.md"));
    const conventions = await readProjectConventions(root);
    expect(conventions.types).toEqual(["feat", "fix"]);
    expect(conventions.sources).toContain(".commitlintrc.json");
    expect(conventions.sources).not.toContain("CONTRIBUTING.md");
    expect(conventions.branchPrefixes.bugfix).toBe("fix");
  });
});
