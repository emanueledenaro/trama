// The first-run guide (C12) and the exercises on the example project (C13, C14).
// Every step state is derived from AppState or from the project document: nothing is marked done
// by a timer, by the renderer or by a model's claim.
import { type MessageKey, type Translate, translator } from "./i18n";
import { readableFailure } from "./providerFailure";
import { isUsableAccount, type ProviderId } from "./codex";
import type { AppState, Candidate, ConflictAssessment, ProjectDocument, ProjectOverview, SpecialistAssignment } from "./domain";

export type GuideStepId = "provider" | "github" | "project" | "aiHero" | "exercise";
export type ExerciseId = "first" | "change" | "revision" | "conflict";
/** Navigation the person performs in the window; the main process records it for the example project only. */
export type ObservedStep = "studyRead" | "mapOpened" | "moduleOpened";
export type StepStatus = "done" | "pending" | "checking" | "skipped" | "blocked";

export interface StepState {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
  optional: boolean;
}

/** The guide's progress, persisted in the app settings. */
export interface OnboardingState {
  /** When the guide opened by itself on the first launch; it never opens by itself again. */
  firstRunShownAt: string | null;
  /** The person chose to skip the whole guide. It stays available from Impostazioni and Aiuto. */
  dismissedAt: string | null;
  skippedSteps: GuideStepId[];
  /** Exercises whose steps were all observed on the example project. */
  completedExercises: Partial<Record<ExerciseId, string>>;
  /** Set when Trama found or prepared AI Hero in a project. */
  aiHeroPreparedAt: string | null;
  /**
   * The person's answer to "prepare the AI Hero method in the projects I open?" (B02). Before any project is
   * open this answer is the whole step; the copy happens when a project opens, as `autoPrepareMethod` says.
   */
  methodChoice: { prepare: boolean; at: string } | null;
  /** When the person reached the end of the welcome or closed it (B02). It never opens by itself again. */
  welcomeClosedAt: string | null;
}

export const EMPTY_ONBOARDING: OnboardingState = {
  firstRunShownAt: null,
  dismissedAt: null,
  skippedSteps: [],
  completedExercises: {},
  aiHeroPreparedAt: null,
  methodChoice: null,
  welcomeClosedAt: null,
};

export const GUIDE_STEP_IDS: GuideStepId[] = ["provider", "github", "project", "aiHero", "exercise"];
export const EXERCISE_IDS: ExerciseId[] = ["first", "change", "revision", "conflict"];
const OBSERVED_STEPS: ObservedStep[] = ["studyRead", "mapOpened", "moduleOpened"];

export function normalizeOnboarding(raw: Partial<OnboardingState> | null | undefined): OnboardingState {
  const value = raw ?? {};
  const completed: Partial<Record<ExerciseId, string>> = {};
  for (const id of EXERCISE_IDS) {
    const at = value.completedExercises?.[id];
    if (typeof at === "string") completed[id] = at;
  }
  return {
    firstRunShownAt: typeof value.firstRunShownAt === "string" ? value.firstRunShownAt : null,
    dismissedAt: typeof value.dismissedAt === "string" ? value.dismissedAt : null,
    skippedSteps: Array.isArray(value.skippedSteps) ? value.skippedSteps.filter((s): s is GuideStepId => GUIDE_STEP_IDS.includes(s)) : [],
    completedExercises: completed,
    aiHeroPreparedAt: typeof value.aiHeroPreparedAt === "string" ? value.aiHeroPreparedAt : null,
    methodChoice:
      value.methodChoice && typeof value.methodChoice.prepare === "boolean" && typeof value.methodChoice.at === "string"
        ? { prepare: value.methodChoice.prepare, at: value.methodChoice.at }
        : null,
    welcomeClosedAt: typeof value.welcomeClosedAt === "string" ? value.welcomeClosedAt : null,
  };
}

