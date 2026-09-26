import { type CSSProperties, useMemo } from "react";
import { type AgentActivity, agentActivity, botShapeFor, teamBotBodies } from "@shared/agentBot";
import type { Specialist } from "@shared/domain";
import { agentTag, paletteEntry } from "@shared/identity";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { AgentBot } from "./AgentBot";

/**
 * An agent's identity (W15, W16): its bot and the short role tag, both in the agent's own color.
 * The color stays here and never reaches badges or cards, which keep the status colors (ADR 0007).
 */

type Agent = Pick<Specialist, "name" | "color" | "tag" | "competence"> &
  Partial<Pick<Specialist, "id" | "role" | "status" | "updatedAt" | "createdAt" | "assignments">>;

/** The agent's two shades; `.agent-identity` in index.css picks the one for the current theme. */
export function agentStyle(agent: Pick<Specialist, "color">): CSSProperties {
  const entry = paletteEntry(agent.color);
  return { "--agent-light": entry.light, "--agent-dark": entry.dark } as CSSProperties;
}

const NO_SPECIALISTS: Specialist[] = [];

/** The agent's body within its project, so no two agents of the team look the same, and its state. */
function useAgentBot(agent: Agent, activity: AgentActivity | undefined) {
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? NO_SPECIALISTS);
  const candidates = useUi((s) => s.app?.project?.document.candidates);
  const reports = useUi((s) => s.app?.project?.candidateReports);
  const bodies = useMemo(() => teamBotBodies(specialists), [specialists]);
  const body = (agent.id && bodies.get(agent.id)) || { shape: botShapeFor(agent), variant: 0 };
  const member = agent.id ? specialists.find((s) => s.id === agent.id) : undefined;
  // A clearance that new evidence or decisions voided no longer makes the agent wait for the person.
  const checked = useMemo(
    () => (candidates ?? []).map((c) => ({ ...c, clearanceValid: !reports?.[c.id]?.clearanceInvalidated })),
    [candidates, reports],
  );
  const state = activity ?? (member ? agentActivity(member, { candidates: checked }) : "idle");
  return { ...body, activity: state };
}

export function AgentAvatar({
  agent,
  size = 24,
  activity,
  className,
}: {
  agent: Agent;
  /** Pixels, from 20 to 96: 24 in lists, 32 in the Team and the chat, 64 on the specialist's page. */
  size?: number;
  /** The state to show when the agent is not in the open project's team, for example a colleague's agent. */
  activity?: AgentActivity;
  className?: string;
}) {
  const bot = useAgentBot(agent, activity);
  return (
    <AgentBot
      shape={bot.shape}
      variant={bot.variant}
      color={agent.color}
      activity={bot.activity}
      seed={agent.id ?? agent.name}
      size={size}
      className={cn("shrink-0", className)}
    />
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

/** Bot, name and tag in a row: how an agent appears wherever Trama names it. */
export function AgentName({
  agent,
  avatar = true,
  size = 24,
  activity,
  className,
}: {
  agent: Agent;
  avatar?: boolean;
  /** The bot's size in pixels. */
  size?: number;
  activity?: AgentActivity;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", className)}>
      {avatar ? <AgentAvatar agent={agent} activity={activity} size={size} /> : null}
      <span className="min-w-0 truncate">{agent.name}</span>
      <AgentTag agent={agent} className="shrink-0" />
    </span>
  );
}
