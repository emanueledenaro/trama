import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@shared/domain";
import { translator } from "@shared/i18n";
import type { RepositoryModule } from "@shared/repository";
import { activityLog } from "@shared/activity";
import { mergeProblem, mergeProposal, renameProblem, splitBlocked, splitProblem, splitProposal, undoProblem } from "@shared/squadChanges";
import { developersOutsideSquads, squadForModules, squadOf, teamSquads } from "@shared/squads";
import { emptyDocument } from "./document";
import { grantMandate } from "./pact";
import { confirmSquadMerge, dismissSquadMerge, mergeSquads, renameSquad, requestSquadMerge, splitSquad, undoSquadChange } from "./squadChanges";
import { formSquads } from "./squads";
import { assign, completeTeam, confirmTeam, findSpecialist, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));
const t = translator("it");

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [module("Sources/Catalog", "Catalogo"), module("Sources/Checkout", "Checkout"), module("Sources/Admin", "Admin")];

/** Three squads formed after the study: Catalogo (Ada, Carla), Checkout (Bruno, Elena) and Admin (Dario). */
function project(): ProjectDocument {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: MODULES.map((m) => m.id), authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const members: [string, string][] = [
    ["Ada", "Sources/Catalog"],
    ["Bruno", "Sources/Checkout"],
    ["Carla", "Sources/Catalog"],
    ["Dario", "Sources/Admin"],
    ["Elena", "Sources/Checkout"],
  ];
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: members.map(([name, moduleId]) => ({ name, competence: "TypeScript", reason: "Negozio", moduleIds: [moduleId] })),
  });
  confirmTeam(document, proposal.id, null, null, at(0));
  completeTeam(document.team, at(0));
  formSquads(document, MODULES, at(1));
  return document;
}

const squad = (document: ProjectDocument, name: string) => teamSquads(document).find((s) => s.name === name)!;
const id = (document: ProjectDocument, name: string) => findSpecialist(document, name)!.id;
const names = (document: ProjectDocument, ids: string[]) => ids.map((i) => document.team.specialists.find((s) => s.id === i)!.name);
const person = (document: ProjectDocument, specialistId: string) => document.team.specialists.find((s) => s.id === specialistId);

const work = (document: ProjectDocument, developer: string, moduleId: string) =>
  assign(
    document,
    {
      specialist: developer,
      kind: "agreedTicket",
      objective: `Lavoro di ${developer}`,
      issueNumber: null,
      exercise: null,
      moduleIds: [moduleId],
      dependencies: [],
      model: "gpt-6-luna",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Lavora",
    },
    document.mandate!.version,
    "r1",
    at(5),
  );

