// The first-run guide (C12) and the exercises on the example project (C13, C14).
// Every step state is derived from AppState or from the project document: nothing is marked done
// by a timer, by the renderer or by a model's claim.
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
  const base = { id: "provider", title: "Collega un provider", optional: false };
  if (usable.length) {
    const names = usable.map(([id, state]) => {
      const account = state.account;
      const who = account?.kind === "chatgpt" ? account.email : account?.kind === "authenticated" ? account.label : null;
      return `${providerNames[id] ?? id}${who ? ` (${who})` : ""}`;
    });
    return { ...base, status: "done", detail: `Account utilizzabile: ${names.join(", ")}.` };
  }
  if (entries.some(([, state]) => state?.checking) || entries.every(([, state]) => !state?.account)) {
    return { ...base, status: "checking", detail: "Trama sta verificando gli account dei provider." };
  }
  const codex = app.providers.codex?.account;
  const detail =
    codex?.kind === "unsupported"
      ? `Codex usa un account di tipo ${codex.type}: Trama accetta solo un account ChatGPT.`
      : codex?.kind === "unavailable" || codex?.kind === "blocked"
        ? `Codex: ${codex.message}`
        : "Nessun provider ha un account utilizzabile. Accedi con ChatGPT o a un altro provider, poi verifica.";
  return { ...base, status: "pending", detail };
}

function gitHubStep(app: AppState): StepState {
  const base = { id: "github", title: "Collega GitHub CLI", optional: true };
  const cli = app.gitHubCli;
  switch (cli.status) {
    case "ready":
      return { ...base, status: "done", detail: `gh è autenticato come ${cli.account}. I permessi su ogni repository si verificano quando lo apri.` };
    case "checking":
      return { ...base, status: "checking", detail: "Trama sta leggendo gh auth status." };
    case "missing":
      return { ...base, status: "pending", detail: "GitHub CLI (gh) non è installato. Il progetto di esempio e i progetti locali funzionano anche senza." };
    case "signedOut":
      return { ...base, status: "pending", detail: `gh non ha un accesso valido${cli.detail ? `: ${cli.detail}` : ""}. Esegui gh auth login nel terminale.` };
    case "error":
      return { ...base, status: "pending", detail: `gh auth status non è riuscito${cli.detail ? `: ${cli.detail}` : ""}.` };
    default:
      return { ...base, status: "pending", detail: "Stato di gh non ancora verificato." };
  }
}

function projectStep(app: AppState): StepState {
  const base = { id: "project", title: "Apri o crea un progetto", optional: false };
  const active = app.project && !app.project.isDemo ? app.project : null;
  if (active) return { ...base, status: "done", detail: `Progetto attivo: ${active.name}.` };
  const recent = app.recentProjects.find((p) => !p.isDemo);
  if (recent) return { ...base, status: "done", detail: `Hai già aperto ${recent.name}.` };
  return { ...base, status: "pending", detail: "Scegli la cartella di un tuo progetto o creane una nuova. Il progetto di esempio serve per gli esercizi." };
}

function aiHeroStep(app: AppState): StepState {
  const base = { id: "aiHero", title: "Prepara il metodo AI Hero", optional: true };
  const project = app.project && !app.project.isDemo ? app.project : null;
  if (project?.aiHeroPrepared) return { ...base, status: "done", detail: `Le skill AI Hero sono presenti in ${project.name}.` };
  if (!project && app.onboarding.aiHeroPreparedAt) return { ...base, status: "done", detail: "Metodo preparato in un tuo progetto." };
  const choice = app.onboarding.methodChoice;
  if (!project && choice) {
    // The answer is the step while no project is open; what happens when one opens follows the current setting.
    const prepare = shouldAutoPrepareMethod(app.settings, app.onboarding);
    return {
      ...base,
      status: "done",
      detail: prepare
        ? "Trama copia le skill nel primo tuo progetto che apri, senza toccare i file che esistono già."
        : "Hai scelto di non preparare il metodo. Puoi prepararlo da Impostazioni, Metodo di lavoro.",
    };
  }
  if (!project) return { ...base, status: "pending", detail: "Scegli se Trama deve copiare le skill di AI Hero nei tuoi progetti quando li apri. I file esistenti restano invariati." };
  return { ...base, status: "pending", detail: `Copia le skill in ${project.name}. I file esistenti restano invariati.` };
}

