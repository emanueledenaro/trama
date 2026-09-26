import { type CSSProperties, useMemo, useSyncExternalStore } from "react";
import { type AgentActivity, agentActivity, botShapeFor, teamBotShapes } from "@shared/agentBot";
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

/** A clock that ticks every half minute, shared by all bots, so an agent falls asleep without other changes. */
let clockNow = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  clockTimer ??= setInterval(() => {
    clockNow = Date.now();
    for (const l of clockListeners) l();
  }, 30_000);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const useClock = () => useSyncExternalStore(subscribeClock, () => clockNow);

const NO_SPECIALISTS: Specialist[] = [];

/** The agent's body within its project, so no two agents of the team look the same, and its state. */
function useAgentBot(agent: Agent, activity: AgentActivity | undefined) {
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? NO_SPECIALISTS);
  const candidates = useUi((s) => s.app?.project?.document.candidates);
  const now = useClock();
  const shapes = useMemo(() => teamBotShapes(specialists), [specialists]);
  const shape = (agent.id && shapes.get(agent.id)) || botShapeFor(agent);
  const member = agent.id ? specialists.find((s) => s.id === agent.id) : undefined;
  const state =
    activity ??
    (member ? agentActivity(member, { candidates: candidates ?? [], now: new Date(now) }) : "idle");
  return { shape, activity: state };
}

export function AgentAvatar({
  agent,
  size = 16,
  activity,
  className,
}: {
  agent: Agent;
  /** Pixels, from 16 to 96. */
  size?: number;
  /** The state to show when the agent is not in the open project's team, for example a colleague's agent. */
  activity?: AgentActivity;
  className?: string;
}) {
  const bot = useAgentBot(agent, activity);
  return (
    <AgentBot
      shape={bot.shape}
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
  activity,
  className,
}: {
  agent: Agent;
  avatar?: boolean;
  activity?: AgentActivity;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", className)}>
      {avatar ? <AgentAvatar agent={agent} activity={activity} /> : null}
      <span className="min-w-0 truncate">{agent.name}</span>
      <AgentTag agent={agent} className="shrink-0" />
    </span>
  );
}
