import type { ProviderId } from "./codex";
import type { AgentColor, AppSettings, AutomaticWorkRequest, DecisionAlternative, GoalStatus, MandateAction, ProjectOverview } from "./domain";
import type { ExerciseId, GuideStepId, ObservedStep } from "./onboarding";

export interface GoalExampleInputPayload {
  /** Present when the example already exists and is being edited. */
  id?: string | null;
  kind: "accepted" | "refused";
  text: string;
}

export interface GoalInputPayload {
  title: string;
  outcome: string;
  examples: GoalExampleInputPayload[];
}

/** Every action the renderer can ask the main process to perform. */
export interface ActionMap {
  "project:openDialog": [void, void];
  "project:open": [{ path: string }, void];
  "project:openDemo": [void, void];
  "project:create": [{ name: string; idea: string }, void];
  /** Clones a GitHub repository (`owner/name` or its URL) into a folder the person chooses, then opens it (B02). */
  "project:clone": [{ repository: string }, void];
  "project:close": [void, void];
  "project:refresh": [void, void];
  "project:forgetRecent": [{ id: string }, void];
  "project:revealInFolder": [{ relativePath?: string }, void];
  "project:readFile": [{ relativePath: string }, string];
  "coordinator:send": [
    {
      text: string;
      moduleId: string | null;
      model: string | null;
      effort: string | null;
      images?: ImageAttachmentInput[];
      /** The composer's provider; a different one moves the Coordinator (ADR 0009). */
      provider?: ProviderId | null;
      /** The goal the chat was filtered on when the message was sent (U01); absent or null is the whole project. */
      goalId?: string | null;
    },
    void,
  ];
  /** Takes the next step shown under a reply when it is a message to the Coordinator; Trama records the step (W04). */
  "coordinator:takeStep": [{ requestId: string }, void];
  "coordinator:interrupt": [void, void];
  /** Pauses or resumes the project's continuous work (A05): the Pause stops automatic moves, rounds and automatic work. */
  "coordinator:pause": [{ paused: boolean }, void];
  /** The person asks the Coordinator for a recap (A03): Trama writes it in the chat from the records. */
  "coordinator:recap": [{ goalId?: string | null }, void];
  "coordinator:retry": [void, void];
  /** Repeats a failed turn without writing the message again (P10). */
  "coordinator:retryRequest": [{ requestId: string }, void];
  /** Stops the automatic retries after a temporary provider limit (P10). */
  "coordinator:stopRetry": [void, void];
  "coordinator:selectModel": [{ model: string; effort: string | null; provider?: ProviderId | null }, void];
  "coordinator:setFastMode": [{ enabled: boolean }, void];
  "coordinator:selectProvider": [{ provider: ProviderId }, void];
  "coordinator:saveDraft": [{ text: string; projectId?: string | null }, void];
  /** Deletes a message still waiting in the queue (W03); a message that reports a recorded choice stays. */
  "coordinator:deleteQueued": [{ id: string }, void];
  "goal:create": [GoalInputPayload, string];
  /** Archives (true) or restores (false) a goal; its status and history stay (W03). Returns the goal id once saved. */
  "goal:archive": [{ id: string; archived: boolean }, string];
  /** Deletes a goal whose dialog is empty (W03). */
  "goal:delete": [{ id: string }, void];
  "goal:update": [
    { id: string; title?: string; outcome?: string; examples?: GoalExampleInputPayload[]; status?: GoalStatus; decisionIds?: string[] },
    /** The goal id, returned once the change is saved. */
    string,
  ];
  /** Puts a task in focus, on pause, or back in the queue from the pause (W02). */
  "focus:change": [{ action: "focus" | "pause" | "resume"; taskId: string }, void];
  "candidate:observeExample": [{ candidateId: string; exampleId: string; observed: boolean; snapshotId: string }, void];
  "overview:read": [void, ProjectOverview[]];
  "overview:prioritize": [{ projectId: string; direction: "up" | "down" }, void];
  "coordinator:setContextThreshold": [{ percent: number }, void];
  "coordinator:reorderContext": [void, void];
  "pact:decide": [{ id: string | null; value: string; acceptedExample: string; rationale: string }, void];
  "decision:answer": [{ requestId: string; alternativeIndex: number | null; freeText: string | null }, void];
  /** Withdraws an open question with a reason; the Coordinator reads it as the person's message (W03). */
  "decision:withdraw": [{ requestId: string; reason: string }, void];
  "mandate:grant": [
    {
      requestId: string | null;
      objectives: string[];
      priorities: string[];
      scopeModuleIds: string[];
      authorizedActions: MandateAction[];
      limits: string[];
    },
    void,
  ];
  "mandate:revoke": [{ reason: string }, void];
  /** Narrows the mandate in force without revoking it: fewer modules or actions, never more (issue #244). */
  "mandate:restrict": [{ scopeModuleIds: string[]; authorizedActions: MandateAction[] }, void];
  /** The person has seen an action a fixed ban stopped; it leaves Aspetta te (issue #244). */
  "fixedBan:acknowledge": [{ id: string }, void];
  /** The person confirms or declines an action they asked for that deletes something or cannot be undone (issue #422). */
  "requestedAction:confirm": [{ id: string }, void];
  "requestedAction:decline": [{ id: string }, void];
  /** The person withdraws the full delegation from the Mandate view, or has seen a choice made with it (issue #423). */
  "delegation:revoke": [void, void];
  "delegation:seen": [{ id: string }, void];
  "mandate:reject": [{ requestId: string; reason: string }, void];
  /** The person corrects a step the Coordinator took by itself within the mandate, in their own words (A06). */
  "autonomousStep:correct": [{ stepId: string; note: string }, boolean];
  "team:answer": [{ proposalId: string; keeping: string[] | null; note: string | null }, void];
  "assignment:stop": [{ assignmentId: string }, void];
  "assignment:resume": [{ assignmentId: string }, void];
  "assignment:place": [{ assignmentId: string; where: import("./domain").WorkPlace }, void];
  "assignment:cloudCheck": [{ assignmentId: string }, void];
  "assignment:removeWorktree": [{ assignmentId: string }, void];
  "assignment:changeProvider": [{ assignmentId: string; provider: ProviderId; model: string }, void];
  "specialist:remove": [{ specialistId: string; reason: string }, void];
  "backlog:move": [{ squadId: string | null; key: string; to: "up" | "down" }, void];
  "backlog:release": [{ squadId: string | null; key: string }, void];
  /** The person renames, merges or splits a squad, or undoes such a change (A11). */
  "squad:rename": [{ squadId: string; name: string }, boolean];
  "squad:merge": [{ intoId: string; fromId: string; keepIds: string[] | null }, boolean];
  "squad:split": [{ squadId: string; moduleIds: string[]; developerIds: string[]; name: string }, boolean];
  "squad:undo": [{ changeId: string }, boolean];
  /** The person confirms the merge they asked the Coordinator for, with who stays, or sets it aside (A11). */
  "squad:confirmMerge": [{ proposalId: string; keepIds: string[] }, boolean];
  "squad:dismissMerge": [{ proposalId: string }, void];
  "specialist:rename": [{ specialistId: string; name: string }, void];
  "specialist:setColor": [{ specialistId: string; color: AgentColor }, void];
  /** The person starts a fixed role's automatic work now (issue #231). */
  "automaticWork:start": [AutomaticWorkRequest, void];
  "plan:cancel": [{ planId: string }, void];
  /** A plan written as a spec is corrected by its sections (M04); a plan written before M04 by its steps. */
  "plan:edit": [
    { planId: string; sections: import("./domain").SpecSections } | { planId: string; steps: string[]; proposedBehavior: string; acceptedExample: string },
    void,
  ];
  /** The person's answer to the seam check of a spec: confirmed, or corrected in their own words (M04). */
  "plan:answerSeams": [{ planId: string; confirmed: boolean; note: string | null }, void];
  /** The person's answer to the breakdown to-tickets proposed: approved, or corrected in their own words (M05). */
  "plan:answerSlices": [{ planId: string; confirmed: boolean; note: string | null }, void];
  /** Asks again for the slices of a ready spec, after a failed round or for a plan written before M05. */
  "plan:slice": [{ planId: string }, void];
  /** Publishes on GitHub the approved slices still only in Trama (M05). */
  "plan:publishSlices": [{ planId: string }, void];
  /** Publishes a written spec on GitHub, when it stayed in Trama or its publication failed (M04). */
  "plan:publish": [{ planId: string }, void];
  "pactDemo:run": [void, void];
  "pactDemo:approve": [void, void];
  /** The person's ok on a candidate; on an interface candidate with the green light Trama then merges it (issue #247). */
  "candidate:approve": [{ candidateId: string }, void];
  /** The person refuses an interface candidate with a reason, which goes back to the developer (issue #247). */
  "candidate:reject": [{ candidateId: string; note: string }, void];
  "candidate:declineMerge": [{ candidateId: string }, void];
  /** One screenshot of an interface candidate, as a data URL (issue #247). */
  "candidate:shot": [{ candidateId: string; index: number }, string];
  /** Opens focus mode on a candidate (F01): real checks, then code-review's two axes. Returns the examination's id. */
  "candidate:focusAudit": [{ candidateId: string }, string];
  /**
   * Opens focus mode on a module or the whole project from a fixed point the person chose (F03). A point that does not
   * exist or an empty diff is an error. Returns the examination's id.
   */
  "focusMode:open": [{ target: { kind: "module"; moduleId: string } | { kind: "project" }; fixedPoint: string }, string];
  /** Revisions to suggest as the fixed point: default branches ahead of which HEAD is, the last tag, a few steps back. */
  "focusMode:fixedPoints": [void, string[]];
  /** Shows an examination in the full-screen focus mode; notifications wait until the person leaves it (F03). */
  "focusMode:enter": [{ auditId: string }, void];
  "focusMode:exit": [void, void];
  /** Turns a finding of focus mode into work (F04): a ticket, an assignment within the mandate or a Pact card. */
  "finding:followUp": [{ auditId: string; findingId: string; kind: "ticket" | "assignment" | "pactCard" }, void];
  /** Publishes the report of a finished focus mode on GitHub, only when the person asks (F04). */
  "audit:publish": [{ auditId: string }, void];
  "candidate:publish": [{ candidateId: string }, void];
  "candidate:previewPullRequest": [
    { candidateId: string },
    { repository: string | null; head: string | null; base: string; title: string; message: string; body: string },
  ];
  "codex:refresh": [void, void];
  "codex:login": [void, void];
  "skills:rollback": [void, string[]];
  "practice:change": [{ action: "adopt" | "retire" | "rollback"; id: string; reason?: string }, void];
  /** The person corrects what the Coordinator learned (ADR 0014). */
  "learning:memory": [{ target: "memory" | "user"; action: "add" | "replace" | "remove"; oldText?: string; content?: string }, { success: boolean; error: string | null }];
  "learning:proposal": [{ id: string; approve: boolean }, void];
  "learning:skill": [{ name: string; action: "pin" | "unpin" | "adopt" | "archive" | "restore" | "delete" | "edit"; content?: string }, void];
  "learning:skillContent": [{ name: string }, string];
  "learning:review": [{ focus: string }, void];
  "learning:curator": [{ action: "run" | "dryRun" | "pause" | "resume" | "rollback"; backupId?: string | null }, void];
  "providers:refresh": [{ provider?: ProviderId }, void];
  "provider:login": [{ provider: ProviderId }, { url: string | null; command: string | null }];
  "github:refresh": [void, void];
  /** The person's answer on sharing the presence (G01): from a chat proposal, or the switch in Impostazioni and Gruppo. */
  "presence:consent": [{ share: boolean; proposal?: import("./presence").PresenceProposal | null }, void];
  /** Pauses or resumes sharing without withdrawing the consent (G01). */
  "presence:pause": [{ paused: boolean }, void];
  /** The person starts or declines the route Ask Trama proposed (M07). */
  "route:answer": [{ routeId: string; start: boolean }, void];
  "presence:refresh": [void, void];
  /** Sends the message the person wrote to a colleague as a comment on the colleague's open pull request (G03). */
  "presence:commentPullRequest": [{ number: number; body: string }, void];
  "github:createIssue": [{ title: string; body: string }, void];
  /** Adapts Trama's Clean Code standard to the open project (Q03): one rule on or off, or the person's note. */
  "project:cleanCode": [{ rule?: import("./cleanCode").CleanCodeRuleId; enabled?: boolean; note?: string | null }, void];
  "settings:update": [Partial<AppSettings>, void];
  "project:settings": [import("./domain").ProjectSettings, void];
  "monitor:update": [{ enabled?: boolean; openAtLogin?: boolean; intervalSeconds?: number; addRepository?: string; removeRepository?: string }, void];
  "monitor:poll": [void, void];
  "skills:prepare": [void, { pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string }];
  "app:dismissError": [void, void];
  /** The first-run guide and the welcome: opened once, skipped, steps skipped or taken back, the method chosen (C12, B02). */
  "onboarding:update": [
    { shown?: boolean; dismissed?: boolean; skipStep?: GuideStepId; unskipStep?: GuideStepId; methodChoice?: boolean; welcomeClosed?: boolean },
    void,
  ];
  "onboarding:checkGitHub": [void, void];
  /** Opens the example project and records that an exercise started (C13, C14). */
  "exercise:start": [{ exercise: ExerciseId }, void];
  /** Navigation in the example project that an exercise step waits for. */
  "exercise:observe": [{ step: ObservedStep }, void];
  /** The conflict exercise: two simulated local changes compared with the latest candidate. */
  "exercise:simulateRemoteChanges": [void, void];
  "shell:openExternal": [{ url: string }, void];
}

/** An image pasted or dropped into the composer, sent to the main process as base64. */
export interface ImageAttachmentInput {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export type ActionName = keyof ActionMap;
export type ActionPayload<K extends ActionName> = ActionMap[K][0];
export type ActionResult<K extends ActionName> = ActionMap[K][1];

export type { DecisionAlternative };

export interface TramaBridge {
  invoke<K extends ActionName>(action: K, payload: ActionPayload<K>): Promise<ActionResult<K>>;
  getState(): Promise<import("./domain").AppState>;
  onState(listener: (state: import("./domain").AppState) => void): () => void;
  onMenu(listener: (command: string) => void): () => void;
}
