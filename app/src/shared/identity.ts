import type { AgentColor, Specialist } from "./domain";

/**
 * An agent's identity (W15, #158): its own color from a fixed palette and a short colored tag with its role.
 * The color lives only on the identity (the bot, W16, and the tag); badges and cards keep the status colors
 * (ADR 0007). Each shade is readable as text over every theme, light and dark, and with every provider theme:
 * `identity.test.ts` checks it against `index.css`.
 */

export interface AgentPaletteEntry {
  color: AgentColor;
  /** The color's name in the Team view. */
  label: string;
  /** The shade on light themes. */
  light: string;
  /** The shade on dark themes. */
  dark: string;
}

/** Hues chosen away from the status colors (green, amber, red), in the order Trama hands them out. */
export const AGENT_PALETTE: AgentPaletteEntry[] = [
  { color: "blue", label: "Blu", light: "#1d4ed8", dark: "#93c5fd" },
  { color: "indigo", label: "Indaco", light: "#4338ca", dark: "#a5b4fc" },
  { color: "violet", label: "Viola", light: "#6d28d9", dark: "#c4b5fd" },
  { color: "fuchsia", label: "Fucsia", light: "#86198f", dark: "#f0abfc" },
  { color: "pink", label: "Rosa", light: "#9d174d", dark: "#f9a8d4" },
  { color: "copper", label: "Rame", light: "#9a3412", dark: "#fdba74" },
  { color: "olive", label: "Oliva", light: "#3f6212", dark: "#bef264" },
  { color: "teal", label: "Verde acqua", light: "#115e59", dark: "#5eead4" },
  { color: "cyan", label: "Ciano", light: "#155e75", dark: "#67e8f9" },
];

export function isAgentColor(value: unknown): value is AgentColor {
  return AGENT_PALETTE.some((entry) => entry.color === value);
}

export function paletteEntry(color: AgentColor): AgentPaletteEntry {
  return AGENT_PALETTE.find((entry) => entry.color === color) ?? AGENT_PALETTE[0]!;
}

/**
 * The color for a new agent: the first one no agent in the team uses, or, once all are taken, the least used.
 * Agents out of the team free their color.
 */
export function freeAgentColor(team: Pick<Specialist, "color" | "status">[]): AgentColor {
  const uses = new Map<AgentColor, number>(AGENT_PALETTE.map((entry) => [entry.color, 0]));
  for (const member of team) {
    if (member.status === "removed" || !uses.has(member.color)) continue;
    uses.set(member.color, uses.get(member.color)! + 1);
  }
  let best = AGENT_PALETTE[0]!.color;
  for (const entry of AGENT_PALETTE) {
    if (uses.get(entry.color)! < uses.get(best)!) best = entry.color;
  }
  return best;
}

const FALLBACK_TAG = "Sviluppo";
const MAXIMUM_TAG = 20;

/** A developer's tag when the Coordinator gave none: the start of its competence, one or two words. */
export function tagFromCompetence(competence: string): string {
  const first = competence.split(/[,.;:()]/)[0]!.trim().replace(/\s+/g, " ");
  if (!first) return FALLBACK_TAG;
  const words = first.split(" ");
  if (words.length <= 2 && first.length <= MAXIMUM_TAG) return first;
  return words[0]!.slice(0, MAXIMUM_TAG);
}

/** The tag shown beside the agent's name. */
export function agentTag(agent: Pick<Specialist, "tag" | "competence">): string {
  return agent.tag?.trim() || tagFromCompetence(agent.competence);
}
