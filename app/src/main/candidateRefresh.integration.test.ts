import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import { approveCandidate, CandidateError, latestCandidate } from "./core/candidates";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";
import { workState } from "./core/workPhase";
import { reviewWorktree } from "./core/workspace";

const root = join(import.meta.dirname, "../..");
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

const host = {
  publish: () => undefined,
  openExternal: async () => undefined,
  applyTheme: () => undefined,
  notify: () => undefined,
  setOpenAtLogin: () => undefined,
  aiHeroResourceDirectory: join(root, "resources/AIHero"),
  demoResourceDirectory: "",
  codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
};

async function repository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  return repo;
}

describe("the candidate after the developer's correction (issue #388)", () => {
  it("declares the new candidate on the real worktree once the work sent back by the gate ends", async () => {
    controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), host);
    await controller.start();
    await controller.updateSettings({ continuousWork: false });
    await controller.openProject(await repository());
    await until(() => controller!.snapshot.project?.phase.kind === "ready");
    const document = controller.snapshot.project!.document;
    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
    await controller.grantMandate({
      requestId: null,
      objectives: ["Documentare l'annullamento"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree", "integrateCandidate"],
      limits: [],
    });
    const decision = document.decisions[0]!;

    // "[bloccante]" leaves a line in the note that the performance reviewer blocks: the gate sends the work back.
    await controller.send("[assegna] [bloccante]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "completed");
    await controller.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    const first = document.candidates[0]!;
    expect(document.gates![0]).toMatchObject({ candidateId: first.id, status: "blocked" });

    // Ada resumes in the same worktree and removes the line: the worktree no longer matches the first candidate.
    await until(() => work.turns.length === 2 && work.status === "completed");
    await until(() => latestCandidate(document, work.id)?.id !== first.id);
    expect(await readFile(join(work.workspace!.worktreeRoot, "NOTE.md"), "utf8")).not.toContain("[rilievo-bloccante]");
    const worktree = await reviewWorktree(work.workspace!);
    expect(worktree.snapshotId).not.toBe(first.snapshotId);

    // Trama declared the new candidate on what the worktree holds now, bound to the same Pact decisions.
    const corrected = latestCandidate(document, work.id)!;
    expect(corrected).toMatchObject({ snapshotId: worktree.snapshotId, diff: worktree.diff, requiredDecisionIds: [decision.id] });
    expect(corrected.diff).not.toContain("[rilievo-bloccante]");
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "candidate" && e.content.referenceId === corrected.id)).toBe(true);

    // The old candidate cannot be approved, and the work waits for the checks of the new one, not for the person.
    expect(() => approveCandidate(document, first.id, "persona", null)).toThrow(CandidateError);
    const state = workState(document, work.requestId);
    expect(state.phase).toBe("verification");
    expect(state.verification).toEqual({ undeclared: [], unverified: [corrected.id] });
    expect(state.moves.map((m) => m.move)).not.toContain("reviewCandidate");

    // The Coordinator's own declaration of the same worktree takes Trama's candidate instead of a copy.
    await controller.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    expect(latestCandidate(document, work.id)!.id).toBe(corrected.id);
    expect(document.gates!.at(-1)).toMatchObject({ candidateId: corrected.id, status: "passed" });
  }, 120_000);
});