describe("the person renames, merges and splits the squads (A11)", () => {
  it("forms the three squads the tests start from", () => {
    const document = project();
    expect(teamSquads(document).map((s) => [s.name, names(document, s.developerIds)])).toEqual([
      ["Catalogo", ["Ada", "Carla"]],
      ["Checkout", ["Bruno", "Elena"]],
      ["Admin", ["Dario"]],
    ]);
  });

  it("renames a squad without changing its id, its area, its people or its slices", () => {
    const document = project();
    const checkout = squad(document, "Checkout");
    const before = structuredClone(checkout);
    expect(squadForModules(document, ["Sources/Checkout"])?.id).toBe(checkout.id);
    renameSquad(document, checkout.id, "  Pagamenti ", "person", t, at(10));
    const renamed = teamSquads(document).find((s) => s.id === before.id)!;
    expect(renamed).toMatchObject({ id: before.id, name: "Pagamenti", moduleIds: before.moduleIds, leadId: before.leadId, qaId: before.qaId, developerIds: before.developerIds });
    expect(renamed.touchedAt).toBe(at(10).toISOString());
    expect(squadForModules(document, ["Sources/Checkout"])?.id).toBe(before.id);
    expect(document.squadChanges).toHaveLength(1);
    expect(document.squadChanges![0]).toMatchObject({ kind: "rename", by: "person", names: { from: "Checkout", to: "Pagamenti" }, undoneAt: null });
  });

  it("refuses an empty name, another squad's name and the same name, with the reason", () => {
    const document = project();
    const checkout = squad(document, "Checkout");
    expect(renameProblem(document, checkout.id, "  ")?.key).toBe("teams.change.problem.nameEmpty");
    expect(renameProblem(document, checkout.id, "catalogo")).toEqual({ key: "teams.change.problem.nameTaken", params: { name: "catalogo" } });
    expect(renameProblem(document, checkout.id, "Checkout")?.key).toBe("teams.change.problem.nameSame");
    expect(() => renameSquad(document, checkout.id, "Catalogo", "person", t)).toThrow("C'è già una squadra che si chiama Catalogo.");
    expect(document.squadChanges ?? []).toHaveLength(0);
  });

  it("merges two squads: areas, developers and slices come together, the other lead and QA leave with the reason", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const admin = squad(document, "Admin");
    const [lead, qa] = [admin.leadId, admin.qaId];
    const change = mergeSquads(document, catalog.id, admin.id, null, "person", t, at(10));
    expect(teamSquads(document).map((s) => s.name)).toEqual(["Catalogo", "Checkout"]);
    const merged = squad(document, "Catalogo");
    expect(merged.id).toBe(catalog.id);
    expect(merged.moduleIds).toEqual(["Sources/Catalog", "Sources/Admin"]);
    expect(names(document, merged.developerIds)).toEqual(["Ada", "Carla", "Dario"]);
    // The slices of the area that joined belong to the merged squad now.
    expect(squadForModules(document, ["Sources/Admin"])?.id).toBe(catalog.id);
    for (const gone of [lead, qa]) {
      expect(person(document, gone)).toMatchObject({ status: "removed", removal: { removedBy: "person", reason: "La squadra Admin si è unita a Catalogo." } });
    }
    expect(change).toMatchObject({ kind: "merge", afterIds: [catalog.id], names: { to: "Catalogo", other: "Admin", leftIds: [] } });
  });

  it("with more than three developers Trama proposes who stays and the person confirms: who leaves keeps the work", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const checkout = squad(document, "Checkout");
    const elena = work(document, "Elena", "Sources/Checkout");
    // Elena works now: she stays first, then those who know the merged area, the squad that stays first.
    expect(names(document, mergeProposal(document, catalog.id, checkout.id))).toEqual(["Elena", "Ada", "Carla"]);
    expect(mergeProblem(document, catalog.id, checkout.id, null)?.key).toBe("teams.change.problem.keepNone");
    expect(mergeProblem(document, catalog.id, checkout.id, [id(document, "Ada"), id(document, "Bruno"), id(document, "Carla")])).toEqual({
      key: "teams.change.problem.keepAtWork",
      params: { name: "Elena" },
    });
    expect(mergeProblem(document, catalog.id, checkout.id, ["Ada", "Bruno", "Carla", "Elena"].map((n) => id(document, n)))?.key).toBe("teams.change.problem.keepTooMany");
    const keep = ["Ada", "Carla", "Elena"].map((n) => id(document, n));
    const change = mergeSquads(document, catalog.id, checkout.id, keep, "person", t, at(10));
    expect(names(document, squad(document, "Catalogo").developerIds)).toEqual(["Ada", "Carla", "Elena"]);
    expect(developersOutsideSquads(document).map((s) => s.name)).toEqual(["Bruno"]);
    expect(change.names.leftIds).toEqual([id(document, "Bruno")]);
    // Elena's running work is hers, untouched.
    expect(findSpecialist(document, "Elena")!.assignments.at(-1)).toMatchObject({ id: elena.id, status: "preparing" });
    expect(squadOf(document, id(document, "Elena"))?.id).toBe(catalog.id);
  });

  it("refuses a merge beyond the limits or while the other squad's lead or QA has work open", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const admin = squad(document, "Admin");
    work(document, "Ada", "Sources/Catalog");
    work(document, "Dario", "Sources/Admin");
    document.settings = { developersPerSquad: 1 };
    expect(mergeProblem(document, catalog.id, admin.id, null)).toEqual({ key: "teams.change.problem.atWorkLimit", params: { count: 2, limit: 1 } });
    expect(() => mergeSquads(document, catalog.id, admin.id, null, "person", t)).toThrow(/oltre il limite di 1 al lavoro per squadra/);
    document.settings = {};
    person(document, admin.qaId)!.assignments.push({ ...findSpecialist(document, "Dario")!.assignments[0]!, id: "A-QA", specialistId: admin.qaId });
    expect(mergeProblem(document, catalog.id, admin.id, null)?.key).toBe("teams.change.problem.staffAtWork");
    expect(mergeProblem(document, catalog.id, catalog.id, null)?.key).toBe("teams.change.problem.sameSquad");
    expect(teamSquads(document)).toHaveLength(3);
  });

  it("splits a squad by the areas the person picks: its slices go with them, running work stays with its developer", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    mergeSquads(document, catalog.id, squad(document, "Admin").id, null, "person", t, at(10));
    expect(splitBlocked(document, squad(document, "Checkout").id)?.key).toBe("teams.change.problem.oneArea");
    // Carla works on the Admin area but stays in Catalogo: her work stays hers.
    const running = work(document, "Carla", "Sources/Admin");
    expect(names(document, splitProposal(document, catalog.id, ["Sources/Admin"]))).toEqual(["Dario"]);
    const change = splitSquad(document, catalog.id, ["Sources/Admin"], [id(document, "Dario")], "Amministrazione", "person", t, at(11));
    const created = squad(document, "Amministrazione");
    expect(teamSquads(document).map((s) => s.name)).toEqual(["Catalogo", "Amministrazione", "Checkout"]);
    expect(created).toMatchObject({ moduleIds: ["Sources/Admin"], touchedAt: at(11).toISOString() });
    expect(names(document, created.developerIds)).toEqual(["Dario"]);
    expect(person(document, created.leadId)).toMatchObject({ role: "squadLead", status: "available" });
    expect(person(document, created.qaId)).toMatchObject({ role: "qa", status: "available" });
    expect(squad(document, "Catalogo")).toMatchObject({ id: catalog.id, moduleIds: ["Sources/Catalog"] });
    expect(names(document, squad(document, "Catalogo").developerIds)).toEqual(["Ada", "Carla"]);
    expect(squadForModules(document, ["Sources/Admin"])?.id).toBe(created.id);
    expect(findSpecialist(document, "Carla")!.assignments.at(-1)).toMatchObject({ id: running.id, status: "preparing" });
    expect(change).toMatchObject({ kind: "split", afterIds: [catalog.id, created.id], addedIds: [created.leadId, created.qaId] });
  });

  it("refuses a split that leaves a squad without an area or a developer, or beyond the squads at work together", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    mergeSquads(document, catalog.id, squad(document, "Admin").id, null, "person", t, at(10));
    const [ada, dario] = [id(document, "Ada"), id(document, "Dario")];
    const all = ["Ada", "Carla", "Dario"].map((n) => id(document, n));
    expect(splitProblem(document, catalog.id, [], [dario], "Nuova")?.key).toBe("teams.change.problem.pickArea");
    expect(splitProblem(document, catalog.id, ["Sources/Catalog", "Sources/Admin"], [dario], "Nuova")?.key).toBe("teams.change.problem.keepArea");
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], [], "Nuova")?.key).toBe("teams.change.problem.pickDeveloper");
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], all, "Nuova")?.key).toBe("teams.change.problem.keepDeveloper");
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], [dario], "Checkout")?.key).toBe("teams.change.problem.nameTaken");
    work(document, "Ada", "Sources/Catalog");
    work(document, "Dario", "Sources/Admin");
    work(document, "Bruno", "Sources/Checkout");
    document.settings = { activeSquads: 2 };
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], [dario], "Nuova")).toEqual({ key: "teams.change.problem.squadsLimit", params: { limit: 2 } });
    // Moving only who is free keeps the squads at work as they are.
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], [id(document, "Carla")], "Nuova")).toBeNull();
    // Both at work move together: the squad left behind has nobody at work.
    expect(splitProblem(document, catalog.id, ["Sources/Admin"], [ada, dario], "Nuova")).toBeNull();
  });

  it("the Coordinator does not recreate, rename or fill a squad the person touched", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const checkout = squad(document, "Checkout");
    renameSquad(document, checkout.id, "Pagamenti", "person", t, at(9));
    renameSquad(document, squad(document, "Admin").id, "Gestione", "person", t, at(9));
    mergeSquads(document, catalog.id, checkout.id, ["Ada", "Carla", "Bruno"].map((n) => id(document, n)), "person", t, at(10));
    // A new study finds the Checkout area covered and Elena outside squads: nothing is recreated or renamed, and the
    // squads the person touched take nobody by themselves.
    expect(formSquads(document, MODULES, at(20))).toBeNull();
    expect(teamSquads(document).map((s) => s.name)).toEqual(["Catalogo", "Gestione"]);
    expect(developersOutsideSquads(document).map((s) => s.name)).toEqual(["Elena"]);
    // A squad only the Coordinator shaped, with room, still takes her.
    delete squad(document, "Gestione").touchedAt;
    const placed = formSquads(document, MODULES, at(21));
    expect(placed?.created).toEqual([]);
    expect(placed?.placed.map((p) => [p.developer.name, p.squad.name])).toEqual([["Elena", "Gestione"]]);
  });

  it("the person's merge asked through the Coordinator: at once up to three, a proposal to confirm beyond", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const direct = requestSquadMerge(document, squad(document, "Checkout").id, squad(document, "Admin").id, t, at(10));
    expect(direct.change).toMatchObject({ kind: "merge", by: "coordinator" });
    expect(document.team.squadMerge ?? null).toBeNull();
    const checkout = squad(document, "Checkout");
    const asked = requestSquadMerge(document, catalog.id, checkout.id, t, at(11));
    expect(asked.change).toBeNull();
    expect(asked.proposal).toMatchObject({ intoId: catalog.id, fromId: checkout.id });
    expect(asked.proposal!.keepIds).toHaveLength(3);
    expect(teamSquads(document)).toHaveLength(2);
    dismissSquadMerge(document, asked.proposal!.id);
    expect(document.team.squadMerge).toBeNull();
    const again = requestSquadMerge(document, catalog.id, checkout.id, t, at(12));
    expect(() => confirmSquadMerge(document, "SM-OTHER", again.proposal!.keepIds, t)).toThrow("Questa proposta non vale più");
    const keep = ["Ada", "Bruno", "Dario"].map((n) => id(document, n));
    confirmSquadMerge(document, again.proposal!.id, keep, t, at(13));
    expect(names(document, squad(document, "Catalogo").developerIds)).toEqual(["Ada", "Bruno", "Dario"]);
    expect(document.team.squadMerge).toBeNull();
    expect(document.squadChanges!.at(-1)).toMatchObject({ kind: "merge", by: "coordinator" });
  });

  it("undoes a merge: both squads back in their place, the lead and QA back in the team, who left back in", () => {
    const document = project();
    const before = structuredClone(teamSquads(document));
    const catalog = squad(document, "Catalogo");
    const checkout = squad(document, "Checkout");
    const change = mergeSquads(document, catalog.id, checkout.id, ["Ada", "Carla", "Bruno"].map((n) => id(document, n)), "person", t, at(10));
    undoSquadChange(document, change.id, t, at(12));
    expect(teamSquads(document)).toEqual(before);
    for (const back of [checkout.leadId, checkout.qaId]) expect(person(document, back)).toMatchObject({ status: "available", removal: null });
    expect(developersOutsideSquads(document)).toEqual([]);
    expect(change.undoneAt).toBe(at(12).toISOString());
    expect(undoProblem(document, change.id)?.key).toBe("teams.change.problem.undone");
  });

  it("undoes a split: the new squad goes, its unused lead and QA with it, the areas and developers come back", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    mergeSquads(document, catalog.id, squad(document, "Admin").id, null, "person", t, at(10));
    const merged = structuredClone(teamSquads(document));
    const people = document.team.specialists.length;
    const split = splitSquad(document, catalog.id, ["Sources/Admin"], [id(document, "Dario")], "Amministrazione", "person", t, at(11));
    expect(document.team.specialists).toHaveLength(people + 2);
    undoSquadChange(document, split.id, t, at(12));
    expect(teamSquads(document)).toEqual(merged);
    expect(document.team.specialists).toHaveLength(people);
  });

  it("undoes only the latest change of the same squads, and not while a lead the change added works", () => {
    const document = project();
    const catalog = squad(document, "Catalogo");
    const merge = mergeSquads(document, catalog.id, squad(document, "Admin").id, null, "person", t, at(10));
    const rename = renameSquad(document, catalog.id, "Vetrina", "person", t, at(11));
    const other = renameSquad(document, squad(document, "Checkout").id, "Cassa", "person", t, at(12));
    expect(undoProblem(document, merge.id)?.key).toBe("teams.change.problem.laterChange");
    expect(() => undoSquadChange(document, merge.id, t)).toThrow("Una modifica più recente tocca le stesse squadre");
    undoSquadChange(document, rename.id, t, at(13));
    expect(undoProblem(document, merge.id)).toBeNull();
    expect(undoProblem(document, other.id)).toBeNull();
    const split = splitSquad(document, catalog.id, ["Sources/Admin"], [id(document, "Dario")], "Amministrazione", "person", t, at(14));
    const lead = person(document, squad(document, "Amministrazione").leadId)!;
    lead.assignments.push({ ...findSpecialist(document, "Dario")!.assignments[0]!, id: "A-LEAD", specialistId: lead.id, status: "running" } as never);
    expect(undoProblem(document, split.id)).toEqual({ key: "teams.change.problem.addedAtWork", params: { name: lead.name } });
  });

  it("tells each change in Activity, in the person's words, and marks it undone", () => {
    const document = project();
    const checkout = squad(document, "Checkout");
    const rename = renameSquad(document, checkout.id, "Pagamenti", "person", t, at(10));
    undoSquadChange(document, rename.id, t, at(11));
    mergeSquads(document, squad(document, "Catalogo").id, squad(document, "Admin").id, null, "coordinator", t, at(12));
    const entries = activityLog(t, [], [], [], [], [], [], document.squadChanges).filter((e) => e.kind === "squad");
    expect(entries.map((e) => [e.label, e.detail, e.outcome])).toEqual([
      ["Squadre unite", "Admin si è unita a Catalogo.", "done"],
      ["Squadra rinominata", "Checkout si chiama ora Pagamenti.", "undone"],
    ]);
    expect(entries[0]!.squadChange?.by).toBe("coordinator");
  });
});
