import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppState, FocusTask } from "@shared/domain";
import type { WaitingItem } from "@shared/waitingForYou";
import { useUi } from "@/lib/store";
import { emptyDocument } from "../../../main/core/document";
import { CoverPane } from "./ChatView";
import { WorkBar } from "./WorkBar";

const focus: FocusTask = {
  id: "goal:G-1",
  goalId: "G-1",
  title: "Preparare l'apertura controllata",
  phase: null,
  phaseLabel: "",
  blocker: null,
  waitingFor: null,
  status: "focus",
};

const waitingItem = { key: "question:D-1", kind: "question", targetId: "D-1", label: "Domanda", title: "Cosa succede a un ordine annullato?", goalId: null, askedAt: "" } as WaitingItem;

// Rendered on the server, the components read the store's initial state (the server snapshot of useSyncExternalStore):
// the test writes the parts the bar reads there, the work in focus and what waits for the person, and puts them back.
const initial = { ...useUi.getInitialState() };
const show = (waiting: WaitingItem[], task: FocusTask | null) =>
  Object.assign(useUi.getInitialState(), {
    app: {
      language: "it",
      project: {
        id: "p1",
        waiting,
        focus: { focus: task, queue: [] },
        overlaps: undefined,
        // The waiting item's title reads its references from these.
        document: emptyDocument("p1"),
        snapshot: { modules: [] },
        github: { repository: null, status: "loading", message: null, issues: [], snapshot: null, events: [] },
      },
    } as unknown as AppState,
    dialogGoalId: "G-1",
    sidebarOpen: false,
  });

// A tab over the conversation, as the agent's tab with its assignments at the bottom.
const agentTab = () => createElement("div", { "data-testid": "editor-detail" }, "Incarichi (10)");
const coverPane = () => renderToStaticMarkup(createElement(CoverPane, null, agentTab()));
const tagOf = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("the work bar outside the conversation (UI wave of 29 September)", () => {
  beforeEach(() => show([waitingItem], focus));
  afterEach(() => Object.assign(useUi.getInitialState(), initial));

  it("is the last row of a tab that covers the conversation, below the tab and in a room of its own", () => {
    const html = coverPane();
    expect(html.indexOf('data-testid="editor-detail"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="work-bar"')).toBeGreaterThan(html.indexOf("Incarichi (10)"));
    const row = tagOf(html, "work-bar-row");
    expect(row).toContain('data-placement="tab"');
    // In the flow of the tab's column, never laid over it.
    expect(row).not.toMatch(/\babsolute\b|\bfixed\b/);
    expect(row).toContain("shrink-0");
    // A flat row of the tab, not the floating glass of the composer.
    expect(tagOf(html, "work-bar")).not.toContain("translucent-popup");
    // It keeps what it does on the composer: the work in focus and Decidi.
    expect(html).toContain("Preparare l&#x27;apertura controllata");
    expect(html).toContain("Decidi");
  });

  it("leaves the tab alone when nothing is in focus and nothing waits", () => {
    show([], null);
    const html = coverPane();
    expect(html).toContain("Incarichi (10)");
    expect(html).not.toContain('data-testid="work-bar"');
  });

  it("stays attached to the composer in the conversation", () => {
    const html = renderToStaticMarkup(createElement(WorkBar, { placement: "composer" }));
    const bar = tagOf(html, "work-bar");
    expect(bar).toContain('data-placement="composer"');
    expect(bar).toContain("translucent-popup");
    // One piece with the composer: no bottom edge of its own, the composer's closes it.
    expect(bar).toContain("border-b-0");
  });
});
