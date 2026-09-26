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

export type CardKind =
  | "study"
  | "mandate"
  | "decision"
  | "contextNotice"
  | "teamProposal"
  | "assignment"
  | "candidate"
  | "plan"
  | "conflict"
  | "goal"
  /** Glossary terms and ADRs the Coordinator drew from the person's decisions (M03); referenceId is the proposal. */
  | "domainProposal"
  /** A move of the Coordinator that Trama started by itself within the mandate (W04); referenceId is its request. */
  | "automaticStep"
  /** Trama asks whether to share the presence in this project (G01); referenceId is the proposal, `initial` or `conflict`. */
  | "presenceConsent"
  /** The Coordinator points out an overlap with a colleague's work (G03); referenceId is the overlap's id. */
  | "overlap";

export interface ConflictAssessment {
  id: string;
  candidateId: string;
  snapshotId: string;
  remoteSHA: string;
  references: string[];
  classification: "conflict" | "overlap" | "clean" | "unknown";
  conflictingFiles: string[];
  /** The lines in conflict for each file, in the candidate's version (G03); absent in older assessments. */
  conflictingLines?: Record<string, import("./overlap").LineRange[]>;
  /**
   * Set when the other side is another developer's worktree in this project, not a remote head (W08): its candidate
   * and the snapshot compared. `remoteSHA` is then the temporary commit Trama made of that candidate.
   */
  otherCandidateId?: string;
  otherSnapshotId?: string;
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
  /** The goal dialog the event belongs to; absent or null means the project dialog (UX02). */
  goalId?: string | null;
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
  /** The goal dialog the message was sent from, fixed when the request is created (UX02). */
  goalId?: string | null;
  /** The one next step the Coordinator declared at the end of the turn (W01). */
  nextStep?: NextStep | null;
  /** The next step this message takes (W04): the person's button, or Trama starting the Coordinator's move by itself. */
  step?: RequestStep | null;
}

/** A next step taken by a message: the person pressed its button, or Trama started the Coordinator's own move (W04). */
export interface RequestStep {
  move: NextMove;
  by: "person" | "trama";
}

/** The phase of a request's work, computed by Trama from the records, never by the model (W01). */
export type WorkPhase = "clarification" | "spec" | "slices" | "execution" | "verification" | "candidate" | "merged" | "blocked";

/**
 * What the person put in focus and on pause among the project's tasks (W02). Everything else about a task
 * (its phase, its blocker, whether it is closed) is computed from the records.
 */
export interface TaskFocus {
  /** The task the person chose to work on; absent, stale or paused means the first open task in the queue. */
  taskId: string | null;
  pausedTaskIds: string[];
}

/** A task of the project as the focus bar and the queue show it (W02). */
export interface FocusTask {
  /** `goal:<goal id>` for a goal's work, `work:<first request id>` for work in the project dialog. */
  id: string;
  /** The dialog the task lives in; null is the project dialog. */
  goalId: string | null;
  title: string;
  /** Null when the task has no work yet: a goal nobody started. */
  phase: WorkPhase | null;
  phaseLabel: string;
  /** Why the work cannot go on; set only in the blocked phase. */
  blocker: string | null;
  /** The person's move the work waits for, as its button says it ("Rispondi alla domanda"); null when none. */
  waitingFor: string | null;
  status: "focus" | "queued" | "paused";
}

/** The task in focus and the others, queued first, then paused (W02). */
export interface FocusView {
  focus: FocusTask | null;
  queue: FocusTask[];
}

/** A move that takes the work on: the first nine are the person's, the last three the Coordinator's (W01). */
export type NextMove =
  | "answerQuestions"
  | "confirmUnderstanding"
  | "grantMandate"
  | "confirmTeam"
  | "confirmSeams"
  | "confirmSlices"
  | "reviewPlan"
  | "reviewCandidate"
  | "mergePullRequest"
  | "preparePlan"
  | "assignWork"
  | "verifyCandidate";

/** The move the Coordinator chose among the allowed ones, with its one-line reason. */
export interface NextStep {
  move: NextMove;
  reason: string;
  declaredAt: string;
}

/** A declared next step that is still allowed, as the chat shows it under the reply. */
export interface NextStepView {
  move: NextMove;
  actor: "person" | "coordinator";
  label: string;
  reason: string;
  /** The record the step is about: a question, a mandate request, a team proposal, a plan or a candidate. */
  targetId: string | null;
  /** The pull request the person merges. */
  url: string | null;
  /** What the button sends to the Coordinator, for a step that is a message. */
  message: string | null;
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
  /**
   * Null while the request waits for the person. "superseded" means a newer request replaced it before the
   * person answered (W14): it can no longer be granted and names the newer one in `supersededBy`.
   */
  resolution: {
    kind: "granted" | "corrected" | "revoked" | "superseded";
    version: number | null;
    resolvedAt: string;
    supersededBy?: string | null;
  } | null;
}

