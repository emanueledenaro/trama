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
  /** The route Ask Trama chose for the person's situation (M07); referenceId is the route. */
  | "route"
  /** The Coordinator points out an overlap with a colleague's work (G03); referenceId is the overlap's id. */
  | "overlap"
  /** The Coordinator's recap at a milestone or on the person's request (A03); referenceId is the recap. */
  | "recap";

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

/** A divergence between the project's branch and the default branch on GitHub, with the files the merge leaves in conflict. */
export interface BranchDivergence {
  /** The branch checked out in the project; null on a detached head. */
  branch: string | null;
  defaultBranch: string;
  headSHA: string;
  remoteSHA: string;
  /** Commits only in the project's branch. */
  ahead: number;
  /** Commits only in the default branch on GitHub. */
  behind: number;
  conflictingFiles: string[];
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
  /** The goal the event belongs to, which the chat filter shows it under (U01); absent or null means the whole project. */
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
  /** The goal the chat was filtered on when the message was sent, fixed when the request is created (UX02, U01). */
  goalId?: string | null;
  /** The one next step the Coordinator declared at the end of the turn (W01). */
  nextStep?: NextStep | null;
  /** The next step this message takes (W04): the person's button, or Trama starting the Coordinator's move by itself. */
  step?: RequestStep | null;
  /** Set when the request repeats a failed one (P10): its id, and the automatic attempt (0 when the person pressed Riprova). */
  retry?: { of: string; attempt: number } | null;
}

/** A next step taken by a message: the person pressed its button, or Trama started the Coordinator's own move (W04). */
export interface RequestStep {
  move: NextMove;
  by: "person" | "trama";
  /** Set when Trama's automatic turn ended without making the move: why, in the person's words (issue #204). */
  stalled?: string | null;
  /** What started Trama's automatic move (A05): the event of the work, or the periodic round; absent on older records. */
  trigger?: WorkEvent;
  /**
   * The technical block the automatic move resolves (A06): its kind, the reason for the Coordinator and for the person,
   * and the outcome Trama read when the turn ended; absent on a move that resolves no block.
   */
  block?: {
    kind: TechnicalBlock;
    blocker: string;
    why: string;
    outcome?: { resolved: boolean; detail: string; at: string } | null;
  } | null;
}

/**
 * What makes Trama weigh the Coordinator's next move (A05): a Coordinator turn, a plan or an assignment that ended, a red
 * check, a conflict between worktrees, a new issue, a commented pull request, or the periodic round.
 */
export type WorkEvent =
  | "turnEnded"
  | "planEnded"
  | "assignmentEnded"
  | "checkFailed"
  | "worktreeConflict"
  | "issueOpened"
  | "pullRequestCommented"
  | "round";

/** A round of the Coordinator that did something (A05): what it started or unblocked, for Activity. */
export interface RoundRecord {
  id: string;
  at: string;
  /** What the round did, in the person's words: "Avviata la mossa Assegna le fette", "Luca prende la fetta S3". */
  detail: string;
  /** The automatic move the round started, when it started one. */
  requestId: string | null;
}

/**
 * Continuous work of the project (A05): the person's Pause and the rounds that did something. Absent until the person
 * first pauses or a round first acts; absent means not paused.
 */
export interface ContinuousWorkRecord {
  paused: boolean;
  /** When the person last paused or resumed; null before the first time. */
  changedAt: string | null;
  /** The latest rounds with an outcome, oldest first, capped. */
  rounds: RoundRecord[];
}

/** What made the Coordinator write a recap (A03): one or more milestones, or the person's request. */
export type RecapReason = "milestone" | "request";

/** A milestone of the work (A03): a slice done, a candidate merged, a goal achieved. */
export type MilestoneKind = "sliceDone" | "candidateMerged" | "goalAchieved";

/** One line of "Cosa ho fatto": a fact from the records, with the issue or pull request it names, if any. */
export interface RecapFact {
  text: string;
  /** The number of the issue or pull request the line names, so the card can link it. */
  number: number | null;
  url: string | null;
}

