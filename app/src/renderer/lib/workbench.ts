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
  standard: "rules",
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
  // Lavoro is one view with sections (issue #332).
  work: ["work"],
  teams: ["team"],
  rules: ["mandate", "pact", "standard"],
  memory: ["memory"],
};

export const TAB_LABELS: Partial<Record<TargetKind, MessageKey>> = {
  mandate: "workbench.tab.mandate",
  pact: "workbench.tab.pact",
  standard: "workbench.tab.standard",
};

/** The tab a detail belongs to: a module under the map, a person under the team, anything of Lavoro under Lavoro. */
const TAB_OF: Partial<Record<TargetKind, TargetKind>> = {
  goals: "work",
  goal: "work",
  candidate: "work",
  audit: "work",
  group: "work",
  pullRequest: "work",
  commit: "work",
  branch: "work",
  issues: "work",
  issue: "work",
  specialist: "team",
  agentThread: "team",
  decision: "pact",
  // Issue #334: the map is the Moduli section of the mandate, so a module and a file belong to Mandato.
  map: "mandate",
  module: "mandate",
  file: "mandate",
};

/** Where a detail's way back leads when there is no history: a module back to the modules, else to its tab. */
const PARENT_OF: Partial<Record<TargetKind, InspectorTarget>> = {
  module: { kind: "map" },
};

export const viewOf = (target: InspectorTarget): Exclude<SideBarView, "projects"> => VIEW_OF[target.kind];

export const tabOf = (target: InspectorTarget): TargetKind => TAB_OF[target.kind] ?? target.kind;

export const parentOf = (target: InspectorTarget): InspectorTarget => PARENT_OF[target.kind] ?? ({ kind: tabOf(target) } as InspectorTarget);