export const isObservedStep = (value: unknown): value is ObservedStep => OBSERVED_STEPS.includes(value as ObservedStep);
export const isExerciseId = (value: unknown): value is ExerciseId => EXERCISE_IDS.includes(value as ExerciseId);

/** What the exercises record in the example project's document. */
export interface ExerciseRecord {
  startedAt: Partial<Record<ExerciseId, string>>;
  observed: Partial<Record<ObservedStep, string>>;
}

/** GitHub CLI as `gh auth status` reports it. A login is not a capability on a repository. */
export interface GitHubCliState {
  status: "unknown" | "checking" | "missing" | "signedOut" | "ready" | "error";
  account: string | null;
  detail: string | null;
  checkedAt: string | null;
}

export const UNKNOWN_GITHUB_CLI: GitHubCliState = { status: "unknown", account: null, detail: null, checkedAt: null };

/** Reads the output of `gh auth status`. */
export function parseGhAuthStatus(result: { exitCode: number; stdout: string; stderr: string }, now = new Date()): GitHubCliState {
  const text = `${result.stdout}\n${result.stderr}`;
  const account = text.match(/Logged in to \S+ (?:account|as) ([A-Za-z0-9-]+)/)?.[1] ?? null;
  const checkedAt = now.toISOString();
  if (result.exitCode === 0 && account) return { status: "ready", account, detail: null, checkedAt };
  if (/not logged in|Failed to log in|token .* is invalid|gh auth login/i.test(text)) {
    const reason = text
      .split("\n")
      .map((line) => line.replace(/^[\s✓X✗!-]+/, "").trim())
      .find((line) => /invalid|not logged|Failed/i.test(line));
    return { status: "signedOut", account, detail: reason ?? null, checkedAt };
  }
  if (result.exitCode === 0) return { status: "ready", account, detail: null, checkedAt };
  return { status: "error", account, detail: text.trim().split("\n").at(-1)?.trim() || null, checkedAt };
}

// MARK: First-run guide

const providerNames: Partial<Record<ProviderId, string>> = { codex: "ChatGPT", claudeAgent: "Claude" };

function providerStep(app: AppState): StepState {
  const entries = Object.entries(app.providers) as [ProviderId, AppState["providers"][ProviderId]][];
  const usable = entries.filter(([, state]) => isUsableAccount(state?.account));
  const t = translator(app.language);
  const base = { id: "provider", title: t("guide.provider.title"), optional: false };
  if (usable.length) {
    const names = usable.map(([id, state]) => {
      const account = state.account;
      const who = account?.kind === "chatgpt" ? account.email : account?.kind === "authenticated" ? account.label : null;
      return `${providerNames[id] ?? id}${who ? ` (${who})` : ""}`;
    });
    return { ...base, status: "done", detail: t("guide.provider.done", { names: names.join(", ") }) };
  }
  if (entries.some(([, state]) => state?.checking) || entries.every(([, state]) => !state?.account)) {
    return { ...base, status: "checking", detail: t("guide.provider.checking") };
  }
  const codex = app.providers.codex?.account;
  const detail =
    codex?.kind === "unsupported"
      ? t("guide.provider.unsupported", { type: codex.type })
      : codex?.kind === "unavailable" || codex?.kind === "blocked"
        ? t("guide.provider.failure", { reason: readableFailure(t, codex.message) })
        : t("guide.provider.none");
  return { ...base, status: "pending", detail };
}

function gitHubStep(app: AppState): StepState {
  const t = translator(app.language);
  const base = { id: "github", title: t("guide.github.title"), optional: true };
  const cli = app.gitHubCli;
  switch (cli.status) {
    case "ready":
      return { ...base, status: "done", detail: t("guide.github.ready", { account: cli.account ?? "" }) };
    case "checking":
      return { ...base, status: "checking", detail: t("guide.github.checking") };
    case "missing":
      return { ...base, status: "pending", detail: t("guide.github.missing") };
    case "signedOut":
      return { ...base, status: "pending", detail: cli.detail ? t("guide.github.signedOutDetail", { detail: cli.detail }) : t("guide.github.signedOut") };
    case "error":
      return { ...base, status: "pending", detail: cli.detail ? t("guide.github.errorDetail", { detail: cli.detail }) : t("guide.github.error") };
    default:
      return { ...base, status: "pending", detail: t("guide.github.unknown") };
  }
}

