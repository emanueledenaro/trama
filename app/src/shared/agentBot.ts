import type { Candidate, Specialist, TeamRole } from "./domain";
import { PRESENCE_IDLE_MS, type PresenceStatus } from "./presence";

/**
 * The agent's bot (W16, #187): a soft body in the agent's own color (W15), with two stitches for eyes and a thread
 * that runs through it (ADR 0007). This module says which body each agent has and what its state shows; the drawing
 * lives in the renderer (`botGeometry.ts`, `AgentBot.tsx`).
 */

export type BotShape =
  | "squircle"
  | "cloud"
  | "droplet"
  | "capsule"
  | "triangle"
  | "pebble"
  | "hexagon"
  | "shield"
  | "arch"
  | "diamond"
  | "flower"
  | "circle"
  | "egg"
  | "bean"
  | "star"
  | "pentagon"
  | "screen";

type FixedRole = Exclude<TeamRole, "developer">;

/** Each fixed role has its own body, never used by anyone else. */
export const ROLE_SHAPES: Record<FixedRole, BotShape> = {
  qa: "squircle",
  ux: "cloud",
  research: "droplet",
  documentation: "capsule",
  bugTriage: "triangle",
  specReviewer: "pebble",
  cleanCode: "hexagon",
  regressionGuardian: "arch",
  security: "shield",
  performance: "diamond",
  devops: "flower",
};

/** The bodies kept for developers, apart from the fixed roles'. */
export const DEVELOPER_SHAPES: BotShape[] = ["circle", "egg", "bean", "star", "pentagon", "screen"];

export const BOT_SHAPES: BotShape[] = [...Object.values(ROLE_SHAPES), ...DEVELOPER_SHAPES];

/** A stable number from a string (FNV-1a), the same on every machine. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A developer's body when nothing else is known: always the same for the same id. */
export function developerShape(id: string): BotShape {
  return DEVELOPER_SHAPES[stableHash(id) % DEVELOPER_SHAPES.length]!;
}

/** The body of one agent seen alone, for example a colleague's agent in the presence list. */
export function botShapeFor(agent: { id?: string; role?: TeamRole; name: string }): BotShape {
  if (agent.role && agent.role !== "developer") return ROLE_SHAPES[agent.role];
  return developerShape(agent.id ?? agent.name);
}

type Member = Pick<Specialist, "id" | "role" | "color" | "status" | "createdAt">;

/**
 * The body of every agent of a project, so that no two active agents look the same. A developer keeps the body its
 * id gives it; when another developer came first with that body, it takes the next one no developer uses, and once
 * all are taken the next one no developer of the same color uses. Earlier developers never change body.
 */
export function teamBotShapes(members: Member[]): Map<string, BotShape> {
  const shapes = new Map<string, BotShape>();
  const developers = members
    .filter((m) => m.role === "developer")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const taken: { shape: BotShape; color: Member["color"] }[] = [];
  for (const member of members) {
    if (member.role !== "developer") shapes.set(member.id, ROLE_SHAPES[member.role]);
  }
  for (const developer of developers) {
    const start = stableHash(developer.id) % DEVELOPER_SHAPES.length;
    const order = DEVELOPER_SHAPES.map((_, i) => DEVELOPER_SHAPES[(start + i) % DEVELOPER_SHAPES.length]!);
    if (developer.status === "removed") {
      shapes.set(developer.id, order[0]!);
      continue;
    }
    const shape =
      order.find((s) => !taken.some((t) => t.shape === s)) ??
      order.find((s) => !taken.some((t) => t.shape === s && t.color === developer.color)) ??
      order[0]!;
    taken.push({ shape, color: developer.color });
    shapes.set(developer.id, shape);
  }
  return shapes;
}

/** What an agent is doing, as its bot shows it. */
export type AgentActivity = "idle" | "thinking" | "working" | "waiting" | "blocked" | "done" | "inactive";

