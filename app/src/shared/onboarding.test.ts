import { describe, expect, it } from "vitest";
import { emptyDocument } from "../main/core/document";
import type { ProviderId } from "./codex";
import type { ActiveProjectState, AppState, Candidate, ProjectDocument, SpecialistAssignment } from "./domain";
import {
  EMPTY_ONBOARDING,
  exerciseSteps,
  guideSteps,
  isComplete,
  normalizeOnboarding,
  parseGhAuthStatus,
  resumeStep,
  shouldOpenGuideOnLaunch,
  UNKNOWN_GITHUB_CLI,
} from "./onboarding";
import { PROVIDERS } from "./providers";

function appState(overrides: Partial<AppState> = {}): AppState {
  const providers = Object.fromEntries(PROVIDERS.map((p) => [p.id, { account: { kind: "signedOut" }, models: [], checking: false }])) as unknown as AppState["providers"];
  return {
    monitor: { enabled: false, openAtLogin: false, intervalSeconds: 300, repositories: [], status: {} },
    recentProjects: [],
    project: null,
    loadingProject: null,
    codex: providers.codex,
    providers,
    settings: { theme: "system", sidebarWidth: 256 },
    error: null,
    backgroundProjects: [],
    practices: [],
    platform: "linux",
    onboarding: { ...EMPTY_ONBOARDING, skippedSteps: [], completedExercises: {} },
    gitHubCli: { ...UNKNOWN_GITHUB_CLI },
    ...overrides,
  };
}

const withAccount = (app: AppState, id: ProviderId, account: AppState["providers"][ProviderId]["account"]) => {
  app.providers[id] = { account, models: [], checking: false };
  return app;
};

const project = (document: ProjectDocument, overrides: Partial<ActiveProjectState> = {}) =>
  ({ id: document.projectId, name: "Negozio", rootPath: "/tmp/negozio", isDemo: true, document, aiHeroPrepared: false, ...overrides }) as ActiveProjectState;

const statusOf = (steps: { id: string; status: string }[]) => Object.fromEntries(steps.map((s) => [s.id, s.status]));

function assignment(id: string, overrides: Partial<SpecialistAssignment> = {}): SpecialistAssignment {
  return {
    id,
    specialistId: "S-1",
    requestId: null,
    kind: "agreedTicket",
    objective: "Documenta l'annullamento",
    issueNumber: null,
    exercise: null,
    moduleIds: ["Sources/Orders"],
    dependencies: [],
    model: "m",
    tools: ["edits"],
    requiredChecks: ["swift_test"],
    instructions: "",
    mandateVersion: 1,
    createdAt: "2026-09-23T10:00:00.000Z",
    status: "running",
    workspace: null,
    threadId: null,
    turns: [],
    stops: [],
    result: null,
    failure: null,
    updatedAt: "2026-09-23T10:00:00.000Z",
    lastUpdate: "",
    reportedStatus: null,
    ...overrides,
  };
}

function withAssignments(document: ProjectDocument, assignments: SpecialistAssignment[]): ProjectDocument {
  document.team.specialists = [
    {
      id: "S-1",
      name: "Ada",
      competence: "Swift",
      reason: "",
      moduleIds: [],
      role: "developer",
      origin: "teamProposal",
      color: "blue",
      tag: "Swift",
      createdAt: "",
      status: "working",
      model: null,
      tools: [],
      updatedAt: "",
      lastUpdate: "",
      assignments,
      removal: null,
    },
  ];
  return document;
}

