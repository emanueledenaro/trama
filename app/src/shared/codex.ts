export type ProviderId = "codex" | "claudeAgent" | "cursor" | "antigravity" | "grok" | "droid" | "devin" | "opencode" | "pi";

/** The account state of one provider. `chatgpt` is Codex's only accepted account; other providers report `authenticated`. */
export type ProviderAccount =
  | { kind: "chatgpt"; email: string | null; plan: string }
  | { kind: "authenticated"; label: string | null }
  | { kind: "signedOut" }
  | { kind: "unsupported"; type: string }
  | { kind: "unavailable"; message: string }
  | { kind: "blocked"; message: string; until: string | null };

export type AccountStatus = ProviderAccount;

/** True when the provider can run turns now. */
export const isUsableAccount = (account: ProviderAccount | null | undefined): boolean =>
  account?.kind === "chatgpt" || account?.kind === "authenticated";

export interface ProviderModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  /** The model offers a fast service tier (Codex `additionalSpeedTiers` contains "fast"). */
  supportsFastMode?: boolean;
}

export type CodexModel = ProviderModel;

/** Title of the activity Trama records when a session tried to read outside its folders (issue #206). */
export const READ_OUTSIDE_SCOPE_TITLE = "Lettura fuori dal progetto bloccata";

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
  /** The session tried to read outside the project, its worktree and the folders Trama allows; the read was refused. */
  | { type: "readOutsideScope"; itemId: string; path: string; tool: string }
  | { type: "tokenUsage"; usedTokens: number; contextWindow: number | null }
  | { type: "compacted" }
  | { type: "completed"; text: string }
  | { type: "failed"; message: string }
  | { type: "interrupted" };
