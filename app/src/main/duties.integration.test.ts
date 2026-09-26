import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GitHubIssue, ProjectDocument, SpecialistAssignment, TeamRole } from "@shared/domain";
import { TramaController } from "./controller";
import { git } from "./core/process";

const root = join(import.meta.dirname, "../..");
const skills = join(root, "resources/AIHero/skills");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
});

async function until(check: () => boolean, timeout = 20_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The example project in a Git repository, with a Node test that fails. */
async function repository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "trama-duties-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "demo", private: true, scripts: { test: "node -e \"process.exit(1)\"" } }));
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  return repo;
}

async function open(repo: string): Promise<ProjectDocument> {
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
  return controller.snapshot.project!.document;
}

const work = (document: ProjectDocument, role: TeamRole): SpecialistAssignment[] =>
  document.team.specialists.filter((s) => s.role === role).flatMap((s) => s.assignments);

const issue = (number: number): GitHubIssue => ({
  number,
  title: `Il salvataggio non riesce ${number}`,
  state: "open",
  body: "Premo Salva e non succede niente.",
  url: `https://github.com/o/r/issues/${number}`,
  author: "rita",
  labels: [],
  updatedAt: "",
});

describe("fixed roles' automatic work (W11)", () => {
  it("triages a new GitHub issue with the original triage skill and records the outcome", async () => {
    const document = await open(await repository());
    await controller!.grantMandate({
      requestId: null,
      objectives: ["Correggere i bug"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    const project = controller!.snapshot.project!;
    // The issues Trama finds first are the baseline; only the ones after them are new.
    project.github = { repository: "o/r", status: "ready", message: null, issues: [issue(1)], snapshot: null, events: [] };
    await controller!.runDuties();
    expect(work(document, "bugTriage")).toHaveLength(0);
    project.github = { ...project.github, issues: [issue(1), issue(2)] };
    await controller!.runDuties();

    const [triage] = work(document, "bugTriage");
    expect(triage).toMatchObject({ issueNumber: 2, tools: ["commands"], provider: "codex" });
    await until(() => triage!.status === "completed");
    expect(triage!.duty?.outcome).toMatchObject({ kind: "triage", category: "bug", state: "ready-for-agent" });
    // SKILL.md reached Codex as a native skill input, from the bundled skill.
    expect(triage!.duty?.outcome?.kind === "triage" && triage!.duty.outcome.verification).toContain(`skill:triage:${join(skills, "triage/SKILL.md")}`);
    expect(triage!.result).toContain("## Agent Brief");
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "assignment" && e.content.referenceId === triage!.id)).toBe(true);
    expect(document.events.some((e) => e.assignmentId === triage!.id && e.content.type === "activity" && e.content.title === "Incarico concluso")).toBe(true);
    await controller!.runDuties();
    expect(work(document, "bugTriage")).toHaveLength(1);
  }, 40_000);

  it("diagnoses a failed test, fixes it within the mandate, then has Clean Code review the free team", async () => {
    const repo = await repository();
    const document = await open(repo);
    await controller!.grantMandate({
      requestId: null,
      objectives: ["Correggere i bug"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    });
    await controller!.send("[verifica:node_test]", null, null, null);

    await until(() => work(document, "bugTriage").length === 2 && work(document, "bugTriage")[1]!.status === "completed", 40_000);
    const [diagnosis, fix] = work(document, "bugTriage");
    expect(diagnosis).toMatchObject({ tools: ["commands"], status: "completed", workspace: null });
    const outcome = diagnosis!.duty?.outcome;
    expect(outcome).toMatchObject({ kind: "diagnosis", reproduced: true, moduleIds: ["Sources/Orders"], fixAssignmentId: fix!.id });
    expect(outcome?.kind === "diagnosis" && outcome.hypotheses.join(" ")).toContain(`skill:diagnosing-bugs:${join(skills, "diagnosing-bugs/SKILL.md")}`);
    expect(document.duties?.failures).toMatchObject([{ check: "node_test", target: "checkout", diagnosisId: diagnosis!.id }]);

    // The fix writes in its own worktree, starts from the diagnosis and must pass the failed check.
    expect(fix).toMatchObject({ tools: ["commands", "edits"], moduleIds: ["Sources/Orders"], requiredChecks: ["node_test"] });
    expect(fix!.duty?.trigger).toEqual({ kind: "diagnosisFix", diagnosisId: diagnosis!.id });
    expect(fix!.instructions).toContain("Far uscire lo script con 0");
    expect(existsSync(join(fix!.workspace!.worktreeRoot, "NOTE.md"))).toBe(true);
    expect(existsSync(join(repo, "NOTE.md"))).toBe(false);

    // The fix changed code and the team is free: Clean Code reviews read-only and asks the person with a Pact card.
    await until(() => work(document, "cleanCode")[0]?.status === "completed", 40_000);
    const [review] = work(document, "cleanCode");
    expect(review).toMatchObject({ tools: ["commands"], workspace: null });
    const architecture = review!.duty?.outcome;
    expect(architecture).toMatchObject({ kind: "architecture", proposals: [{ strength: "Strong" }, { strength: "Speculative" }] });
    expect(architecture?.kind === "architecture" && architecture.topRecommendation).toContain(
      `skill:improve-codebase-architecture:${join(skills, "improve-codebase-architecture/SKILL.md")}`,
    );
    const card = document.decisionRequests.find((r) => architecture?.kind === "architecture" && r.id === architecture.decisionRequestId)!;
    expect(card.alternatives.map((a) => a.behavior)).toEqual(["Approfondire: Approfondire l'annullamento", "Approfondire: Unire i pagamenti", "Nessuno per ora"]);
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "decision" && e.content.referenceId === card.id)).toBe(true);
    expect(document.decisions).toHaveLength(0);
  }, 90_000);

  it("turns grilling decisions into glossary and ADR proposals, written only within the mandate in a worktree (M03)", async () => {
    const repo = await repository();
    const document = await open(repo);
    await controller!.send("[grilling:1] Gli ordini pagati annullati vanno in revisione", null, null, null);
    for (const question of [...document.decisionRequests]) await controller!.answerDecision(question.id, 1, null);
    expect(document.decisions).toHaveLength(2);

    // The read-only Coordinator proposes: without a mandate nothing is written.
    await controller!.send("[dominio]", null, null, null);
    const [proposal] = document.domainProposals ?? [];
    expect(proposal).toMatchObject({ decisionIds: [document.decisions.at(-1)!.id], assignmentId: null, scopeModuleIds: ["root"] });
    expect(proposal!.waiting).toMatch(/mandato/);
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "domainProposal" && e.content.referenceId === proposal!.id)).toBe(true);
    expect(work(document, "documentation")).toHaveLength(0);
    expect(existsSync(join(repo, "CONTEXT.md"))).toBe(false);

    // A mandate that covers the glossary's module lets the documentation and domain role write it in its worktree.
    await controller!.grantMandate({ requestId: null, objectives: ["Glossario"], priorities: [], scopeModuleIds: ["root"], authorizedActions: ["executeInWorktree"], limits: [] });
    await until(() => work(document, "documentation")[0]?.status === "completed", 40_000);
    const [writing] = work(document, "documentation");
    expect(writing).toMatchObject({ id: proposal!.assignmentId, tools: ["commands", "edits"], duty: { skill: "domain-modeling", trigger: { kind: "domainProposal", proposalId: proposal!.id } } });
    expect(writing!.result).toContain(`skill:domain-modeling:${join(skills, "domain-modeling/SKILL.md")}`);
    const glossary = await readFile(join(writing!.workspace!.worktreeRoot, "CONTEXT.md"), "utf8");
    expect(glossary).toContain("**Ordine in revisione**:\nUn ordine pagato e annullato che aspetta la decisione di una persona.\n_Avoid_: Ordine sospeso, Rimborso in attesa");
    expect(existsSync(join(repo, "CONTEXT.md"))).toBe(false);
  }, 90_000);
});
