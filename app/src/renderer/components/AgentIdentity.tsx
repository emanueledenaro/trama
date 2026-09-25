import type { CSSProperties } from "react";
import type { Specialist } from "@shared/domain";
import { agentTag, paletteEntry } from "@shared/identity";
import { cn } from "@/lib/cn";

/**
 * An agent's identity (W15): the avatar with its initial and the short role tag, both in the agent's own color.
 * The color stays here and never reaches badges or cards, which keep the status colors (ADR 0007).
 */

type Agent = Pick<Specialist, "name" | "color" | "tag" | "competence">;

/** The agent's two shades; `.agent-identity` in index.css picks the one for the current theme. */
export function agentStyle(agent: Pick<Specialist, "color">): CSSProperties {
  const entry = paletteEntry(agent.color);
  return { "--agent-light": entry.light, "--agent-dark": entry.dark } as CSSProperties;
}

const initial = (name: string) => [...name.trim()][0]?.toLocaleUpperCase("it") ?? "?";

export function AgentAvatar({ agent, className }: { agent: Agent; className?: string }) {
  return (
    <span aria-hidden className={cn("agent-identity agent-avatar", className)} style={agentStyle(agent)}>
      {initial(agent.name)}
    </span>
  );
}

/** The tag `[Interfaccia]`; nothing when it only repeats the name, as for QA or DevOps. */
export function AgentTag({ agent, className }: { agent: Agent; className?: string }) {
  const tag = agentTag(agent);
  if (tag.toLocaleLowerCase("it") === agent.name.trim().toLocaleLowerCase("it")) return null;
  return (
    <span className={cn("agent-identity agent-tag", className)} style={agentStyle(agent)} data-testid="agent-tag">
      [{tag}]
    </span>
  );
}

/** Avatar, name and tag in a row: how an agent appears wherever Trama names it. */
export function AgentName({ agent, avatar = true, className }: { agent: Agent; avatar?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", className)}>
      {avatar ? <AgentAvatar agent={agent} /> : null}
      <span className="min-w-0 truncate">{agent.name}</span>
      <AgentTag agent={agent} className="shrink-0" />
    </span>
  );
}
