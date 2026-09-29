import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backlogOrder, moveBacklogItem, problemBacklogKey, sliceBacklogKey } from "@shared/backlog";
import type { FoundProblem, PlanSlicing, ProjectDocument, SliceTicket, WorkPlan } from "@shared/domain";
import type { RepositoryModule } from "@shared/repository";
import { teamSquads } from "@shared/squads";
import { squadBacklogs } from "./backlog";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { grantMandate } from "./pact";
import { pickSlices } from "./slicePicking";
import { formSquads } from "./squads";
import { AppStorage } from "./storage";
import { completeTeam, confirmTeam, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [module("Sources/Catalog", "Catalogo"), module("Sources/Checkout", "Checkout")];

function project(members: [string, string][]) {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: MODULES.map((m) => m.id), authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: members.map(([name, moduleId]) => ({ name, competence: "TypeScript", reason: "Negozio", moduleIds: [moduleId] })),
  });
  confirmTeam(document, proposal.id, null, null, at(0));
  completeTeam(document.team, at(0));
  return document;
}

const ticket = (number: number, text: string, blockedBy: string[] = []): SliceTicket => ({
  id: `S${number}`,
  title: `Fetta ${number}`,
  whatToBuild: text,
  acceptanceCriteria: [`Criterio ${number}`],
  blockedBy,
  issue: null,
});

function plan(tickets: SliceTicket[]): WorkPlan {
  const slicing: PlanSlicing = { status: "approved", tickets, feedback: null, approvedAt: at(2).toISOString(), failure: null, publishFailure: null };
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: MODULES.map((m) => m.id),
    summary: "Negozio",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [{ seam: "Il catalogo", existing: true, tests: "Un prodotto compare" }],
      seamsAnswer: { confirmed: true, note: null, at: at(0).toISOString() },
      sections: null as never,
      affectedModuleIDs: [],
      references: [],
      requiredDecisionIDs: [],
      issue: null,
      publishFailure: null,
    },
    slicing,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
  };
}

const problem = (id: string, evidence: FoundProblem["evidence"], key: string): FoundProblem => ({
  id,
  key,
  title: `Problema ${id}`,
  detail: "",
  evidence,
  foundAt: at(3).toISOString(),
  issue: { number: 40, url: "https://github.com/o/r/issues/40", at: at(3).toISOString(), opened: true },
  issueFailure: null,
  labelsApplied: null,
  placement: { kind: "backlog", at: at(4).toISOString(), reason: "Resta nel backlog." },
});

/** Catalogo (Ada) and Checkout (Bruno), with slices in both areas and two found problems. */
function shop() {
  const document = project([
    ["Ada", "Sources/Catalog"],
    ["Bruno", "Sources/Checkout"],
  ]);
  document.plans.push(
    plan([
      ticket(1, "Il pagamento in Sources/Checkout"),
      ticket(2, "La ricevuta in Sources/Checkout", ["S1"]),
      ticket(3, "Le schede in Sources/Catalog"),
      ticket(4, "I filtri in Sources/Catalog"),
    ]),
  );
  document.problems = {
    since: at(0).toISOString(),
    seen: [],
    items: [
      problem("F1", { kind: "finding", reference: "gate-1", label: "Rilievo" }, "finding:security:Sources/Catalog/list.ts:query senza limite"),
      problem("F2", { kind: "check", reference: "failure-1", label: "Verifica" }, "check:test"),
    ],
  };
  formSquads(document, MODULES, at(1));
  return document;
}

const squadId = (document: ProjectDocument, name: string) => teamSquads(document).find((s) => s.name === name)!.id;
const keysOf = (document: ProjectDocument, squad: string | null) => squadBacklogs(document, MODULES).find((b) => b.squadId === squad)!.items.map((item) => item.key);
const S = (n: number) => sliceBacklogKey("P-1", `S${n}`);

