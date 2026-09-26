import { describe, expect, it } from "vitest";
import type { AgentColor, Specialist, SpecialistAssignment } from "./domain";
import {
  ACTIVITY_LOOK,
  agentActivity,
  botShapeFor,
  DEVELOPER_SHAPES,
  developerShape,
  presenceActivity,
  ROLE_SHAPES,
  teamBotShapes,
  transitionMove,
} from "./agentBot";
import { AGENT_PALETTE } from "./identity";
import { PRESENCE_IDLE_MS } from "./presence";
import { FIXED_ROLES } from "./roster";

const NOW = new Date("2026-09-26T12:00:00Z");
const recent = new Date(NOW.getTime() - 60_000).toISOString();
const old = new Date(NOW.getTime() - PRESENCE_IDLE_MS - 60_000).toISOString();

type Member = Pick<Specialist, "id" | "role" | "color" | "status" | "createdAt">;
const developer = (id: string, color: AgentColor = "blue", createdAt = "2026-09-01T00:00:00Z", status: Specialist["status"] = "available"): Member => ({
  id,
  role: "developer",
  color,
  status,
  createdAt,
});

function agent(assignment: Partial<SpecialistAssignment> | null, status: Specialist["status"] = "available", updatedAt = recent) {
  return {
    id: "S-1",
    status,
    updatedAt,
    assignments: assignment ? [{ status: "running", updatedAt, waitingForProvider: null, ...assignment } as SpecialistAssignment] : [],
  };
}
const candidate = (over: Record<string, unknown> = {}) => ({
  specialistId: "S-1",
  clearance: { actor: "trama", fingerprint: "f", at: recent },
  humanApproval: null,
  pullRequest: null,
  ...over,
});

describe("agent bot shapes (W16)", () => {
  it("gives every fixed role its own body, apart from the developers' bodies", () => {
    const shapes = FIXED_ROLES.map((role) => ROLE_SHAPES[role as keyof typeof ROLE_SHAPES]);
    expect(shapes.every(Boolean)).toBe(true);
    expect(new Set(shapes).size).toBe(FIXED_ROLES.length);
    for (const shape of DEVELOPER_SHAPES) expect(shapes).not.toContain(shape);
    expect(botShapeFor({ role: "security", name: "Sicurezza" })).toBe("shield");
  });

  it("derives a developer's body from its id, the same every time", () => {
    expect(developerShape("S-0A1B2C3D")).toBe(developerShape("S-0A1B2C3D"));
    expect(DEVELOPER_SHAPES).toContain(developerShape("S-0A1B2C3D"));
    const spread = new Set(Array.from({ length: 40 }, (_, i) => developerShape(`S-${i}`)));
    expect(spread.size).toBe(DEVELOPER_SHAPES.length);
    expect(botShapeFor({ id: "S-7", role: "developer", name: "Ada" })).toBe(developerShape("S-7"));
  });

  it("never gives two active agents of a project the same body and color", () => {
    const fixed: Member[] = FIXED_ROLES.map((role, i) => ({ id: `F-${i}`, role, color: AGENT_PALETTE[i % 9]!.color, status: "available", createdAt: "2026-09-01T00:00:00Z" }));
    const developers = Array.from({ length: 30 }, (_, i) => developer(`S-${i}`, AGENT_PALETTE[i % 9]!.color, `2026-09-02T00:00:${String(i).padStart(2, "0")}Z`));
    const shapes = teamBotShapes([...fixed, ...developers]);
    const looks = [...fixed, ...developers].map((m) => `${shapes.get(m.id)}:${m.color}`);
    expect(new Set(looks).size).toBe(looks.length);
    // The first six developers all get different bodies, whatever their colors.
    expect(new Set(developers.slice(0, 6).map((d) => shapes.get(d.id))).size).toBe(6);
  });

  it("keeps an earlier developer's body when another joins, and ignores removed ones", () => {
    const first = developer("S-A", "blue", "2026-09-01T00:00:00Z");
    const before = teamBotShapes([first]).get("S-A");
    const clash = Array.from({ length: 200 }, (_, i) => `S-${i}`).find((id) => developerShape(id) === before)!;
    const after = teamBotShapes([first, developer(clash, "indigo", "2026-09-03T00:00:00Z")]);
    expect(after.get("S-A")).toBe(before);
    expect(after.get(clash)).not.toBe(before);
    const removed = teamBotShapes([developer("S-A", "blue", "2026-09-01T00:00:00Z", "removed"), developer(clash, "indigo", "2026-09-03T00:00:00Z")]);
    expect(removed.get(clash)).toBe(before);
  });
});