function projectStep(app: AppState): StepState {
  const t = translator(app.language);
  const base = { id: "project", title: t("guide.project.title"), optional: false };
  const active = app.project && !app.project.isDemo ? app.project : null;
  if (active) return { ...base, status: "done", detail: t("guide.project.active", { name: active.name }) };
  const recent = app.recentProjects.find((p) => !p.isDemo);
  if (recent) return { ...base, status: "done", detail: t("guide.project.recent", { name: recent.name }) };
  return { ...base, status: "pending", detail: t("guide.project.pending") };
}

function aiHeroStep(app: AppState): StepState {
  const t = translator(app.language);
  const base = { id: "aiHero", title: t("guide.aiHero.title"), optional: true };
  const project = app.project && !app.project.isDemo ? app.project : null;
  if (project?.aiHeroPrepared) return { ...base, status: "done", detail: t("guide.aiHero.present", { name: project.name }) };
  if (!project && app.onboarding.aiHeroPreparedAt) return { ...base, status: "done", detail: t("guide.aiHero.preparedElsewhere") };
  const choice = app.onboarding.methodChoice;
  if (!project && choice) {
    // The answer is the step while no project is open; what happens when one opens follows the current setting.
    const prepare = shouldAutoPrepareMethod(app.settings, app.onboarding);
    return {
      ...base,
      status: "done",
      detail: prepare
        ? t("guide.aiHero.willPrepare")
        : t("guide.aiHero.declined"),
    };
  }
  if (!project) return { ...base, status: "pending", detail: t("guide.aiHero.choose") };
  return { ...base, status: "pending", detail: t("guide.aiHero.copy", { name: project.name }) };
}

function exerciseStep(app: AppState): StepState {
  const t = translator(app.language);
  const base = { id: "exercise", title: t("guide.exercise.title"), optional: false };
  const done = app.onboarding.completedExercises.first;
  if (done) return { ...base, status: "done", detail: t("guide.exercise.done") };
  const project = app.project?.isDemo ? app.project : null;
  if (project) {
    const steps = exerciseSteps(t, "first", project.document, { providerReady: hasUsableProvider(app) });
    const count = steps.filter((s) => s.status === "done").length;
    return { ...base, status: "pending", detail: t("guide.exercise.progress", { done: count, total: steps.length }) };
  }
  return { ...base, status: "pending", detail: t("guide.exercise.pending") };
}

export function hasUsableProvider(app: AppState): boolean {
  return Object.values(app.providers).some((state) => isUsableAccount(state?.account));
}

/** The guide's steps with their real state; a skipped step that is not done stays visibly skipped. */
export function guideSteps(app: AppState): StepState[] {
  const steps = [providerStep(app), gitHubStep(app), projectStep(app), aiHeroStep(app), exerciseStep(app)];
  return steps.map((step) =>
    step.status !== "done" && app.onboarding.skippedSteps.includes(step.id as GuideStepId) ? { ...step, status: "skipped" as const } : step,
  );
}

/** Where the guide resumes: the first step neither done nor skipped. */
export function resumeStep(steps: StepState[]): string | null {
  return steps.find((s) => s.status !== "done" && s.status !== "skipped")?.id ?? null;
}

/**
 * Whether opening a project copies the AI Hero method by itself: the setting says so, and the person did not
 * postpone the step. "Rimanda" leaves the method unprepared until the person chooses (B02).
 */
export function shouldAutoPrepareMethod(settings: AppState["settings"], onboarding: OnboardingState): boolean {
  return settings.autoPrepareMethod !== false && !onboarding.skippedSteps.includes("aiHero");
}

