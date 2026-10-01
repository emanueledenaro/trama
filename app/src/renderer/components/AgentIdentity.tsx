import { type CSSProperties, useMemo } from "react";
import { IconCloudFilled } from "@tabler/icons-react";
import { type AgentActivity, agentActivity, botShapeFor, teamBotShapes } from "@shared/agentBot";
import type { Specialist } from "@shared/domain";
import { agentTag, paletteEntry } from "@shared/identity";
import { agentInCloud } from "@shared/workPlace";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { AgentBot } from "./AgentBot";
import { useT } from "@/lib/i18n";

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
  const shapes = useMemo(() => teamBotShapes(specialists), [specialists]);
  const shape = (agent.id && shapes.get(agent.id)) || botShapeFor(agent);
  const member = agent.id ? specialists.find((s) => s.id === agent.id) : undefined;
  const state =
    activity ??
    (member ? agentActivity(member, { candidates: candidates ?? [] }) : "idle");
  return { shape, activity: state, inCloud: agentInCloud(member ?? agent) };
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
  const t = useT();
  const bot = useAgentBot(agent, activity);
  const body = (
    <AgentBot
      shape={bot.shape}
      color={agent.color}
      activity={bot.activity}
      seed={agent.id ?? agent.name}
      size={size}
      className={cn("shrink-0", !bot.inCloud && className)}
    />
  );
  if (!bot.inCloud) return body;
  // A small cloud at the bottom right, away from the state knot at the top right: the agent works in a cloud session.
  // It keeps the neutral colors, as the agent's color stays on its bot (ADR 0007).
  const label = t("cloudSession.agentInCloud", { name: agent.name });
  return (
    <span className={cn("relative inline-flex shrink-0", className)} title={label} data-testid="agent-in-cloud">
      {body}
      <span
        role="img"
        aria-label={label}
        className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-background p-px text-muted-foreground"
      >
        <IconCloudFilled size={Math.max(9, Math.round(size * 0.4))} />
      </span>
    </span>
  );
}

/** The tag `[Interfaccia]`; nothing when it only repeats the name, as for QA or DevOps. */
export function AgentTag({ agent, className }: { agent: Agent; className?: string }) {
  const t = useT();
  const tag = agentTag(t, agent);
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
  fit = false,
}: {
  agent: Agent;
  avatar?: boolean;
  /** The bot's size in pixels. */
  size?: number;
  activity?: AgentActivity;
  className?: string;
  /**
   * In a narrow row the tag gives up its room first and both end with an ellipsis, so the tag never runs over what
   * follows and a few letters of the name always show. The full name and tag stay on hover.
   */
  fit?: boolean;
}) {
  const t = useT();
  const tag = agentTag(t, agent);
  const full = tag.toLocaleLowerCase("it") === agent.name.trim().toLocaleLowerCase("it") ? agent.name : `${agent.name} [${tag}]`;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", className)} title={fit ? full : undefined}>
      {avatar ? <AgentAvatar agent={agent} activity={activity} size={size} /> : null}
      <span className={cn("min-w-0 truncate", fit && "min-w-[4ch]")} data-testid="agent-name">
        {agent.name}
      </span>
      <AgentTag agent={agent} className={fit ? "min-w-0 shrink-[4] truncate" : "shrink-0"} />
    </span>
  );
}