/** A panel that is not one of its view's tabs is a detail: its header offers a way back. */
export const isDetail = (target: InspectorTarget): boolean => {
  if (target.kind === "waiting") return false;
  if (target.kind === "goals") return Boolean(target.create);
  // Goals, branches and issues are sections of the Lavoro view, not details (issue #332).
  if (target.kind === "group" || target.kind === "issues") return false;
  // The map is Mandato with its Moduli open, not a detail (issue #334).
  if (target.kind === "map") return false;
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

export const SIDE_BAR_MAX_WIDTH = 720;

/**
 * The sheet's margins: PANE_GAP on each side above a 1200 px window, flush at 1200 and below (index.css, .workbench-card).
 * Every maximum below counts them, so the conversation keeps CHAT_MIN_WIDTH: window - 48 - side bar - detail - margins.
 */
export const SHEET_FLUSH_MAX_VIEWPORT = 1200;
export const sheetMargins = (viewport: number) => (viewport > SHEET_FLUSH_MAX_VIEWPORT ? 2 * PANE_GAP : 0);

/**
 * The gap between two panes of the sheet, which is also their sash (person's note, 2 October 2026): 8 px above a
 * 1200 px window (12 px, index.css --pane-gap), where the panes lie flush (index.css, .sash--gap).
 */
export const PANE_GAP = 12;
export const paneGap = (viewport: number) => (viewport > SHEET_FLUSH_MAX_VIEWPORT ? PANE_GAP : 0);

/** The room beside the activity bar and the sheet's margins, less the conversation's minimum. */
const roomBesideChat = (viewport: number) => viewport - ACTIVITY_BAR_WIDTH - sheetMargins(viewport) - CHAT_MIN_WIDTH;

/**
 * The widest the side bar gets: the conversation keeps CHAT_MIN_WIDTH beside it and beside the detail pane, when the
 * split editor shows one (`detail` is its real width, 0 without it). At 720 px it is 252 px.
 */
export const sideBarMaxWidth = (viewport: number, detail = 0) =>
  Math.max(SIDE_BAR_MIN_WIDTH, Math.min(SIDE_BAR_MAX_WIDTH, roomBesideChat(viewport) - detail - (detail > 0 ? paneGap(viewport) : 0)));

// Issue #336 (B07): the editor area has tabs, as in VS Code. The conversation is always the first and never closes; a
// detail opens in a tab of its own next to it, and so do Progetti and Impostazioni. From about 1500 px the details
// sit beside the conversation in a split editor; below that a tab covers the conversation.

/** The details that open as editor tabs instead of in the side bar. Lists, tabs and forms stay in the side bar. */
export const EDITOR_KINDS: ReadonlySet<TargetKind> = new Set<TargetKind>([
  "specialist",
  "agentThread",
  "candidate",
  "audit",
  "decision",
  "goal",
  "issue",
  "pullRequest",
  "commit",
  "branch",
  "module",
  "file",
]);

export const opensInEditor = (target: InspectorTarget): boolean => EDITOR_KINDS.has(target.kind);

/** A tab of the editor area besides the conversation. */
/** Benvenuto is a main tab like Progetti and Impostazioni (issue #354). */
export type EditorTab = { kind: "projects" } | { kind: "settings" } | { kind: "welcome" } | { kind: "detail"; target: InspectorTarget };

export const CONVERSATION_TAB = "conversation";

/** The identity of a detail: reopening the same record brings back its tab instead of opening another. */
export function detailKey(target: InspectorTarget): string {
  switch (target.kind) {
    case "issue":
    case "pullRequest":
      return `${target.kind}:${target.number}`;
    case "commit":
      return `commit:${target.sha}`;
    case "branch":
      return `branch:${target.name}`;
    case "file":
      return `file:${target.path}`;
    case "specialist":
    case "agentThread":
    case "candidate":
    case "audit":
    case "decision":
    case "goal":
    case "module":
      return `${target.kind}:${target.id}`;
    default:
      return target.kind;
  }
}

export const tabKey = (tab: EditorTab): string => (tab.kind === "detail" ? `detail:${detailKey(tab.target)}` : tab.kind);

/** From this window width the details sit beside the conversation (issue #336: "da circa 1500 px"). */
export const SPLIT_EDITOR_MIN_VIEWPORT = 1500;
export const DETAIL_PANE_MIN_WIDTH = 360;

/** The detail pane's default width beside the conversation: 440 px, 520 from a 1900 px window. */
export const detailPaneDefaultWidth = (viewport: number) => (viewport >= 1900 ? 520 : 440);

export const DETAIL_PANE_MAX_WIDTH = 900;

/**
 * The widest the detail pane gets: the conversation keeps CHAT_MIN_WIDTH beside it, next to the activity bar and the
 * side bar at its real width (`sideBar`, 0 when it is closed).
 */
export const detailPaneMaxWidth = (viewport: number, sideBar: number = sideBarDefaultWidth(viewport)) =>
  Math.max(DETAIL_PANE_MIN_WIDTH, Math.min(DETAIL_PANE_MAX_WIDTH, roomBesideChat(viewport) - sideBar - paneGap(viewport)));

/**
 * The widths on screen of the side bar and of the detail pane, from the widths the person chose: the detail pane
 * first fits beside the chosen side bar, then the side bar fits beside the detail pane as it shows. Together they
 * leave the conversation CHAT_MIN_WIDTH. A closed panel is null and takes no room.
 */
export function fitPanels(viewport: number, sideBar: number | null, detail: number | null): { sideBar: number; detail: number } {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  const detailWidth = detail === null ? 0 : clamp(detail, DETAIL_PANE_MIN_WIDTH, detailPaneMaxWidth(viewport, sideBar ?? 0));
  const sideBarWidth = sideBar === null ? 0 : clamp(sideBar, SIDE_BAR_MIN_WIDTH, sideBarMaxWidth(viewport, detailWidth));
  return { sideBar: sideBarWidth, detail: detailWidth };
}

/** Whether the details sit beside the conversation: a wide window and the person's switch on. */
export const splitsEditor = (viewport: number, switchOn: boolean) => switchOn && viewport >= SPLIT_EDITOR_MIN_VIEWPORT;

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

/**
 * The lowest window that holds the editor's EDITOR_MIN_HEIGHT and the bottom panel's PANEL_MIN_HEIGHT one above the
 * other: 716 px. A lower window keeps the panel under the editor at PANEL_MIN_HEIGHT and the editor gives up the
 * difference: the composer always stays in view, which an overlaid panel would hide (responsive pass of 1 October 2026).
 */
export const PANEL_DOCKED_MIN_VIEWPORT = WINDOW_BARS_HEIGHT + EDITOR_MIN_HEIGHT + PANEL_MIN_HEIGHT;

/** The bottom panel never lies over the editor: it would hide the composer. Kept for the callers that ask. */
export const panelOverlays = (_viewportHeight: number) => false;

/**
 * The highest the bottom panel gets: the editor keeps EDITOR_MIN_HEIGHT above it and the gap between them, and in a low
 * window the panel keeps its lowest.
 */
export const panelMaxHeight = (viewportHeight: number) =>
  Math.max(PANEL_MIN_HEIGHT, viewportHeight - WINDOW_BARS_HEIGHT - EDITOR_MIN_HEIGHT - PANE_GAP);