// MARK: Benvenuto (B02, issue #354)

/**
 * The first launch: the state is read (settings, onboarding and recent projects) and Trama never showed the
 * Benvenuto. Before `started` the state is the empty one the window gets while Trama starts, so it says nothing
 * about the person: deciding on it showed the Benvenuto again with every step done (issue #354).
 */
export function isFirstLaunch(app: AppState): boolean {
  return (
    app.started &&
    !app.onboarding.firstRunShownAt &&
    !app.onboarding.welcomeClosedAt &&
    !app.onboarding.dismissedAt &&
    app.recentProjects.length === 0 &&
    !app.project
  );
}

/** The rows of the Configura block, in order: the language first, then the steps that make Trama ready. */
export type WelcomeStepId = "language" | "provider" | "github" | "aiHero";
export const WELCOME_STEP_IDS: WelcomeStepId[] = ["language", "provider", "github", "aiHero"];

/** The language is always chosen: the system's until the person picks one. */
function languageStep(app: AppState): StepState {
  const t = translator(app.language);
  return { id: "language", title: t("welcome.step.language"), status: "done", detail: t("welcome.step.languageDetail"), optional: true };
}

/** The Configura block's steps with the guide's real state: the same states, not a second guide. */
export function welcomeSteps(app: AppState): StepState[] {
  const steps = guideSteps(app);
  return [languageStep(app), ...WELCOME_STEP_IDS.slice(1).map((id) => steps.find((s) => s.id === id)!)];
}

/** Every step of Configura is done: the Benvenuto says "Tutto pronto" and never opens by itself. */
export const isAllSet = (app: AppState): boolean => welcomeSteps(app).every((s) => s.status === "done");

/** The step the Benvenuto points at when it opens: the first one neither done nor skipped, else none. */
export function welcomeFocusStep(app: AppState): WelcomeStepId | null {
  return resumeStep(welcomeSteps(app)) as WelcomeStepId | null;
}

/**
 * Whether the Benvenuto opens by itself next to an open project (issue #354): only when no provider is connected,
 * and only once the state is read and the providers checked. "wait" until then; the optional steps never open it.
 */
export function welcomeLaunchDecision(app: AppState): "wait" | "open" | "stay" {
  if (!app.started || !app.project) return "wait";
  const provider = providerStep(app).status;
  if (provider === "checking") return "wait";
  return provider === "done" || hasWaitingProvider(app) ? "stay" : "open";
}

/**
 * A provider at its usage limit is connected: it waits for its quota, and the status line says so. It is not a
 * missing provider, so it never opens the Benvenuto or takes the composer's send away.
 */
const hasWaitingProvider = (app: AppState): boolean => Object.values(app.providers).some((state) => state?.account?.kind === "blocked");

/** Whether the composer offers "Collega un provider" instead of sending: the providers are checked and none is connected. */
export const needsProvider = (app: AppState): boolean => providerStep(app).status === "pending" && !hasWaitingProvider(app);

/** One exercise in the Impara block: done, started on the example project, or still to do. */
export interface LearnRow {
  id: ExerciseId;
  status: "done" | "started" | "todo";
}

export function learnRows(app: AppState): LearnRow[] {
  const started = app.project?.isDemo ? (app.project.document.exercises?.startedAt ?? {}) : {};
  return EXERCISE_IDS.map((id) => ({ id, status: app.onboarding.completedExercises[id] ? "done" : started[id] ? "started" : "todo" }));
}

// MARK: Exercises

export interface ExerciseDescriptor {
  id: ExerciseId;
  title: string;
  /** What the exercise asks and authorizes, shown before it starts. */
  intro: string;
  /** The message the person can send to the Coordinator to begin; null when a Trama action starts it. */
  prompt: string | null;
}

/**
 * The messages that begin an exercise. i18n-exempt: written for the Coordinator, with the names of its tools; the
 * Coordinator answers in the person's language.
 */