/** One line of "Cosa mi serve da te": an item of "Aspetta te" as it was when the recap was written. */
export interface RecapNeed {
  /** The item's key in "Aspetta te", so the card opens it there while it still waits. */
  key: string;
  label: string;
  title: string;
}

/**
 * The Coordinator's recap (A03): what it did, what it does, what it needs from the person. Trama writes it from the
 * records (Activity, the state of the work, "Aspetta te"), never from a model's text, and keeps it as written.
 */
export interface RecapRecord {
  id: string;
  at: string;
  reason: RecapReason;
  /** The milestones the recap is about, in the person's words; empty for a recap the person asked for. */
  milestones: string[];
  done: RecapFact[];
  /** The status line when the recap was written. */
  doing: string;
  needs: RecapNeed[];
}

/** The recaps of a project and the milestones already told (A03). Absent until Trama first reads the milestones. */
export interface RecapLedger {
  /** The milestone keys already told in a recap, or already reached when Trama first read them. */
  told: string[];
  /** The recaps, oldest first, capped. */
  recaps: RecapRecord[];
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
  /** Why the work cannot go on, in the person's words; set only in the blocked phase. */
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

/** A button of the status line: the move that takes the work on, and the request and dialog it acts on. */
export interface StatusLineAction extends NextStepView {
  /** The request whose declared step the button takes; null when the move was not declared, so the button opens its card. */
  requestId: string | null;
  goalId: string | null;
}

/**
 * The Coordinator's status line (Q6): what it does now and what comes next, as in "Sto verificando S2, poi assegno S3".
 * Trama computes it from the records (the move that runs, the next move, the ready slices), never from a model's text.
 */
export interface StatusLineView {
  /**
   * working: something runs; next: nothing runs and the next move is the Coordinator's own; waiting: the work waits for
   * the person; blocked: the work is held; idle: nothing is going on.
   */
  state: "working" | "next" | "waiting" | "blocked" | "idle";
  /** The line itself, in the first person; "Niente in corso." when nothing is going on. */
  text: string;
  /** Why the work is held and what unblocks it, in the person's words; null while it goes on. */
  reason: string | null;
  /** The person's move, the line's primary button; null when none. */
  action: StatusLineAction | null;
  /** The automatic move that runs now, which the line's stop button stops; null when none. */
  runningMove: { requestId: string; label: string } | null;
  /** The person paused continuous work (A05): no automatic move, round or automatic work starts until Riprendi. */
  paused: boolean;
  /**
   * The provider limit the Coordinator waits for (issue #249): no move, round or new turn starts until it ends, then the
   * work resumes by itself. `until` is the end the provider gave, ISO, or null when it did not say. Null when none.
   */
  providerWait: { provider: string; until: string | null } | null;
}

/** A move that takes the work on: the first nine are the person's, the last four the Coordinator's (W01, W06). */
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
  | "verifyCandidate"
  | "answerQuestion";

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
  /** Set when the person narrowed the mandate before this version without revoking it (issue #244). */
  restriction?: { removedModuleIds: string[]; removedActions: MandateAction[] } | null;
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
   * The project mandate for the whole cycle (issue #244): Trama asks for it on the Coordinator's behalf when a project
   * opens without a mandate. Absent on the requests the Coordinator asks with request_mandate.
   */
  projectCycle?: boolean;
  /**
   * Null while the request waits for the person. "superseded" means a newer request replaced it before the
   * person answered (W14): it can no longer be granted and names the newer one in `supersededBy`. "rejected" means
   * the person turned the proposal down and the mandate in force stayed as it was; "revoked" is kept for requests
   * answered before that, when declining a proposal also revoked the mandate.
   */
  resolution: {
    kind: "granted" | "corrected" | "rejected" | "revoked" | "superseded";
    version: number | null;
    resolvedAt: string;
    supersededBy?: string | null;
  } | null;
}

/**
 * An action a fixed ban stopped before it started (issue #244): who tried it, the command or the file, and whether the
 * person has seen it. It waits in "Aspetta te" until the person acknowledges it.
 */
export interface FixedBanRefusal {
  id: string;
  ban: import("./fixedBans").FixedBan;
  /** The command, the file or the branch the action named. */
  action: string;
  by: { kind: "coordinator" } | { kind: "specialist"; specialistId: string; assignmentId: string } | { kind: "trama" };
  refusedAt: string;
  acknowledgedAt: string | null;
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
  /** Set when the card answers a developer's question (W06): it blocks that work until the person answers. */
  blocksWork?: { assignmentId: string; questionId: string } | null;
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
  /** `transcript` false: the new session starts without the conversation (an Ask Trama "/clear", M07). */
  pendingHandover?: { from: ProviderId; reason: string; transcript?: boolean } | null;
  injectedStudy: Partial<Record<StudyPart, string>>;
  memory: CoordinatorMemory;
  study: ProjectStudy | null;
  memorySentToThread: string | null;
  /** Fingerprint of the adopted practices last sent to the thread. */
  practicesSent?: string | null;
  /** The listing of Trama's references last sent to the thread (issue #277). */
  referencesSent?: string | null;
  /** The late rules (writing, grilling) the thread holds: a thread opened before they changed receives them in a turn. */
  rulesSent?: string | null;
  /** Percent of the context window above which the chat shows a notice (5-95). */
  contextThreshold?: number;
  /** The threshold the last notice was given for; cleared by a compaction or a new thread. */
  contextWarnedAt?: number | null;
  /** The learning loop (ADR 0014); absent in documents written before it. */
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
/** `paused`: the developer asked the Coordinator a question (W06) and waits for the answer; its slice is on hold. */
export type AssignmentStatus = "preparing" | "running" | "stopRequested" | "stopped" | "completed" | "failed" | "paused";

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
  /** The commit type and scope the Coordinator chose for the work, and whether it is a hotfix (Q01); absent means derived. */
  commit?: AssignmentCommit | null;
  /**
   * The seams to test in the contract of the assignment (W05). For a slice, the seams the person confirmed in the
   * spec, with their number there. Absent in assignments made before the contract, and in a fixed role's work.
   */
  seams?: ContractSeam[];
  /** The developer's structured report (W05), read from its last answer: its statement, never evidence. */
  report?: DeveloperReport | null;
  /** Set when the developer took the slice by itself, within the mandate, instead of the Coordinator assigning it (W08). */
  selfPicked?: boolean;
  /** The questions the developer asked the Coordinator during the work (W06), oldest first. */
  questions?: DeveloperQuestion[];
  /** The candidate gate sent the work back with blocking findings (W10); the latest return, absent before any. */
  gateReturn?: { gateId: string; candidateId: string; findings: string[]; at: string } | null;
}

/**
 * A question a developer asked the Coordinator with its tool (W06). The work pauses when the developer's turn ends
 * and resumes in the same session with the answer: the Coordinator's, from facts, or the person's, when the
 * Coordinator put it on a Pact card that blocks the work.
 */
export interface DeveloperQuestion {
  id: string;
  question: string;
  /** What the developer needs the answer for, in its words. */
  context: string | null;
  askedAt: string;
  answer: DeveloperAnswer | null;
  /** When Trama resumed the work with the answer; null while it waits. */
  resumedAt: string | null;
}

export type DeveloperAnswer =
  /** The Coordinator answered from facts it names: files, Pact decisions, issues, the spec. */
  | { kind: "facts"; text: string; sources: string[]; answeredAt: string }
  /**
   * The answer is the person's: a Pact card that blocks the work (`decisionRequestId`). `text` and `answeredAt`
   * are set when the person answers or withdraws the card.
   */
  | { kind: "person"; decisionRequestId: string; since: string; text: string | null; answeredAt: string | null };

/** Where a developer's question stands: waiting for the Coordinator, for the person on a Pact card, or answered. */
export type DeveloperQuestionState = "asked" | "waitingForPerson" | "answered";

export function developerQuestionState(question: Pick<DeveloperQuestion, "answer">): DeveloperQuestionState {
  if (!question.answer) return "asked";
  if (question.answer.kind === "person" && !question.answer.answeredAt) return "waitingForPerson";
  return "answered";
}

/** The Coordinator's correction of what Trama derives for the work's commit and branch (Q01). */
export interface AssignmentCommit {
  type: string | null;
  /** Null lets Trama derive the scope; an empty string asks for no scope. */
  scope: string | null;
  hotfix: boolean;
}

/**
 * The rules a project declares for what Trama writes in its repository (Q01): Conventional Commits 1.0.0 and
 * Conventional Branch names unless AGENTS.md, CONTRIBUTING.md, commitlint or its branches say otherwise.
 */
export interface CommitConventions {
  /** Where the rules come from, for example `AGENTS.md` or `.commitlintrc.json`; empty for the defaults. */
  sources: string[];
  types: string[];
  /** The scopes commitlint allows; null when any scope is allowed. */
  scopes: string[] | null;
  headerMaxLength: number;
  /** Conventional Branch types (feature, bugfix, hotfix, release, chore) or the project's own prefixes for them. */
  branchPrefixes: { feature: string; bugfix: string; hotfix: string; release: string; chore: string };
}

/** The commit Trama will write for a candidate (Q01), derived from the work and correctable by the Coordinator. */
export interface CandidateCommit {
  type: string;
  scope: string | null;
  description: string;
  /** The description of an incompatible change; null when the change is compatible. */
  breaking: string | null;
  message: string;
  conventions: CommitConventions;
  correctedBy: "coordinator" | null;
}

/** One condition of the quality standard a candidate meets before Trama publishes it (Q01). */
export interface QualityItem {
  code: "VERIFIED" | "COMMIT_MESSAGE" | "NO_SECRETS" | "DIFF_CHECK" | "ISSUE_LINKED" | "PACT_SETTLED" | "MANDATE";
  passed: boolean;
  /** What Trama found, in the person's words. */
  detail: string;
  /** How to fix it; null when the condition holds. */
  fix: string | null;
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
  /** The rules of Trama's Clean Code standard the developer set aside, and why (Q03). Absent in reports before Q03. */
  exceptions?: string[] | null;
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
  /** Who asked Trama to start it now, outside its rule (issue #231); absent when Trama's rule started it. */
  requestedBy?: "person" | "coordinator";
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

/** An issue Trama saw for the first time after it started watching the project. */
export interface NewIssue {
  number: number;
  seenAt: string;
  /** Why the issue no longer goes to triage; null while it is still new. Once set it stays, also after a reopening. */
  dropped: string | null;
}

/** The fixed roles' automatic work, as the person and the Coordinator see it (issue #231). */
export type AutomaticWorkKind = "triage" | "diagnosis" | "architectureReview" | "domainWriting";

/** The automatic work the person or the Coordinator may start now, outside Trama's rule. */
export type AutomaticWorkRequest = { kind: "architectureReview" } | { kind: "triage"; issueNumber: number };

export interface AutomaticWorkStatus {
  kind: AutomaticWorkKind;
  role: TeamRole;
  /** running: at work now; due: starts at Trama's next look; waiting: has work but something holds it; idle: nothing to do. */
  state: "running" | "due" | "waiting" | "idle";
  /** The assignment at work, while running. */
  assignmentId: string | null;
  /** In the person's words: what it does, when it starts and why it has not started yet. */
  detail: string;
  /** Whether the person or the Coordinator may start it now on request; null for work that only Trama's rule starts. */
  onRequest: { allowed: true } | { allowed: false; reason: string } | null;
}

/** Trama's own bookkeeping for the fixed roles' automatic work (W11). */
export interface DutyLedger {
  /** The highest issue number when Trama first read the project's issues: only issues above it are new. */
  issueBaseline: number | null;
  /**
   * Each issue above the baseline as Trama first read it, and why it stopped counting as new (issue #231): closed,
   * already evaluated, already in work or with a linked pull request. Absent in ledgers written before it.
   */
  newIssues?: NewIssue[];
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
  /** What the reviewer found against Trama's Clean Code standard (Q03): its judgement, never evidence. */
  findings?: import("./cleanCode").ReviewFinding[];
  /** Trama's own measures of the candidate against the standard (Q03): the only evidence of the review. */
  standard?: StandardCheck | null;
  /** The candidate gate this review closes (W10): the verdict is the gate's; absent in reviews before it. */
  gateId?: string;
}

/** The deterministic part of a technical review (Q03): the standard's version, the rules on and what Trama measured. */
export interface StandardCheck {
  version: number;
  rules: import("./cleanCode").CleanCodeRuleId[];
  filesMeasured: number;
  functionsMeasured: number;
  /** The measures past their limit. */
  measures: import("./cleanCode").CodeMeasure[];
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
  /** The commit Trama will write (Q01); absent in candidates declared before it. */
  commit?: CandidateCommit;
  /** What `git diff --check` reported on the candidate's snapshot (Q01); absent in candidates declared before it. */
  whitespaceErrors?: string[];
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

/** "superseded": newer work replaced the candidate (U02); it is not merged and does not collide with anyone. */
export type CandidateState = "building" | "verified" | "decided" | "superseded";

export interface CandidateBlocker {
  code: string;
  detail: string;
}

export interface CandidateReport {
  state: CandidateState;
  blockers: CandidateBlocker[];
  clearanceInvalidated: boolean;
  approvalInvalidated: boolean;
  /** The quality standard before publishing (Q01); absent where the report is computed without the project. */
  quality?: QualityItem[];
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
   * superseded: a newer plan of the same goal replaced it; one goal has one active plan (U01).
   */
  status: "planning" | "seams" | "ready" | "failed" | "stale" | "superseded";
  /** The plan that replaced this one; set only when the status is superseded. */
  supersededBy?: string | null;
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
  /** Set when the Coordinator confirmed the seams by itself within the mandate (A06); absent when the person answered. */
  by?: "coordinator";
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
  /** Set when the Coordinator approved the breakdown by itself within the mandate (A06); absent when the person did. */
  approvedBy?: "coordinator" | null;
  failure: string | null;
  /** Why the publication on GitHub did not fully succeed. */
  publishFailure: string | null;
}

/** Where a slice of an approved breakdown stands, computed by Trama from its assignments and candidates (M05). */
export type SliceState = "blocked" | "ready" | "working" | "paused" | "verifying" | "done";

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

/** The composer's selection and draft of the chat (ADR 0010). */
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
  /** Pact decisions the person or a turn about the goal linked to this goal. */
  decisionIds: string[];
  /**
   * The composer of the goal dialog, written before the single chat (U01). Loading a document folds its draft
   * into the chat's composer and removes it; new goals never have it.
   */
  dialog?: DialogComposer;
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
  /** Actions the fixed bans stopped (issue #244); absent in documents written before. */
  fixedBanRefusals?: FixedBanRefusal[];
  decisionRequests: DecisionRequest[];
  coordinator: CoordinatorState;
  /** The composer's selection for the project's one chat (ADR 0010, U01). Absent provider means Codex. */
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
  /**
   * The project's branch and the default branch on GitHub went different ways with files in conflict (U02): one notice
   * for the project, instead of the same conflict on every candidate. Null or absent while they are aligned.
   */
  branchDivergence?: BranchDivergence | null;
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
  /** Routes the Coordinator proposed with the ask-trama skill (M07); absent before the first one. */
  routes?: import("./askTrama").AskTramaRoute[];
  /** The overlaps the Coordinator already pointed out in the chat (G03), so each one is said once. */
  overlapNotices?: string[];
  /** The person's settings for this project; absent until they first change one. */
  settings?: ProjectSettings;
  /** How the project adapts Trama's Clean Code standard (Q03); absent means every rule is on. */
  cleanCode?: import("./cleanCode").CleanCodeSettings;
  /** Focus mode examinations (F01); absent until the person first opens focus mode. */
  audits?: FocusAudit[];
  /** The candidate gates (W10); absent until the first candidate is reviewed. */
  gates?: CandidateGate[];
  /** The Pause and the rounds of continuous work (A05); absent until the first pause or round with an outcome. */
  continuousWork?: ContinuousWorkRecord;
  /** The Coordinator's recaps and the milestones already told (A03); absent until Trama first reads the milestones. */
  recap?: RecapLedger;
  /** The person's steps the Coordinator took by itself within the mandate (A06); absent until the first one. */
  autonomousSteps?: AutonomousStep[];
  /** The problems found outside the work in progress and their issues (A08); absent until Trama first looks for them. */
  problems?: ProblemLedger;
  /** The conversations between agents (W07), oldest first; absent before the first one. */
  agentThreads?: AgentThread[];
}

/**
 * What a conversation between agents is about (W07): a developer's question to the Coordinator, the technical review
 * of the developer's candidate, or a regression the guardian found on it.
 */
export type AgentThreadKind = "question" | "review" | "regression";

/** Who wrote a message in a conversation between agents: a member of the team, the Coordinator, or the person on a Pact card. */
export type AgentThreadAuthor = { kind: "specialist"; specialistId: string } | { kind: "coordinator" } | { kind: "person" };

export interface AgentThreadMessage {
  id: string;
  author: AgentThreadAuthor;
  text: string;
  at: string;
}

/**
 * A conversation between agents (W07): always visible and recorded, never private. One per kind and assignment; the
 * person reads it from the specialist's page and talks only with the Coordinator (Q32 of #239).
 */
export interface AgentThread {
  id: string;
  kind: AgentThreadKind;
  /** The developer's work the conversation is about. */
  assignmentId: string;
  /** The members of the team in the conversation, the developer first; the Coordinator is not a member. */
  specialistIds: string[];
  /** Whether the Coordinator takes part, as in a developer's question. */
  withCoordinator: boolean;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentThreadMessage[];
}

/** The proof a found problem refers to (A08): a red check or a reviewer's finding. */
export interface ProblemEvidence {
  kind: "check" | "finding";
  /** The record it names: the check failure or the gate. */
  reference: string;
  /** The proof in the person's words, for the issue and for Activity. */
  label: string;
}

/**
 * A problem Trama found outside the work in progress (A08, Q10): a check red on the checkout or on a candidate's base
 * too, or a reviewer's finding on a file the candidate did not change. The Coordinator opens one issue for it, or links
 * the open one about the same problem, has it triaged and assigns it or puts it in the backlog. Without GitHub it stays
 * in Trama as a backlog item.
 */
export interface FoundProblem {
  id: string;
  /** The same problem has the same key, whatever found it: `check:<check>`, `finding:<role>:<file>:<title>`. */
  key: string;
  title: string;
  /** What Trama saw, in Markdown, for the issue body. */
  detail: string;
  evidence: ProblemEvidence;
  foundAt: string;
  /** The issue of the problem; `opened` false when an open issue about the same problem was already there. */
  issue: { number: number; url: string; at: string; opened: boolean } | null;
  /** Why the issue could not be opened the last time Trama tried; null otherwise. */
  issueFailure: { message: string; at: string } | null;
  /** The triage labels Trama applied to the issue after the triage, once. */
  labelsApplied: string[] | null;
  /** Where the problem went after the triage: an assignment that works on it, or the backlog. */
  placement: ProblemPlacement | null;
}

export type ProblemPlacement =
  | { kind: "assignment"; assignmentId: string; at: string; reason: string }
  | { kind: "backlog"; at: string; reason: string };

/** Trama's bookkeeping of found problems (A08). */
export interface ProblemLedger {
  /** When Trama started looking: records older than this are not new problems. */
  since: string;
  /** The records already read, as `failure:<id>` or `gate:<id>:<check or finding>`, so each is read once. */
  seen: string[];
  items: FoundProblem[];
}

/** The person's steps the project mandate lets the Coordinator take by itself (A06, Q1). */
export type DelegableMove = "confirmUnderstanding" | "confirmTeam" | "confirmSeams" | "confirmSlices";

/**
 * A step of the person the Coordinator took by itself within the mandate (A06): the understanding, the team, the seams
 * or the slices it confirmed. It is told in Activity and in the recap, and the person can correct it in their own words:
 * the correction is kept here and the work starts again from that step.
 */
export interface AutonomousStep {
  id: string;
  move: DelegableMove;
  /** The request of the dialog the step belongs to; null for the team, which is the project's. */
  requestId: string | null;
  goalId: string | null;
  /** The record the step confirmed: the plan of the seams or the slices, the team proposal; null for the understanding. */
  targetId: string | null;
  /** What was confirmed, in the person's words. */
  summary: string;
  at: string;
  /** The person's correction, once they gave one. */
  correction: { note: string; at: string } | null;
}

/** A technical block the Coordinator resolves by itself within the mandate (A06, Q3). */
export type TechnicalBlock = "checkFailed" | "worktreeConflict" | "stalledAssignment";

export interface ProjectSettings {
  /** Developers at work at the same time (W08); absent means three. */
  parallelDevelopers?: number;
}

/** "verifying": both axes ended and Trama rechecks the proof of each finding (F02). */
export type AuditStatus = "checking" | "reviewing" | "verifying" | "done" | "failed";

/** The proof a finding carries (F02, spec #124 step 4): a line of a file, a command that fails, or a reproduction. */
export type FindingEvidence =
  | { kind: "fileLine"; file: string; line: number; quote: string }
  | { kind: "command"; command: string }
  | { kind: "reproduction"; steps: string };

/**
 * "verified": Trama rechecked the proof itself and it holds. "confirmed": Trama could not run the proof and a
 * stronger model confirmed the serious finding. "hypothesis": everything else, shown as such. "pending": not
 * rechecked yet, never shown as verified.
 */
export type FindingStatus = "pending" | "verified" | "confirmed" | "hypothesis";

/** One finding of an axis with its proof and how Trama verified it (F02). */
export interface AuditFinding {
  /** The axis and the position, as `standards-1`. */
  id: string;
  title: string;
  severity: "serious" | "minor";
  /** Null when the axis gave no proof: the finding stays a hypothesis. */
  evidence: FindingEvidence | null;
  status: FindingStatus;
  /** Why the finding has its status, in Italian: what Trama checked, or what the second model said. */
  basis: string | null;
  /** What Trama read when it rechecked the proof: the quoted line, or the tail of a failed check. */
  observed: string | null;
  /** The stronger model's answer for a serious finding Trama could not recheck. */
  confirmation: { model: string; confirmed: boolean; reason: string; at: string } | null;
}

/**
 * Trama's own lenses of focus mode (F05, issue #129): security, test quality and agreement between documents and code.
 * They are not in AI Hero's skills: Trama adds them next to the two axes of code-review, each as a read-only session
 * whose findings go through the same verification as the axes' (F02).
 */
export type LensName = "security" | "tests" | "docs";

/** One axis of AI Hero's code-review skill, or one of Trama's lenses, run as a read-only session of its own (F01, F05). */
export interface AuditAxis {
  /** "skipped": the skill skips the Spec sub-agent when there is no spec. */
  status: "waiting" | "running" | "done" | "skipped" | "failed";
  /** The sub-agent's report in Markdown, as it wrote it; the skill's "no spec available" when skipped. */
  report: string | null;
  findings: number | null;
  /** The worst finding within this axis, in one line; null when there is none. */
  worst: string | null;
  /** Each finding with its proof and verification (F02); absent in reports written before it. */
  items?: AuditFinding[];
  threadId: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failure: string | null;
}

/**
 * Focus mode on one target (F01, spec #124): Trama runs the real checks in the sandbox, then the two axes of
 * code-review in parallel and read-only. The checks are evidence; the axes' findings are the model's judgement,
 * each with a proof that Trama verifies (F02).
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
  /** Trama's lenses (F05), run next to the axes; absent in reports written before them. */
  lenses?: Record<LensName, AuditAxis>;
  /** The skill's closing line, per axis: total findings and the worst one within each axis. */
  summary: string | null;
  failure: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** The figures of the team that review a candidate at its moment (W10, spec #137 Q10). */
export type GateRole = "specReviewer" | "cleanCode" | "regressionGuardian" | "security" | "performance" | "ux" | "devops" | "documentation";

/** A reviewer's finding on the diff: its judgement, never evidence. A blocking one sends the work back to the developer. */
export interface GateFinding {
  severity: "blocking" | "advisory";
  title: string;
  detail: string;
  /** The file it is about, with the line when known; null when it is about the whole diff. */
  file: string | null;
}

/** One figure of the gate, reviewing the diff in a session of its own. */
export interface GateReview {
  role: GateRole;
  /** "skipped": the spec reviewer has no spec, as code-review says. */
  status: "waiting" | "running" | "done" | "skipped" | "failed";
  findings: GateFinding[];
  /** The report in Markdown; "Niente da segnalare." when the figure found nothing. */
  report: string | null;
  threadId: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failure: string | null;
}

/** One check of the suite, run by Trama on the candidate's base and on the candidate (W10). */
export interface SuiteComparison {
  check: string;
  base: "pass" | "fail" | "notRun";
  candidate: "pass" | "fail" | "notRun";
  /** The base's output, kept when the check failed or did not run there. */
  baseOutput: string | null;
}

/**
 * The candidate gate (W10): before a candidate reaches the person, Trama's real checks, then every candidate reviewer
 * of the team in parallel on the diff. A regression or a blocking finding stops the candidate and sends the work back
 * to its developer.
 */
export interface CandidateGate {
  id: string;
  candidateId: string;
  assignmentId: string;
  snapshotId: string;
  baseSHA: string;
  status: "checking" | "reviewing" | "passed" | "blocked" | "failed";
  /** Required checks that did not pass: the reviewers do not start and the debugger takes the failure (W11). */
  checksFailed: string[];
  suite: SuiteComparison[];
  reviews: GateReview[];
  /** The work went back to its developer with the blocking findings; `waiting` says why it has not resumed yet. */
  returned: { assignmentId: string; at: string; waiting: string | null } | null;
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
  /** The issues the pull request names in its title, body or branch (#12, Closes #12, issue-12-...). */
  linkedIssues?: number[];
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

/** The issues a pull request names, open or not (issue #231). */
export interface PullRequestLink {
  number: number;
  linkedIssues: number[];
}

export interface GitHubState {
  repository: string | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  message: string | null;
  issues: GitHubIssue[];
  /** The pull requests of every state that GitHub listed with the issues, and the issues they name; absent before the first reading. */
  pullRequestLinks?: PullRequestLink[];
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
  /**
   * What waits for the person, ordered (issue #292): the one list the summary, the sidebar counter and the next step
   * read, computed by the main process; absent before the first computation.
   */
  waiting?: import("./waitingForYou").WaitingItem[];
  /** The Coordinator's status line (Q6), computed by the main process; absent before the first computation. */
  statusLine?: StatusLineView | null;
  /** The AI Hero skills Trama copies are present in the project. */
  aiHeroPrepared?: boolean;
  /** Who works on what (G01), computed by the main process; absent until the first reading and in the example project. */
  presence?: import("./presence").PresenceView | null;
  /** The person's work against the colleagues' presence (G03); absent without a presence reading. */
  overlaps?: import("./overlap").OverlapView | null;
  /** Where each fixed role's automatic work stands (issue #231), computed by the main process. */
  automaticWork?: AutomaticWorkStatus[];
  /** The automatic retry after a temporary provider limit, while it waits (P10). */
  providerRetry?: import("./providerFailure").ProviderRetryView | null;
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
  /** The interface language the person chose (issue #301). Missing: the system's language. */
  language?: import("./i18n").Language;
  sidebarWidth: number;
  /** Prepare the AI Hero method when a project without it opens (T04). On unless the person turns it off. */
  autoPrepareMethod?: boolean;
  /** A sound with useful alerts only (conflicts, blocked providers, finished work). Off by default. */
  sounds?: boolean;
  /** Continuous work (W04): Trama starts the Coordinator's own moves within the mandate. On unless the person turns it off. */
  continuousWork?: boolean;
  /** What the learning loop may do (ADR 0014); missing keys take the defaults. */
  learning?: Partial<LearningSettings>;
  /**
   * The model the person last chose for the Coordinator, per provider (issue #205). A project without a choice of its
   * own starts from it; without it, the provider's catalogue decides the default.
   */
  coordinatorModels?: Partial<Record<ProviderId, { model: string; effort: string | null }>>;
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
  /** The language Trama speaks: the person's choice, else the system's (issue #301). */
  language: import("./i18n").Language;
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
  /** Colleagues seen working on the repository (G01), from the live presence reading; null when not read. */
  colleagues: number | null;
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
