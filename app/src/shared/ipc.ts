import type { AppSettings, DecisionAlternative, MandateAction } from "./domain";

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
    { text: string; moduleId: string | null; model: string | null; effort: string | null; images?: ImageAttachmentInput[] },
    void,
  ];
  "coordinator:interrupt": [void, void];
  "coordinator:retry": [void, void];
  "coordinator:selectModel": [{ model: string; effort: string | null }, void];
  "coordinator:saveDraft": [{ text: string }, void];
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
  "specialist:remove": [{ specialistId: string; reason: string }, void];
  "candidate:approve": [{ candidateId: string }, void];
  "candidate:publish": [{ candidateId: string }, void];
  "codex:refresh": [void, void];
  "codex:login": [void, void];
  "github:refresh": [void, void];
  "github:createIssue": [{ title: string; body: string }, void];
  "settings:update": [Partial<AppSettings>, void];
  "app:dismissError": [void, void];
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
