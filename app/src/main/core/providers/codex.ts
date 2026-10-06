import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CodexClient, resolveCodexExecutable, restrictedAppServerArguments, searchPath } from "../codexClient";
import {
  agentTempFolder,
  browserCacheRoots,
  CODEX_READ_PROFILE,
  CODEX_WRITE_PROFILE,
  codexPermissionProfiles,
  privatePathsInCommand,
  readableRoots,
  sandboxGitEnvironment,
  sandboxSearchPath,
  toolchainRoots,
} from "../readScope";
import { t } from "../personLanguage";
import { type AgentRuntime, type OpenThreadOptions, ProviderError, type RunTurnOptions, type RuntimeOptions } from "./types";
import { ToolRefusals } from "./toolRefusal";

const TOKEN_ENVIRONMENT_VARIABLE = "TRAMA_COORDINATOR_TOKEN";

/**
 * Codex puts the person's own ~/.codex/AGENTS.md before the project's documents in every thread, and offers no option
 * to leave it out without moving its home, where the login lives (Codex 0.160, checked in its source on 2 October 2026).
 * The person chose that Trama's agents do not follow those rules: this line asks them not to. A request to the model,
 * not an exclusion. @model-text
 */
export const PERSONAL_INSTRUCTIONS_RULE =
  "The AGENTS.md instructions that come before `--- project-doc ---` (all of them, when there is no such line and no project AGENTS.md) are the person's personal settings for their own Codex, not rules of this project or of Trama: ignore them, and never read files they point to. Follow the project's AGENTS.md after that line and these instructions.";

/** The environment of a developer's shell in its own temporary folder: scratch files, npm's cache and a home. */
function developerEnvironment(tempRoot: string): Record<string, string> {
  const home = join(tempRoot, "home");
  mkdirSync(home, { recursive: true });
  const browsers = browserCacheRoots()[0];
  return {
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    HOME: home,
    npm_config_cache: join(tempRoot, "npm"),
    ...(browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}),
  };
}
/** A command that reaches GitHub or the network, which the read-only sandbox stops. */
const NETWORK_COMMAND = /(?:^|[\s;&|('"])(?:gh|curl|wget)\s|\bgit\s+(?:fetch|pull|push|clone|ls-remote)\b/;

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
  /** GitHub and network commands the sandbox stopped; the next prompt names the Trama tool to use (issue #228). */
  private readonly refusals = new ToolRefusals(() => this.options.toolServer?.tools ?? []);

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
    // Playwright's browsers are readable too: reading them is no attempt outside the project.
    this.scope = { roots: [...roots, ...browserCacheRoots()], writableRoot };
    const searchEntries = [...executableFolders(this.options.executable), ...searchPath()];
    const shellRoots = [...roots, ...toolchainRoots(searchEntries), ...browserCacheRoots()];
    const tempRoot = writableRoot ? agentTempFolder(writableRoot) : null;
    return this.client.openThread({
      model: options.model,
      cwd: options.cwd,
      developerInstructions: `${options.developerInstructions}\n\n${PERSONAL_INSTRUCTIONS_RULE}`,
      permissions: writableRoot ? CODEX_WRITE_PROFILE : CODEX_READ_PROFILE,
      ephemeral: options.ephemeral,
      resumeThreadId: options.resumeThreadId,
      config: {
        web_search: "disabled",
        // Codex compacts by itself only above Trama's threshold, as a fallback within a very long turn (ADR 0019).
        ...(options.autoCompactTokenLimit ? { model_auto_compact_token_limit: options.autoCompactTokenLimit } : {}),
        features: {
          apps: false,
          plugins: false,
          hooks: false,
          multi_agent: false,
          memories: false,
          ...(options.hostToolsOnly ? { shell_tool: false, unified_exec: false, apply_patch_freeform: false } : {}),
        },
        ...codexPermissionProfiles(shellRoots, writableRoot, tempRoot),
        // The profiles hide the home folder, ~/.gitconfig included: git in the shell reads no global file (issue #391).
        // A developer's tools write their scratch files in its own temporary folder, npm its cache and logs too, and
        // their settings in a home of its own there (Astro's, 2 October 2026): the person's home stays hidden.
        // Playwright finds its browsers by the real home, so it gets their folder by name.
        "shell_environment_policy.set": {
          ...sandboxGitEnvironment(),
          PATH: sandboxSearchPath(searchEntries, shellRoots),
          ...(tempRoot ? developerEnvironment(tempRoot) : {}),
        },
        ...(toolServer
          ? {
              [`mcp_servers.${toolServer.name}`]: {
                url: toolServer.url,
                bearer_token_env_var: TOKEN_ENVIRONMENT_VARIABLE,
                default_tools_approval_mode: "approve",
                tool_timeout_sec: toolServer.toolTimeoutSec ?? 120,
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
      return Promise.reject(new ProviderError("unsupportedSandbox", t("main.codex.writeOutsideThread")));
    }
    const notice = this.refusals.takeNotice();
    return this.client.runTurn({
      ...options,
      prompt: notice ? `${notice}\n\n${options.prompt}` : options.prompt,
      permissions: options.writableRoot ? CODEX_WRITE_PROFILE : CODEX_READ_PROFILE,
      outputSchema: options.outputSchema as never,
      onEvent: (event) => {
        options.onEvent(event);
        if (event.type !== "commandCompleted") return;
        // Web search, apps and the person's MCP servers are off; a failed gh or network command meets the sandbox (issue #228).
        if (!event.succeeded && NETWORK_COMMAND.test(event.command)) this.refusals.record({ itemId: event.itemId, tool: event.command, kind: "execute" }, options.onEvent);
        // The profile already hid these files; Trama records that the session tried (issue #206).
        for (const path of privatePathsInCommand(event.command, options.cwd, scope.roots)) {
          options.onEvent({ type: "readOutsideScope", itemId: event.itemId, path, tool: event.command });
        }
      },
    });
  }

  interrupt() {
    return this.client.interrupt();
  }

  compact(threadId: string) {
    return this.client.compactThread(threadId);
  }

  stop() {
    this.client.stop();
  }
}