/** The one mandate request waiting for the person: the latest unresolved one (W14). */
export function pendingMandateRequest(document: Pick<ProjectDocument, "mandateRequests">): MandateRequest | null {
  return document.mandateRequests.filter((r) => !r.resolution).at(-1) ?? null;
}

export interface DecisionAlternative {
  behavior: string;
  example: string;
  consequence: string | null;
}

/** Where a grilling question sits: the request being clarified, its round, its number and the recommended answer. */
export interface GrillingPlace {
  /** The request whose work the grilling clarifies: the one where round 1 was asked. */
  subjectRequestId: string;
  round: number;
  /** 1-based position of the question within its round. */
  number: number;
  /** Index of the alternative the Coordinator recommends. */
  recommendedIndex: number;
}

export interface DecisionRequest {
  id: string;
  requestId: string | null;
  category: "product" | "destructive";
  question: string;
  concreteCase: string;
  alternatives: DecisionAlternative[];
  revisesDecisionId: string | null;
  /** The goal dialog the question was asked in; its answer links the decision to that goal. */
  goalId?: string | null;
  /** Set when the question belongs to a grilling round before a plan (M01). */
  grilling?: GrillingPlace | null;
  askedAt: string;
  outcome: { answer: string; alternativeIndex: number | null; decisionId: string; version: number; answeredAt: string } | null;
  /**
   * Set when the person withdrew the open question with a reason (W03): it stays in the history, records no
   * decision and no longer waits for an answer. Absent in documents written before withdrawals.
   */
  withdrawal?: { reason: string; withdrawnAt: string } | null;
}

/** A question still waiting for the person: neither answered nor withdrawn. */
export function isOpenQuestion(request: Pick<DecisionRequest, "outcome" | "withdrawal">): boolean {
  return !request.outcome && !request.withdrawal;
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
  /** Fingerprint of the adopted practices last sent to the thread. */
  practicesSent?: string | null;
  /** The late rules (writing, grilling) the thread holds: a thread opened before they changed receives them in a turn. */
  rulesSent?: string | null;
  /** Percent of the context window above which the chat shows a notice (5-95). */
  contextThreshold?: number;
  /** The threshold the last notice was given for; cleared by a compaction or a new thread. */
  contextWarnedAt?: number | null;
  /** The learning loop ported from Hermes (ADR 0014); absent in documents written before it. */
  learning?: CoordinatorLearning;
}

export interface CoordinatorLearning {
  /** Person turns since the Coordinator last wrote memory or a memory review ran. */
  turnsSinceMemory: number;
  /** Tool iterations since the Coordinator last wrote a skill or a skill review ran. */
  itersSinceSkill: number;
  /** Events from this sequence on are in the Coordinator's live thread: session search skips them. */
  liveFromSequence: number;
  /** The old single-text memory was moved into MEMORY.md. */
  memoryMigrated?: boolean;
  /** The skills index last sent to the thread. */
  skillsIndexSent?: string | null;
}

export type WorkKind = "agreedTicket" | "decidedBehaviorCorrection" | "newFeature" | "tradeOff";
export type SpecialistTool = "commands" | "edits";

export interface ProposedSpecialist {
  name: string;
  /** The role in short (W15), for example `Interfaccia`; derived from the competence when absent. */
  tag?: string;
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
  /** Set when the provider hit a usage limit: Trama resumes the work by itself when it unblocks (C11). */
  waitingForProvider?: { provider: ProviderId; until: string | null; since: string } | null;
  /** Pact decisions the work relies on, with the version it was delegated against (C06). */
  decisionVersions?: Record<string, number>;
  /** The provider recorded at assignment; the person can change it (ADR 0009). Absent means Codex. */
  provider?: ProviderId;
  /** Why the Coordinator chose this provider and model, in its own words (UX05); absent in older documents. */
  modelReason?: string | null;
  /** The goal the work serves (UX02); absent when it was assigned outside a goal. */
  goalId?: string | null;
  tools: SpecialistTool[];
  requiredChecks: string[];
  instructions: string;
  mandateVersion: number;
  createdAt: string;
  status: AssignmentStatus;
  workspace: WorktreeSession | null;
  /** When the person removed the worktree after the work ended (T08); the session stays for history. */
  workspaceRemovedAt?: string | null;
  threadId: string | null;
  turns: AssignmentTurn[];
  stops: AssignmentStop[];
  result: string | null;
  failure: string | null;
  updatedAt: string;
  lastUpdate: string;
  reportedStatus: AssignmentStatus | null;
  /** Set when Trama started this work of a fixed role by itself (W11); absent for work the Coordinator assigned. */
  duty?: AssignmentDuty | null;
  /** The slice of the plan's approved breakdown this work delivers (M05); absent for work outside one. */
  slice?: { planId: string; sliceId: string } | null;
  /**
   * The seams to test in the contract of the assignment (W05). For a slice, the seams the person confirmed in the
   * spec, with their number there. Absent in assignments made before the contract, and in a fixed role's work.
   */
  seams?: ContractSeam[];
  /** The developer's structured report (W05), read from its last answer: its statement, never evidence. */
  report?: DeveloperReport | null;
  /** Set when the developer took the slice by itself, within the mandate, instead of the Coordinator assigning it (W08). */
  selfPicked?: boolean;
}

