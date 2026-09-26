import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkPlan } from "@shared/domain";
import { TramaController } from "./controller";
import { git } from "./core/process";
import { findSpecialist } from "./core/team";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
  delete process.env.FAKE_CODEX_QUESTION;
});

async function until(check: () => boolean, timeout = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** An approved breakdown of one slice on a spec whose seam the person confirmed, as M04 and M05 leave it. */
function slicedPlan(requestId: string): WorkPlan {
  const at = new Date().toISOString();
  return {
    id: "P-W06",
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

/** A project with the demo repository, a team, a mandate and one approved slice, ready for the developer. */
async function ready() {
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
  await controller.grantMandate({
    requestId: null,
    objectives: ["Ordini in revisione"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["plan", "executeInWorktree"],
    limits: [],
  });
  document.plans.push(slicedPlan(document.requests.at(-1)!.id));
  return document;
}

describe("a developer's question to the Coordinator (W06)", () => {
  it("pauses the slice, gets the Coordinator's answer from facts and resumes in the same worktree", async () => {
    const document = await ready();
    // "[domanda]" makes the developer ask with ask_coordinator. The Coordinator assigns the slice while continuous work
    // is off, so Ada does not take it by herself first (W08); turning it on starts the Coordinator's answer by itself.
    await controller!.send("[assegna] [domanda]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "paused");
    await controller!.updateSettings({ continuousWork: true });
    await until(() => work.status === "completed");
    const question = work.questions![0]!;
    expect(question).toMatchObject({ question: expect.stringContaining("buono"), context: expect.stringContaining("carta") });
    expect(question.answer).toMatchObject({ kind: "facts", sources: ["Sources/Orders/CancelPaidOrder.swift", "spec: Ordini pagati annullati in revisione"] });
    expect(question.resumedAt).not.toBeNull();
    expect(work.turns).toHaveLength(2);
    expect(work.result).toContain("Ripreso con la risposta: Sì: un buono è un pagamento");
    expect(document.requests.some((r) => r.step?.move === "answerQuestion" && r.step.by === "trama")).toBe(true);
    const activity = document.events.flatMap((e) => (e.content.type === "activity" ? [e.content.title] : []));
    expect(activity).toContain(`Domanda ${question.id} al Coordinatore`);
    expect(activity).toContain("In pausa per una domanda");
    expect(activity).toContain("Risposta ricevuta");
    // A pause is not a failure: the history says it once, as a pause.
    expect(activity).not.toContain("Incarico non riuscito");
  }, 40_000);

  it("puts a product question on a Pact card that blocks the work until the person answers", async () => {
    const document = await ready();
    await controller!.send("[assegna] [domanda]", null, null, null);
    const work = findSpecialist(document, "Ada")!.assignments[0]!;
    await until(() => work.status === "paused");
    expect(controller!.snapshot.project!.sliceViews!["P-W06"]![0]!.state).toBe("paused");
    await controller!.send("[blocca-dubbio]", null, null, null);
    const card = document.decisionRequests.find((r) => r.blocksWork)!;
    expect(card.blocksWork).toEqual({ assignmentId: work.id, questionId: work.questions![0]!.id });
    expect(document.events.some((e) => e.content.type === "card" && e.content.kind === "decision" && e.content.referenceId === card.id)).toBe(true);
    expect(work.status).toBe("paused");

    await controller!.answerDecision(card.id, 0, null);
    await until(() => work.status === "completed");
    expect(work.questions![0]!.answer).toMatchObject({ kind: "person", text: expect.stringContaining("Va in revisione come gli altri") });
    expect(work.result).toContain("Ripreso con la risposta: Va in revisione come gli altri");
  }, 40_000);
});
