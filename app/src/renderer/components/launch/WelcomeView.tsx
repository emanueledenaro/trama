import {
  IconBrandGithub,
  IconChevronDown,
  IconCircleCheck,
  IconFolder,
  IconFolderOpen,
  IconLayoutList,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRotateClockwise,
  IconSchool,
  IconTarget,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderId } from "@shared/codex";
import type { ProjectOverview, RecentProject } from "@shared/domain";
import { formatAgo, type MessageKey } from "@shared/i18n";
import { type ExerciseId, isAllSet, learnRows, type LearnRow, recentProjectStatus, type StepState, type WelcomeStepId, welcomeSteps } from "@shared/onboarding";
import { PROVIDERS } from "@shared/providers";
import { LaunchIntro } from "@/components/launch/LaunchIntro";
import { useSeam } from "@/components/Seam";
import { StepActions } from "@/components/onboarding/StepActions";
import { StepIcon, stepStatusLabel } from "@/components/onboarding/StepRow";
import { ProviderIcon } from "@/components/ProviderIcon";
import { LanguageChoice } from "@/components/settings/LanguageChoice";
import { providerStatus } from "@/components/settings/SettingsView";
import { Spinner } from "@/components/Spinner";
import { useWaiting } from "@/components/WaitingView";
import { Button, FilledScope } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

/** Codex and Claude come first; the other providers wait behind their toggle. */
const MAIN_PROVIDERS: ProviderId[] = ["codex", "claudeAgent"];
/** The Recenti block lists the last five; "Tutti i progetti" opens the rest. */
const RECENT_COUNT = 5;

const EXERCISE_COPY: Record<ExerciseId, { title: MessageKey; lead: MessageKey }> = {
  first: { title: "welcome.learn.first", lead: "welcome.learn.firstLead" },
  change: { title: "welcome.learn.change", lead: "welcome.learn.changeLead" },
  revision: { title: "welcome.learn.revision", lead: "welcome.learn.revisionLead" },
  conflict: { title: "welcome.learn.conflict", lead: "welcome.learn.conflictLead" },
};