const EXERCISE_PROMPTS: Record<ExerciseId, string | null> = {
  first:
    "Esercizio: spiegami come funziona l'annullamento di un ordine pagato in questo progetto, citando i file che hai letto. Non avviare squadre e non modificare nulla.",
  change:
    "Esercizio di modifica sulla copia di esempio. Chiedimi prima il mandato necessario, poi assegna a uno specialista, nel suo worktree e con il campo exercise impostato a \"Esercizio di modifica\", una piccola modifica al modulo Orders con una verifica richiesta. Dichiara un candidato che fa fallire la verifica, poi correggilo, dichiara il nuovo candidato, verificalo e fai la revisione tecnica. Non pubblicare nulla.",
  revision:
    "Esercizio di decisione sulla copia di esempio. Assegna due incarichi marcati come esercizio: uno nel modulo Orders che dipende da una decisione del Patto (indicala in decisionIDs) e una ricerca indipendente nel modulo Catalog senza decisioni. Poi chiedimi di rivedere quella decisione con request_decision, con alternative concrete.",
  conflict: null,
};

export const exerciseDescriptor = (t: Translate, id: ExerciseId): ExerciseDescriptor => ({
  id,
  title: t(`shared.exercise.${id}`),
  intro: t(`shared.exercise.${id}.intro`),
  prompt: EXERCISE_PROMPTS[id],
});

/**
 * Remote revisions created by the conflict exercise carry this label in their references. i18n-exempt: a marker Trama
 * reads back from its records.
 */
export const EXERCISE_REFERENCE_PREFIX = "Esercizio";
export const isExerciseAssessment = (assessment: ConflictAssessment): boolean =>
  assessment.references.some((r) => r.startsWith(EXERCISE_REFERENCE_PREFIX));

const step = (id: string, title: string, done: boolean, detail: string, optional = false): StepState => ({
  id,
  title,
  status: done ? "done" : "pending",
  detail,
  optional,
});

/** A step whose title and pending detail come from the catalog, with its own detail once done. */
const exerciseTaskStep = (t: Translate, id: string, done: boolean, detail: string | null) =>
  step(id, t(`shared.exercise.${id}` as MessageKey), done, done && detail !== null ? detail : t(`shared.exercise.${id}.pending` as MessageKey));

const allAssignments = (document: ProjectDocument): SpecialistAssignment[] => document.team.specialists.flatMap((s) => s.assignments);

function firstExerciseSteps(t: Translate, document: ProjectDocument, providerReady: boolean): StepState[] {
  const observed = document.exercises?.observed ?? {};
  const studied = document.events.some((e) => e.content.type === "card" && e.content.kind === "study" && !!e.content.detail);
  const completed = new Set(document.requests.filter((r) => r.state === "completed").map((r) => r.id));
  const explained = document.events.some(
    (e) => e.origin === "coordinator" && e.content.type === "coordinatorText" && e.requestId !== null && completed.has(e.requestId) && e.content.references.length > 0,
  );
  const answered = document.decisionRequests.some((r) => r.outcome);
  const noProvider = t("shared.exercise.noProvider");
  const steps = [
    exerciseTaskStep(t, "study", studied, t("shared.exercise.study.done")),
    exerciseTaskStep(t, "read", !!observed.studyRead, t("shared.exercise.read.done")),
    exerciseTaskStep(t, "ask", explained, t("shared.exercise.ask.done")),
    exerciseTaskStep(t, "map", !!observed.mapOpened, t("shared.exercise.map.done")),
    exerciseTaskStep(t, "module", !!observed.moduleOpened, t("shared.exercise.module.done")),
    exerciseTaskStep(t, "decision", answered, t("shared.exercise.decision.done")),
  ];
  if (!providerReady) {
    for (const s of steps) if (s.status === "pending" && ["study", "ask", "decision"].includes(s.id)) Object.assign(s, { status: "blocked", detail: noProvider });
  }
  return steps;
}

