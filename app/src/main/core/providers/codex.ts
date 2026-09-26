import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CodexClient, resolveCodexExecutable, restrictedAppServerArguments, searchPath } from "../codexClient";
import {
  CODEX_READ_PROFILE,
  CODEX_WRITE_PROFILE,
  codexPermissionProfiles,
  privatePathsInCommand,
  readableRoots,
  toolchainRoots,
} from "../readScope";
import { type AgentRuntime, type OpenThreadOptions, ProviderError, type RunTurnOptions, type RuntimeOptions } from "./types";

const TOKEN_ENVIRONMENT_VARIABLE = "TRAMA_COORDINATOR_TOKEN";

/** The folders of the Codex executable, as installed and as resolved, so its sandbox can start it again. */
function executableFolders(configured: string | null | undefined): string[] {
  try {
    const executable = resolveCodexExecutable(configured);
    return [dirname(executable), dirname(realpathSync.native(executable))];
  } catch {
    return [];
  }
}

/**
 * Codex through its app-server, with the restricted runtime of ADR 0011. Each thread runs under Trama's
 * permission profiles: shell commands read only the thread's folders, the toolchains and the platform's
 * minimal folders, and Codex memories are off (issue #206).
 */
export class CodexRuntime implements AgentRuntime {
  readonly providerId = "codex" as const;
  private readonly client: CodexClient;
  /** What the open thread may read and write. */
  private scope: { roots: string[]; writableRoot: string | null } | null = null;

  constructor(private readonly options: RuntimeOptions = {}) {
    const toolServer = options.toolServer ?? null;
    this.client = new CodexClient({
      executable: options.executable,
      argumentsFor: (executable) => restrictedAppServerArguments(executable, toolServer?.name ?? null),
      environment: toolServer ? { [TOKEN_ENVIRONMENT_VARIABLE]: toolServer.token } : undefined,
      requestTimeoutMs: options.requestTimeoutMs,
      onAccountChanged: options.onAccountChanged,
    });
  }

  get isRunningTurn(): boolean {
    return this.client.isRunningTurn;
  }

  readAccount() {
    return this.client.readAccount();
  }

  listModels() {
    return this.client.listModels();
  }

  startLogin(): Promise<string | null> {
    return this.client.startLogin();
  }

  listSkills(cwd: string) {
    return this.client.listSkills(cwd);
  }

  openThread(options: OpenThreadOptions) {
    const toolServer = this.options.toolServer;
    const writableRoot = options.sandbox === "workspace-write" ? resolve(options.cwd) : null;
    const roots = readableRoots(options.cwd, options.readableRoots ?? []);
    this.scope = { roots, writableRoot };
    const shellRoots = [...roots, ...toolchainRoots([...executableFolders(this.options.executable), ...searchPath()])];
    return this.client.openThread({
      model: options.model,
      cwd: options.cwd,
      developerInstructions: options.developerInstructions,
      permissions: writableRoot ? CODEX_WRITE_PROFILE : CODEX_READ_PROFILE,
      ephemeral: options.ephemeral,
      resumeThreadId: options.resumeThreadId,
      config: {
        web_search: "disabled",
        features: {
          apps: false,
          plugins: false,
          hooks: false,
          multi_agent: false,
          memories: false,
          ...(options.hostToolsOnly ? { shell_tool: false, unified_exec: false, apply_patch_freeform: false } : {}),
        },
        ...codexPermissionProfiles(shellRoots, writableRoot),
        ...(toolServer
          ? {
              [`mcp_servers.${toolServer.name}`]: {
                url: toolServer.url,
                bearer_token_env_var: TOKEN_ENVIRONMENT_VARIABLE,
                default_tools_approval_mode: "approve",
                tool_timeout_sec: 120,
              },
              "shell_environment_policy.exclude": [TOKEN_ENVIRONMENT_VARIABLE],
            }
          : {}),
      },
    });
  }

  runTurn(options: RunTurnOptions) {
    const scope = this.scope;
    if (!scope) return this.client.runTurn({ ...options, outputSchema: options.outputSchema as never });
    if (options.writableRoot && resolve(options.writableRoot) !== scope.writableRoot) {
      return Promise.reject(new ProviderError("unsupportedSandbox", "Il turno chiede di scrivere fuori dalla cartella del thread di Codex."));
    }
    return this.client.runTurn({
      ...options,
      permissions: options.writableRoot ? CODEX_WRITE_PROFILE : CODEX_READ_PROFILE,
      outputSchema: options.outputSchema as never,
      onEvent: (event) => {
        options.onEvent(event);
        // The profile already hid these files; Trama records that the session tried (issue #206).
        if (event.type !== "commandCompleted") return;
        for (const path of privatePathsInCommand(event.command, options.cwd, scope.roots)) {
          options.onEvent({ type: "readOutsideScope", itemId: event.itemId, path, tool: event.command });
        }
      },
    });
  }

  interrupt() {
    return this.client.interrupt();
  }

  stop() {
    this.client.stop();
  }
}
