import type { ProviderId } from "./codex";
import type { AppSettings, DecisionAlternative, MandateAction } from "./domain";
import type { ExerciseId, GuideStepId, ObservedStep } from "./onboarding";

/** Every action the renderer can ask the main process to perform. */
export interface ActionMap {
  "project:openDialog": [void, void];
  "project:open": [{ path: string }, void];
  "project:openDemo": [void, void];
  "project:create": [{ name: string; idea: string }, void];
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
    },
    void,
  ];
  "coordinator:interrupt": [void, void];
  "coordinator:retry": [void, void];
  "coordinator:selectModel": [{ model: string; effort: string | null; provider?: ProviderId | null }, void];
  "coordinator:selectProvider": [{ provider: ProviderId }, void];
  "coordinator:saveDraft": [{ text: string }, void];
  "coordinator:setContextThreshold": [{ percent: number }, void];
  "pact:decide": [{ id: string | null; value: string; acceptedExample: string; rationale: string }, void];
  "decision:answer": [{ requestId: string; alternativeIndex: number | null; freeText: string | null }, void];
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
  "plan:prepare": [{ requestId: string }, void];
  "plan:cancel": [{ planId: string }, void];
  "plan:edit": [{ planId: string; steps: string[]; proposedBehavior: string; acceptedExample: string }, void];
  "pactDemo:run": [void, void];
  "pactDemo:approve": [void, void];
  "candidate:approve": [{ candidateId: string }, void];
  "candidate:publish": [{ candidateId: string }, void];
  "candidate:previewPullRequest": [
    { candidateId: string },
    { repository: string | null; head: string | null; base: string; title: string; body: string },
  ];
  "codex:refresh": [void, void];
  "codex:login": [void, void];
  "skills:rollback": [void, string[]];
  "practice:change": [{ action: "adopt" | "retire" | "rollback"; id: string; reason?: string }, void];
  "providers:refresh": [{ provider?: ProviderId }, void];
  "provider:login": [{ provider: ProviderId }, { url: string | null; command: string | null }];
  "github:refresh": [void, void];
  "github:createIssue": [{ title: string; body: string }, void];
  "settings:update": [Partial<AppSettings>, void];
  "monitor:update": [{ enabled?: boolean; openAtLogin?: boolean; intervalSeconds?: number; addRepository?: string; removeRepository?: string }, void];
  "monitor:poll": [void, void];
  "skills:prepare": [void, { pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string }];
  "app:dismissError": [void, void];
  /** The first-run guide: opened once, skipped, steps skipped or taken back (C12). */
  "onboarding:update": [{ shown?: boolean; dismissed?: boolean; skipStep?: GuideStepId; unskipStep?: GuideStepId }, void];
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