const candidatesOf = (document: ProjectDocument, assignmentId: string): Candidate[] =>
  document.candidates.filter((c) => c.assignmentId === assignmentId).sort((a, b) => a.declaredAt.localeCompare(b.declaredAt));

const passesAll = (candidate: Candidate) =>
  candidate.requiredChecks.length > 0 && candidate.requiredChecks.every((check) => candidate.evidence[check]?.result === "pass");

function changeExerciseSteps(t: Translate, document: ProjectDocument): StepState[] {
  const mandate = document.mandate?.status === "granted" && document.mandate.authorizedActions.includes("executeInWorktree");
  const exercises = allAssignments(document).filter((a) => a.exercise && a.workspace);
  // Prefer the exercise assignment that went furthest.
  const assignment = [...exercises].sort((a, b) => candidatesOf(document, b.id).length - candidatesOf(document, a.id).length)[0] ?? null;
  const candidates = assignment ? candidatesOf(document, assignment.id) : [];
  const failedIndex = candidates.findIndex((c) => Object.values(c.evidence).some((e) => e.result === "fail"));
  const fixed = failedIndex >= 0 ? candidates.slice(failedIndex + 1).filter(passesAll).at(-1) ?? null : null;
  const reviewed = fixed?.technicalReview?.verdict === "approved";
  return [
    exerciseTaskStep(t, "mandate", mandate, mandate ? t("shared.exercise.mandate.done", { version: String(document.mandate!.version) }) : null),
    exerciseTaskStep(t, "assignment", !!assignment, assignment ? `${assignment.id}: ${assignment.objective} (${assignment.workspace!.branch}).` : null),
    exerciseTaskStep(t, "failing", failedIndex >= 0, failedIndex >= 0 ? t("shared.exercise.failing.done", { id: candidates[failedIndex]!.id }) : null),
    exerciseTaskStep(t, "passing", !!fixed, fixed ? t("shared.exercise.passing.done", { id: fixed.id, checks: fixed.requiredChecks.join(", ") }) : null),
    exerciseTaskStep(t, "review", reviewed, t("shared.exercise.review.done")),
  ];
}

function revisionExerciseSteps(t: Translate, document: ProjectDocument): StepState[] {
  const assignments = allAssignments(document);
  const dependsOn = (a: SpecialistAssignment, id: string) => a.decisionVersions?.[id] !== undefined;
  const dependent = assignments.filter((a) => Object.keys(a.decisionVersions ?? {}).length > 0);
  const revisions = document.decisionRequests.filter((r) => r.revisesDecisionId && dependent.some((a) => dependsOn(a, r.revisesDecisionId!)));
  const revision = revisions.find((r) => r.outcome) ?? revisions[0] ?? null;
  const decisionId = revision?.revisesDecisionId ?? Object.keys(dependent[0]?.decisionVersions ?? {})[0] ?? null;
  const stoppedBy = (a: SpecialistAssignment) => !!decisionId && a.stops.some((s) => s.reason.includes(decisionId));
  const target = decisionId ? dependent.filter((a) => dependsOn(a, decisionId)) : [];
  const independent = decisionId ? assignments.filter((a) => !dependsOn(a, decisionId)) : [];
  const stopped = target.find(stoppedBy) ?? null;
  const kept = revision ? independent.filter((a) => a.createdAt <= revision.askedAt && !stoppedBy(a)) : [];
  const decision = decisionId ?? "";
  return [
    exerciseTaskStep(
      t,
      "dependent",
      target.length > 0,
      target[0] ? t("shared.exercise.dependent.done", { id: target[0].id, decision, version: String(target[0].decisionVersions![decisionId!]) }) : null,
    ),
    exerciseTaskStep(t, "independent", independent.length > 0, independent[0] ? t("shared.exercise.independent.done", { id: independent[0].id, decision }) : null),
    exerciseTaskStep(t, "asked", !!revision, revision ? t("shared.exercise.asked.done", { question: revision.question }) : null),
    exerciseTaskStep(t, "stopped", !!stopped, stopped ? t("shared.exercise.stopped.done", { id: stopped.id }) : null),
    exerciseTaskStep(
      t,
      "answered",
      !!revision?.outcome,
      revision?.outcome ? t("shared.exercise.answered.done", { decision, version: String(revision.outcome.version) }) : null,
    ),
    exerciseTaskStep(t, "kept", !!revision?.outcome && kept.length > 0, kept[0] && revision?.outcome ? t("shared.exercise.kept.done", { id: kept[0].id }) : null),
  ];
}

