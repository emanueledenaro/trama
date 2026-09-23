import type { ProviderAccount, ProviderId, ProviderModel } from "./codex";
import type { RepositorySnapshot } from "./repository";

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  isDemo: boolean;
  lastOpenedAt: string;
}

export type EventOrigin = "person" | "coordinator" | "trama" | "specialist";

export type CardKind = "study" | "mandate" | "decision" | "contextNotice" | "teamProposal" | "assignment" | "candidate" | "plan" | "conflict";

export interface ConflictAssessment {
  id: string;
  candidateId: string;
  snapshotId: string;
  remoteSHA: string;
  references: string[];
  classification: "conflict" | "overlap" | "clean" | "unknown";
  conflictingFiles: string[];
  detail: string;
  checkedAt: string;
}

export type EventContent =
  | { type: "personMessage"; text: string; moduleId: string | null; moduleName: string | null; imageCount?: number }
  | { type: "coordinatorText"; text: string; model: string | null; references: string[]; provider?: ProviderId | null }
  | { type: "activity"; title: string; detail: string | null; tone: "info" | "tool" | "error" }
  | { type: "card"; kind: CardKind; title: string; detail: string | null; referenceId: string | null };

export interface ConversationEvent {
  id: string;
  sequence: number;
  origin: EventOrigin;
  requestId: string | null;
  /** Specialist work: the assignment and turn the activity belongs to. */
  assignmentId?: string | null;
  workKey?: string | null;
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
  /** The provider the turn ran on; absent in documents written before providers existed (Codex). */
  provider?: ProviderId;
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

export type StudyPart = "code" | "instructions" | "github" | "monitor" | "pact" | "mandate" | "history";

export interface ProjectStudy {
  sections: StudySection[];
  updatedAt: string;
}

export interface CoordinatorState {
  threadId: string | null;
  threadModel: string | null;
  /** The provider that owns `threadId`; absent means Codex. */
  threadProvider?: ProviderId;
  /** Set when the person moved the Coordinator to another provider: the next study hands the conversation over. */
  pendingHandover?: { from: ProviderId; reason: string } | null;
  injectedStudy: Partial<Record<StudyPart, string>>;
  memory: CoordinatorMemory;
  study: ProjectStudy | null;
  memorySentToThread: string | null;
  /** Percent of the context window above which the chat shows a notice (5-95). */
  contextThreshold?: number;
  /** The threshold the last notice was given for; cleared by a compaction or a new thread. */
  contextWarnedAt?: number | null;
}

export type WorkKind = "agreedTicket" | "decidedBehaviorCorrection" | "newFeature" | "tradeOff";
export type SpecialistTool = "commands" | "edits";

export interface ProposedSpecialist {
  name: string;
  competence: string;
  reason: string;
  moduleIds: string[];
}

export interface TeamProposal {
  id: string;
  requestId: string | null;
  summary: string | null;
  members: ProposedSpecialist[];
  askedAt: string;
  resolution:
    | { kind: "confirmed"; specialistIds: string[]; resolvedAt: string }
    | { kind: "corrected"; specialistIds: string[]; removedNames: string[]; note: string | null; resolvedAt: string }
    | { kind: "superseded"; resolvedAt: string }
    | null;
}

export type SpecialistStatus = "available" | "working" | "stopping" | "stopped" | "removed";
export type AssignmentStatus = "preparing" | "running" | "stopRequested" | "stopped" | "completed" | "failed";

export interface WorktreeSession {
  sourceRoot: string;
  worktreeRoot: string;
  branch: string;
  baseSHA: string;
}

export interface AssignmentTurn {
  id: string;
  number: number;
  model: string;
  /** The provider that produced this turn (ADR 0009); absent means Codex. */
  provider?: ProviderId;
  startedAt: string;
  endedAt: string | null;
  outcome: "completed" | "interrupted" | "failed" | null;
}

export interface AssignmentStop {
  requestedBy: string;
  reason: string;
  requestedAt: string;
  thenRemove: boolean;
  confirmedAt: string | null;
}

export interface SpecialistAssignment {
  id: string;
  specialistId: string;
  requestId: string | null;
  kind: WorkKind;
  objective: string;
  issueNumber: number | null;
  exercise: string | null;
  moduleIds: string[];
  dependencies: string[];
  model: string;
  /** Pact decisions the work relies on, with the version it was delegated against (C06). */
  decisionVersions?: Record<string, number>;
  /** The provider recorded at assignment; the person can change it (ADR 0009). Absent means Codex. */
  provider?: ProviderId;
  tools: SpecialistTool[];
  requiredChecks: string[];
  instructions: string;
  mandateVersion: number;
  createdAt: string;
  status: AssignmentStatus;
  workspace: WorktreeSession | null;
  threadId: string | null;
  turns: AssignmentTurn[];
  stops: AssignmentStop[];
  result: string | null;
  failure: string | null;
  updatedAt: string;
  lastUpdate: string;
  reportedStatus: AssignmentStatus | null;
}

export interface Specialist {
  id: string;
  name: string;
  competence: string;
  reason: string;
  moduleIds: string[];
  origin: "teamProposal" | "coordinator";
  createdAt: string;
  status: SpecialistStatus;
  model: string | null;
  provider?: ProviderId | null;
  tools: SpecialistTool[];
  updatedAt: string;
  lastUpdate: string;
  assignments: SpecialistAssignment[];
  removal: { removedBy: string; reason: string; removedAt: string } | null;
}

export interface ProjectTeam {
  proposals: TeamProposal[];
  specialists: Specialist[];
  confirmedAt: string | null;
}

export interface CandidateEvidence {
  check: string;
  result: "pass" | "fail";
  command: string;
  output: string;
  snapshotId: string;
  decisionVersions: Record<string, number>;
  recordedAt: string;
}

export interface TechnicalReview {
  id: string;
  reviewerThreadId: string;
  authorThreadId: string | null;
  verdict: "approved" | "changesRequested";
  summary: string;
  at: string;
}

export interface Candidate {
  id: string;
  assignmentId: string;
  specialistId: string;
  snapshotId: string;
  baseSHA: string;
  diff: string;
  changedFiles: string[];
  touchedModules: string[];
  requiredDecisionIds: string[];
  /** Decision versions the candidate was delegated against (the lease). */
  decisionVersions: Record<string, number>;
  requiredChecks: string[];
  unresolvedChoices: string[];
  externalEffects: string[];
  declaredAt: string;
  updatedAt: string;
  evidence: Record<string, CandidateEvidence>;
  technicalReview: TechnicalReview | null;
  clearance: { actor: string; fingerprint: string; at: string } | null;
  humanApproval: { actor: string; fingerprint: string; at: string } | null;
  pullRequest: { url: string; number: number; branch: string; at: string } | null;
}

export type CandidateState = "building" | "verified" | "decided";

export interface CandidateBlocker {
  code: string;
  detail: string;
}

export interface CandidateReport {
  state: CandidateState;
  blockers: CandidateBlocker[];
  clearanceInvalidated: boolean;
  approvalInvalidated: boolean;
}

export interface PlanProposal {
  sourceSnapshotID: string;
  summary: string;
  steps: string[];
  affectedModuleIDs: string[];
  references: string[];
  requiredDecisionIDs: string[];
  proposedBehavior: string;
  acceptedExample: string;
  rationale: string;
  questions: {
    scenario: string;
    question: string;
    options: { label: string; behavior: string; example: string; rationale: string }[];
    revisesDecisionID: string | null;
  }[];
}

export interface WorkPlan {
  id: string;
  requestId: string | null;
  orderedBy: "person" | "coordinator";
  kind: WorkKind;
  moduleIds: string[];
  summary: string;
  issueNumber: number | null;
  status: "planning" | "ready" | "failed";
  proposal: PlanProposal | null;
  failure: string | null;
  decisionRequestIds: string[];
  createdAt: string;
  updatedAt: string;
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
  /** The composer's selection for the project dialog (ADR 0010). Absent provider means Codex. */
  selectedProvider?: ProviderId;
  selectedModel: string | null;
  selectedEffort: string | null;
  /** The last model and effort chosen for each provider, restored when the person switches back. */
  providerPreferences?: Partial<Record<ProviderId, { model: string | null; effort: string | null }>>;
  composerDraft: string;
  team: ProjectTeam;
  candidates: Candidate[];
  plans: WorkPlan[];
  conflicts?: ConflictAssessment[];
  /** The review cycle scenario of the example project, run on a local model of an order. */
  pactDemo?: PactDemo | null;
}

export interface PactDemo {
  candidateId: string;
  decisionId: string;
  decisionVersion: number;
  evidence: { check: string; result: "pass" | "fail" | "notRun"; output: string }[];
  approval: { actor: string; decisionVersion: number; at: string } | null;
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

export interface GitHubBranch {
  name: string;
  sha: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  headSHA: string;
  baseRef: string;
  url: string;
  draft: boolean;
  updatedAt: string;
}

export interface GitHubSnapshot {
  repository: string;
  defaultBranch: string;
  branches: GitHubBranch[];
  pullRequests: GitHubPullRequest[];
  fetchedAt: string;
  warnings: string[];
}

export interface TeamEvent {
  id: string;
  repository: string;
  entity: "branch" | "pullRequest";
  change: "created" | "updated" | "deleted";
  reference: string;
  title: string;
  author: string | null;
  beforeSHA: string | null;
  afterSHA: string | null;
  url: string | null;
  observedAt: string;
}

export interface MonitorState {
  enabled: boolean;
  openAtLogin: boolean;
  intervalSeconds: number;
  repositories: string[];
  status: Record<string, { lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number }>;
}

export interface GitHubState {
  repository: string | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  message: string | null;
  issues: GitHubIssue[];
  snapshot: GitHubSnapshot | null;
  events: TeamEvent[];
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
  /** Work keys of specialist turns that are running now. */
  runningWork: string[];
  /** What the example project's review scenario still needs. */
  pactDemoBlockers: CandidateBlocker[];
  /** Skills Codex loads for this project. */
  skills: import("./skills").LoadedSkill[];
  /** The current verdict of each candidate, computed by the main process. */
  candidateReports: Record<string, CandidateReport>;
}

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  sidebarWidth: number;
}

export interface AppState {
  monitor: MonitorState;
  recentProjects: RecentProject[];
  project: ActiveProjectState | null;
  loadingProject: string | null;
  /** Codex's state; the same object as `providers.codex`. */
  codex: ProviderState;
  providers: Record<ProviderId, ProviderState>;
  settings: AppSettings;
  error: string | null;
  platform: NodeJS.Platform;
}

export interface ProviderState {
  account: ProviderAccount | null;
  models: ProviderModel[];
  checking: boolean;
}