function candidate(id: string, assignmentId: string, declaredAt: string, result: "pass" | "fail"): Candidate {
  return {
    id,
    assignmentId,
    specialistId: "S-1",
    snapshotId: id,
    baseSHA: "b",
    diff: "",
    changedFiles: ["Sources/Orders/Order.swift"],
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["swift_test"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt,
    updatedAt: declaredAt,
    evidence: { swift_test: { check: "swift_test", result, command: "swift test", output: "", snapshotId: id, decisionVersions: {}, recordedAt: declaredAt } },
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  };
}

const workspace = { sourceRoot: "/tmp/negozio", worktreeRoot: "/tmp/wt", branch: "trama/ada", baseSHA: "b" };

describe("first-run guide", () => {
  it("opens by itself only on a clean first launch", () => {
    expect(shouldOpenGuideOnLaunch(appState())).toBe(true);
    expect(shouldOpenGuideOnLaunch(appState({ onboarding: { ...EMPTY_ONBOARDING, firstRunShownAt: "t" } }))).toBe(false);
    expect(shouldOpenGuideOnLaunch(appState({ onboarding: { ...EMPTY_ONBOARDING, dismissedAt: "t" } }))).toBe(false);
    expect(shouldOpenGuideOnLaunch(appState({ recentProjects: [{ id: "1", name: "A", path: "/a", isDemo: false, lastOpenedAt: "" }] }))).toBe(false);
  });

  it("marks the provider step done only with a usable account of any provider", () => {
    const app = appState();
    expect(statusOf(guideSteps(app)).provider).toBe("pending");
    withAccount(app, "codex", { kind: "unsupported", type: "apiKey" });
    expect(guideSteps(app)[0]!.detail).toContain("apiKey");
    expect(statusOf(guideSteps(app)).provider).toBe("pending");
    withAccount(app, "claudeAgent", { kind: "authenticated", label: "ada@example.com" });
    const step = guideSteps(app)[0]!;
    expect(step.status).toBe("done");
    expect(step.detail).toContain("Claude");
  });

  it("reports providers still being checked", () => {
    const app = appState();
    for (const id of Object.keys(app.providers) as ProviderId[]) app.providers[id] = { account: null, models: [], checking: true };
    expect(statusOf(guideSteps(app)).provider).toBe("checking");
  });

  it("keeps a skipped step visible as skipped, never as done", () => {
    const app = appState({ onboarding: { ...EMPTY_ONBOARDING, skippedSteps: ["github", "provider"] } });
    const steps = statusOf(guideSteps(app));
    expect(steps.github).toBe("skipped");
    expect(steps.provider).toBe("skipped");
    expect(resumeStep(guideSteps(app))).toBe("project");
    app.gitHubCli = { status: "ready", account: "ada", detail: null, checkedAt: "t" };
    expect(statusOf(guideSteps(app)).github).toBe("done");
  });

  it("counts only a real project and AI Hero found in it", () => {
    const app = appState({ project: project(emptyDocument("demo")) });
    expect(statusOf(guideSteps(app)).project).toBe("pending");
    expect(statusOf(guideSteps(app)).aiHero).toBe("blocked");
    app.project = project(emptyDocument("real"), { isDemo: false, name: "Mio" });
    expect(statusOf(guideSteps(app)).project).toBe("done");
    expect(statusOf(guideSteps(app)).aiHero).toBe("pending");
    app.project.aiHeroPrepared = true;
    expect(statusOf(guideSteps(app)).aiHero).toBe("done");
  });

  it("marks the exercise step done only from a recorded completion", () => {
    const app = appState({ project: project(emptyDocument("demo")) });
    expect(statusOf(guideSteps(app)).exercise).toBe("pending");
    app.onboarding.completedExercises.first = "t";
    expect(statusOf(guideSteps(app)).exercise).toBe("done");
  });

  it("drops unknown values from persisted progress", () => {
    const value = normalizeOnboarding({ skippedSteps: ["github", "nope" as never], completedExercises: { first: "t", other: "x" } as never });
    expect(value.skippedSteps).toEqual(["github"]);
    expect(value.completedExercises).toEqual({ first: "t" });
  });
});

describe("gh auth status", () => {
  it("reads the logged-in account and the failures", () => {
    expect(parseGhAuthStatus({ exitCode: 0, stdout: "github.com\n  ✓ Logged in to github.com account ada (keyring)\n", stderr: "" }).account).toBe("ada");
    expect(parseGhAuthStatus({ exitCode: 0, stdout: "", stderr: "✓ Logged in to github.com as ada (oauth_token)" }).status).toBe("ready");
    expect(parseGhAuthStatus({ exitCode: 1, stdout: "", stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" }).status).toBe("signedOut");
    const invalid = parseGhAuthStatus({ exitCode: 1, stdout: "", stderr: "X Failed to log in to github.com account ada (keyring)\n- The token in keyring is invalid." });
    expect(invalid.status).toBe("signedOut");
    expect(parseGhAuthStatus({ exitCode: 2, stdout: "", stderr: "boom" }).status).toBe("error");
  });
});

describe("first exercise", () => {
  it("advances only on the study, observed navigation, a referenced reply and an answered decision", () => {
    const document = emptyDocument("demo");
    const steps = () => statusOf(exerciseSteps("first", document, { providerReady: true }));
    expect(Object.values(steps()).every((s) => s === "pending")).toBe(true);

    document.events.push({ id: "e1", sequence: 1, origin: "coordinator", requestId: null, createdAt: "", content: { type: "card", kind: "study", title: "Studio", detail: "Stack Swift", referenceId: null } });
    document.exercises = { startedAt: {}, observed: { studyRead: "t", mapOpened: "t" } };
    document.requests.push({ id: "R1", text: "Spiegami", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: "", failure: null });
    document.events.push({ id: "e2", sequence: 2, origin: "coordinator", requestId: "R1", createdAt: "", content: { type: "coordinatorText", text: "Senza fonti", model: null, references: [] } });
    expect(steps()).toMatchObject({ study: "done", read: "done", ask: "pending", map: "done", module: "pending", decision: "pending" });

    document.events.push({ id: "e3", sequence: 3, origin: "coordinator", requestId: "R1", createdAt: "", content: { type: "coordinatorText", text: "Vedi", model: null, references: ["Sources/Orders/CancelPaidOrder.swift"] } });
    document.exercises.observed.moduleOpened = "t";
    document.decisionRequests.push({
      id: "Q1",
      requestId: null,
      category: "product",
      question: "?",
      concreteCase: "",
      alternatives: [],
      revisesDecisionId: null,
      askedAt: "",
      outcome: null,
    });
    expect(isComplete(exerciseSteps("first", document, { providerReady: true }))).toBe(false);
    document.decisionRequests[0]!.outcome = { answer: "a", alternativeIndex: 0, decisionId: "D-1", version: 1, answeredAt: "" };
    expect(isComplete(exerciseSteps("first", document, { providerReady: true }))).toBe(true);
  });

  it("declares the limit without a provider instead of pretending", () => {
    const steps = exerciseSteps("first", emptyDocument("demo"), { providerReady: false });
    expect(statusOf(steps)).toMatchObject({ study: "blocked", read: "pending", ask: "blocked", map: "pending", decision: "blocked" });
  });
});

describe("change exercise", () => {
  it("needs a worktree exercise, a recorded failure, a later passing candidate and an approved review", () => {
    const document = emptyDocument("demo");
    const steps = () => statusOf(exerciseSteps("change", document, { providerReady: true }));
    document.mandate = {
      version: 1,
      objectives: ["o"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
      grantedAt: "",
      status: "granted",
      revocation: null,
      history: [],
    };
    withAssignments(document, [assignment("A-1", { workspace })]);
    expect(steps()).toMatchObject({ mandate: "done", assignment: "pending" });

    withAssignments(document, [assignment("A-1", { workspace, exercise: "Esercizio di modifica" })]);
    document.candidates.push(candidate("C-1", "A-1", "2026-09-23T10:01:00.000Z", "pass"));
    expect(steps()).toMatchObject({ assignment: "done", failing: "pending", passing: "pending" });

    document.candidates.push(candidate("C-2", "A-1", "2026-09-23T10:02:00.000Z", "fail"));
    expect(steps()).toMatchObject({ failing: "done", passing: "pending" });

    document.candidates.push(candidate("C-3", "A-1", "2026-09-23T10:03:00.000Z", "pass"));
    expect(steps()).toMatchObject({ passing: "done", review: "pending" });
    document.candidates[2]!.technicalReview = { id: "T", reviewerThreadId: "r", authorThreadId: null, verdict: "approved", summary: "", at: "" };
    expect(isComplete(exerciseSteps("change", document, { providerReady: true }))).toBe(true);
  });
});

describe("revision exercise", () => {
  it("sees dependent work stop and independent work continue", () => {
    const document = emptyDocument("demo");
    const steps = () => statusOf(exerciseSteps("revision", document, { providerReady: true }));
    withAssignments(document, [
      assignment("A-1", { decisionVersions: { "D-1": 1 } }),
      assignment("A-2", { moduleIds: ["Sources/Catalog"] }),
    ]);
    expect(steps()).toMatchObject({ dependent: "done", independent: "done", asked: "pending", stopped: "pending" });

    document.decisionRequests.push({
      id: "Q1",
      requestId: null,
      category: "product",
      question: "Rivediamo?",
      concreteCase: "",
      alternatives: [],
      revisesDecisionId: "D-1",
      askedAt: "2026-09-23T11:00:00.000Z",
      outcome: null,
    });
    expect(steps()).toMatchObject({ asked: "done", stopped: "pending", kept: "pending" });

    const [dependent] = document.team.specialists[0]!.assignments;
    dependent!.status = "stopRequested";
    dependent!.stops.push({ requestedBy: "Trama", reason: "La decisione D-1 è cambiata o è in revisione.", requestedAt: "", thenRemove: false, confirmedAt: null });
    expect(steps()).toMatchObject({ stopped: "done", answered: "pending" });

    document.decisionRequests[0]!.outcome = { answer: "a", alternativeIndex: null, decisionId: "D-1", version: 2, answeredAt: "" };
    expect(isComplete(exerciseSteps("revision", document, { providerReady: true }))).toBe(true);

    // If the revision had also stopped the independent work, the exercise would not be complete.
    document.team.specialists[0]!.assignments[1]!.stops.push({ requestedBy: "Trama", reason: "La decisione D-1 è cambiata.", requestedAt: "", thenRemove: false, confirmedAt: null });
    expect(steps().kept).toBe("pending");
  });
});

describe("conflict exercise", () => {
  it("completes only with exercise assessments and the conflict card", () => {
    const document = emptyDocument("demo");
    const steps = () => statusOf(exerciseSteps("conflict", document, { providerReady: true }));
    document.candidates.push(candidate("C-1", "A-1", "t", "pass"));
    const assessment = (id: string, classification: "clean" | "conflict", reference: string) => ({
      id,
      candidateId: "C-1",
      snapshotId: "C-1",
      remoteSHA: "0".repeat(40),
      references: [reference],
      classification,
      conflictingFiles: classification === "conflict" ? ["Sources/Orders/Order.swift"] : [],
      detail: "",
      checkedAt: "",
    });
    document.conflicts = [assessment("x", "conflict", "#12 feature")];
    expect(steps()).toMatchObject({ candidate: "done", compatible: "pending", incompatible: "pending" });
    document.conflicts.push(assessment("c", "clean", "Esercizio · modifica compatibile simulata"), assessment("i", "conflict", "Esercizio · modifica incompatibile simulata"));
    expect(steps()).toMatchObject({ compatible: "done", incompatible: "pending" });
    document.events.push({ id: "e", sequence: 1, origin: "trama", requestId: null, createdAt: "", content: { type: "card", kind: "conflict", title: "", detail: null, referenceId: "i" } });
    expect(isComplete(exerciseSteps("conflict", document, { providerReady: true }))).toBe(true);
  });
});
