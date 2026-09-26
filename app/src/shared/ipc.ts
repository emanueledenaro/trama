import type { ProviderId } from "./codex";
import type { AgentColor, AppSettings, DecisionAlternative, GoalStatus, MandateAction, ProjectOverview } from "./domain";
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
      /** The goal dialog the message is sent from; absent or null is the project dialog (UX02). */
      goalId?: string | null;
    },
    void,
  ];
  /** Takes the next step shown under a reply when it is a message to the Coordinator; Trama records the step (W04). */
  "coordinator:takeStep": [{ requestId: string }, void];
  "coordinator:interrupt": [void, void];
  "coordinator:retry": [void, void];
  "coordinator:selectModel": [{ model: string; effort: string | null; provider?: ProviderId | null; goalId?: string | null }, void];
  "coordinator:setFastMode": [{ enabled: boolean; goalId?: string | null }, void];
  "coordinator:selectProvider": [{ provider: ProviderId; goalId?: string | null }, void];
  "coordinator:saveDraft": [{ text: string; goalId?: string | null }, void];
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
  "coordinator:setContextThreshold": [{ percent: number }, void];
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
  "mandate:revoke": [{ reason: string; requestId: string | null }, void];
  "team:answer": [{ proposalId: string; keeping: string[] | null; note: string | null }, void];
  "assignment:stop": [{ assignmentId: string }, void];
  "assignment:resume": [{ assignmentId: string }, void];
  "assignment:removeWorktree": [{ assignmentId: string }, void];
  "assignment:changeProvider": [{ assignmentId: string; provider: ProviderId; model: string }, void];
  "specialist:remove": [{ specialistId: string; reason: string }, void];
  "specialist:rename": [{ specialistId: string; name: string }, void];
  "specialist:setColor": [{ specialistId: string; color: AgentColor }, void];
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
  "candidate:approve": [{ candidateId: string }, void];
  /** Opens focus mode on a candidate (F01): real checks, then code-review's two axes. Returns the examination's id. */
  "candidate:focusAudit": [{ candidateId: string }, string];
  "candidate:publish": [{ candidateId: string }, void];
  "candidate:previewPullRequest": [
    { candidateId: string },
    { repository: string | null; head: string | null; base: string; title: string; body: string },
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
  "presence:refresh": [void, void];
  /** Sends the message the person wrote to a colleague as a comment on the colleague's open pull request (G03). */
  "presence:commentPullRequest": [{ number: number; body: string }, void];
  "github:createIssue": [{ title: string; body: string }, void];
  "settings:update": [Partial<AppSettings>, void];
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