/** A seam the developer must test, as the contract of the assignment names it (W05). */
export interface ContractSeam {
  /** The number the developer uses in its report: the seam's number in the spec for a slice. */
  number: number;
  seam: string;
  /** What the test at this seam verifies, when the spec says it. */
  tests: string | null;
}

/**
 * The developer's structured report at the end of the work (W05), extending the tested seams of M06.
 * A section the developer left out is null; an empty list means it said there was nothing.
 */
export interface DeveloperReport {
  filesTouched: string[] | null;
  testsWritten: string[] | null;
  /** Every seam of the contract, with the tests the developer named or null; a number outside it is not agreed. */
  seams: TestedSeam[] | null;
  doubts: string[] | null;
}

/** The AI Hero skill a fixed role runs when Trama starts its work by itself (W11). */
export type DutySkill = "triage" | "diagnosing-bugs" | "improve-codebase-architecture" | "domain-modeling";

/** What made Trama start a fixed role's work: a rule of Trama, never the model's judgment (W11). */
export type DutyTrigger =
  | { kind: "newIssue"; issueNumber: number; title: string }
  | { kind: "failedCheck"; failureId: string }
  /** `afterWork`: the finished work that changed code, known when the review started. */
  | { kind: "idleTeam"; headSHA: string; afterWork: string[] }
  | { kind: "diagnosisFix"; diagnosisId: string }
  /** The documentation and domain role writes a domain proposal in its worktree, within the mandate (M03). */
  | { kind: "domainProposal"; proposalId: string };

export type TriageCategory = "bug" | "enhancement";
export type TriageState = "needs-triage" | "needs-info" | "ready-for-agent" | "ready-for-human" | "wontfix";

/** The triage skill's recommendation for an issue; posting it on GitHub stays with the person. */
export interface TriageOutcome {
  kind: "triage";
  category: TriageCategory;
  state: TriageState;
  reasoning: string;
  /** What happened when the claim was checked against the code. */
  verification: string;
  /** Where the behavior already lives, when the request is already implemented. */
  alreadyImplemented: string | null;
  /** The comment the skill would post on the issue: agent brief, triage notes or the reason to close. */
  comment: string;
}

export interface DiagnosisOutcome {
  kind: "diagnosis";
  /** The one command of the feedback loop, and what it printed. */
  loopCommand: string | null;
  loopOutput: string | null;
  /** The loop went red on this bug. */
  reproduced: boolean;
  /** Ranked, most likely first. */
  hypotheses: string[];
  cause: string | null;
  /** The failing test to write at the correct seam. */
  regressionTest: string | null;
  /** Set when no correct seam exists for a regression test. */
  seamNote: string | null;
  fix: string | null;
  moduleIds: string[];
  /** What the person should provide when no loop could be built. */
  openQuestions: string | null;
  /** The fix Trama assigned within the mandate. */
  fixAssignmentId: string | null;
  /** Why the fix is not assigned yet. */
  fixWaiting: string | null;
}

export type ArchitectureStrength = "Strong" | "Worth exploring" | "Speculative";

export interface ArchitectureProposal {
  title: string;
  files: string[];
  problem: string;
  solution: string;
  benefits: string;
  strength: ArchitectureStrength;
  /** The ADR the proposal contradicts and why it is worth reopening. */
  adrConflict: string | null;
}

export interface ArchitectureOutcome {
  kind: "architecture";
  proposals: ArchitectureProposal[];
  topRecommendation: string | null;
  /** The Pact decision card that puts the proposals to the person; null when there is nothing to propose. */
  decisionRequestId: string | null;
}

export type DutyOutcome = TriageOutcome | DiagnosisOutcome | ArchitectureOutcome;

