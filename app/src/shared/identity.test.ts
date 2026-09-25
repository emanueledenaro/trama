import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentColor, Specialist } from "./domain";
import { AGENT_PALETTE, agentTag, freeAgentColor, isAgentColor, tagFromCompetence } from "./identity";

const css = readFileSync(join(import.meta.dirname, "../renderer/index.css"), "utf8");

/** Every surface a tag or an avatar can sit on: the base theme and each provider theme, light and dark. */
function surfaces(): { light: string[]; dark: string[] } {
  const light: string[] = [];
  const dark: string[] = [];
  for (const block of css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    const surface = /--surface:\s*(#[0-9a-f]{6})/i.exec(block[2]!)?.[1];
    if (!surface) continue;
    (block[1]!.includes(".dark") ? dark : light).push(surface);
  }
  return { light, dark };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (color: number[]) => {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: number[], b: number[]) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};
/** The avatar's background: the agent color at 16% over the surface, as `.agent-avatar` mixes it. */
const tint = (color: number[], surface: number[]) => color.map((v, i) => v * 0.16 + surface[i]! * 0.84);

function member(color: AgentColor, status: Specialist["status"] = "available"): Pick<Specialist, "color" | "status"> {
  return { color, status };
}

describe("agent identity (W15)", () => {
  it("keeps every palette color readable on every theme, light and dark, as text and on its avatar", () => {
    const { light, dark } = surfaces();
    expect(light.length).toBeGreaterThanOrEqual(10);
    expect(dark.length).toBeGreaterThanOrEqual(10);
    for (const entry of AGENT_PALETTE) {
      for (const [shade, backgrounds] of [
        [entry.light, light],
        [entry.dark, dark],
      ] as const) {
        for (const surface of backgrounds) {
          const ratio = Math.min(contrast(rgb(shade), rgb(surface)), contrast(rgb(shade), tint(rgb(shade), rgb(surface))));
          expect(ratio, `${entry.color} ${shade} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("stays away from the status colors", () => {
    const status = ["#10b981", "#f59e0b", "#ef4444"];
    for (const entry of AGENT_PALETTE) expect(status).not.toContain(entry.light);
    expect(new Set(AGENT_PALETTE.map((e) => e.color)).size).toBe(AGENT_PALETTE.length);
    expect(isAgentColor("teal")).toBe(true);
    expect(isAgentColor("green")).toBe(false);
  });

  it("picks the first free color, then the least used one; removed agents free theirs", () => {
    expect(freeAgentColor([])).toBe(AGENT_PALETTE[0]!.color);
    expect(freeAgentColor([member("blue"), member("indigo", "removed")])).toBe("indigo");
    const all = AGENT_PALETTE.map((e) => member(e.color));
    expect(freeAgentColor([...all, member("blue")])).toBe("indigo");
  });

  it("shortens a competence into a tag, and prefers the agent's own", () => {
    expect(tagFromCompetence("Interfaccia")).toBe("Interfaccia");
    expect(tagFromCompetence("Provider AI, account e modelli.")).toBe("Provider AI");
    expect(tagFromCompetence("Componenti dell'interfaccia React con Tailwind")).toBe("Componenti");
    expect(tagFromCompetence("  ")).toBe("Sviluppo");
    expect(agentTag({ tag: " Regressioni ", competence: "x" })).toBe("Regressioni");
    expect(agentTag({ tag: "", competence: "Swift" })).toBe("Swift");
  });
});