describe("the squads' backlogs (A13)", () => {
  it("puts the slices and the problems of each area in its squad's backlog, in order, with the Coordinator's reason", () => {
    const document = shop();
    const backlogs = squadBacklogs(document, MODULES);
    const checkout = backlogs.find((b) => b.squadId === squadId(document, "Checkout"))!;
    expect(checkout.items.map((i) => [i.label, i.state, i.reason])).toEqual([
      ["S1", "ready", { kind: "unblocks", count: 1 }],
      ["S2", "blocked", { kind: "blocked", waitingFor: ["S1"] }],
    ]);
    const catalog = backlogs.find((b) => b.squadId === squadId(document, "Catalogo"))!;
    expect(catalog.items.map((i) => [i.key, i.reason.kind])).toEqual([
      [S(3), "ready"],
      [S(4), "ready"],
      [problemBacklogKey("F1"), "finding"],
    ]);
    expect(catalog.items[2]).toMatchObject({ kind: "problem", issue: { number: 40 }, state: "open", placedByPerson: false });
    // A red check belongs to no area: it waits in the backlog of the work no squad owns.
    expect(backlogs.find((b) => b.squadId === null)!.items.map((i) => [i.key, i.reason.kind])).toEqual([[problemBacklogKey("F2"), "check"]]);
  });

  it("keeps the place the person chose through a new order of the Coordinator, new items and a restart", async () => {
    const document = shop();
    const catalog = squadId(document, "Catalogo");
    moveBacklogItem(document, catalog, keysOf(document, catalog), problemBacklogKey("F1"), 0, at(5));
    expect(keysOf(document, catalog)).toEqual([problemBacklogKey("F1"), S(3), S(4)]);

    // The Coordinator puts S4 first with its reason: the problem the person placed stays on top.
    const context = { document, snapshot: { modules: MODULES }, changed: () => undefined } as unknown as ToolContext;
    const result = await runCoordinatorTool(
      "order_backlog",
      {
        squadID: catalog,
        items: [
          { key: S(4), reason: "I filtri servono alla demo" },
          { key: S(3), reason: "Dopo i filtri" },
          { key: problemBacklogKey("F1"), reason: "Non blocca" },
        ],
      },
      context,
    );
    expect(result.isError).toBeFalsy();
    const ordered = squadBacklogs(document, MODULES).find((b) => b.squadId === catalog)!.items;
    expect(ordered.map((i) => [i.key, i.placedByPerson])).toEqual([
      [problemBacklogKey("F1"), true],
      [S(4), false],
      [S(3), false],
    ]);
    expect(ordered[1]!.reason).toEqual({ kind: "coordinator", text: "I filtri servono alla demo" });

    // A new slice of the area enters without moving the problem the person placed.
    document.plans[0]!.slicing!.tickets.push(ticket(5, "Le recensioni in Sources/Catalog"));
    expect(keysOf(document, catalog)).toEqual([problemBacklogKey("F1"), S(4), S(3), S(5)]);

    // After a restart the order is the same.
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-backlog-")));
    await storage.saveDocument(document);
    const reopened = (await storage.loadDocument("p")).document!;
    expect(backlogOrder(reopened, catalog)?.person.map((p) => [p.key, p.position])).toEqual([[problemBacklogKey("F1"), 0]]);
    expect(keysOf(reopened, catalog)).toEqual([problemBacklogKey("F1"), S(4), S(3), S(5)]);
  });

  it("refuses an order with items that are not in the squad's backlog", async () => {
    const document = shop();
    const context = { document, snapshot: { modules: MODULES }, changed: () => undefined } as unknown as ToolContext;
    const refused = await runCoordinatorTool("order_backlog", { squadID: squadId(document, "Catalogo"), items: [{ key: S(1), reason: "x" }] }, context);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/Not in this backlog/);
    expect(document.backlog).toBeUndefined();
  });

  it("lets a free developer take work from the top of its squad's backlog, skipping blocked slices", () => {
    const document = shop();
    const catalog = squadId(document, "Catalogo");
    const checkout = squadId(document, "Checkout");
    moveBacklogItem(document, catalog, keysOf(document, catalog), S(4), 0, at(5));
    // The person puts the blocked S2 on top of Checkout: Bruno still takes S1, the ready one.
    moveBacklogItem(document, checkout, keysOf(document, checkout), S(2), 0, at(5));
    const outcomes = pickSlices(document, {
      modules: MODULES,
      presence: null,
      providers: [{ id: "codex", models: ["gpt-6-luna"] }],
      fallback: { provider: "codex", model: "gpt-6-luna" },
      now: at(6),
    });
    const picked = outcomes.flatMap((o) => (o.kind === "picked" ? [[o.sliceId, document.team.specialists.find((s) => s.id === o.assignment.specialistId)!.name]] : []));
    expect(picked).toEqual([
      ["S1", "Bruno"],
      ["S4", "Ada"],
    ]);
  });
});