export interface AssignmentDuty {
  skill: DutySkill;
  trigger: DutyTrigger;
  /** Read from the session's answer when it ends; a fix keeps its report in `result` instead. */
  outcome: DutyOutcome | null;
  /** The session ended with an answer Trama could not read. */
  unreadable?: boolean;
}

/** A check that failed on the project checkout or on a candidate, waiting for or under diagnosis (W11). */
export interface CheckFailure {
  id: string;
  check: string;
  /** The check as the person reads it, for example "test Node". */
  title: string;
  command: string;
  target: "checkout" | "candidate";
  candidateId: string | null;
  /** The candidate's assignment: its worktree is where the check failed. */
  assignmentId: string | null;
  /** The candidate snapshot or the checkout HEAD the check failed on. */
  version: string | null;
  /** The check passed before: on the candidate's base, on an earlier version of the same work or on an earlier HEAD. */
  regression: boolean;
  output: string;
  at: string;
  diagnosisId: string | null;
}

/** A glossary term in the shape of domain-modeling's CONTEXT-FORMAT.md. */
export interface GlossaryTerm {
  term: string;
  /** One or two sentences: what the term is. */
  definition: string;
  /** The other words for the same concept, listed under `_Avoid_`. */
  avoid: string[];
}

/** An ADR in the shape of domain-modeling's ADR-FORMAT.md; the optional sections are left out when empty. */
export interface AdrProposal {
  title: string;
  /** One to three sentences: the context, the decision and why. */
  body: string;
  consideredOptions: string[];
  consequences: string | null;
}

/**
 * Glossary terms and ADRs the Coordinator drew from Pact decisions while it grilled a request (M03). The Coordinator
 * is read-only: the documentation and domain role writes them in its worktree, only within the mandate.
 */
export interface DomainProposal {
  id: string;
  requestId: string | null;
  /** The Pact decisions the terms and ADRs come from. */
  decisionIds: string[];
  /** The glossary the terms go to, relative to the project root: `CONTEXT.md` in a single-context repo. */
  contextPath: string;
  /** Where the ADRs go: `docs/adr` next to the glossary. */
  adrDirectory: string;
  terms: GlossaryTerm[];
  adrs: AdrProposal[];
  /** The modules the files belong to, `root` for a root CONTEXT.md and `docs` for docs/adr: no other work may run there. */
  moduleIds: string[];
  /** Those of them that are modules of the project: the mandate's scope must cover them. */
  scopeModuleIds: string[];
  createdAt: string;
  /** The documentation and domain assignment that writes the proposal. */
  assignmentId: string | null;
  /** Why the writing has not started yet. */
  waiting: string | null;
}

/** Trama's own bookkeeping for the fixed roles' automatic work (W11). */
export interface DutyLedger {
  /** The highest issue number when Trama first read the project's issues: only issues above it are new. */
  issueBaseline: number | null;
  failures: CheckFailure[];
  /** The last result of each check on the project checkout, to recognize a regression. */
  checkoutChecks: Record<string, { headSHA: string | null; passed: boolean }>;
}

/**
 * A figure of the project team (W09): every fixed role that each team always has, and the developers
 * chosen for the project.
 */
export type TeamRole =
  | "qa"
  | "ux"
  | "research"
  | "documentation"
  | "developer"
  | "bugTriage"
  | "specReviewer"
  | "cleanCode"
  | "regressionGuardian"
  | "security"
  | "performance"
  | "devops";

/** A color of the fixed agent palette (W15, `@shared/identity`). */
export type AgentColor = "blue" | "indigo" | "violet" | "fuchsia" | "pink" | "copper" | "olive" | "teal" | "cyan";

/** The point of the flow where a figure of the team works (W09). */
export type TeamMoment = "spec" | "slices" | "candidate" | "background";

export interface Specialist {
  id: string;
  name: string;
  competence: string;
  reason: string;
  moduleIds: string[];
  /** A fixed role, or `developer` for the specialists chosen for the project (W09). */
  role: TeamRole;
  /** `fixedRole`: Trama adds it to every team and it cannot be removed. */
  origin: "teamProposal" | "coordinator" | "fixedRole";
  /** The agent's own color, only on its identity (W15, ADR 0007): Trama picks a free one, the person may change it. */
  color: AgentColor;
  /** The role in short, shown colored beside the name (W15): the fixed role's, or the developer's own. */
  tag: string;
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
  /** mergedAt: when Trama saw the pull request merged on GitHub. */
  pullRequest: { url: string; number: number; branch: string; at: string; mergedAt?: string | null } | null;
  /** The goal of the assignment, copied when the candidate is declared. */
  goalId?: string | null;
  /** The person's observations of the goal's examples on this exact snapshot (UX06). */
  exampleObservations?: ExampleObservation[];
  /**
   * The seams the developer of a slice says it tested (M06), against the seams the person confirmed in the spec.
   * The developer's statement, never evidence. Null when the developer reported none; absent outside a slice.
   */
  testedSeams?: TestedSeam[] | null;
}

