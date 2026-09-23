import type { AccountStatus, CodexModel } from "./codex";
import type { RepositorySnapshot } from "./repository";

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  isDemo: boolean;
  lastOpenedAt: string;
}

export type EventOrigin = "person" | "coordinator" | "trama";

export type CardKind = "study" | "mandate" | "decision" | "contextNotice";

export type EventContent =
  | { type: "personMessage"; text: string; moduleId: string | null; moduleName: string | null; imageCount?: number }
  | { type: "coordinatorText"; text: string; model: string | null; references: string[] }
  | { type: "activity"; title: string; detail: string | null; tone: "info" | "tool" | "error" }
  | { type: "card"; kind: CardKind; title: string; detail: string | null; referenceId: string | null };

export interface ConversationEvent {
  id: string;
  sequence: number;
  origin: EventOrigin;
  requestId: string | null;
  createdAt: string;
  content: EventContent;
}

export type RequestState = "running" | "completed" | "interrupted" | "failed";

/** One message of the person and the Coordinator turn that answers it. */
export interface CoordinatorRequest {
  id: string;
  text: string;
  moduleId: string | null;
  state: RequestState;
  model: string | null;
  effort: string | null;
  createdAt: string;
  completedAt: string | null;
  failure: string | null;
  attachments?: string[];
}

export interface PactDecision {
  id: string;
  value: string;
  acceptedExample: string;
  rationale: string;
  version: number;
  decidedAt: string;
}

export interface MandateSnapshot {
  version: number;
  objectives: string[];
  priorities: string[];
  scopeModuleIds: string[];
  authorizedActions: MandateAction[];
  limits: string[];
  grantedAt: string;
}

export type MandateAction = "plan" | "executeInWorktree" | "openPullRequest" | "integrateCandidate" | "composeTeam";

export interface ProjectMandate extends MandateSnapshot {
  status: "granted" | "revoked";
  revocation: { reason: string; revokedAt: string } | null;
  history: MandateSnapshot[];
}

export interface MandateRequest {
  id: string;
  requestId: string | null;
  reason: string;
  objectives: string[];
  priorities: string[];
  scopeModuleIds: string[];
  authorizedActions: MandateAction[];
  limits: string[];
  askedAt: string;
  resolution: { kind: "granted" | "corrected" | "revoked"; version: number | null; resolvedAt: string } | null;
}

export interface DecisionAlternative {
  behavior: string;
  example: string;
  consequence: string | null;
}

export interface DecisionRequest {
  id: string;
  requestId: string | null;
  category: "product" | "destructive";
  question: string;
  concreteCase: string;
  alternatives: DecisionAlternative[];
  revisesDecisionId: string | null;
  askedAt: string;
  outcome: { answer: string; alternativeIndex: number | null; decisionId: string; version: number; answeredAt: string } | null;
}

export interface CoordinatorMemory {
  text: string;
  updatedAt: string | null;
  revision: number;
}

export const MEMORY_BYTE_LIMIT = 16_384;

export interface StudySection {
  part: StudyPart;
  fingerprint: string;
  text: string;
}

export type StudyPart = "code" | "instructions" | "github" | "pact" | "mandate" | "history";

export interface ProjectStudy {
  sections: StudySection[];
  updatedAt: string;
}

export interface CoordinatorState {
  threadId: string | null;
  threadModel: string | null;
  injectedStudy: Partial<Record<StudyPart, string>>;
  memory: CoordinatorMemory;
  study: ProjectStudy | null;
  memorySentToThread: string | null;
}

export interface ProjectDocument {
  schemaVersion: 1;
  projectId: string;
  events: ConversationEvent[];
  lastSequence: number;
  requests: CoordinatorRequest[];
  decisions: PactDecision[];
  decisionHistory: PactDecision[];
  mandate: ProjectMandate | null;
  mandateRequests: MandateRequest[];
  decisionRequests: DecisionRequest[];
  coordinator: CoordinatorState;
  selectedModel: string | null;
  selectedEffort: string | null;
  composerDraft: string;
}

export type CoordinatorPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "studying" }
  | { kind: "ready" }
  | { kind: "unavailable"; message: string };

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  url: string;
  author: string | null;
  labels: string[];
  updatedAt: string;
}

export interface GitHubState {
  repository: string | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  message: string | null;
  issues: GitHubIssue[];
}

export interface ActiveProjectState {
  id: string;
  name: string;
  rootPath: string;
  isDemo: boolean;
  snapshot: RepositorySnapshot;
  document: ProjectDocument;
  phase: CoordinatorPhase;
  streaming: { requestId: string | null; text: string } | null;
  runningRequestId: string | null;
  contextUsage: { usedTokens: number; contextWindow: number | null } | null;
  github: GitHubState;
  stateWritable: boolean;
}

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  sidebarWidth: number;
}

export interface AppState {
  recentProjects: RecentProject[];
  project: ActiveProjectState | null;
  loadingProject: string | null;
  codex: { account: AccountStatus | null; models: CodexModel[]; checking: boolean };
  settings: AppSettings;
  error: string | null;
  platform: NodeJS.Platform;
}
