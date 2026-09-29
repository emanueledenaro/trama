import {
  IconCircleDot,
  IconFile,
  IconFileDiff,
  IconGitBranch,
  IconGitCommit,
  IconGitPullRequest,
  IconHome,
  IconLayoutList,
  IconMessageCircle,
  IconMessages,
  IconRosetteDiscountCheck,
  IconSettings,
  IconSitemap,
  IconTarget,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "@shared/i18n";
import { ChatView } from "@/components/chat/ChatView";
import { InspectorBody, targetTitle, useTargetTitle } from "@/components/inspector/Inspector";
import { FilledScope } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useWaiting } from "@/components/WaitingView";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { Sash, useResizableWidth } from "@/lib/resizable";
import { type InspectorTarget, type MainView, useUi } from "@/lib/store";
import {
  CONVERSATION_TAB,
  DETAIL_PANE_MIN_WIDTH,
  type EditorTab,
  type TargetKind,
  detailPaneDefaultWidth,
  detailPaneMaxWidth,
  splitsEditor,
  tabKey,
} from "@/lib/workbench";

const ICON = "size-3.5 shrink-0";

const DETAIL_ICONS: Partial<Record<TargetKind, React.ReactNode>> = {
  specialist: <IconUser className={ICON} stroke={1.7} />,
  agentThread: <IconMessages className={ICON} stroke={1.7} />,
  candidate: <IconFileDiff className={ICON} stroke={1.7} />,
  audit: <IconFileDiff className={ICON} stroke={1.7} />,
  decision: <IconRosetteDiscountCheck className={ICON} stroke={1.7} />,
  goal: <IconTarget className={ICON} stroke={1.7} />,
  issue: <IconCircleDot className={ICON} stroke={1.7} />,
  pullRequest: <IconGitPullRequest className={ICON} stroke={1.7} />,
  commit: <IconGitCommit className={ICON} stroke={1.7} />,
  branch: <IconGitBranch className={ICON} stroke={1.7} />,
  module: <IconSitemap className={ICON} stroke={1.7} />,
  file: <IconFile className={ICON} stroke={1.7} />,
};

/** The window's width, followed as it changes: the editor splits from about 1500 px (issue #336). */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Whether the editor shows the details beside the conversation now. */
export function useSplitEditor(): boolean {
  const width = useViewportWidth();
  const switchOn = useUi((s) => s.splitEditor);
  const hasDetail = useUi((s) => s.activeDetail !== null);
  return splitsEditor(width, switchOn) && hasDetail;
}