function conflictExerciseSteps(t: Translate, document: ProjectDocument): StepState[] {
  const candidates = document.candidates.filter((c) => !c.pullRequest);
  const assessments = (document.conflicts ?? []).filter(isExerciseAssessment);
  const compatible = assessments.find((a) => a.classification === "clean") ?? null;
  const incompatible = assessments.find((a) => a.classification === "conflict") ?? null;
  const card = !!incompatible && document.events.some((e) => e.content.type === "card" && e.content.kind === "conflict" && e.content.referenceId === incompatible.id);
  return [
    exerciseTaskStep(t, "candidate", candidates.length > 0, candidates.length ? t("shared.exercise.candidate.done", { id: candidates.at(-1)!.id }) : null),
    exerciseTaskStep(t, "compatible", !!compatible, compatible ? compatible.detail : null),
    exerciseTaskStep(t, "incompatible", !!incompatible && card, incompatible ? t("shared.exercise.incompatible.done", { files: incompatible.conflictingFiles.join(", ") }) : null),
  ];
}

export function exerciseSteps(t: Translate, id: ExerciseId, document: ProjectDocument, context: { providerReady: boolean }): StepState[] {
  switch (id) {
    case "first":
      return firstExerciseSteps(t, document, context.providerReady);
    case "change":
      return changeExerciseSteps(t, document);
    case "revision":
      return revisionExerciseSteps(t, document);
    case "conflict":
      return conflictExerciseSteps(t, document);
  }
}

export const isComplete = (steps: StepState[]): boolean => steps.every((s) => s.optional || s.status === "done");

// MARK: Project picker (B02)

/**
 * Reads what the person typed to clone a project: `owner/name`, or a github.com URL (https, ssh or git@).
 * Returns `owner/name`, or null when it is not a GitHub repository.
 */
export function parseRepositoryInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match =
    trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/#?].*)?$/i) ??
    trimmed.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+)$/i) ??
    trimmed.match(/^([^/\s:]+)\/([^/\s:]+)$/);
  if (!match) return null;
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

/**
 * What a recent project's row says about it in the Benvenuto, from the overview's records only: the work and the
 * colleagues. Nothing is inferred when a record is missing.
 */
export function recentProjectStatus(t: Translate, entry: ProjectOverview | null): { work: string[]; colleagues: string | null } {
  if (!entry) return { work: [], colleagues: null };
  if (entry.source === "unreadable") return { work: [t("shared.recent.unreadable")], colleagues: null };
  if (entry.source === "notSaved") return { work: [t("shared.recent.notSaved")], colleagues: null };
  const work: string[] = [];
  if (entry.runningWork) work.push(t("shared.recent.running", { count: entry.runningWork }));
  if (entry.pendingDecisions) work.push(t("shared.recent.decisions", { count: entry.pendingDecisions }));
  if (entry.blockedWork) work.push(t("shared.recent.blocked", { count: entry.blockedWork }));
  if (entry.toApprove) work.push(t("main.overview.toApprove", { count: entry.toApprove }));
  if (!work.length) work.push(t("shared.recent.nothing"));
  const colleagues =
    entry.colleagues === null ? null : entry.colleagues === 0 ? t("shared.recent.noColleagues") : t("shared.recent.colleagues", { count: entry.colleagues });
  return { work, colleagues };
}