/** A seam as the developer of a slice reported it (M06). */
export interface TestedSeam {
  seam: string;
  /** False for a seam the developer named outside the ones the person confirmed. */
  agreed: boolean;
  /** The tests the developer named at this seam; null when it did not report testing it. */
  tests: string | null;
}

/** The person observed, or did not observe, a goal example on one candidate snapshot. */
export interface ExampleObservation {
  goalId: string;
  exampleId: string;
  /** The example text observed: an edited example no longer matches. */
  exampleText: string;
  snapshotId: string;
  observed: boolean;
  actor: string;
  at: string;
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
  /**
   * seams: the planner proposed the seams to test and waits for the person's answer before it writes the spec (M04).
   * stale: the repository changed while the planner read it; the plan must be re-evaluated (T06).
   */
  status: "planning" | "seams" | "ready" | "failed" | "stale";
  /** The plan of a request written before M04; a plan written with to-spec keeps `spec` instead. */
  proposal: PlanProposal | null;
  /** The plan as a spec, written with AI Hero's to-spec skill (M04); absent in plans written before it. */
  spec?: PlanSpec | null;
  /** The spec split into vertical slices with AI Hero's to-tickets skill (M05); absent before the spec is written. */
  slicing?: PlanSlicing | null;
  /** Set when the person corrected the proposal or the spec. */
  editedAt?: string | null;
  failure: string | null;
  decisionRequestIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A seam at which the work of a spec is tested, in codebase-design's words (M04). */
export interface SpecSeam {
  /** Where the tests cross: the module and the interface they go through. */
  seam: string;
  /** A seam the code already has, which to-spec prefers, or a new one. */
  existing: boolean;
  /** What the tests check there. */
  tests: string;
}

/** The sections of to-spec's template, in its order, and the title the spec takes in the issue tracker. */
export interface SpecSections {
  title: string;
  problemStatement: string;
  solution: string;
  userStories: string[];
  implementationDecisions: string[];
  testingDecisions: string[];
  outOfScope: string;
  furtherNotes: string;
}

/** The person's answer to to-spec's seam check: the seams as proposed, or a correction in their own words. */
export interface SeamsAnswer {
  confirmed: boolean;
  note: string | null;
  at: string;
}

/** A plan written as a spec with AI Hero's to-spec skill and codebase-design's vocabulary (M04). */
export interface PlanSpec {
  /** The seams to test: proposed by the planner, then as checked with the person. */
  seams: SpecSeam[];
  /** Null while the seams wait for the person. */
  seamsAnswer: SeamsAnswer | null;
  /** Null until the planner wrote the spec after the person's answer. */
  sections: SpecSections | null;
  affectedModuleIDs: string[];
  references: string[];
  requiredDecisionIDs: string[];
  /** The GitHub issue the spec was published as; null while the spec stays in Trama. */
  issue: { number: number; url: string; at: string } | null;
  /** Why the last publication or update on GitHub did not succeed. */
  publishFailure: string | null;
}

/** A ticket of to-tickets (M05): a tracer-bullet vertical slice with the tickets that block it. */
export interface SliceTicket {
  /** S1, S2, ... in dependency order: blockers first. */
  id: string;
  title: string;
  /** The end-to-end behaviour the slice makes work, from the person's perspective. */
  whatToBuild: string;
  acceptanceCriteria: string[];
  /** Ids of the slices that must be done before this one can start; empty when it can start immediately. */
  blockedBy: string[];
  /** The GitHub issue the slice was published as; null while it stays in Trama. */
  issue: { number: number; url: string; at: string } | null;
  /**
   * Set while the slice is paused, as when a developer's question became a Pact card that blocks the work (W06):
   * nobody picks it until the pause is cleared. Absent or null means not paused.
   */
  pause?: { reason: string; since: string } | null;
}

/**
 * The spec split with AI Hero's to-tickets skill (M05). drafting: the slicer works; proposed: the breakdown waits
 * for the person, as to-tickets quizzes the user; approved: Trama published it and assigns its unblocked slices.
 */
export interface PlanSlicing {
  status: "drafting" | "proposed" | "approved" | "failed";
  tickets: SliceTicket[];
  /** The person's correction of the last breakdown, which the next draft receives. */
  feedback: string | null;
  approvedAt: string | null;
  failure: string | null;
  /** Why the publication on GitHub did not fully succeed. */
  publishFailure: string | null;
}

/** Where a slice of an approved breakdown stands, computed by Trama from its assignments and candidates (M05). */
export type SliceState = "blocked" | "paused" | "ready" | "working" | "verifying" | "done";

export interface SliceView {
  id: string;
  state: SliceState;
  /** Blocking slices that are not done yet. */
  waitingFor: string[];
  /** The latest assignment of the slice, when there is one. */
  assignmentId: string | null;
}

/** A behavior example of a goal: accepted means it must happen, refused means it must not. */
export interface GoalExample {
  id: string;
  kind: "accepted" | "refused";
  text: string;
}

/** Proposed by the Coordinator and not yet confirmed, open, achieved or abandoned by the person. */
export type GoalStatus = "proposed" | "open" | "achieved" | "abandoned";

/** The composer's selection and draft of one dialog (ADR 0010). */
export interface DialogComposer {
  selectedProvider?: ProviderId;
  selectedModel: string | null;
  selectedEffort: string | null;
  /** Fast mode for models that offer it; absent means off. */
  selectedFastMode?: boolean;
  providerPreferences?: Partial<Record<ProviderId, { model: string | null; effort: string | null }>>;
  composerDraft: string;
}

/**
 * A project result with a stable identity and verifiable examples (UX01). It is distinct from a
 * message, an assignment and a candidate; relations to them are explicit ids.
 */
export interface ProjectGoal {
  id: string;
  title: string;
  outcome: string;
  examples: GoalExample[];
  status: GoalStatus;
  origin: "person" | "coordinator";
  createdAt: string;
  updatedAt: string;
  /** Pact decisions the person or the goal dialog linked to this goal. */
  decisionIds: string[];
  /** The goal dialog's composer. */
  dialog: DialogComposer;
  /**
   * When the person put the goal away (W03). Archiving hides it from the working view and keeps its status,
   * links and history; restoring clears it. Absent or null means not archived.
   */
  archivedAt?: string | null;
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
  /** Fast mode for models that offer it; absent means off. */
  selectedFastMode?: boolean;
  /** The last model and effort chosen for each provider, restored when the person switches back. */
  providerPreferences?: Partial<Record<ProviderId, { model: string | null; effort: string | null }>>;
  composerDraft: string;
  team: ProjectTeam;
  candidates: Candidate[];
  plans: WorkPlan[];
  conflicts?: ConflictAssessment[];
  /** The idea the person started this project from (T10); the Coordinator proposes purpose and structure first. */
  createdFromIdea?: string | null;
  /** Goals of the project (UX01); absent in documents written before goals. */
  goals?: ProjectGoal[];
  /** The review cycle scenario of the example project, run on a local model of an order. */
  pactDemo?: PactDemo | null;
  /** Progress of the guided exercises, kept only in the example project (C13, C14). */
  exercises?: import("./onboarding").ExerciseRecord;
  /** The fixed roles' automatic work (W11); absent until Trama first needs it. */
  duties?: DutyLedger;
  /** Glossary and ADR proposals drawn from the person's decisions (M03); absent before the first one. */
  domainProposals?: DomainProposal[];
  /** The task in focus and the paused ones (W02); absent until the person first chooses. */
  focus?: TaskFocus;
  /** The person's consent to share the presence in this project (G01); absent until Trama first proposes it. */
  presence?: import("./presence").PresenceConsent;
  /** The overlaps the Coordinator already pointed out in the chat (G03), so each one is said once. */
  overlapNotices?: string[];
  /** The person's settings for this project; absent until they first change one. */
  settings?: ProjectSettings;
  /** Focus mode examinations (F01); absent until the person first opens focus mode. */
  audits?: FocusAudit[];
}

export interface ProjectSettings {
  /** Developers at work at the same time (W08); absent means three. */
  parallelDevelopers?: number;
}

export type AuditStatus = "checking" | "reviewing" | "done" | "failed";

/** One axis of AI Hero's code-review skill, run as a read-only session of its own (F01). */
export interface AuditAxis {
  /** "skipped": the skill skips the Spec sub-agent when there is no spec. */
  status: "waiting" | "running" | "done" | "skipped" | "failed";
  /** The sub-agent's report in Markdown, as it wrote it; the skill's "no spec available" when skipped. */
  report: string | null;
  findings: number | null;
  /** The worst finding within this axis, in one line; null when there is none. */
  worst: string | null;
  threadId: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failure: string | null;
}

/**
 * Focus mode on one target (F01, spec #124): Trama runs the real checks in the sandbox, then the two axes of
 * code-review in parallel and read-only. The checks are evidence; the axes' findings are the model's judgement.
 */
export interface FocusAudit {
  id: string;
  target: { kind: "candidate"; candidateId: string; assignmentId: string };
  /** The fixed point of code-review: the candidate's base commit. */
  fixedPoint: string;
  snapshotId: string;
  changedFiles: string[];
  status: AuditStatus;
  /** Trama's evidence from the checks run for this examination, in the order they ran. */
  checks: CandidateEvidence[];
  /** Where the Spec axis read the spec from, in Italian; null when no spec was found. */
  specSource: string | null;
  standards: AuditAxis;
  spec: AuditAxis;
  /** The skill's closing line, per axis: total findings and the worst one within each axis. */
  summary: string | null;
  failure: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
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
  /** Opened from a fork: its head lives in another repository. */
  fromFork?: boolean;
  checks?: "success" | "failure" | "pending" | "none";
  reviewState?: "approved" | "changesRequested" | "commented" | "none";
}

export interface GitHubSnapshot {
  repository: string;
  defaultBranch: string;
  branches: GitHubBranch[];
  pullRequests: GitHubPullRequest[];
  fetchedAt: string;
  warnings: string[];
  /** Branches whose new head does not contain the old one: history was rewritten. */
  forcePushed?: string[];
  /** GitHub now answers with another name for the repository. */
  renamedTo?: string | null;
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
  /** What the person's gh session can do on this repository (T03). */
  capabilities?: GitHubCapabilities | null;
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
  /** Messages sent while a turn was running, in the order they will leave (W03). */
  queuedMessages: QueuedMessage[];
  contextUsage: { usedTokens: number; contextWindow: number | null } | null;
  github: GitHubState;
  stateWritable: boolean;
  /** Work keys of specialist turns that are running now. */
  runningWork: string[];
  /** What the example project's review scenario still needs. */
  pactDemoBlockers: CandidateBlocker[];
  /** Skills of the AI Hero method that Codex's catalogue did not load (T04); null when not checked. */
  missingMethodSkills?: string[] | null;
  /** Skills Codex loads for this project. */
  skills: import("./skills").LoadedSkill[];
  /** The current verdict of each candidate, computed by the main process. */
  candidateReports: Record<string, CandidateReport>;
  /** The next step of the latest request of each dialog, by request id, while it is still allowed (W01). */
  nextSteps: Record<string, NextStepView>;
  /** Where each slice of an approved breakdown stands, by plan id (M05); computed by the main process. */
  sliceViews?: Record<string, SliceView[]>;
  /** The task in focus and the queue, computed by the main process (W02). */
  focus: FocusView;
  /** The AI Hero skills Trama copies are present in the project. */
  aiHeroPrepared?: boolean;
  /** Who works on what (G01), computed by the main process; absent until the first reading and in the example project. */
  presence?: import("./presence").PresenceView | null;
  /** The person's work against the colleagues' presence (G03); absent without a presence reading. */
  overlaps?: import("./overlap").OverlapView | null;
}

/** A message waiting for the running turn to end; it has no request and no event until it leaves. */
export interface QueuedMessage {
  id: string;
  text: string;
  /** The dialog it was sent from, fixed at sending (UX02). */
  goalId: string | null;
  imageCount: number;
  queuedAt: string;
  /**
   * False when the message reports a choice Trama already recorded (an answer, a withdrawal, a mandate):
   * deleting it would hide that choice from the Coordinator.
   */
  removable: boolean;
}

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  sidebarWidth: number;
  /** Prepare the AI Hero method when a project without it opens (T04). On unless the person turns it off. */
  autoPrepareMethod?: boolean;
  /** A sound with useful alerts only (conflicts, blocked providers, finished work). Off by default. */
  sounds?: boolean;
  /** Continuous work (W04): Trama starts the Coordinator's own moves within the mandate. On unless the person turns it off. */
  continuousWork?: boolean;
  /** What the learning loop may do (ADR 0014); missing keys take the defaults. */
  learning?: Partial<LearningSettings>;
}

