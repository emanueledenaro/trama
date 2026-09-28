// The window laid out as in VS Code (ADR 0018, issue #330): an activity bar picks the view, the side bar shows it,
// the chat is the editor area and the status bar says what happens now. Until the slices B02-B08 build the new
// views, every panel of the old inspector opens in the side bar under the closest view, one tab per old panel.
// Activity is not one of them: it opens in the bottom panel under the editor (issue #337).
import type { MessageKey } from "@shared/i18n";
import type { InspectorTarget } from "@/lib/store";

/** The views of the activity bar that open in the side bar. Conversazione and Impostazioni open in the editor. */
export type SideBarView = "projects" | "waiting" | "work" | "teams" | "rules" | "memory";

export const SIDE_BAR_VIEWS: SideBarView[] = ["projects", "waiting", "work", "teams", "rules", "memory"];

export type TargetKind = InspectorTarget["kind"];

/** The name of each view, the same on its icon and on the side bar's header. */
export const VIEW_LABELS: Record<SideBarView, MessageKey> = {
  projects: "workbench.view.projects",
  waiting: "workbench.view.waiting",
  work: "workbench.view.work",
  teams: "workbench.view.teams",
  rules: "workbench.view.rules",
  memory: "workbench.view.memory",
};

/** Where each panel of today opens: the view of the activity bar closest to it (issue #330). */
export const VIEW_OF: Record<TargetKind, Exclude<SideBarView, "projects">> = {
  waiting: "waiting",
  goals: "work",
  goal: "work",
  work: "work",
  candidate: "work",
  audit: "work",
  group: "work",
  pullRequest: "work",
  commit: "work",
  branch: "work",
  issues: "work",
  issue: "work",
  team: "teams",
  specialist: "teams",
  agentThread: "teams",
  mandate: "rules",
  pact: "rules",
  decision: "rules",
  map: "rules",
  module: "rules",
  file: "rules",
  memory: "memory",
};

/** The panels a view lists as tabs, in order; the first is what the view shows when it opens. */
export const VIEW_TABS: Record<Exclude<SideBarView, "projects">, TargetKind[]> = {
  waiting: ["waiting"],
  work: ["goals", "work", "group", "issues"],
  teams: ["team"],
  rules: ["mandate", "pact", "map"],
  memory: ["memory"],
};

export const TAB_LABELS: Partial<Record<TargetKind, MessageKey>> = {
  goals: "workbench.tab.goals",
  work: "workbench.tab.candidates",
  group: "workbench.tab.group",
  issues: "workbench.tab.issues",
  mandate: "workbench.tab.mandate",
  pact: "workbench.tab.pact",
  map: "workbench.tab.map",
};

/** The tab a detail belongs to: a module under the map, a candidate under the candidates, a goal under the goals. */
const TAB_OF: Partial<Record<TargetKind, TargetKind>> = {
  goal: "goals",
  candidate: "work",
  audit: "work",
  pullRequest: "group",
  commit: "group",
  branch: "group",
  issue: "issues",
  specialist: "team",
  agentThread: "team",
  decision: "pact",
  module: "map",
  file: "map",
};

export const viewOf = (target: InspectorTarget): Exclude<SideBarView, "projects"> => VIEW_OF[target.kind];

export const tabOf = (target: InspectorTarget): TargetKind => TAB_OF[target.kind] ?? target.kind;

/** A panel that is not one of its view's tabs is a detail: its header offers a way back. */
export const isDetail = (target: InspectorTarget): boolean => {
  if (target.kind === "waiting") return false;
  if (target.kind === "goals") return Boolean(target.create);
  return !VIEW_TABS[viewOf(target)].includes(target.kind);
};

/** What a view shows when it opens: its first tab. Projects has no panel of the old inspector. */
export const homeOf = (view: SideBarView): InspectorTarget | null =>
  view === "projects" ? null : ({ kind: VIEW_TABS[view][0] } as InspectorTarget);

export const ACTIVITY_BAR_WIDTH = 48;
/** The narrowest the conversation gets next to the side bar (issue #330: 420 px at 1066x666). */
export const CHAT_MIN_WIDTH = 420;
export const SIDE_BAR_MIN_WIDTH = 240;

/** The side bar's default width: 300 px, 340 from a 1500 px window (issue #330). */
export const sideBarDefaultWidth = (viewport: number) => (viewport >= 1500 ? 340 : 300);

/** The widest the side bar gets: the conversation keeps CHAT_MIN_WIDTH beside it. */
export const sideBarMaxWidth = (viewport: number) => Math.max(SIDE_BAR_MIN_WIDTH, Math.min(720, viewport - ACTIVITY_BAR_WIDTH - CHAT_MIN_WIDTH));

/** The title bar and the status bar: the editor and the bottom panel share the height left between them. */
export const WINDOW_BARS_HEIGHT = 46 + 24;
/** The lowest the bottom panel gets: its header and a few rows. */
export const PANEL_MIN_HEIGHT = 120;
/**
 * The height the editor keeps above the bottom panel: the conversation stays at least 380 px high over the composer's
 * dock, which takes 146 px with an empty composer (issue #337). At 1280x800 the default 200 px is also the highest.
 */
export const EDITOR_MIN_HEIGHT = 526;

/** The bottom panel's default height: 200 px, 260 from a 1500 px wide window (issue #337). */
export const panelDefaultHeight = (viewportWidth: number) => (viewportWidth >= 1500 ? 260 : 200);

/** The highest the bottom panel gets: the editor keeps EDITOR_MIN_HEIGHT above it. */
export const panelMaxHeight = (viewportHeight: number) => Math.max(PANEL_MIN_HEIGHT, viewportHeight - WINDOW_BARS_HEIGHT - EDITOR_MIN_HEIGHT);
