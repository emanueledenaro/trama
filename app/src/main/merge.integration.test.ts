import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activityLog } from "@shared/activity";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";
import { workState } from "./core/workPhase";
import { translator } from "@shared/i18n";

const t = translator("it");

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
const path = process.env.PATH;
let ghLog: string | null = null;

afterEach(async () => {
  await controller?.stop();
  controller = null;
  // Background GitHub refreshes must reach the fake gh only: wait until it has been quiet, then restore PATH.
  const size = () => (ghLog && existsSync(ghLog) ? readFileSync(ghLog, "utf8").length : 0);
  let before = -1;
  let after = size();
  while (after !== before) {
    await new Promise((r) => setTimeout(r, 500));
    before = after;
    after = size();
  }
  process.env.PATH = path;
  delete process.env.FAKE_GH_LOG;
  delete process.env.FAKE_GH_PULLS;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.TRAMA_MERGE_CHECKS_MS;
});

async function until(check: () => boolean, timeout = 20_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("merge with the green light, interface candidates held for the person (issue #247)", () => {
  it("merges a verified candidate by itself, holds an interface one with its screenshots, returns a refusal to the developer and merges on the person's ok", async () => {
    // A shop with a GitHub remote whose pushes go to a local bare repository, and a fake gh that opens and merges.
    const bin = await mkdtemp(join(tmpdir(), "trama-bin-"));
    ghLog = join(bin, "gh.log");
    await symlink(join(root, "test-fixtures/fake-gh.mjs"), join(bin, "gh"));
    process.env.PATH = `${bin}:${path}`;
    process.env.FAKE_GH_LOG = ghLog;
    process.env.FAKE_GH_PULLS = "1";
    process.env.FAKE_CODEX_LOG = join(bin, "codex.log");
    // A pull request just opened waits this long for its checks before Trama merges it.
    process.env.TRAMA_MERGE_CHECKS_MS = "200";
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await mkdir(join(repo, "web"));
    await writeFile(join(repo, "web/index.css"), ":root { --accent: #336699; }\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "negozio", private: true, scripts: { screenshots: `node ${join(root, "test-fixtures/fake-screenshots.mjs")}` } }));
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
    const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
    await git(["init", "--bare", "-b", "main"], remote, false);
    await git(["remote", "add", "origin", "https://github.com/trama-fixture/negozio.git"], repo, false);
    await git(["config", "remote.origin.pushurl", remote], repo, false);
    await git(["config", "user.name", "T"], repo, false);
    await git(["config", "user.email", "t@t"], repo, false);

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
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(repo);
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    await controller.refreshGitHub();
    const project = () => controller!.snapshot.project!;
    const document = project().document;
    expect(project().github.repository).toBe("trama-fixture/negozio");

    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
    const decision = document.decisions[0]!;
    await controller.grantMandate({
      requestId: null,
      objectives: ["Negozio"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree", "openPullRequest", "integrateCandidate"],
      limits: [],
    });
    const ada = findSpecialist(document, "Ada")!;
    const ghCalls = () => readFileSync(ghLog!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    const waitingKeys = () => (project().waiting ?? []).map((w) => w.key);

    // 1. No interface change: verified, gate passed, green light. Trama publishes and merges it by itself.
    await controller.send("[assegna]", null, null, null);
    const plain = ada.assignments[0]!;
    await until(() => plain.status === "completed");
    await controller.send(`[candidato:${plain.id}:${decision.id}]`, null, null, null);
    const first = document.candidates[0]!;
    expect(first.changedFiles).toEqual(["NOTE.md"]);
    await until(() => Boolean(first.pullRequest?.mergedAt));
    // Merged work leaves its working copy, so copies do not pile up: the branch is on the remote.
    await until(() => Boolean(plain.workspaceRemovedAt));
    expect(existsSync(plain.workspace!.worktreeRoot)).toBe(false);
    expect(first.humanApproval).toBeNull();
    expect(first.pullRequest).toMatchObject({ number: 21, mergedBy: "coordinator", branch: plain.workspace!.branch });
    const pushed = (await git(["rev-parse", `refs/heads/${plain.workspace!.branch}`], remote)).trim();
    expect(first.pullRequest!.headSHA).toBe(pushed);
    const merge = ghCalls().find((c) => c.includes("PUT"))!;
    expect(merge).toContain("repos/trama-fixture/negozio/pulls/21/merge");
    expect(merge).toContain(`sha=${pushed}`);
    expect(merge).toContain("merge_method=merge");
    expect(merge.find((a) => a.startsWith("commit_title="))).toMatch(/ \(#21\)$/);
    // The main branch of the remote received nothing directly.
    await expect(git(["rev-parse", "refs/heads/main"], remote)).rejects.toThrow();
    expect(document.events.some((e) => e.content.type === "activity" && e.content.title === `Candidato ${first.id} unito con il via libera del Coordinatore`)).toBe(true);
    // The merge is in Activity and, as a milestone, in the recap.
    const entry = activityLog(t, document.requests, document.events, [], [], [], document.candidates).find((e) => e.kind === "merge")!;
    expect(entry).toMatchObject({ label: "Candidato unito con il via libera del Coordinatore", outcome: "done", pullRequest: { number: 21 } });
    await until(() => (document.recap?.told ?? []).includes(`merged:${first.id}`));
    const recap = document.recap!.recaps.at(-1)!;
    expect(recap.milestones).toContain("Candidato unito con la pull request #21");
    expect(recap.done.map((d) => d.text)).toContain(`Candidato unito con il via libera del Coordinatore: Candidato ${first.id}, pull request #21.`);
    expect(waitingKeys()).not.toContain(`candidate:${first.id}`);

    // 2. An interface change: it waits for the person with the screenshots before and after, in light and dark.
    await controller.send("[assegna] [interfaccia]", null, null, null);
    const styled = ada.assignments.at(-1)!;
    await until(() => styled.id !== plain.id && styled.status === "completed");
    await controller.send(`[candidato:${styled.id}:${decision.id}]`, null, null, null);
    const second = document.candidates.at(-1)!;
    expect(second.changedFiles).toContain("web/index.css");
    expect(project().candidateReports[second.id]).toMatchObject({ state: "decided", mergeRoute: "interface", interfaceFiles: ["web/index.css"] });
    await until(() => second.interfaceShots?.status === "ready", 30_000);
    expect(second.interfaceShots!.shots.map((s) => `${s.side}-${s.theme}`)).toEqual(["before-light", "before-dark", "after-light", "after-dark"]);
    expect(await controller.interfaceShot(second.id, 2)).toMatch(/^data:image\/png;base64,/);
    expect((project().waiting ?? []).find((w) => w.key === `candidate:${second.id}`)).toMatchObject({ label: "Interfaccia da guardare" });
    expect(second.pullRequest).toBeNull();

    // The person refuses it with a reason: it goes back to the developer as a finding, and leaves Aspetta te.
    await controller.rejectCandidateByPerson(second.id, "Il rosso del pulsante Paga è troppo acceso in scuro");
    expect(second.humanRejection).toMatchObject({ note: "Il rosso del pulsante Paga è troppo acceso in scuro" });
    expect(styled.gateReturn?.findings).toEqual(["La persona ha rifiutato il candidato guardando le schermate: Il rosso del pulsante Paga è troppo acceso in scuro"]);
    expect(waitingKeys()).not.toContain(`candidate:${second.id}`);
    await until(() => styled.status === "completed");
    const resumed = (await readFile(process.env.FAKE_CODEX_LOG!, "utf8")).includes("Il rosso del pulsante Paga è troppo acceso in scuro");
    expect(resumed).toBe(true);
    expect(second.pullRequest).toBeNull();

    // 3. The corrected interface candidate: the person's ok merges it.
    await controller.send("[assegna] [interfaccia]", null, null, null);
    const again = ada.assignments.at(-1)!;
    await until(() => again.id !== styled.id && again.status === "completed");
    await controller.send(`[candidato:${again.id}:${decision.id}]`, null, null, null);
    const third = document.candidates.at(-1)!;
    await until(() => third.interfaceShots?.status === "ready", 30_000);
    expect(third.pullRequest).toBeNull();
    await controller.approveCandidateByPerson(third.id);
    await until(() => Boolean(third.pullRequest?.mergedAt));
    expect(third.pullRequest).toMatchObject({ mergedBy: "person" });
    expect(third.clearance).toMatchObject({ actor: "Coordinatore" });
    expect(third.humanApproval).toMatchObject({ actor: "Persona" });
    expect(document.events.some((e) => e.content.type === "activity" && e.content.title === `Candidato ${third.id} unito con il tuo ok`)).toBe(true);

    // 3b. A project without the screenshots script (issue #587), as one Trama creates: the interface candidate still
    // waits for the person, and its field says why there are no screenshots instead of showing none.
    const manifest = join(repo, "package.json");
    await writeFile(manifest, JSON.stringify({ name: "negozio", private: true, scripts: {} }));
    await git(["add", "package.json"], repo, false);
    await git(["commit", "-m", "chore: drop the screenshots script"], repo, false);
    // The checkout's head is read by a scan: without it the new work looks built on an older base (BASE_CHANGED).
    await controller.refreshProject(false);
    await controller.send("[assegna] [interfaccia]", null, null, null);
    const bare = ada.assignments.at(-1)!;
    await until(() => bare.id !== again.id && bare.status === "completed");
    await controller.send(`[candidato:${bare.id}:${decision.id}]`, null, null, null);
    const withoutScript = document.candidates.at(-1)!;
    await until(() => withoutScript.interfaceShots?.status === "unavailable", 30_000);
    expect(withoutScript.interfaceShots).toMatchObject({ shots: [] });
    expect(project().candidateReports[withoutScript.id]).toMatchObject({ mergeRoute: "interface" });
    await until(() => waitingKeys().includes(`candidate:${withoutScript.id}`), 60_000).catch((error: Error) => {
      const report = project().candidateReports[withoutScript.id];
      throw new Error(`${error.message}: report ${report?.state} ${JSON.stringify(report?.blockers?.map((b) => b.code))}, humanRejection ${Boolean(withoutScript.humanRejection)}, merge ${withoutScript.merge?.status}`);
    });
    expect((project().waiting ?? []).find((w) => w.key === `candidate:${withoutScript.id}`)).toMatchObject({ label: "Interfaccia da guardare" });
    expect(withoutScript.pullRequest).toBeNull();

    // 4. A merge that would change the repository's settings runs into a fixed ban: it stops and waits for the person.
    await controller.send("[assegna] [impostazioni]", null, null, null);
    const settings = ada.assignments.at(-1)!;
    await until(() => settings.id !== again.id && settings.status === "completed");
    await controller.send(`[candidato:${settings.id}:${decision.id}]`, null, null, null);
    const fourth = document.candidates.at(-1)!;
    expect(fourth.changedFiles).toContain("CODEOWNERS");
    await until(() => fourth.merge?.status === "stopped");
    expect(fourth.pullRequest).toBeNull();
    const refusal = (document.fixedBanRefusals ?? []).at(-1)!;
    expect(refusal).toMatchObject({ ban: "repositorySettings", action: `Unione della pull request del candidato ${fourth.id} (${settings.workspace!.branch})`, by: { kind: "trama" } });
    expect(waitingKeys()).toContain(`fixedBan:${refusal.id}`);
    expect(ghCalls().filter((c) => c.includes("PUT"))).toHaveLength(2);
  }, 180_000);
});

/** A shop with a GitHub remote, a fake gh that opens and merges, a team, a decision and a mandate that merges (issue #41). */
async function openShop(env: Record<string, string> = {}) {
  const bin = await mkdtemp(join(tmpdir(), "trama-bin-"));
  ghLog = join(bin, "gh.log");
  await symlink(join(root, "test-fixtures/fake-gh.mjs"), join(bin, "gh"));
  process.env.PATH = `${bin}:${path}`;
  process.env.FAKE_GH_LOG = ghLog;
  process.env.FAKE_GH_PULLS = "1";
  process.env.TRAMA_MERGE_CHECKS_MS = "200";
  Object.assign(process.env, env);
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  const remote = await mkdtemp(join(tmpdir(), "trama-remote-"));
  await git(["init", "--bare", "-b", "main"], remote, false);
  await git(["remote", "add", "origin", "https://github.com/trama-fixture/negozio.git"], repo, false);
  await git(["config", "remote.origin.pushurl", remote], repo, false);
  await git(["config", "user.name", "T"], repo, false);
  await git(["config", "user.email", "t@t"], repo, false);
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
  await controller.updateSettings({ continuousWork: false });
  await controller.openProject(repo);
  await until(() => controller!.snapshot.project?.phase.kind === "ready");
  await controller.refreshGitHub();
  const document = controller.snapshot.project!.document;
  await controller.send("[proponi-team]", null, null, null);
  await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
  controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
  await controller.grantMandate({
    requestId: null,
    objectives: ["Negozio"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree", "openPullRequest", "integrateCandidate"],
    limits: [],
  });
  const ada = findSpecialist(document, "Ada")!;
  /** Assigns work with `tags`, declares its candidate and returns it. */
  const candidateOf = async (tags: string) => {
    const before = ada.assignments.length;
    await controller!.send(`[assegna]${tags ? ` ${tags}` : ""}`, null, null, null);
    await until(() => ada.assignments.length > before && ada.assignments.at(-1)!.status === "completed");
    const assignment = ada.assignments.at(-1)!;
    await controller!.send(`[candidato:${assignment.id}:${document.decisions[0]!.id}]`, null, null, null);
    return document.candidates.at(-1)!;
  };
  const ghCalls = () => readFileSync(ghLog!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  const merges = () => ghCalls().filter((c) => c.includes("PUT") && c.some((a) => a.endsWith("/merge")));
  const titles = () => document.events.flatMap((e) => (e.content.type === "activity" ? [e.content.title] : []));
  return { repo, document, candidateOf, merges, titles, waitingKeys: () => (controller!.snapshot.project!.waiting ?? []).map((w) => w.key) };
}

describe("merge by mandate without faking the human review (issue #41)", () => {
  afterEach(() => {
    delete process.env.FAKE_GH_MERGE_LOST;
    delete process.env.FAKE_GH_PULL_HEAD;
  });

  it("settles a merge whose answer was lost by reading the pull request, without merging twice", async () => {
    const shop = await openShop({ FAKE_GH_MERGE_LOST: "1" });
    const candidate = await shop.candidateOf("");
    await until(() => Boolean(candidate.pullRequest?.mergedAt));
    expect(candidate.pullRequest).toMatchObject({ number: 21, mergedBy: "coordinator" });
    expect(candidate.merge).toMatchObject({ by: "coordinator", status: "merged", mandateVersion: 1, mergeSHA: "0dd5e1ec0dd5e1ec0dd5e1ec0dd5e1ec0dd5e1ec" });
    expect(candidate.clearance).toMatchObject({ actor: "Coordinatore", mandateVersion: 1 });
    expect(candidate.humanApproval).toBeNull();
    expect(shop.merges()).toHaveLength(1);
    expect(shop.titles()).toContain(`Candidato ${candidate.id} unito con il via libera del Coordinatore`);
    expect(shop.titles()).not.toContain(`Unione del candidato ${candidate.id} non riuscita`);
  }, 60_000);

  it("does not merge a pull request that received another push after Trama published it", async () => {
    const shop = await openShop({ FAKE_GH_PULL_HEAD: "baddbaddbaddbaddbaddbaddbaddbaddbaddbadd" });
    const candidate = await shop.candidateOf("");
    await until(() => candidate.merge?.status === "stopped");
    expect(candidate.merge!.detail).toMatch(/altro lavoro/);
    expect(candidate.pullRequest?.mergedAt ?? null).toBeNull();
    expect(shop.merges()).toHaveLength(0);
  }, 60_000);

  it("does not open a pull request that would conflict with its base branch as it moved on the remote (negozio, pull request #25)", async () => {
    const shop = await openShop();
    // The project's branch follows its copy on a remote Trama can fetch; the person pushes there from another clone.
    const upstream = await mkdtemp(join(tmpdir(), "trama-upstream-"));
    await git(["init", "--bare", "-b", "main"], upstream, false);
    await git(["remote", "add", "upstream", upstream], shop.repo, false);
    await git(["push", "-q", "-u", "upstream", "main"], shop.repo, false);
    const ada = findSpecialist(shop.document, "Ada")!;
    await controller!.send("[assegna]", null, null, null);
    await until(() => ada.assignments.length > 0 && ada.assignments.at(-1)!.status === "completed");
    const assignment = ada.assignments.at(-1)!;
    const other = await mkdtemp(join(tmpdir(), "trama-other-"));
    await git(["clone", "-q", upstream, other], tmpdir(), false);
    await writeFile(join(other, "NOTE.md"), "La nota scritta dalla persona su GitHub\n");
    await git(["add", "NOTE.md"], other, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "docs: nota della persona"], other, false);
    await git(["push", "-q", "origin", "HEAD:main"], other, false);

    await controller!.send(`[candidato:${assignment.id}:${shop.document.decisions[0]!.id}]`, null, null, null);
    const candidate = shop.document.candidates.at(-1)!;
    await until(() => (shop.document.conflicts ?? []).some((c) => c.candidateId === candidate.id && c.classification === "conflict"));
    const conflict = shop.document.conflicts!.find((c) => c.candidateId === candidate.id && c.classification === "conflict")!;
    expect(conflict).toMatchObject({ references: ["main"], conflictingFiles: ["NOTE.md"] });
    await until(() => candidate.merge?.status === "failed");
    // Nothing reached GitHub: no pull request, no merge. The conflict goes to the Coordinator, not to the person.
    expect(candidate.pullRequest ?? null).toBeNull();
    expect(shop.merges()).toHaveLength(0);
    expect(controller!.snapshot.project!.candidateReports[candidate.id]!.blockers.map((b) => b.code)).toContain("REMOTE_CONFLICT");
    expect(workState(shop.document, assignment.requestId!)).toMatchObject({ phase: "blocked", block: "worktreeConflict" });
  }, 60_000);

  it("stops a candidate that deletes a file for the person, and merges it on their ok as their act", async () => {
    const shop = await openShop();
    const candidate = await shop.candidateOf("[cancella]");
    expect(candidate.changedFiles).toContain("README.md");
    await until(() => candidate.merge?.status === "stopped");
    expect(candidate.merge!.stop).toMatchObject({ reasons: ["Cancella un file."], acknowledgedAt: null });
    expect(candidate.pullRequest).toBeNull();
    expect(shop.waitingKeys()).toContain(`merge:${candidate.id}`);
    expect(shop.titles()).toContain("Unione fermata: serve la tua decisione");
    expect(shop.merges()).toHaveLength(0);
    await controller!.approveCandidateByPerson(candidate.id);
    await until(() => Boolean(candidate.pullRequest?.mergedAt));
    expect(candidate.pullRequest).toMatchObject({ mergedBy: "person" });
    expect(candidate.merge).toMatchObject({ by: "person", mandateVersion: null });
    expect(shop.waitingKeys()).not.toContain(`merge:${candidate.id}`);
  }, 60_000);
});
