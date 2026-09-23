import { CodexClient, restrictedAppServerArguments } from "../codexClient";
import type { AgentRuntime, OpenThreadOptions, RunTurnOptions, RuntimeOptions } from "./types";

const TOKEN_ENVIRONMENT_VARIABLE = "TRAMA_COORDINATOR_TOKEN";

/** Codex through its app-server, with the restricted runtime of ADR 0011. */
export class CodexRuntime implements AgentRuntime {
  readonly providerId = "codex" as const;
  private readonly client: CodexClient;

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
    const writable = options.sandbox === "workspace-write";
    return this.client.openThread({
      model: options.model,
      cwd: options.cwd,
      developerInstructions: options.developerInstructions,
      sandbox: options.sandbox,
      ephemeral: options.ephemeral,
      resumeThreadId: options.resumeThreadId,
      config: {
        web_search: "disabled",
        features: { apps: false, plugins: false, hooks: false, multi_agent: false },
        ...(writable
          ? {
              sandbox_workspace_write: {
                writable_roots: [options.cwd],
                network_access: false,
                exclude_tmpdir_env_var: true,
                exclude_slash_tmp: true,
              },
            }
          : {}),
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
    return this.client.runTurn({ ...options, outputSchema: options.outputSchema as never });
  }

  interrupt() {
    return this.client.interrupt();
  }

  stop() {
    this.client.stop();
  }
}