export interface LearningSettings {
  /** MEMORY.md: the Coordinator's notes about this project. */
  memory: boolean;
  /** USER.md: who the person is, shared by their projects. */
  userProfile: boolean;
  /** The unattended review after enough turns or tool iterations. */
  backgroundReview: boolean;
  /** The weekly deterministic pass that stales and archives unused learned skills. */
  curator: boolean;
  /** The curator's optional model pass that merges narrow skills. Off by default. */
  consolidate: boolean;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = { memory: true, userProfile: true, backgroundReview: true, curator: true, consolidate: false };

export interface LearningReviewRun {
  id: string;
  /** What started it: the counters, the person, or the curator. */
  trigger: "memory" | "skills" | "memory+skills" | "person" | "curator";
  startedAt: string;
  endedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  provider: import("./codex").ProviderId | null;
  model: string | null;
  /** Writes the review made, one line each; empty when it saved nothing. */
  actions: string[];
  toolCalls: number;
  usedTokens: number | null;
  error: string | null;
}

export interface LearnedSkillView {
  name: string;
  category: string | null;
  description: string;
  /** "agent": written by the unattended review, maintained by the curator; "learn": written in a turn with the person. */
  createdBy: "agent" | "learn" | null;
  state: "active" | "stale" | "archived";
  pinned: boolean;
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface MemoryStoreView {
  enabled: boolean;
  entries: string[];
  chars: number;
  limit: number;
}

export interface LearningView {
  memory: MemoryStoreView;
  user: MemoryStoreView;
  skills: LearnedSkillView[];
  archivedSkills: string[];
  /** Replacements and removals an unattended review proposed; only the person applies them. */
  proposals: { id: string; target: "memory" | "user"; summary: string; createdAt: string; operations: string[] }[];
  reviews: LearningReviewRun[];
  curator: { lastRunAt: string | null; lastRunSummary: string | null; paused: boolean; runCount: number; backups: string[] };
  counters: { turnsSinceMemory: number; itersSinceSkill: number; memoryInterval: number; skillInterval: number };
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
  /** General practices as the selected project may see them (C15). */
  practices: PracticeView[];
  /** What the selected project's Coordinator learned (ADR 0014); null without a project. */
  learning?: LearningView | null;
  /** Projects not selected whose team is still working (C07). */
  backgroundProjects: BackgroundProject[];
  platform: NodeJS.Platform;
  /** The first-run guide's persisted progress (C12). */
  onboarding: import("./onboarding").OnboardingState;
  /** GitHub CLI's login, read on demand for the guide. */
  gitHubCli: import("./onboarding").GitHubCliState;
}

export interface ProviderState {
  account: ProviderAccount | null;
  models: ProviderModel[];
  checking: boolean;
  /** Models the provider refused for this account in this session; the picker shows them disabled. */
  unsupportedModels?: string[];
}

export type AttentionReason = "decision" | "blocked" | "approval" | "running";

/**
 * One project in the overview (UX03), built from records only. `live` comes from the project in
 * memory, `saved` from its last save on disk; `unreadable` and `notSaved` have no data to show.
 */
export interface ProjectOverview {
  id: string;
  name: string;
  path: string;
  isDemo: boolean;
  source: "live" | "saved" | "unreadable" | "notSaved";
  selected: boolean;
  /** The time of the last recorded event, null when unknown. */
  updatedAt: string | null;
  pendingDecisions: number;
  blockedWork: number;
  toApprove: number;
  runningWork: number;
  goals: { id: string; title: string; status: GoalStatus }[];
  attention: AttentionReason | null;
  reasons: string[];
  problem: string | null;
}

export interface BackgroundProject {
  id: string;
  name: string;
  rootPath: string;
  runningAssignments: number;
  pendingDecisions: number;
  lastUpdate: string | null;
}

/** What Trama can do on the project's GitHub repository with the person's gh session (T03). */
export interface GitHubCapabilities {
  status: "ready" | "ghMissing" | "signedOut" | "sso" | "notFound" | "rateLimited" | "error";
  message: string | null;
  login: string | null;
  private: boolean | null;
  canRead: boolean;
  canPush: boolean;
  canAdmin: boolean;
  /** Pull requests, reviews and checks are readable when the repository is. */
  canReadChecks: boolean;
  rateRemaining: number | null;
}


/** A problem in a project that a practice answers (C15). */
export interface PracticeEvidence {
  kind: "regression" | "review" | "failure" | "wait" | "conflict";
  /** Id of the evidence in its source project; never shown to other projects. */
  reference: string;
  summary: string;
}

export interface PracticeVersion {
  version: number;
  method: string;
  rationale: string;
  evidence: PracticeEvidence[];
  createdAt: string;
}

/** A general working method the Coordinator proposes and the person adopts per project (C15). */
export interface Practice {
  id: string;
  title: string;
  status: "proposed" | "adopted" | "retired";
  sourceProjectHash: string;
  versions: PracticeVersion[];
  adoptions: { projectId: string; version: number; adoptedAt: string; retiredAt: string | null; retiredReason: string | null }[];
  createdAt: string;
}

export interface PracticeView {
  id: string;
  title: string;
  status: Practice["status"];
  version: number;
  method: string;
  rationale: string;
  /** Evidence summaries, only for the project the practice came from. */
  evidence: string[];
  fromThisProject: boolean;
  adoptedVersion: number | null;
  retiredHere: { at: string; reason: string | null } | null;
  versions: number;
}
