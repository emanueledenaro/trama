import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentColor, Specialist } from "./domain";
import { AGENT_PALETTE, agentTag, freeAgentColor, isAgentColor, tagFromCompetence } from "./identity";
import { translator } from "./i18n";

const t = translator("it");

const css = readFileSync(join(import.meta.dirname, "../renderer/index.css"), "utf8");

/** Every surface a tag or a bot can sit on: the neutral surface and each section's tint, light and dark (issue #457). */
function surfaces(): { light: string[]; dark: string[] } {
  const light: string[] = [];
  const dark: string[] = [];
  for (const block of css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    for (const surface of block[2]!.matchAll(/--(?:surface|app-[a-z]+-tint):\s*(#[0-9a-f]{6})/gi)) (block[1]!.includes(".dark") ? dark : light).push(surface[1]!);
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

function member(color: AgentColor, status: Specialist["status"] = "available"): Pick<Specialist, "color" | "status"> {
  return { color, status };
}

describe("agent identity (W15)", () => {
  it("keeps every palette color readable as text on every theme, light and dark", () => {
    const { light, dark } = surfaces();
    // The surface plus the editor, bottom panel, side bar, activity bar and status bar tints.
    expect(light.length).toBeGreaterThanOrEqual(6);
    expect(dark.length).toBeGreaterThanOrEqual(6);
    for (const entry of AGENT_PALETTE) {
      for (const [shade, backgrounds] of [
        [entry.light, light],
        [entry.dark, dark],
      ] as const) {
        for (const surface of backgrounds) {
          const ratio = contrast(rgb(shade), rgb(surface));
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
    expect(tagFromCompetence(t, "Interfaccia")).toBe("Interfaccia");
    expect(tagFromCompetence(t, "Provider AI, account e modelli.")).toBe("Provider AI");
    expect(tagFromCompetence(t, "Componenti dell'interfaccia React con Tailwind")).toBe("Componenti");
    expect(tagFromCompetence(t, "  ")).toBe("Sviluppo");
    expect(agentTag(t, { tag: " Regressioni ", competence: "x" })).toBe("Regressioni");
    expect(agentTag(t, { tag: "", competence: "Swift" })).toBe("Swift");
  });
});
