/**
 * What an agent learns when Trama blocks one of its provider's own tools (issue #228). The provider's GitHub, web,
 * command and connector tools and the person's MCP servers stay off (issue #206); Trama's own tools do the same job,
 * so every refusal names the reason and the Trama tool to use instead.
 */
import type { TurnEvent } from "./types";

export type ExternalToolKind = "github" | "web" | "command" | "other";

/** GitHub first: `gh issue list` is a command, but what the agent wants is an issue. */
export function externalToolKind(tool: string, kind: string | null = null): ExternalToolKind {
  const text = tool.toLowerCase();
  if (/github|(?:^|[^a-z])gh(?:$|[^a-z])|pull[_ -]?requests?|(?:^|[^a-z])issues?(?:$|[^a-z])/.test(text)) return "github";
  if (kind === "fetch" || /web|fetch|brows|https?:|url|internet/.test(text)) return "web";
  if (kind === "execute" || /bash|shell|terminal|command|exec/.test(text)) return "command";
  return "other";
}

// @model-text: the refusal texts below go to the agent, in the tool result or in its next prompt.
const NO_TERMINAL = "Non chiedere alla persona di eseguire comandi nel terminale per leggere dati che Trama può leggere.";

/**
 * The refusal in plain Italian: why the tool is blocked and which Trama tool does the job. `hostTools` are the
 * names the session reaches on Trama's server; empty when it has none.
 */
// @model-text: the agent reads the refusal; the Activity row shows the same text.
export function refusalReason(kind: ExternalToolKind, hostTools: readonly string[]): string {
  const has = (name: string) => hostTools.includes(name);
  const issues = has("read_issues")
    ? "per le issue usa read_issues di Trama."
    : has("ask_coordinator")
      ? "se ti serve una issue, chiedila al Coordinatore con ask_coordinator."
      : "usa quello che Trama ti ha dato nell'incarico e scrivi nella risposta cosa manca.";
  const issuesToo = has("read_issues") ? " Per le issue usa read_issues di Trama." : "";
  const checks = has("run_readonly_check") ? " Per le verifiche usa run_readonly_check." : "";
  const trama = hostTools.length ? "usa gli strumenti di Trama." : "usa solo gli strumenti di lettura del progetto.";
  switch (kind) {
    case "github":
      return `Gli strumenti GitHub del provider sono bloccati: ${issues} ${NO_TERMINAL}`;
    case "web":
      return `Gli strumenti web del provider sono bloccati: Trama non consente accessi alla rete.${issuesToo} ${NO_TERMINAL}`;
    case "command":
      return `I comandi del provider sono bloccati in questo turno: per leggere il progetto usa gli strumenti di lettura.${issuesToo}${checks} ${NO_TERMINAL}`;
    default:
      return `Gli strumenti propri del provider, i connettori e i server MCP della persona sono bloccati: ${trama} ${NO_TERMINAL}`;
  }
}

/** The line every Coordinator and specialist reads in its instructions. */
export function providerToolsRule(hostTools: "coordinator" | "developer" | "none"): string {
  const issues =
    hostTools === "coordinator"
      ? "for GitHub issues and pull requests use Trama's read_issues, for checks run_readonly_check, and the other trama tools for the project's data."
      : hostTools === "developer"
        ? "when you need an issue or a fact Trama did not give you, ask the Coordinator with ask_coordinator."
        : "work with what Trama gave you in the assignment and say in your answer what is missing.";
  return [
    `Your provider's own GitHub, web, ${hostTools === "coordinator" ? "command, " : ""}connector and MCP tools are blocked in Trama: ${issues}`,
    "When Trama blocks one of them it tells you why and which Trama tool to use: switch to that tool and do not retry the blocked one.",
    "Never ask the person to run a terminal command (such as gh issue list) and paste its output to read data Trama can read.",
  ].join(" ");
}

/**
 * The refusals of one session. A provider that cannot carry a message with its refusal (ACP permissions, the
 * Antigravity hook) tells the agent at the start of its next turn.
 */
export class ToolRefusals {
  private pending = new Map<string, string>();

  constructor(private readonly hostTools: () => readonly string[]) {}

  /** Records the refusal and reports it as a readable activity; returns the reason for the agent. */
  record(input: { itemId: string; tool: string; kind?: string | null }, onEvent: (event: TurnEvent) => void): string {
    const tool = input.tool.trim() || "strumento";
    const reason = refusalReason(externalToolKind(tool, input.kind ?? null), this.hostTools());
    this.pending.set(tool, reason);
    onEvent({ type: "toolRefused", itemId: input.itemId, tool, reason });
    return reason;
  }

  /** The note for the next prompt, once; null when nothing was refused. */
  // @model-text: the note opens the agent's next prompt.
  takeNotice(): string | null {
    if (this.pending.size === 0) return null;
    const lines = [...this.pending].map(([tool, reason]) => `- ${tool}: ${reason}`);
    this.pending.clear();
    return ["Nel turno precedente Trama ha bloccato questi strumenti del provider:", ...lines].join("\n");
  }

  clear(): void {
    this.pending.clear();
  }
}