function exerciseStep(app: AppState): StepState {
  const base = { id: "exercise", title: "Fai il primo esercizio", optional: false };
  const done = app.onboarding.completedExercises.first;
  if (done) return { ...base, status: "done", detail: "Hai completato il primo esercizio sul progetto di esempio." };
  const project = app.project?.isDemo ? app.project : null;
  if (project) {
    const steps = exerciseSteps("first", project.document, { providerReady: hasUsableProvider(app) });
    const count = steps.filter((s) => s.status === "done").length;
    return { ...base, status: "pending", detail: `${count} passi su ${steps.length} osservati nella copia di esempio.` };
  }
  return { ...base, status: "pending", detail: "Una copia locale del Negozio di esempio: niente viene pubblicato." };
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

/** The welcome (B02) shows by itself once, on a clean first launch; afterwards the guide reopens it. */
export function shouldShowWelcomeOnLaunch(app: AppState): boolean {
  return (
    !app.onboarding.firstRunShownAt &&
    !app.onboarding.welcomeClosedAt &&
    !app.onboarding.dismissedAt &&
    app.recentProjects.length === 0 &&
    !app.project
  );
}

// MARK: Welcome (B02)

/** The configuration the welcome walks through, in order: the same steps as the guide, not a second guide. */
export const SETUP_STEP_IDS: GuideStepId[] = ["provider", "github", "aiHero"];

/** The welcome's configuration steps with the guide's real state. */
export function setupSteps(app: AppState): StepState[] {
  const steps = guideSteps(app);
  return SETUP_STEP_IDS.map((id) => steps.find((s) => s.id === id)!);
}

/**
 * Where the welcome's configuration resumes: the first step neither done nor skipped, then the first one
 * skipped (resuming is taking it back), else the first step.
 */
export function resumeSetupStep(app: AppState): GuideStepId {
  const steps = setupSteps(app);
  const id = resumeStep(steps) ?? steps.find((s) => s.status === "skipped")?.id ?? SETUP_STEP_IDS[0]!;
  return id as GuideStepId;
}

/** The step after `id` in the welcome, or null at the end, where the project picker follows. */
export function nextSetupStep(id: GuideStepId): GuideStepId | null {
  const index = SETUP_STEP_IDS.indexOf(id);
  return index >= 0 ? (SETUP_STEP_IDS[index + 1] ?? null) : null;
}

/** What fills the window once the state is read: the welcome, the project picker, or the open project. */
export function launchScreen(app: AppState): "welcome" | "picker" | "project" {
  if (app.project) return "project";
  return shouldShowWelcomeOnLaunch(app) ? "welcome" : "picker";
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

export const EXERCISES: ExerciseDescriptor[] = [
  {
    id: "first",
    title: "Conosci il progetto",
    intro:
      "Il Coordinatore studia la copia locale del Negozio di esempio. Leggi lo studio, chiedi una spiegazione con i file citati, apri la mappa e un modulo, poi rispondi a una decisione. Niente viene modificato o pubblicato.",
    prompt:
      "Esercizio: spiegami come funziona l'annullamento di un ordine pagato in questo progetto, citando i file che hai letto. Non avviare squadre e non modificare nulla.",
  },
  {
    id: "change",
    title: "Una modifica verificata",
    intro:
      "Concedi un mandato che autorizza il lavoro in un worktree sul modulo Orders della copia di esempio. Il Coordinatore assegna a uno specialista una modifica marcata come esercizio: prima una verifica fallisce, poi la correzione produce un nuovo candidato con verifiche superate e una revisione tecnica. Niente viene pubblicato.",
    prompt:
      "Esercizio di modifica sulla copia di esempio. Chiedimi prima il mandato necessario, poi assegna a uno specialista, nel suo worktree e con il campo exercise impostato a \"Esercizio di modifica\", una piccola modifica al modulo Orders con una verifica richiesta. Dichiara un candidato che fa fallire la verifica, poi correggilo, dichiara il nuovo candidato, verificalo e fai la revisione tecnica. Non pubblicare nulla.",
  },
  {
    id: "revision",
    title: "Rivedere una decisione",
    intro:
      "Un incarico dipende da una decisione del Patto, un altro no. Quando il Coordinatore ti chiede di rivedere quella decisione, Trama ferma solo il lavoro che dipende da lei; il lavoro indipendente continua.",
    prompt:
      "Esercizio di decisione sulla copia di esempio. Assegna due incarichi marcati come esercizio: uno nel modulo Orders che dipende da una decisione del Patto (indicala in decisionIDs) e una ricerca indipendente nel modulo Catalog senza decisioni. Poi chiedimi di rivedere quella decisione con request_decision, con alternative concrete.",
  },
  {
    id: "conflict",
    title: "Un confronto controllato",
    intro:
      "Trama crea due modifiche simulate in una copia locale separata, marcate come esercizio: nessun collaboratore reale e nessuna rete. La prima non tocca i file del candidato, la seconda cambia gli stessi file. Le confronta con il candidato tramite una fusione temporanea.",
    prompt: null,
  },
];

export const exerciseDescriptor = (id: ExerciseId): ExerciseDescriptor => EXERCISES.find((e) => e.id === id)!;

/** Remote revisions created by the conflict exercise carry this label in their references. */
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

const allAssignments = (document: ProjectDocument): SpecialistAssignment[] => document.team.specialists.flatMap((s) => s.assignments);

function firstExerciseSteps(document: ProjectDocument, providerReady: boolean): StepState[] {
  const observed = document.exercises?.observed ?? {};
  const studied = document.events.some((e) => e.content.type === "card" && e.content.kind === "study" && !!e.content.detail);
  const completed = new Set(document.requests.filter((r) => r.state === "completed").map((r) => r.id));
  const explained = document.events.some(
    (e) => e.origin === "coordinator" && e.content.type === "coordinatorText" && e.requestId !== null && completed.has(e.requestId) && e.content.references.length > 0,
  );
  const answered = document.decisionRequests.some((r) => r.outcome);
  const noProvider = "Serve un provider collegato. Senza accesso puoi esplorare mappa e moduli; la spiegazione AI non è disponibile.";
  const steps = [
    step("study", "Il Coordinatore studia il progetto", studied, studied ? "La scheda di studio è nella conversazione." : "Lo studio parte quando il Coordinatore si collega alla copia di esempio."),
    step("read", "Leggi la scheda di studio", !!observed.studyRead, observed.studyRead ? "Hai aperto la scheda di studio." : "Apri la scheda di studio dalla guida."),
    step("ask", "Chiedi una spiegazione", explained, explained ? "Il Coordinatore ha risposto citando i file letti." : "Chiedi al Coordinatore di spiegarti una parte del progetto."),
    step("map", "Apri la mappa", !!observed.mapOpened, observed.mapOpened ? "Hai aperto la mappa dei moduli." : "Apri la mappa dall'intestazione."),
    step("module", "Apri un modulo", !!observed.moduleOpened, observed.moduleOpened ? "Hai aperto un modulo dalla mappa." : "Scegli un modulo nella mappa, per esempio Orders."),
    step("decision", "Rispondi a una decisione", answered, answered ? "La tua risposta è nel Patto." : "Chiedi al Coordinatore una domanda di prodotto e rispondi dalla scheda."),
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

function changeExerciseSteps(document: ProjectDocument): StepState[] {
  const mandate = document.mandate?.status === "granted" && document.mandate.authorizedActions.includes("executeInWorktree");
  const exercises = allAssignments(document).filter((a) => a.exercise && a.workspace);
  // Prefer the exercise assignment that went furthest.
  const assignment = [...exercises].sort((a, b) => candidatesOf(document, b.id).length - candidatesOf(document, a.id).length)[0] ?? null;
  const candidates = assignment ? candidatesOf(document, assignment.id) : [];
  const failedIndex = candidates.findIndex((c) => Object.values(c.evidence).some((e) => e.result === "fail"));
  const fixed = failedIndex >= 0 ? candidates.slice(failedIndex + 1).filter(passesAll).at(-1) ?? null : null;
  const reviewed = fixed?.technicalReview?.verdict === "approved";
  return [
    step("mandate", "Concedi il mandato", mandate, mandate ? `Mandato v${document.mandate!.version} con lavoro nel worktree.` : "Il mandato deve autorizzare il lavoro in un worktree."),
    step(
      "assignment",
      "Incarico di esercizio in un worktree",
      !!assignment,
      assignment ? `${assignment.id}: ${assignment.objective} (${assignment.workspace!.branch}).` : "Un incarico con il campo esercizio e un worktree proprio.",
    ),
    step(
      "failing",
      "Una verifica fallisce",
      failedIndex >= 0,
      failedIndex >= 0 ? `Il candidato ${candidates[failedIndex]!.id} ha una verifica fallita registrata da Trama.` : "Trama registra una verifica fallita su un candidato dell'esercizio.",
    ),
    step(
      "passing",
      "La correzione supera le verifiche",
      !!fixed,
      fixed ? `Il nuovo candidato ${fixed.id} supera ${fixed.requiredChecks.join(", ")}.` : "Un candidato successivo supera tutte le verifiche richieste.",
    ),
    step("review", "Revisione tecnica", reviewed, reviewed ? "Un revisore distinto ha approvato il candidato corretto." : "La revisione tecnica approva il candidato corretto."),
  ];
}

function revisionExerciseSteps(document: ProjectDocument): StepState[] {
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
  return [
    step("dependent", "Un incarico dipende da una decisione", target.length > 0, target[0] ? `${target[0].id} usa ${decisionId} v${target[0].decisionVersions![decisionId!]}.` : "Il Coordinatore assegna un incarico con la decisione in decisionIDs."),
    step("independent", "Un incarico indipendente", independent.length > 0, independent[0] ? `${independent[0].id} non usa ${decisionId}.` : "Un secondo incarico che non dipende da quella decisione."),
    step("asked", "Il Coordinatore chiede una revisione", !!revision, revision ? `Domanda: ${revision.question}` : "Una domanda che rivede la decisione, con alternative e risposta libera."),
    step("stopped", "Il lavoro dipendente si ferma", !!stopped, stopped ? `Trama ha fermato ${stopped.id}.` : "Trama ferma gli incarichi che usano la decisione in revisione."),
    step("answered", "Rispondi alla revisione", !!revision?.outcome, revision?.outcome ? `${decisionId} è ora alla versione ${revision.outcome.version}.` : "La risposta crea una nuova versione della decisione."),
    step("kept", "Il lavoro indipendente continua", !!revision?.outcome && kept.length > 0, kept[0] && revision?.outcome ? `${kept[0].id} non è stato fermato dalla revisione.` : "L'incarico indipendente non viene fermato."),
  ];
}

function conflictExerciseSteps(document: ProjectDocument): StepState[] {
  const candidates = document.candidates.filter((c) => !c.pullRequest);
  const assessments = (document.conflicts ?? []).filter(isExerciseAssessment);
  const compatible = assessments.find((a) => a.classification === "clean") ?? null;
  const incompatible = assessments.find((a) => a.classification === "conflict") ?? null;
  const card = !!incompatible && document.events.some((e) => e.content.type === "card" && e.content.kind === "conflict" && e.content.referenceId === incompatible.id);
  return [
    step("candidate", "Un candidato locale", candidates.length > 0, candidates.length ? `Candidato ${candidates.at(-1)!.id} in un worktree.` : "Serve un candidato non pubblicato: completa prima l'esercizio di modifica."),
    step("compatible", "Una modifica compatibile", !!compatible, compatible ? compatible.detail : "Trama confronta il candidato con una modifica simulata su altri file."),
    step("incompatible", "Una modifica incompatibile", !!incompatible && card, incompatible ? `Conflitto su ${incompatible.conflictingFiles.join(", ")}.` : "Trama confronta il candidato con una modifica simulata sugli stessi file."),
  ];
}

export function exerciseSteps(id: ExerciseId, document: ProjectDocument, context: { providerReady: boolean }): StepState[] {
  switch (id) {
    case "first":
      return firstExerciseSteps(document, context.providerReady);
    case "change":
      return changeExerciseSteps(document);
    case "revision":
      return revisionExerciseSteps(document);
    case "conflict":
      return conflictExerciseSteps(document);
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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a recent project's row says about it in the picker, from the overview's records only: the work and the
 * colleagues. Nothing is inferred when a record is missing.
 */
export function recentProjectStatus(entry: ProjectOverview | null): { work: string[]; colleagues: string | null } {
  if (!entry) return { work: [], colleagues: null };
  if (entry.source === "unreadable") return { work: ["Stato non leggibile"], colleagues: null };
  if (entry.source === "notSaved") return { work: ["Ancora da studiare"], colleagues: null };
  const work: string[] = [];
  if (entry.runningWork) work.push(count(entry.runningWork, "agente al lavoro", "agenti al lavoro"));
  if (entry.pendingDecisions) work.push(count(entry.pendingDecisions, "decisione in attesa", "decisioni in attesa"));
  if (entry.blockedWork) work.push(count(entry.blockedWork, "lavoro fermo", "lavori fermi"));
  if (entry.toApprove) work.push(count(entry.toApprove, "risultato da approvare", "risultati da approvare"));
  if (!work.length) work.push("Niente in attesa");
  const colleagues =
    entry.colleagues === null ? null : entry.colleagues === 0 ? "Nessun collega attivo" : count(entry.colleagues, "collega attivo", "colleghi attivi");
  return { work, colleagues };
}
