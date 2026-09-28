import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, ProjectDocument, WorkPlan } from "@shared/domain";
import { chatEvents, chatRequests, findGoal, timelineRowGoalId } from "@shared/goals";
import { deriveTimelineRows } from "@shared/timeline";
import { appendEvent, emptyDocument } from "./document";
import { createGoal } from "./goals";
import { supersedeGoalPlans } from "./plan";
import { migrateToSingleChat } from "./singleChat";
import { AppStorage } from "./storage";

const goalInput = (title: string) => ({ title, outcome: `${title}: risultato`, examples: [] });

function request(id: string, goalId: string | null, createdAt: string): CoordinatorRequest {
  return {
    id,
    text: id,
    moduleId: null,
    state: "completed",
    model: null,
    effort: null,
    createdAt,
    completedAt: createdAt,
    failure: null,
    ...(goalId ? { goalId } : {}),
  };
}

function plan(id: string, requestId: string | null, createdAt: string, status: WorkPlan["status"] = "ready"): WorkPlan {
  return {
    id,
    requestId,
    orderedBy: "coordinator",
    kind: "newFeature",
    moduleIds: [],
    summary: `Piano ${id}`,
    issueNumber: null,
    status,
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt,
    updatedAt: createdAt,
  };
}

const say = (document: ProjectDocument, text: string, requestId: string, at: string) =>
  appendEvent(document, "person", { type: "personMessage", text, moduleId: null, moduleName: null }, requestId, new Date(at));

/**
 * A project as Trama wrote it with one dialog per goal: the project dialog and two goal dialogs, each with its own
 * draft and selection, and two plans still active for the same goal.
 */
function legacyProject(): { stored: ProjectDocument; orders: string; catalog: string } {
  const document = emptyDocument("p");
  const orders = createGoal(document, goalInput("Ordini"), new Date("2026-09-20T09:00:00.000Z")).id;
  const catalog = createGoal(document, goalInput("Catalogo"), new Date("2026-09-20T09:01:00.000Z")).id;
  document.requests.push(
    request("r-project", null, "2026-09-20T10:00:00.000Z"),
    request("r-orders-1", orders, "2026-09-20T10:05:00.000Z"),
    request("r-catalog", catalog, "2026-09-20T10:10:00.000Z"),
    request("r-orders-2", orders, "2026-09-20T10:15:00.000Z"),
  );
  say(document, "Priorità del progetto", "r-project", "2026-09-20T10:00:00.000Z");
  say(document, "Partiamo dagli ordini", "r-orders-1", "2026-09-20T10:05:00.000Z");
  say(document, "Il catalogo è lento", "r-catalog", "2026-09-20T10:10:00.000Z");
  say(document, "Rifacciamo il piano degli ordini", "r-orders-2", "2026-09-20T10:15:00.000Z");
  // An event written before its goal was recorded on it: the request still says where it came from.
  delete document.events.at(-1)!.goalId;
  document.plans.push(
    plan("P-OLD", "r-orders-1", "2026-09-20T10:06:00.000Z"),
    plan("P-CATALOG", "r-catalog", "2026-09-20T10:11:00.000Z"),
    plan("P-NEW", "r-orders-2", "2026-09-20T10:16:00.000Z", "seams"),
    plan("P-PROJECT", "r-project", "2026-09-20T10:01:00.000Z"),
  );
  document.composerDraft = "bozza del progetto";
  findGoal(document, orders)!.dialog = {
    selectedModel: "gpt-5.5",
    selectedEffort: "high",
    composerDraft: "bozza sugli ordini",
    providerPreferences: { claudeAgent: { model: "claude-sonnet-5", effort: null } },
  };
  findGoal(document, catalog)!.dialog = { selectedModel: null, selectedEffort: null, composerDraft: "" };
  return { stored: JSON.parse(JSON.stringify(document)) as ProjectDocument, orders, catalog };
}

