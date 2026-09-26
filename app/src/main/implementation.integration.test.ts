import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkPlan } from "@shared/domain";
import { TramaController } from "./controller";
import { IMPLEMENT_BINDING, TDD_BINDING } from "./core/implementation";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
const skillsDirectory = join(root, "resources/AIHero/skills");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_LOG;
});

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Request = { method: string; params: { cwd?: string; input?: { type: string; text?: string; name?: string; path?: string }[] } };

/** An approved breakdown of one slice on a spec whose seam the person confirmed, as M04 and M05 leave it. */
function slicedPlan(requestId: string): WorkPlan {
  const at = new Date().toISOString();
  return {
    id: "P-M06",
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [{ seam: "L'interfaccia di CancelPaidOrder: annullare un ordine pagato", existing: true, tests: "Un ordine pagato annullato va in revisione" }],
      seamsAnswer: { confirmed: true, note: null, at },
      sections: {
        title: "Ordini pagati annullati in revisione",
        problemStatement: "Un ordine pagato annullato viene rimborsato subito.",
        solution: "L'ordine va in revisione.",
        userStories: ["Come supporto, voglio vedere gli ordini in revisione, così che possa decidere il rimborso"],
        implementationDecisions: ["Lo stato review si aggiunge agli stati"],
        testingDecisions: ["Si prova attraverso CancelPaidOrder"],
        outOfScope: "Le email.",
        furtherNotes: "",
      },
      affectedModuleIDs: ["Sources/Orders"],
      references: [],
      requiredDecisionIDs: [],
      issue: null,
      publishFailure: null,
    },
    slicing: {
      status: "approved",
      tickets: [{ id: "S1", title: "Stato in revisione", whatToBuild: "Un ordine pagato annullato va in revisione", acceptanceCriteria: ["L'ordine 42 va in revisione"], blockedBy: [], issue: null }],
      feedback: null,
      approvedAt: at,
      failure: null,
      publishFailure: null,
    },
    failure: null,
    decisionRequestIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

describe("the developer of a slice with implement and tdd (M06)", () => {
  it("runs the original skills in its worktree, reports the tested seams and waits for Trama's build and tests", async () => {
    const log = join(await mkdtemp(join(tmpdir(), "trama-log-")), "codex.log");
    process.env.FAKE_CODEX_LOG = log;
    const requests = async (): Promise<Request[]> =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Request);
    const repo = await mkdtemp(join(tmpdir(), "trama-repo-"));
    await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
    await git(["init", "-b", "main"], repo, false);
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
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
    const document = controller.snapshot.project!.document;

    await controller.send("[proponi-team]", null, null, null);
    await controller.answerTeamProposal(document.team.proposals[0]!.id, null, null);
    controller.recordDecision({ id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" });
    const decision = document.decisions[0]!;
    await controller.grantMandate({
      requestId: null,
      objectives: ["Ordini in revisione"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["plan", "executeInWorktree", "integrateCandidate"],
      limits: [],
    });
    document.plans.push(slicedPlan(document.requests.at(-1)!.id));

    // The Coordinator assigns the ready slice; "[test]" makes it name the project's build and full test suite.
    await controller.send("[assegna] [test]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    expect(work.slice).toEqual({ planId: "P-M06", sliceId: "S1" });
    expect(work.requiredChecks).toEqual(["git_status", "swift_build", "swift_test"]);
    await until(() => work.status === "completed");

    // The developer's turn carries implement and tdd as Codex skill inputs, tdd's reference files byte for byte,
    // the bindings, and the slice with the seam the person confirmed.
    const worktree = work.workspace!.worktreeRoot;
    const turn = (await requests()).find((r) => r.method === "turn/start" && r.params.cwd === worktree)!;
    const skills = turn.params.input!.filter((item) => item.type === "skill");
    expect(skills.map((s) => [s.name, s.path])).toEqual([
      ["implement", join(skillsDirectory, "implement/SKILL.md")],
      ["tdd", join(skillsDirectory, "tdd/SKILL.md")],
    ]);
    const text = Buffer.from(turn.params.input!.filter((item) => item.type === "text").map((item) => item.text).join("\n"), "utf8");
    for (const path of ["tdd/mocking.md", "tdd/tests.md"]) expect(text.includes(await readFile(join(skillsDirectory, path)))).toBe(true);
    expect(text.includes(IMPLEMENT_BINDING)).toBe(true);
    expect(text.includes(TDD_BINDING)).toBe(true);
    expect(text.includes("## Seam confermati dalla persona\n1. L'interfaccia di CancelPaidOrder: annullare un ordine pagato (esistente).")).toBe(true);
    expect(work.result).toContain("Skill ricevute: implement, tdd");

    // The candidate carries the developer's report; the green light waits for Trama's own checks.
    await controller.send(`[candidato:${work.id}:${decision.id}]`, null, null, null);
    const candidate = document.candidates[0]!;
    expect(candidate.testedSeams).toEqual([{ seam: "L'interfaccia di CancelPaidOrder: annullare un ordine pagato", agreed: true, tests: "NOTE.md" }]);
    expect(candidate.evidence.git_status?.result).toBe("pass");
    expect(candidate.clearance).toBeNull();
    expect(controller.snapshot.project!.candidateReports[candidate.id]!.blockers.map((b) => `${b.code}:${b.detail}`)).toEqual([
      "EVIDENCE_MISSING:swift_build",
      "EVIDENCE_MISSING:swift_test",
    ]);
  }, 30_000);
});