/** A block of the Benvenuto: a small heading and its rows, like the columns of the Welcome page of VS Code. */
function Block({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`welcome-${id}`} data-testid={`welcome-${id}`} className="min-w-0">
      <div className="flex min-h-8 items-center gap-2 pb-2">
        <h2 id={`welcome-${id}`} className="min-w-0 flex-1 text-ui font-medium text-foreground">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A way to start, written as a link: the Benvenuto keeps one filled button, the step Trama needs. */
function StartLink({ icon, label, hint, onClick, disabled }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="group/start flex min-h-8 w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-[var(--color-text-accent)]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-ui text-[var(--color-text-accent)] group-hover/start:underline">{label}</span>
          {hint ? <span className="block text-ui-xs text-muted-foreground">{hint}</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * Inizia answers one question: how do I get to a project. The three other ways are rows; opening a folder is the action,
 * on the right and last. It is the Benvenuto's one filled button while no project is open; with one open the window's
 * filled button belongs to the work, so it is an outline.
 */
function StartBlock({ onClone }: { onClone: () => void }) {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const setDialog = useUi((s) => s.setDialog);
  const setInspector = useUi((s) => s.setInspector);
  const loading = Boolean(app.loadingProject);
  const project = app.project && !app.project.isDemo ? app.project : null;
  return (
    <Block id="start" title={t("welcome.start.title")}>
      {app.loadingProject ? (
        <p className="flex items-center gap-2 px-2 pb-2 text-ui-sm text-muted-foreground" role="status">
          <Spinner /> {t("welcome.start.opening", { name: app.loadingProject })}
        </p>
      ) : null}
      <ul className="space-y-0.5" data-testid="welcome-start-actions">
        <StartLink icon={<IconPlus className="size-4" stroke={1.7} />} label={t("welcome.start.create")} disabled={loading} onClick={() => setDialog("createProject")} />
        <StartLink icon={<IconBrandGithub className="size-4" stroke={1.7} />} label={t("welcome.start.clone")} disabled={loading} onClick={onClone} />
        <StartLink
          icon={<IconSchool className="size-4" stroke={1.7} />}
          label={t("welcome.start.example")}
          hint={t("welcome.start.exampleHint")}
          disabled={loading}
          onClick={() => void act("project:openDemo", undefined).then(() => useUi.getState().closeWelcome())}
        />
        {project ? (
          <StartLink
            icon={<IconTarget className="size-4" stroke={1.7} />}
            label={t("welcome.start.firstGoal")}
            hint={t("welcome.start.firstGoalHint", { name: project.name })}
            onClick={() => setInspector({ kind: "goals", create: true })}
          />
        ) : null}
      </ul>
      <div className="cta-row mt-4" data-testid="welcome-start-open">
        <p className="mr-auto min-w-0 text-ui-xs text-muted-foreground">{t("welcome.start.openHint")}</p>
        <Button variant={app.project ? "outline" : "default"} disabled={loading} onClick={() => void act("project:openDialog", undefined)}>
          <IconFolderOpen className="size-4" stroke={1.7} />
          {t("welcome.start.open")}
        </Button>
      </div>
    </Block>
  );
}

/** The state of a project's line while the summaries are read: a bar where the work and colleagues will be. */
function RecentSkeleton() {
  return <span className="mt-2 block h-3 w-32 animate-pulse rounded-sm bg-[var(--color-background-button-secondary)]" aria-hidden data-testid="recent-loading" />;
}

function RecentRow({ recent, entry, loading }: { recent: RecentProject; entry: ProjectOverview | null; loading: boolean }) {
  const t = useT();
  const language = useLanguage();
  const status = recentProjectStatus(t, entry);
  const busy = (entry?.runningWork ?? 0) > 0;
  const name = recent.isDemo ? t("welcome.start.example") : recent.name;
  return (
    <li className="group/recent relative" data-testid="recent-project">
      <button
        type="button"
        onClick={() => void act("project:open", { path: recent.path })}
        className="flex min-h-8 w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
      >
        <IconFolder className="mt-0.5 size-4 shrink-0 text-muted-foreground" stroke={1.6} />
        <span className="min-w-0 flex-1">
          {/* The room on the right is the forget button's, so the time never sits under it. */}
          <span className="flex items-baseline gap-2 pr-8">
            <span className="min-w-0 truncate text-ui text-[var(--color-text-accent)]">{name}</span>
            <span className="ml-auto shrink-0 text-ui-xs text-muted-foreground/70">
              {entry?.updatedAt
                ? t("welcome.recent.lastWork", { ago: formatAgo(language, entry.updatedAt) })
                : t("welcome.recent.opened", { ago: formatAgo(language, recent.lastOpenedAt) })}
            </span>
          </span>
          {/* The path can be long: truncated, whole in the tooltip. */}
          <Tooltip label={recent.path} side="bottom">
            <span className="block truncate font-mono text-ui-xs text-muted-foreground/70">{recent.path}</span>
          </Tooltip>
          {entry ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1.5", busy && "text-[var(--color-text-accent)]")}>
                {busy ? <span className="size-1.5 rounded-full bg-[var(--color-text-accent)]" aria-hidden /> : null}
                {status.work.join(", ")}
              </span>
              {status.colleagues ? (
                <span className="inline-flex items-center gap-1">
                  <IconUsers className="size-3" stroke={1.8} aria-hidden />
                  {status.colleagues}
                </span>
              ) : null}
            </span>
          ) : loading ? (
            <RecentSkeleton />
          ) : null}
        </span>
      </button>
      <IconButton
        label={t("welcome.recent.forget", { name })}
        icon={<IconX />}
        size="icon"
        onClick={() => void act("project:forgetRecent", { id: recent.id })}
        className="absolute top-1 right-1 opacity-0 group-hover/recent:opacity-100 focus-visible:opacity-100"
      />
    </li>
  );
}

/**
 * Recenti answers one question: which project do I go back to. Four states: the rows (default), a bar under each
 * project while its summary is read (loading), a message with the way to a first project (empty) and a message with
 * a retry when the summaries cannot be read (error: the rows still open their project).
 */
function RecentBlock() {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const openView = useUi((s) => s.openView);
  const [entries, setEntries] = useState<Map<string, ProjectOverview>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const recents = app.recentProjects.slice(0, RECENT_COUNT);
  const hasRecents = recents.length > 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  // Re-read the summaries when the state changes, at most every half second, as the overview does: a parked
  // project's agents may finish while the Benvenuto is open.
  useEffect(() => {
    if (!hasRecents) return;
    let live = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        void act("overview:read", undefined).then((result) => {
          if (!live) return;
          if (result) {
            setEntries(new Map(result.map((entry) => [entry.id, entry])));
            setStatus("ready");
          } else setStatus("failed");
        }),
      loaded.current ? 500 : 0,
    );
    loaded.current = true;
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [app, hasRecents, attempt]);

  return (
    <Block
      id="recent"
      title={t("welcome.recent.title")}
      aside={
        hasRecents ? (
          <IconButton label={t("welcome.recent.all")} icon={<IconLayoutList />} size="icon" onClick={() => openView("projects")} />
        ) : null
      }
    >
      {hasRecents ? (
        <>
          {status === "failed" ? (
            <p className="flex items-center gap-2 px-2 pb-2 text-ui-sm text-destructive" role="alert" data-testid="recent-error">
              <span className="min-w-0 flex-1">{t("welcome.recent.error")}</span>
              <IconButton
                label={t("welcome.recent.retry")}
                icon={<IconRefresh />}
                size="icon"
                onClick={() => {
                  setStatus("loading");
                  setAttempt((n) => n + 1);
                }}
              />
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {recents.map((recent) => (
              <RecentRow key={recent.id} recent={recent} entry={entries.get(recent.id) ?? null} loading={status === "loading"} />
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-3 px-2" data-testid="recent-empty">
          <p className="text-ui-sm text-muted-foreground">{t("welcome.recent.none")}</p>
          <div className="cta-row">
            <Button variant="outline" onClick={() => void act("project:openDialog", undefined)}>
              <IconFolderOpen className="size-4" stroke={1.7} />
              {t("welcome.start.open")}
            </Button>
          </div>
        </div>
      )}
    </Block>
  );
}

function ProviderList() {
  const t = useT();
  const language = useLanguage();
  const providers = useUi((s) => s.app!.providers);
  const [others, setOthers] = useState(false);
  const [hint, setHint] = useState<Partial<Record<ProviderId, string>>>({});
  const shown = PROVIDERS.filter((p) => others || MAIN_PROVIDERS.includes(p.id as ProviderId));
  return (
    <div>
      <ul className="divide-y divide-[color:var(--app-surface-divider)] rounded-lg border border-[color:var(--color-border)]" aria-label={t("welcome.providers")}>
        {shown.map((provider) => {
          const id = provider.id as ProviderId;
          const state = providers[id];
          const status = providerStatus(t, language, state?.account ?? null, state?.checking ?? false);
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2" data-provider-row={id}>
              <ProviderIcon provider={id} className="size-4" />
              <span className="text-ui text-foreground">{provider.name}</span>
              {state?.checking ? <Spinner className="size-3" /> : null}
              {/* The provider's own words can be long: cut, whole in the tooltip. */}
              {status.detail ? (
                <Tooltip label={status.detail}>
                  <span className="min-w-[6rem] flex-1 truncate text-ui-xs text-muted-foreground">{status.detail}</span>
                </Tooltip>
              ) : (
                <span className="min-w-[6rem] flex-1" />
              )}
              <Badge tone={status.tone}>{status.label}</Badge>
              {state?.account?.kind === "signedOut" ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    id === "codex"
                      ? void act("codex:login", undefined)
                      : void act("provider:login", { provider: id }).then((result) =>
                          setHint((h) => ({
                            ...h,
                            [id]: result?.command ? t("welcome.signInHint", { command: result.command }) : t("welcome.signInCommand", { command: provider.signInCommand }),
                          })),
                        )
                  }
                >
                  {t("welcome.signIn")}
                </Button>
              ) : null}
              {hint[id] ? <span className="w-full pl-6.5 text-ui-xs text-foreground/80">{hint[id]}</span> : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-expanded={others}
        onClick={() => setOthers(!others)}
        className="-ml-2 mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-ui-sm text-muted-foreground hover:text-foreground"
      >
        {others ? t("welcome.onlyMainProviders") : t("welcome.otherProviders", { count: PROVIDERS.length - MAIN_PROVIDERS.length })}
        <IconChevronDown className={cn("size-3.5 transition-transform", others && "rotate-180")} stroke={1.8} />
      </button>
    </div>
  );
}

const STEP_LEAD: Partial<Record<WelcomeStepId, MessageKey>> = {
  provider: "welcome.provider.lead",
  github: "welcome.github.lead",
  aiHero: "welcome.aiHero.lead",
};

/** What unfolds under a step of Configura: how to take it, with its own actions on the right. */
function StepBody({ step }: { step: StepState }) {
  const t = useT();
  const cloneWaiting = useUi((s) => s.cloneAfterGitHub);
  const setCloneAfterGitHub = useUi((s) => s.setCloneAfterGitHub);
  const setDialog = useUi((s) => s.setDialog);
  const app = useUi((s) => s.app)!;
  return (
    <div className="space-y-2">
      {STEP_LEAD[step.id as WelcomeStepId] ? <p className="text-ui-sm text-muted-foreground">{t(STEP_LEAD[step.id as WelcomeStepId]!)}</p> : null}
      {step.id === "provider" ? <ProviderList /> : null}
      {step.id === "github" && cloneWaiting ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-[var(--color-background-button-secondary)] px-3 py-2" data-testid="welcome-clone-waiting">
          <p className="min-w-[12rem] flex-1 text-ui-xs text-muted-foreground">{t("welcome.github.cloneWaiting")}</p>
          <div className="cta-row ml-auto">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setCloneAfterGitHub(false);
                setDialog("cloneProject");
              }}
            >
              {t("welcome.github.clonePublic")}
            </Button>
          </div>
        </div>
      ) : null}
      {/* Without a project the filled button of the Benvenuto is Apri un progetto: a step's primary is an outline. */}
      <FilledScope allowed={Boolean(app.project)}>
        <div className="cta-row">
          <StepActions step={step} />
        </div>
      </FilledScope>
    </div>
  );
}

/** The one action on the right of a step: Collega while it is to do, Cambia once done, Apri for the method. */
function stepAction(t: ReturnType<typeof useT>, step: StepState): string {
  if (step.status === "done") return t("welcome.action.change");
  return step.id === "aiHero" ? t("welcome.action.open") : t("welcome.action.connect");
}

/**
 * One step of Configura. A step done asks for nothing: a check, what Trama saw and a small "Cambia". A step to do
 * says nothing about its state, its button says what to do; the state is written only when it is not that
 * (checking, skipped, blocked). The provider, the step Trama needs, is the one with a text button; the other steps
 * unfold with an icon.
 */
function StepLine({ step, open, primary, onToggle }: { step: StepState; open: boolean; primary: boolean; onToggle: () => void }) {
  const t = useT();
  const id = step.id as WelcomeStepId;
  const done = step.status === "done";
  const bodyId = `welcome-step-${id}`;
  const label = stepAction(t, step);
  const toggle = { "aria-expanded": open, "aria-controls": bodyId, onClick: onToggle };
  return (
    <li
      data-step={id}
      data-status={step.status}
      data-testid="welcome-step"
      className={cn("rounded-lg transition-colors", open && "bg-[var(--color-background-button-secondary)]")}
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StepIcon status={step.status} index={WELCOME_ORDER[id]} current={open} />
        </span>
        <div className="min-w-[10rem] flex-1">
          <p className="flex items-baseline gap-2 text-ui text-foreground">
            <span className="min-w-0 truncate">{step.title}</span>
            {/* Optional only where it still matters: never beside a step already done (issue #354). */}
            {step.optional && !done && id !== "language" ? <span className="shrink-0 text-ui-xs text-muted-foreground/70">{t("welcome.optional")}</span> : null}
          </p>
          <p className="mt-0.5 text-ui-xs text-muted-foreground" data-testid="welcome-step-detail">
            {step.detail}
          </p>
        </div>
        {id === "language" ? (
          <LanguageChoice />
        ) : (
          <>
            {step.status !== "done" && step.status !== "pending" ? (
              <span className="shrink-0 text-ui-xs text-muted-foreground" data-testid="welcome-step-status">
                {stepStatusLabel(t, step.status)}
              </span>
            ) : null}
            {id === "provider" && !done ? (
              <Button variant={primary ? "default" : "outline"} className="min-w-[4.5rem]" {...toggle}>
                {label}
              </Button>
            ) : (
              <IconButton label={label} icon={<IconChevronDown className={cn("transition-transform", open && "rotate-180")} />} size="icon" {...toggle} />
            )}
          </>
        )}
      </div>
      {open && id !== "language" ? (
        <div id={bodyId} className="px-2 pb-4 pl-9">
          <StepBody step={step} />
        </div>
      ) : null}
    </li>
  );
}

const WELCOME_ORDER: Record<WelcomeStepId, number> = { language: 0, provider: 1, github: 2, aiHero: 3 };

function SetupBlock({ steps, open, setOpen }: { steps: StepState[]; open: WelcomeStepId | null; setOpen: (id: WelcomeStepId | null) => void }) {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const done = steps.filter((s) => s.status === "done").length;
  const providerPending = steps.find((s) => s.id === "provider")?.status !== "done";
  return (
    <Block
      id="setup"
      title={t("welcome.setup.title")}
      // Once everything is set the header says so: the count would say it twice.
      aside={isAllSet(app) ? null : <span className="text-ui-xs text-muted-foreground">{t("welcome.setup.count", { done, total: steps.length })}</span>}
    >
      <ol className="space-y-0.5" aria-label={t("welcome.stepsLabel")}>
        {steps.map((step) => (
          <StepLine
            key={step.id}
            step={step}
            open={open === step.id}
            // With a project open the Benvenuto's filled button is the provider, the one step Trama needs, while nothing is unfolded.
            primary={step.id === "provider" && providerPending && open === null && Boolean(app.project)}
            onToggle={() => setOpen(open === step.id ? null : (step.id as WelcomeStepId))}
          />
        ))}
      </ol>
    </Block>
  );
}

/**
 * One exercise of Impara. Its number is a check once done and ringed while it runs; the state is not written again
 * beside its button. The button starts work, so it has an icon and its text, and it shows the wait while the example opens.
 */
function ExerciseLine({ row, index }: { row: LearnRow; index: number }) {
  const t = useT();
  const setExercise = useUi((s) => s.setExercise);
  const closeWelcome = useUi((s) => s.closeWelcome);
  const [starting, setStarting] = useState(false);
  const copy = EXERCISE_COPY[row.id];
  const label = row.status === "done" ? t("welcome.learn.redo") : row.status === "started" ? t("welcome.learn.resume") : t("welcome.learn.start");
  return (
    <li className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2" data-exercise={row.id} data-status={row.status} data-testid="welcome-exercise">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {row.status === "done" ? <IconCircleCheck className="size-4 text-success" stroke={1.8} aria-hidden /> : <StepIcon status="pending" index={index} current={row.status === "started"} />}
      </span>
      <div className="min-w-[10rem] flex-1">
        <p className="text-ui text-foreground">{t(copy.title)}</p>
        <p className="mt-0.5 text-ui-xs text-muted-foreground">{t(copy.lead)}</p>
      </div>
      <Button
        variant="outline"
        className="min-w-[6rem]"
        disabled={starting}
        aria-label={`${label}: ${t(copy.title)}`}
        // The exercise runs on the example project, in a panel beside its chat (C13, issue #354).
        onClick={() => {
          setStarting(true);
          void act("exercise:start", { exercise: row.id })
            .then(() => {
              setExercise(row.id);
              closeWelcome();
            })
            .finally(() => setStarting(false));
        }}
      >
        {starting ? <Spinner /> : row.status === "done" ? <IconRotateClockwise className="size-4" stroke={1.7} /> : <IconPlayerPlay className="size-4" stroke={1.7} />}
        {label}
      </Button>
    </li>
  );
}

function LearnBlock() {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const rows = learnRows(app);
  const done = rows.filter((row) => row.status === "done").length;
  const allDone = done === rows.length;
  const [shown, setShown] = useState(false);
  return (
    <Block
      id="learn"
      title={t("welcome.learn.title")}
      aside={
        allDone ? (
          <IconButton
            label={shown ? t("welcome.learn.hide") : t("welcome.learn.again")}
            icon={<IconChevronDown className={cn("transition-transform", shown && "rotate-180")} />}
            size="icon"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
          />
        ) : null
      }
    >
      {allDone && !shown ? (
        <p className="flex min-h-8 items-center gap-2 px-2 text-ui text-foreground/85" data-testid="welcome-learn-done">
          <IconCircleCheck className="size-4 text-success" stroke={1.8} aria-hidden />
          {t("welcome.learn.doneCount", { count: done })}
        </p>
      ) : (
        <>
          <p className="px-2 pb-2 text-ui-xs text-muted-foreground">{t("welcome.learn.lead")}</p>
          <ol className="space-y-0.5" aria-label={t("welcome.learn.title")}>
            {rows.map((row, index) => (
              <ExerciseLine key={row.id} row={row} index={index} />
            ))}
          </ol>
        </>
      )}
    </Block>
  );
}

/** Trama's mark at the head of the Benvenuto, stitched like the bots (W17), outside the mark's clear space. */
function WelcomeMark({ play }: { play: boolean }) {
  const seam = useSeam("logo", { radius: "18px" });
  return (
    <div className="relative flex size-[72px] shrink-0 items-center justify-center" data-testid="picker-mark">
      <LaunchIntro play={play} size={52} />
      {seam.stitch}
    </div>
  );
}

/**
 * The Benvenuto (B02, issue #354, ADR 0018): a page of the editor area, as the Welcome page of VS Code. Four blocks:
 * Inizia and Recenti on the left, Configura and Impara on the right; one column in a narrow window. Without a project
 * it is the only thing in the window; with one it opens beside the conversation and closes when the person wants.
 * Every step keeps its real state: nothing is marked done by the page.
 */
export function WelcomeView() {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const welcomeStep = useUi((s) => s.welcomeStep);
  const intro = useUi((s) => s.welcomeIntro);
  const setCloneAfterGitHub = useUi((s) => s.setCloneAfterGitHub);
  const setDialog = useUi((s) => s.setDialog);
  const steps = useMemo(() => welcomeSteps(app), [app]);
  const allSet = isAllSet(app);
  const [open, setOpen] = useState<WelcomeStepId | null>(welcomeStep);
  const root = useRef<HTMLDivElement>(null);

  // The step the Benvenuto was opened on unfolds and comes into view.
  useEffect(() => {
    if (!welcomeStep) return;
    setOpen(welcomeStep);
    requestAnimationFrame(() => root.current?.querySelector(`[data-step="${welcomeStep}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [welcomeStep]);

  // GitHub CLI is read once, so the row never says "not connected" when it is only not checked yet (P10).
  useEffect(() => {
    if (useUi.getState().app?.gitHubCli.status === "unknown") void act("onboarding:checkGitHub", undefined);
  }, []);

  const openStep = (id: WelcomeStepId) => {
    setOpen(id);
    requestAnimationFrame(() => root.current?.querySelector(`[data-step="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  // Cloning goes through GitHub CLI: without it the GitHub row unfolds, and the clone starts again once gh is ready.
  const clone = () => {
    if (app.gitHubCli.status === "ready") return setDialog("cloneProject");
    setCloneAfterGitHub(true);
    openStep("github");
  };

  // Beside the conversation the window's one filled button is Aspetta te's while something waits (issue #338).
  const waiting = useWaiting().length > 0;
  return (
    <FilledScope allowed={!waiting}>
      <div
        ref={root}
        className="chat-pane-enter @container/welcome relative min-h-0 flex-1 overflow-y-auto"
        data-testid="welcome"
        data-all-set={allSet ? "true" : "false"}
      >
        <div className="mx-auto w-full max-w-[60rem] px-4 pt-8 pb-12 sm:px-8 @min-[900px]/welcome:pt-12">
          <header className="flex items-center gap-4">
            <WelcomeMark play={intro} />
            <div className="min-w-0">
              <h1 className="font-display text-3xl leading-[1.1] font-normal tracking-[-0.015em] text-foreground @min-[900px]/welcome:text-4xl">
                {t("welcome.title")}
              </h1>
              <p className="mt-2 text-ui-lg text-muted-foreground">{t("welcome.tagline")}</p>
            </div>
          </header>
          {allSet ? (
            <p className="mt-6 flex items-center gap-2 text-ui text-foreground" data-testid="welcome-all-set">
              <IconCircleCheck className="size-4 text-success" stroke={1.8} aria-hidden />
              <span className="font-medium">{t("welcome.allSet.title")}</span>
              <span className="text-muted-foreground">{t("welcome.allSet.lead")}</span>
            </p>
          ) : null}
          <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 @min-[900px]/welcome:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="flex min-w-0 flex-col gap-8">
              <StartBlock onClone={clone} />
              <RecentBlock />
            </div>
            <div className="flex min-w-0 flex-col gap-8">
              <SetupBlock steps={steps} open={open} setOpen={setOpen} />
              <LearnBlock />
            </div>
          </div>
        </div>
      </div>
    </FilledScope>
  );
}
