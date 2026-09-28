import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { problemBacklog } from "@shared/problems";
import { TramaController } from "./controller";
import { problemMarker } from "./core/problems";
import { git } from "./core/process";

/**
 * A08 on a test repository: a stand-in for gh keeps the issues of `prova/trama-test` in a JSON file, so the test sees
 * what Trama opened, which labels it applied and that it never opens the same problem twice.
 */

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
let store = "";
const path = process.env.PATH;

interface StoredIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
}

const FAKE_GH = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const store = process.env.PROBLEMS_GH_STORE;
const issues = JSON.parse(readFileSync(store, "utf8"));
const save = () => writeFileSync(store, JSON.stringify(issues));
const out = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
const endpoint = args.slice(1).find((a, i, l) => !a.startsWith("-") && !["--method", "--raw-field", "--field", "--jq"].includes(l[i - 1]));
const fields = args.flatMap((a, i) => (args[i - 1] === "--raw-field" ? [a] : []));
const field = (name) => fields.filter((f) => f.startsWith(name + "=")).map((f) => f.slice(name.length + 1));
const [route] = (endpoint || "").split("?");
const url = (n) => "https://github.com/prova/trama-test/issues/" + n;
const raw = (i) => ({ number: i.number, title: i.title, state: i.state, body: i.body, html_url: url(i.number), user: { login: "prova" }, labels: i.labels.map((name) => ({ name })), updated_at: "2026-09-28T10:00:00Z" });
let m;
if (route === "repos/prova/trama-test/issues" && method === "GET") out(endpoint.includes("page=1") ? issues.map(raw) : []);
if (route === "repos/prova/trama-test/issues" && method === "POST") {
  const issue = { number: issues.length + 1, title: field("title")[0], body: field("body")[0], state: "open", labels: field("labels[]") };
  issues.push(issue); save(); out({ id: 1000 + issue.number, number: issue.number, html_url: url(issue.number) });
}
if ((m = route.match(/^repos\\/prova\\/trama-test\\/issues\\/(\\d+)\\/labels$/)) && method === "POST") {
  const issue = issues.find((i) => i.number === Number(m[1]));
  for (const label of field("labels[]")) if (!issue.labels.includes(label)) issue.labels.push(label);
  save(); out([]);
}
if ((m = route.match(/^repos\\/prova\\/trama-test\\/issues\\/(\\d+)\\/labels\\/(.+)$/)) && method === "DELETE") {
  const issue = issues.find((i) => i.number === Number(m[1]));
  const label = decodeURIComponent(m[2]);
  if (!issue.labels.includes(label)) { process.stderr.write("HTTP 404: Label does not exist"); process.exit(1); }
  issue.labels = issue.labels.filter((l) => l !== label); save(); out([]);
}
process.stderr.write("fake gh: " + args.join(" ") + " not supported"); process.exit(1);
`;

beforeEach(async () => {
  const bin = await mkdtemp(join(tmpdir(), "trama-problems-gh-"));
  await writeFile(join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  store = join(bin, "issues.json");
  process.env.PATH = `${bin}:${path}`;
  process.env.PROBLEMS_GH_STORE = store;
});

afterEach(async () => {
  await controller?.stop();
  controller = null;
  process.env.PATH = path;
  delete process.env.PROBLEMS_GH_STORE;
});

const stored = async () => JSON.parse(await readFile(store, "utf8")) as StoredIssue[];

async function until(check: () => boolean | Promise<boolean>, timeout = 40_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The example project in a Git repository, with a Node test that fails, and its triage label mapping. */
async function repository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "trama-problems-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "demo", private: true, scripts: { test: 'node -e "process.exit(1)"' } }));
  await mkdir(join(repo, "docs/agents"), { recursive: true });
  await writeFile(
    join(repo, "docs/agents/triage-labels.md"),
    ["| Ruolo skill | Etichetta |", "| --- | --- |", "| `needs-triage` | `da-valutare` |", "| `ready-for-agent` | `pronta-agente` |"].join("\n"),
  );
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  return repo;
}

async function open(repo: string, issues: StoredIssue[]): Promise<ProjectDocument> {
  await writeFile(store, JSON.stringify(issues));
  controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
    publish: () => undefined,
    openExternal: async () => undefined,
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: "",
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
  });
  await controller.start();
  await controller.openProject(repo);
  await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading");
  await controller.grantMandate({
    requestId: null,
    objectives: ["Correggere i bug"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree"],
    limits: [],
  });
  const project = controller.snapshot.project!;
  project.github = { repository: "prova/trama-test", status: "ready", message: null, issues: [], snapshot: null, events: [] };
  return project.document;
}

const triages = (document: ProjectDocument): SpecialistAssignment[] =>
  document.team.specialists.flatMap((s) => s.assignments).filter((a) => a.duty?.skill === "triage");

const existing: StoredIssue = { number: 1, title: "Una issue di prima", body: "", state: "open", labels: [] };

describe("the Coordinator opens and triages the issues of the problems it finds (A08)", () => {
  it("opens one issue for a red check on the branch, has it triaged, labels it and places it", async () => {
    const document = await open(await repository(), [existing]);
    await controller!.send("[verifica:node_test]", null, null, null);

    await until(async () => (await stored()).length === 2);
    const [, opened] = await stored();
    expect(opened).toMatchObject({ number: 2, title: "La verifica test Node non passa sul branch del progetto", labels: ["da-valutare"] });
    expect(opened!.body).toContain(problemMarker("check:node_test"));
    expect(opened!.body).toContain(document.duties!.failures[0]!.id);

    // The bug triage takes the new issue with the triage skill; Trama applies the repository's labels afterwards.
    await until(() => triages(document)[0]?.status === "completed", 60_000);
    expect(triages(document)[0]).toMatchObject({ issueNumber: 2 });
    await until(async () => (await stored())[1]!.labels.join() === "pronta-agente,bug", 60_000);
    await until(() => document.problems!.items[0]!.labelsApplied !== null);
    expect(document.problems!.items[0]!.labelsApplied).toEqual(["pronta-agente", "bug"]);

    const [problem] = document.problems!.items;
    await until(() => problem!.placement !== null);
    expect(problem!.issue).toMatchObject({ number: 2, opened: true });
    expect(["assignment", "backlog"]).toContain(problem!.placement!.kind);

    // The same check red again is the same problem: no second issue.
    await controller!.send("[verifica:node_test]", null, null, null);
    await controller!.runDuties();
    expect(await stored()).toHaveLength(2);
    expect(document.problems!.items).toHaveLength(1);

    // The recap cites the issue with its number.
    controller!.recap();
    const recap = document.recap!.recaps.at(-1)!;
    expect(recap.done).toContainEqual(expect.objectContaining({ number: 2, text: expect.stringContaining("Aperta la issue #2") }));
  }, 120_000);

  it("links the open issue that already describes the problem instead of opening another", async () => {
    const already: StoredIssue = { number: 1, title: "La verifica test Node non passa sul branch del progetto", body: "Lo vedo anche io.", state: "open", labels: [] };
    const document = await open(await repository(), [already]);
    await controller!.send("[verifica:node_test]", null, null, null);
    await until(() => document.problems?.items[0]?.issue !== null && document.problems?.items[0]?.issue !== undefined);
    await controller!.runDuties();
    expect(await stored()).toHaveLength(1);
    expect(document.problems!.items[0]).toMatchObject({ issue: { number: 1, opened: false } });
    await until(() => document.problems!.items[0]!.placement !== null);
  }, 120_000);

  it("keeps the problem in Trama's backlog when GitHub is not connected", async () => {
    const document = await open(await repository(), []);
    controller!.snapshot.project!.github = { repository: null, status: "unavailable", message: "Il remoto origin non punta a GitHub.", issues: [], snapshot: null, events: [] };
    await controller!.send("[verifica:node_test]", null, null, null);
    await until(() => problemBacklog(document).length === 1);
    expect(document.problems!.items[0]).toMatchObject({ issue: null, placement: { kind: "backlog" } });
    expect(await stored()).toEqual([]);
  }, 120_000);
});
