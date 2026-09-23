export type AccountStatus =
  | { kind: "chatgpt"; email: string | null; plan: string }
  | { kind: "signedOut" }
  | { kind: "unsupported"; type: string }
  | { kind: "unavailable"; message: string };

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

/** A normalized event from one running turn, forwarded to the renderer. */
export type TurnEvent =
  | { type: "turnStarted"; turnId: string }
  | { type: "textDelta"; itemId: string | null; delta: string }
  | { type: "reasoning"; text: string }
  | { type: "commentary"; text: string }
  | { type: "commandCompleted"; itemId: string; command: string; exitCode: number | null; output: string | null; succeeded: boolean }
  | { type: "fileChangeCompleted"; itemId: string; paths: string[]; succeeded: boolean }
  | { type: "toolCallStarted"; itemId: string; server: string; tool: string }
  | { type: "toolCallCompleted"; itemId: string; server: string; tool: string; succeeded: boolean; error: string | null }
  | { type: "tokenUsage"; usedTokens: number; contextWindow: number | null }
  | { type: "compacted" }
  | { type: "completed"; text: string }
  | { type: "failed"; message: string }
  | { type: "interrupted" };
