// The window laid out as in VS Code (ADR 0018, issue #330): an activity bar picks the view, the side bar shows it,
// the chat is the editor area and the status bar says what happens now. Until the slices B02-B08 build the new
// views, every panel of the old inspector opens in the side bar under the closest view, one tab per old panel.
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
  activity: "work",
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
  // Lavoro is one view with sections (issue #332); Activity opens under it until the bottom panel (B08).
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
  activity: "work",
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

/** The widest the side bar gets: the conversation keeps CHAT_MIN_WIDTH beside it. */
export const sideBarMaxWidth = (viewport: number) => Math.max(SIDE_BAR_MIN_WIDTH, Math.min(720, viewport - ACTIVITY_BAR_WIDTH - CHAT_MIN_WIDTH));
