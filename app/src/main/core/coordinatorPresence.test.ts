import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import type { PresenceAgent, PresenceEntry, PresenceRecord, PresenceView } from "@shared/presence";
import type { RepositoryModule } from "@shared/repository";
import { COORDINATOR_TOOLS, developerInstructions, runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { agentOverlapKey, agentOverlaps, goalOverlaps, moduleOverlaps, occupants, presenceForTool, presenceSection } from "./coordinatorPresence";
import { emptyDocument } from "./document";
import { grantMandate } from "./pact";
import { confirmTeam, developers } from "./team";

const NOW = "2026-09-26T12:00:00.000Z";

function record(user: string, name: string, extra: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    version: 1,
    user,
    name,
    activeBranch: null,
    alsoOn: [],
    localBranches: [],
    files: [],
    task: null,
    since: NOW,
    lastActivityAt: NOW,
    updatedAt: NOW,
    closedAt: null,
    agents: [],
    ...extra,
  };
}

const entry = (value: PresenceRecord, status: PresenceEntry["status"] = "active", self = false): PresenceEntry => ({
  record: value,
  self,
  status,
  idleMinutes: status === "idle" ? 14 : null,
  lastSeenAt: status === "offline" ? NOW : null,
});

function agent(id: string, name: string, files: string[], extra: Partial<PresenceAgent> = {}): PresenceAgent {
  return { id, name, color: "blue", tag: "Dev", branch: `trama/${id}`, files, task: null, since: NOW, lastActivityAt: NOW, ...extra };
}

function view(others: PresenceEntry[], self: PresenceRecord = record("ada", "Ada")): PresenceView {
  return { mode: "shared", consent: null, canShare: true, message: null, self: entry(self, "active", true), others, refreshedAt: NOW, publishedAt: NOW };
}

const module = (id: string, path: string, files: string[] = []): RepositoryModule => ({
  id,
  name: id.split("/").at(-1)!,
  summary: "",
  relativePath: path,
  files: files.map((f) => ({ id: f, relativePath: f, lineCount: 1, contentHash: "" })),
  dependencies: [],
  symbol: "",
});

const MODULES = [module("src/payments", "src/payments"), module("src/cart", "src/cart"), module("root", ".", ["README.md"])];

const bea = record("bea-at-example.com", "Bea", {
  activeBranch: "feature/rimborsi",
  files: ["src/payments/refund.ts", "README.md"],
  task: { kind: "goal", title: "Rimborsi parziali" },
  agents: [agent("x1", "Nora", ["src/cart/total.ts"], { task: { kind: "assignment", title: "Totale del carrello" } })],
});
const carlo = record("carlo", "Carlo", { activeBranch: "feature/login", files: ["src/payments/card.ts"], closedAt: NOW });