describe("agent bot state (W16)", () => {
  const at = (a: ReturnType<typeof agent>, candidates: ReturnType<typeof candidate>[] = []) => agentActivity(a, { candidates, now: NOW });

  it("follows the agent's work", () => {
    expect(at(agent(null))).toBe("idle");
    expect(at(agent({ status: "preparing" }, "working"))).toBe("thinking");
    expect(at(agent({ status: "running" }, "working"))).toBe("working");
    expect(at(agent({ status: "stopRequested" }, "stopping"))).toBe("working");
    expect(at(agent({ status: "completed" }), [candidate()])).toBe("waiting");
    expect(at(agent({ status: "completed" }), [candidate({ humanApproval: { actor: "p", fingerprint: "f", at: recent } })])).toBe("done");
    expect(at(agent({ status: "completed" }), [candidate({ clearance: null })])).toBe("done");
    expect(at(agent({ status: "failed" }))).toBe("blocked");
    expect(at(agent({ status: "stopped" }, "stopped"))).toBe("blocked");
    expect(at(agent({ status: "running", waitingForProvider: { provider: "codex", until: null, since: recent } }, "working"))).toBe("blocked");
    expect(at(agent({ status: "completed" }))).toBe("done");
  });

  it("sleeps out of the team or after presence's idle time, unless it works or waits for the person", () => {
    expect(at(agent(null, "removed"))).toBe("inactive");
    expect(at(agent({ status: "completed" }, "available", old))).toBe("inactive");
    expect(at(agent({ status: "running" }, "working", old))).toBe("working");
    expect(at(agent({ status: "completed" }, "available", old), [candidate()])).toBe("waiting");
  });

  it("maps each state to its move and expression", () => {
    expect(ACTIVITY_LOOK.idle).toMatchObject({ animation: "idle", expression: "neutral", followsCursor: true });
    expect(ACTIVITY_LOOK.thinking.animation).toBe("thinking");
    expect(ACTIVITY_LOOK.working).toMatchObject({ animation: "idle", expression: "attentive" });
    expect(ACTIVITY_LOOK.waiting.animation).toBe("notification");
    expect(ACTIVITY_LOOK.blocked.animation).toBe("exclamation");
    expect(ACTIVITY_LOOK.done.expression).toBe("happy");
    expect(ACTIVITY_LOOK.inactive).toMatchObject({ animation: "sleep", followsCursor: false });
  });

  it("plays an alert before a notification and wide eyes on finishing, only on a change", () => {
    expect(transitionMove(null, "waiting")).toBeNull();
    expect(transitionMove("working", "waiting")?.animation).toBe("alert");
    expect(transitionMove("working", "done")?.animation).toBe("wide");
    expect(transitionMove("done", "done")).toBeNull();
    expect(transitionMove("idle", "working")).toBeNull();
  });

  it("puts a colleague's agents to sleep when the colleague is idle or away", () => {
    expect(presenceActivity({ task: null }, "active")).toBe("idle");
    expect(presenceActivity({ task: { kind: "work", title: "x" } }, "active")).toBe("working");
    expect(presenceActivity({ task: null }, "idle")).toBe("inactive");
    expect(presenceActivity({ task: null }, "offline")).toBe("inactive");
  });
});