function TabButton({
  tabKey: key,
  icon,
  label,
  hover,
  selected,
  closable,
  titleTestId,
}: {
  tabKey: string;
  icon: React.ReactNode;
  label: string;
  hover?: string;
  selected: boolean;
  closable: boolean;
  titleTestId?: string;
}) {
  const t = useT();
  const focusTab = useUi((s) => s.focusTab);
  const closeTab = useUi((s) => s.closeTab);
  return (
    <div
      className={cn(
        "group relative flex h-full min-w-0 max-w-[14rem] shrink-0 items-center border-r border-[color:var(--app-panel-border)] text-ui-sm",
        selected
          ? "bg-[var(--color-background-surface)] text-foreground shadow-[inset_0_1px_0_var(--color-text-accent)]"
          : "text-muted-foreground hover:text-foreground",
      )}
      data-testid="editor-tab"
      data-tab={key}
      data-selected={selected ? "true" : "false"}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        className={cn("flex h-full min-w-0 items-center gap-1.5 pl-3", closable ? "pr-1" : "pr-3")}
        onClick={() => focusTab(key)}
        onAuxClick={(event) => {
          // A middle click closes the tab, as in VS Code.
          if (closable && event.button === 1) closeTab(key);
        }}
      >
        {icon}
        <span className="min-w-0 truncate" title={hover} data-testid={selected ? titleTestId : undefined}>
          {label}
        </span>
      </button>
      {closable ? (
        <Tooltip label={t("workbench.editor.closeTab", { name: label })}>
          <button
            type="button"
            aria-label={t("workbench.editor.closeTab", { name: label })}
            className={cn(
              "sidebar-icon-button mr-1.5 size-5 rounded-md",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => closeTab(key)}
          >
            <IconX className="size-3" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function DetailTabButton({ tab, selected }: { tab: Extract<EditorTab, { kind: "detail" }>; selected: boolean }) {
  const { title, id } = useTargetTitle(tab.target);
  return (
    <TabButton
      tabKey={tabKey(tab)}
      icon={DETAIL_ICONS[tab.target.kind] ?? <IconFile className={ICON} stroke={1.7} />}
      label={title}
      hover={id}
      selected={selected}
      closable
      titleTestId="editor-detail-title"
    />
  );
}

const MAIN_TABS: Record<"projects" | "settings" | "welcome", { label: MessageKey; icon: React.ReactNode }> = {
  projects: { label: "workbench.view.projects", icon: <IconLayoutList className={ICON} stroke={1.7} /> },
  settings: { label: "workbench.view.settings", icon: <IconSettings className={ICON} stroke={1.7} /> },
  welcome: { label: "welcome.tab", icon: <IconHome className={ICON} stroke={1.7} /> },
};

/** A row of tabs, 35 px as in VS Code; `selected` is the key of the tab on screen. */
function TabStrip({
  tabs,
  conversation,
  selected,
  label,
  pinnedWelcome = false,
}: {
  tabs: EditorTab[];
  conversation: boolean;
  selected: string;
  label: string;
  /** Without a project the Benvenuto is the window's first tab and does not close (issue #354). */
  pinnedWelcome?: boolean;
}) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label={label}
      className="app-sidebar-surface flex h-[35px] shrink-0 items-stretch overflow-x-auto border-b border-[color:var(--app-panel-border)] [scrollbar-width:none]"
      data-testid="editor-tabs"
    >
      {conversation ? (
        <TabButton
          tabKey={CONVERSATION_TAB}
          icon={<IconMessageCircle className={ICON} stroke={1.7} />}
          label={t("workbench.editor.conversation")}
          selected={selected === CONVERSATION_TAB}
          closable={false}
        />
      ) : null}
      {tabs.map((tab) =>
        tab.kind === "detail" ? (
          <DetailTabButton key={tabKey(tab)} tab={tab} selected={selected === tabKey(tab)} />
        ) : (
          <TabButton
            key={tab.kind}
            tabKey={tab.kind}
            icon={MAIN_TABS[tab.kind].icon}
            label={t(MAIN_TABS[tab.kind].label)}
            selected={selected === tab.kind}
            closable={!(pinnedWelcome && tab.kind === "welcome")}
          />
        ),
      )}
    </div>
  );
}

/** The detail of a record in its editor tab: the same panel of today, with the room of the editor. */
function DetailPane({ target }: { target: InspectorTarget }) {
  const t = useT();
  // While something waits, the window's one filled button is Aspetta te's (issue #338): here primaries are outlines.
  const waiting = useWaiting().length > 0;
  return (
    <div
      className="@container/inspector min-h-0 flex-1 overflow-y-auto"
      aria-label={targetTitle(target.kind, t)}
      data-testid="editor-detail"
      data-kind={target.kind}
      role="tabpanel"
    >
      <div className="mx-auto w-full max-w-[52rem] pb-6">
        <FilledScope allowed={!waiting}>
          <InspectorBody target={target} />
        </FilledScope>
      </div>
    </div>
  );
}

const mainKey = (view: MainView, hasProject: boolean) =>
  view === "overview" ? "projects" : view === "settings" ? "settings" : view === "welcome" || !hasProject ? "welcome" : CONVERSATION_TAB;

/**
 * The editor area (issue #336, ADR 0018): the conversation is always the first tab and never closes; Progetti,
 * Impostazioni and every detail open in a tab next to it, and reopening the same thing brings back its tab. The tabs
 * show only when there is more than the conversation. In a window from about 1500 px wide the details sit beside the
 * conversation, with a sash between them; in a narrower one a tab covers the conversation, and the row above the
 * composer and the status bar stay in view.
 */
export function EditorArea() {
  const t = useT();
  const tabs = useUi((s) => s.editorTabs);
  const mainView = useUi((s) => s.mainView);
  const activeDetail = useUi((s) => s.activeDetail);
  const focus = useUi((s) => s.editorFocus);
  const hasProject = useUi((s) => Boolean(s.app?.project));
  const split = useSplitEditor();
  const detailWidth = useResizableWidth("trama.detailPaneWidth", { initial: detailPaneDefaultWidth, min: DETAIL_PANE_MIN_WIDTH, max: detailPaneMaxWidth });
  const detail = tabs.find((tab): tab is Extract<EditorTab, { kind: "detail" }> => tab.kind === "detail" && tabKey(tab) === activeDetail) ?? null;
  const main = mainKey(mainView, hasProject);
  // Without a project there is no conversation: the Benvenuto is the first tab, and the only one until another opens.
  const withoutProject: EditorTab[] = [{ kind: "welcome" }, ...tabs.filter((tab) => tab.kind !== "welcome")];
  const stripTabs = hasProject ? tabs : withoutProject;
  const showStrip = hasProject ? tabs.length > 0 : withoutProject.length > 1;
  const showDetail = Boolean(detail) && (split || focus === "detail");
  const label = t("workbench.editor.tabs");

  if (split && detail) {
    const mainTabs = tabs.filter((tab) => tab.kind !== "detail");
    const detailTabs = tabs.filter((tab) => tab.kind === "detail");
    return (
      <div className="flex min-h-0 min-w-0 flex-1" data-testid="editor-area" data-split="true" data-active-detail={activeDetail ?? undefined}>
        <main className="chat-content-card @container/main relative z-[15] flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="editor-main">
          <TabStrip tabs={mainTabs} conversation selected={main} label={label} />
          <ChatView />
        </main>
        <section
          className={cn(
            "chat-content-card relative z-[16] flex h-full shrink-0 flex-col border-l border-[color:var(--app-panel-border)]",
            !detailWidth.resizing && "transition-[width] duration-200 ease-out",
          )}
          style={{ width: detailWidth.width }}
          aria-label={t("workbench.editor.details")}
          data-testid="editor-side"
        >
          <Sash
            side="left"
            label={t("workbench.editor.resize")}
            size={detailWidth.width}
            min={detailWidth.bounds.min}
            max={detailWidth.bounds.max}
            onResize={detailWidth.setWidth}
            onReset={detailWidth.reset}
            onDragChange={detailWidth.setResizing}
          />
          <TabStrip tabs={detailTabs} conversation={false} selected={activeDetail ?? ""} label={t("workbench.editor.details")} />
          <DetailPane key={activeDetail} target={detail.target} />
        </section>
      </div>
    );
  }

  return (
    <main
      className="chat-content-card @container/main relative z-[15] flex min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="editor-area"
      data-split="false"
      data-active-detail={activeDetail ?? undefined}
      data-covered={showDetail ? "true" : "false"}
    >
      {showStrip ? (
        <TabStrip
          tabs={stripTabs}
          conversation={hasProject}
          pinnedWelcome={!hasProject}
          selected={showDetail && detail ? tabKey(detail) : main}
          label={label}
        />
      ) : null}
      {showDetail && detail ? (
        // Over the conversation the row of Aspetta te stays in view; over Progetti or Impostazioni the detail is alone.
        mainView === "dialog" && hasProject ? (
          <ChatView cover={<DetailPane key={activeDetail} target={detail.target} />} />
        ) : (
          <DetailPane key={activeDetail} target={detail.target} />
        )
      ) : (
        <ChatView />
      )}
    </main>
  );
}