describe("single chat migration (U01)", () => {
  it("moves the goal dialogs of an existing project into the one chat when it is opened", async () => {
    const { stored, orders, catalog } = legacyProject();
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-single-chat-")));
    await mkdir(dirname(storage.documentPath("p")), { recursive: true });
    await writeFile(storage.documentPath("p"), JSON.stringify(stored));

    const loaded = await storage.loadDocument("p");
    expect(loaded).toMatchObject({ writable: true, error: null });
    const document = loaded.document!;

    // One chat: every message, in the order it was recorded, each with the goal it came from.
    const messages = chatEvents(document.events, null).map((e) => [e.content.type === "personMessage" ? e.content.text : e.content.type, e.goalId ?? null]);
    expect(messages).toEqual([
      ["Priorità del progetto", null],
      ["Partiamo dagli ordini", orders],
      ["Il catalogo è lento", catalog],
      ["Rifacciamo il piano degli ordini", orders],
    ]);
    expect(chatEvents(document.events, orders)).toHaveLength(2);
    expect(chatRequests(document.requests, catalog).map((r) => r.id)).toEqual(["r-catalog"]);

    // One composer: the goal drafts join the chat's, and the goal composers are gone.
    expect(document.composerDraft).toBe("bozza del progetto\n\nbozza sugli ordini");
    expect(findGoal(document, orders)!.dialog).toBeUndefined();
    expect(findGoal(document, catalog)!.dialog).toBeUndefined();
    expect(document.providerPreferences).toEqual({ claudeAgent: { model: "claude-sonnet-5", effort: null } });

    // One active plan per goal: the newer plan of the orders replaced the older one. The others are untouched.
    const status = Object.fromEntries(document.plans.map((p) => [p.id, [p.status, p.supersededBy ?? null]]));
    expect(status).toEqual({
      "P-OLD": ["superseded", "P-NEW"],
      "P-CATALOG": ["ready", null],
      "P-NEW": ["seams", null],
      "P-PROJECT": ["ready", null],
    });

    // Saved and opened again, nothing moves a second time.
    await storage.saveDocument(document);
    const reopened = (await storage.loadDocument("p")).document!;
    expect(reopened.composerDraft).toBe(document.composerDraft);
    expect(reopened.events).toEqual(document.events);
    expect(reopened.plans).toEqual(document.plans);
  });

  it("changes nothing on a document already in the one chat", () => {
    const { stored } = legacyProject();
    migrateToSingleChat(stored);
    const again = migrateToSingleChat(stored);
    expect(again).toEqual({ taggedEvents: 0, reordered: false, foldedDrafts: 0, removedComposers: 0, supersededPlans: 0 });
  });

  it("reports what it moved and puts events back in recorded order", () => {
    const { stored } = legacyProject();
    stored.events.reverse();
    const result = migrateToSingleChat(stored);
    expect(result).toEqual({ taggedEvents: 1, reordered: true, foldedDrafts: 1, removedComposers: 2, supersededPlans: 1 });
    expect(stored.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("does not repeat a goal draft the chat's draft already holds", () => {
    const { stored, orders } = legacyProject();
    stored.composerDraft = "bozza sugli ordini";
    migrateToSingleChat(stored);
    expect(stored.composerDraft).toBe("bozza sugli ordini");
    expect(findGoal(stored, orders)!.dialog).toBeUndefined();
  });
});

describe("one active plan per goal (U01)", () => {
  it("supersedes the earlier plans of the same goal and leaves the others alone", () => {
    const document = emptyDocument("p");
    const goal = createGoal(document, goalInput("Ordini")).id;
    const other = createGoal(document, goalInput("Catalogo")).id;
    document.requests.push(
      request("r1", goal, "2026-09-20T10:00:00.000Z"),
      request("r2", other, "2026-09-20T10:01:00.000Z"),
      request("r3", goal, "2026-09-20T10:02:00.000Z"),
      request("r4", null, "2026-09-20T10:03:00.000Z"),
    );
    const failed = plan("P-FAILED", "r1", "2026-09-20T10:00:10.000Z", "failed");
    const first = plan("P-1", "r1", "2026-09-20T10:00:20.000Z", "planning");
    const otherPlan = plan("P-OTHER", "r2", "2026-09-20T10:01:10.000Z");
    const next = plan("P-2", "r3", "2026-09-20T10:02:10.000Z", "planning");
    document.plans.push(failed, first, otherPlan, next);

    const replaced = supersedeGoalPlans(document, next, new Date("2026-09-20T10:02:11.000Z"));
    expect(replaced.map((p) => p.id)).toEqual(["P-1"]);
    expect(first).toMatchObject({ status: "superseded", supersededBy: "P-2", updatedAt: "2026-09-20T10:02:11.000Z" });
    expect(failed.status).toBe("failed");
    expect(otherPlan.status).toBe("ready");
    expect(next.status).toBe("planning");

    // A plan of the whole project, outside every goal, replaces nothing.
    const projectPlan = plan("P-PROJECT", "r4", "2026-09-20T10:03:10.000Z");
    document.plans.push(projectPlan);
    expect(supersedeGoalPlans(document, projectPlan)).toEqual([]);
  });
});

describe("goal filter of the chat (U01)", () => {
  it("shows the goal's events and the card that proposed it, and tags each row with its goal", () => {
    const document = emptyDocument("p");
    const goal = createGoal(document, goalInput("Ordini")).id;
    document.requests.push(request("r1", null, "2026-09-20T10:00:00.000Z"), request("r2", goal, "2026-09-20T10:01:00.000Z"));
    say(document, "Messaggio del progetto", "r1", "2026-09-20T10:00:00.000Z");
    const proposal = appendEvent(document, "coordinator", { type: "card", kind: "goal", title: "Obiettivo proposto", detail: null, referenceId: goal }, "r1");
    say(document, "Messaggio sugli ordini", "r2", "2026-09-20T10:01:00.000Z");

    expect(chatEvents(document.events, null)).toHaveLength(3);
    expect(chatEvents(document.events, goal).map((e) => e.id)).toEqual([proposal.id, document.events[2]!.id]);

    const rows = deriveTimelineRows(document.events, document.requests, null);
    expect(rows.map((row) => timelineRowGoalId(row, document.requests))).toEqual([null, null, goal]);
  });
});