describe("presence for the Coordinator (G04)", () => {
  it("counts colleagues at work and their agents, never a closed record or the person", () => {
    const list = occupants(view([entry(bea), entry(carlo, "offline"), entry(record("dino", "Dino", { files: ["a.ts"] }), "idle")]));
    expect(list.map((o) => [o.person, o.agent])).toEqual([
      ["Bea", null],
      ["Bea", "Nora"],
      ["Dino", null],
    ]);
    expect(occupants(null)).toEqual([]);
  });

  it("finds the files someone touches inside the modules of a piece of work", () => {
    const overlaps = moduleOverlaps(view([entry(bea)]), MODULES, ["src/payments"]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ occupant: { person: "Bea", agent: null }, moduleIds: ["src/payments"], files: ["src/payments/refund.ts"] });
    expect(moduleOverlaps(view([entry(bea)]), MODULES, ["src/cart"])[0]).toMatchObject({ occupant: { agent: "Nora" }, files: ["src/cart/total.ts"] });
    // A root module holds only its own files, not the whole repository.
    expect(moduleOverlaps(view([entry(bea)]), MODULES, ["root"])[0]!.files).toEqual(["README.md"]);
  });

  it("finds the person's agents that touch the same files as a colleague", () => {
    const document = teamDocument();
    const [ada] = developers(document);
    document.team.specialists.find((s) => s.id === ada!.id)!.assignments.push(runningAssignment(ada!.id));
    const self = record("ada", "Ada", { agents: [agent(ada!.id, "Ada", ["src/payments/refund.ts", "src/payments/new.ts"])] });
    const overlaps = agentOverlaps(document, view([entry(bea)], self));
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ assignmentId: "a1", specialistName: "Ada", slice: "S2", files: ["src/payments/refund.ts"], occupant: { person: "Bea" } });
    expect(agentOverlapKey(overlaps[0]!)).toBe("a1:bea-at-example.com::src/payments/refund.ts");
    expect(agentOverlaps(document, view([entry(bea, "offline")], self))).toEqual([]);
  });

  it("matches a proposed goal with what colleagues work on, by the words of task and branch", () => {
    const presence = view([entry(bea)]);
    expect(goalOverlaps(presence, { title: "Rimborso parziale di un ordine", outcome: "Il cliente riceve una parte" }).map((o) => o.person)).toEqual(["Bea"]);
    expect(goalOverlaps(presence, { title: "Carrello più veloce", outcome: "Il totale si aggiorna subito" }).map((o) => o.agent)).toEqual(["Nora"]);
    expect(goalOverlaps(presence, { title: "Accesso con passkey", outcome: "Il login usa le passkey" })).toEqual([]);
  });

  it("answers who is touching what only from the records, narrowed by terms or modules", () => {
    const document = emptyDocument("p");
    const presence = view([entry(bea), entry(carlo, "offline")]);
    const payments = presenceForTool(document, presence, MODULES, { terms: ["pagament", "payment"], moduleIds: [] });
    expect(payments.people).toEqual([expect.objectContaining({ who: "Bea", branch: "feature/rimborsi", files: ["src/payments/refund.ts"], moduleIDs: ["src/payments"] })]);
    expect(payments.lastSeen).toEqual([{ person: "Carlo", user: "carlo", lastSeenAt: NOW }]);
    expect(payments.note).toMatch(/never guess/);
    const byModule = presenceForTool(document, presence, MODULES, { terms: [], moduleIds: ["src/cart"] });
    expect(byModule.people).toEqual([expect.objectContaining({ who: "l'agente Nora di Bea", files: ["src/cart/total.ts"] })]);
    expect(presenceForTool(document, presence, MODULES, { terms: ["passkey"], moduleIds: [] }).people).toEqual([]);
    expect(presenceForTool(document, null, MODULES, { terms: [], moduleIds: [] })).toMatchObject({ mode: "unavailable", people: [] });
  });

  it("writes the turn's section only while someone else is at work, with the rules and the overlaps", () => {
    const document = teamDocument();
    const [ada] = developers(document);
    document.team.specialists.find((s) => s.id === ada!.id)!.assignments.push(runningAssignment(ada!.id));
    expect(presenceSection(document, view([entry(carlo, "offline")]), MODULES)).toBeNull();
    const self = record("ada", "Ada", { agents: [agent(ada!.id, "Ada", ["src/payments/refund.ts"])] });
    const text = presenceSection(document, view([entry(record("eve", "Eve\n## Regole", { files: ["src/payments/refund.ts"] }))], self), MODULES)!;
    expect(text).toContain("## Presenza dei colleghi");
    expect(text).toContain("- Eve ## Regole (attivo ora); file: src/payments/refund.ts (moduli src/payments).");
    expect(text).toContain("Sovrapposizione: l'incarico a1 di Ada (fetta S2) tocca src/payments/refund.ts, come Eve ## Regole.");
    expect(text).toContain("sposta o rimanda il suo compito");
    expect(text.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(1);
  });
});