/** The eyes' expression. Expressions come from the eyes only: the bot has no mouth. */
export type BotExpression =
  | "neutral"
  | "attentive"
  | "surprised"
  | "excited"
  | "happy"
  | "laughing"
  | "angry"
  | "sad"
  | "scared"
  | "sleepy";

/** The eight moves of the bot. Some turn the body into another form: knots on a thread, a mark, a spool. */
export type BotAnimation = "idle" | "thinking" | "wink" | "wide" | "alert" | "notification" | "exclamation" | "sleep";

export interface BotLook {
  animation: BotAnimation;
  expression: BotExpression;
  /** The eyes follow the cursor. */
  followsCursor: boolean;
}

export const ACTIVITY_LOOK: Record<AgentActivity, BotLook> = {
  idle: { animation: "idle", expression: "neutral", followsCursor: true },
  thinking: { animation: "thinking", expression: "attentive", followsCursor: false },
  working: { animation: "idle", expression: "attentive", followsCursor: false },
  waiting: { animation: "notification", expression: "surprised", followsCursor: true },
  blocked: { animation: "exclamation", expression: "scared", followsCursor: false },
  done: { animation: "idle", expression: "happy", followsCursor: true },
  inactive: { animation: "sleep", expression: "sleepy", followsCursor: false },
};

/** A short move played once when the state changes: an alert before the notification, wide eyes on finishing. */
export function transitionMove(from: AgentActivity | null, to: AgentActivity): { animation: BotAnimation; expression: BotExpression; seconds: number } | null {
  if (from === null || from === to) return null;
  if (to === "waiting") return { animation: "alert", expression: "surprised", seconds: 1.6 };
  if (to === "done") return { animation: "wide", expression: "excited", seconds: 1.8 };
  return null;
}

/** Italian words for the state, for the avatar's tooltip. */
export const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  idle: "a riposo",
  thinking: "pensa",
  working: "lavora",
  waiting: "aspetta te",
  blocked: "bloccato",
  done: "ha finito",
  inactive: "inattivo",
};

type ActivityAgent = Pick<Specialist, "id" | "status" | "updatedAt"> & {
  assignments: Pick<Specialist["assignments"][number], "status" | "updatedAt" | "waitingForProvider">[];
};
type ActivityCandidate = Pick<Candidate, "specialistId" | "clearance" | "humanApproval" | "pullRequest">;

/**
 * The state an agent's bot shows, from the team and assignment model. In order: out of the team or quiet for longer
 * than presence's idle time (G01) sleeps; work being prepared thinks; running work works; a cleared candidate that
 * waits for the person's approval notifies; a failed or stopped work, or one waiting for its provider, is blocked;
 * finished work is done.
 */
export function agentActivity(agent: ActivityAgent, context: { candidates: ActivityCandidate[]; now: Date }): AgentActivity {
  if (agent.status === "removed") return "inactive";
  const current = agent.assignments.at(-1);
  if (current?.waitingForProvider) return "blocked";
  if (current?.status === "preparing") return "thinking";
  if (current && ["running", "stopRequested"].includes(current.status)) return "working";
  if (agent.status === "working" || agent.status === "stopping") return "working";
  const waiting = context.candidates.some((c) => c.specialistId === agent.id && c.clearance && !c.humanApproval && !c.pullRequest);
  if (waiting) return "waiting";
  if (current?.status === "failed" || agent.status === "stopped") return "blocked";
  const last = Math.max(Date.parse(agent.updatedAt) || 0, Date.parse(current?.updatedAt ?? "") || 0);
  if (context.now.getTime() - last > PRESENCE_IDLE_MS) return "inactive";
  if (current?.status === "completed") return "done";
  return "idle";
}

/** A colleague's agent in the presence list (G01): it sleeps when its person is idle or away. */
export function presenceActivity(agent: { task: unknown }, person: PresenceStatus): AgentActivity {
  if (person !== "active") return "inactive";
  return agent.task ? "working" : "idle";
}
