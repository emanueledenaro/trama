/**
 * The common shape of a provider runtime (V08). Every provider, Codex included, runs the Coordinator,
 * specialists, planners and reviewers through this interface; the controller never talks to a
 * provider protocol directly.
 *
 * Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
 */
import type { ProviderAccount, ProviderId, ProviderModel, TurnEvent } from "@shared/codex";
import type { Language } from "@shared/i18n";
import type { LoadedSkill } from "@shared/skills";

export type { ProviderAccount, ProviderId, ProviderModel, TurnEvent };

/** Trama's loopback MCP server, reachable with a bearer token. */
export interface HostToolServer {
  name: string;
  url: string;
  token: string;
  /** Names of the tools the server offers, so a refusal can name the one to use instead (issue #228). */
  tools?: readonly string[];
}

/**
 * How long a provider waits for one call to Trama's tools. review_candidate runs the required checks and every candidate
 * reviewer before it answers, which takes minutes: two minutes cut it off while the gate was still at work (issue #389).
 * A call cut off anyway leaves the gate running, and the next review_candidate waits for the same gate.
 */
export const HOST_TOOL_TIMEOUT_MS = 30 * 60_000;

export interface OpenThreadOptions {
  model: string;
  cwd: string;
  developerInstructions: string;
  /** Defaults to read-only; a specialist with its own worktree gets workspace-write on `cwd` only. */
  sandbox?: "read-only" | "workspace-write";
  /** Resume this session when the provider still has it; otherwise start a new one. */
  resumeThreadId?: string | null;
  /** An ephemeral session is not kept by the provider after the runtime stops. */
  ephemeral?: boolean;
  /**
   * Only Trama's tools: the provider's own shell, file and web tools are turned off where the adapter
   * can do it. The learning review relies on this and also stops a session that uses one (ADR 0014).
   */
  hostToolsOnly?: boolean;
  /**
   * Folders outside `cwd` the session may read, such as the project of a worktree and Trama's bundled skills.
   * Every other read outside `cwd` is refused (issue #206).
   */
  readableRoots?: string[];
  /**
   * Where the provider's own automatic compaction may start, in tokens: above Trama's threshold, so the provider
   * compacts only as a fallback within a very long turn (ADR 0019). Adapters that cannot set it ignore it.
   */
  autoCompactTokenLimit?: number | null;
}

export interface RunTurnOptions {
  threadId: string;
  prompt: string;
  cwd: string;
  model: string;
  effort?: string | null;
  /** Fast service tier, where the provider offers one (Codex); others ignore it. */
  fastMode?: boolean | null;
  /** Absolute paths of images attached to this message. */
  images?: string[];
  /** The only directory the turn may write; the turn is read-only when absent. */
  writableRoot?: string | null;
  /** Skills the person invoked. */
  skills?: LoadedSkill[];
  /** JSON schema the final answer must follow. Providers without native support ask for it in the prompt. */
  outputSchema?: Record<string, unknown>;
  onEvent: (event: TurnEvent) => void;
}

export interface RuntimeOptions {
  /** Absolute path of the provider CLI, when the person configured one. */
  executable?: string | null;
  /** Trama's tools, exposed to the session as an MCP server. Absent for specialists and checks. */
  toolServer?: HostToolServer | null;
  requestTimeoutMs?: number;
  onAccountChanged?: () => void;
  /** The person's language now, for the messages the runtime writes itself. Italian when absent. */
  language?: () => Language;
}

/**
 * One provider process (or SDK session host). A runtime serves one session at a time and at most one
 * running turn; the controller creates one runtime per Coordinator, specialist or check.
 */
export interface AgentRuntime {
  readonly providerId: ProviderId;
  readonly isRunningTurn: boolean;
  readAccount(): Promise<ProviderAccount>;
  listModels(): Promise<ProviderModel[]>;
  /** Opens the provider's sign-in flow. Returns a URL to open, or null when the flow runs elsewhere. */
  startLogin(): Promise<string | null>;
  /** The skills the provider finds for `cwd`, where the adapter can list them (supportsSkillDiscovery). */
  listSkills?(cwd: string): Promise<LoadedSkill[]>;
  openThread(options: OpenThreadOptions): Promise<{ threadId: string; replaced: boolean }>;
  /** Runs one turn and resolves with the final answer. Rejects with a message containing "interrott" when interrupted. */
  runTurn(options: RunTurnOptions): Promise<string>;
  interrupt(): Promise<void>;
  /**
   * Asks the provider to compact the session's context now (ADR 0019). Only a fallback: Trama reorders the context
   * itself with a new session, and uses this when that session could not open. Absent where the provider has no way.
   */
  compact?(threadId: string): Promise<void>;
  stop(): void;
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | "executableNotFound"
      | "authenticationRequired"
      | "unsupportedAccount"
      | "malformedMessage"
      | "rpcError"
      | "timedOut"
      | "processExited"
      | "emptyPrompt"
      | "invalidModel"
      | "turnAlreadyRunning"
      | "blocked"
      /** A temporary or shared limit (P10): the provider stays usable and the turn may be retried. */
      | "rateLimited"
      | "unsupportedSandbox",
    message: string,
  ) {
    super(message);
  }
}

/** Instruction appended to the prompt when a provider cannot enforce an output schema natively. */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return `\n\nRispondi solo con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice, conforme a questo schema:\n${JSON.stringify(schema)}`;
}

/** Extracts the JSON object from a final answer that may be wrapped in a code fence. */
export function extractJsonAnswer(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) return fenced[1]!.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/** True when `path` is `root` or inside it. Both must be absolute and normalized. */
export function isInside(root: string, path: string): boolean {
  const normalizedRoot = root.endsWith("/") || root.endsWith("\\") ? root : `${root}${root.includes("\\") ? "\\" : "/"}`;
  return path === root || path.startsWith(normalizedRoot);
}