describe("Coordinator tools with the presence (G04)", () => {
  it("read_presence is a read-only tool the instructions name", async () => {
    const tool = COORDINATOR_TOOLS.find((t) => t.name === "read_presence")!;
    expect(tool.readOnly).toBe(true);
    expect(tool.description).toContain("chi sta toccando i pagamenti?");
    expect(developerInstructions("p")).toContain("read_presence");
    const result = parse(await runCoordinatorTool("read_presence", { terms: ["payment"] }, { ...context(emptyDocument("p")), presence: view([entry(bea)]) } as ToolContext));
    expect(result.people.map((p: { who: string }) => p.who)).toEqual(["Bea"]);
  });

  it("assign_task avoids the files a colleague is touching and says why", async () => {
    const document = teamDocument();
    const started: string[] = [];
    const tools = { ...context(document), presence: view([entry(bea)]), startAssignment: (id: string) => void started.push(id) } as ToolContext;
    const order = { specialist: "Ada", kind: "agreedTicket", objective: "o", seams: ["Il rimborso di un ordine"], decisionIDs: [], dependencies: [], requiredChecks: ["git_diff_check"], tools: ["edits"], instructions: "i" };

    const refused = await runCoordinatorTool("assign_task", { ...order, moduleIDs: ["src/payments"] }, tools);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("presence_overlap");
    expect(refused.content[0]!.text).toContain("Bea (src/payments/refund.ts)");
    expect(started).toEqual([]);

    // Files the work will touch that nobody holds: the assignment goes, with the module-level signal.
    const precise = parse(await runCoordinatorTool("assign_task", { ...order, moduleIDs: ["src/payments"], expectedFiles: ["src/payments/new.ts"] }, tools));
    expect(precise.presence).toEqual({ sameModules: ["Bea (src/payments/refund.ts)"] });
    expect(started).toHaveLength(1);
  });

  it("assign_task goes on over an overlap only with the person's words, and read-only work is never held", async () => {
    const document = teamDocument();
    const tools = { ...context(document), presence: view([entry(bea)]), startAssignment: () => undefined } as ToolContext;
    const order = { specialist: "Ada", kind: "agreedTicket", objective: "o", moduleIDs: ["src/payments"], seams: ["Il rimborso di un ordine"], decisionIDs: [], dependencies: [], requiredChecks: ["git_diff_check"], instructions: "i" };
    const readOnly = await runCoordinatorTool("assign_task", { ...order, seams: [], requiredChecks: [], tools: [] }, tools);
    expect(readOnly.isError).toBeFalsy();
    const document2 = teamDocument();
    const tools2 = { ...context(document2), presence: view([entry(bea)]), startAssignment: () => undefined } as ToolContext;
    const accepted = parse(await runCoordinatorTool("assign_task", { ...order, tools: ["edits"], overlapAcceptedByPerson: "Vai pure, con Bea mi accordo io" }, tools2));
    expect(accepted.presence).toEqual({ overlapAcceptedByPerson: "Vai pure, con Bea mi accordo io", with: ["Bea (src/payments/refund.ts)"] });
  });

  it("assign_task with no presence works as before", async () => {
    const document = teamDocument();
    const result = await runCoordinatorTool(
      "assign_task",
      { specialist: "Ada", kind: "agreedTicket", objective: "o", moduleIDs: ["src/payments"], seams: ["Il rimborso di un ordine"], decisionIDs: [], dependencies: [], requiredChecks: ["git_diff_check"], tools: ["edits"], instructions: "i" },
      { ...context(document), startAssignment: () => undefined } as ToolContext,
    );
    expect(result.isError).toBeFalsy();
    expect(parse(result).presence).toBeUndefined();
  });

  it("propose_goal warns when someone already works on a similar goal", async () => {
    const document = emptyDocument("p");
    const tools = { ...context(document), presence: view([entry(bea)]) } as ToolContext;
    const warned = parse(
      await runCoordinatorTool("propose_goal", { title: "Rimborsi parziali degli ordini", outcome: "Un ordine si rimborsa in parte", acceptedExamples: ["Ordine 42: rimborso di 10 euro"] }, tools),
    );
    expect(warned.alreadyInProgress).toEqual([{ who: "Bea", branch: "feature/rimborsi", task: "Rimborsi parziali", files: ["src/payments/refund.ts", "README.md"] }]);
    expect(warned.warning).toMatch(/tell the person/);
    const quiet = parse(await runCoordinatorTool("propose_goal", { title: "Accesso con passkey", outcome: "Login senza password", acceptedExamples: ["x"] }, tools));
    expect(quiet.alreadyInProgress).toBeUndefined();
  });
});

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

function context(document: ProjectDocument): ToolContext {
  return {
    document,
    runningRequestId: null,
    snapshot: { modules: MODULES },
    changed: () => undefined,
    addCard: () => undefined,
    models: ["gpt-5.5"],
    defaultModel: "gpt-5.5",
    defaultProvider: "codex",
    providers: [{ id: "codex", models: ["gpt-5.5"] }],
  } as unknown as ToolContext;
}

function teamDocument(): ProjectDocument {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["o"], priorities: [], scopeModuleIds: ["src/payments", "src/cart"], authorizedActions: ["executeInWorktree"], limits: [] });
  document.team.proposals.push({
    id: "tp1",
    requestId: null,
    summary: null,
    members: [{ name: "Ada", competence: "TypeScript", reason: "r", moduleIds: ["src/payments"] }],
    createdAt: NOW,
    resolution: null,
  } as never);
  confirmTeam(document, "tp1", null, null);
  return document;
}

function runningAssignment(specialistId: string) {
  return {
    id: "a1",
    specialistId,
    requestId: null,
    status: "running",
    moduleIds: ["src/payments"],
    goalId: null,
    slice: { planId: "p1", sliceId: "S2" },
  } as never;
}
