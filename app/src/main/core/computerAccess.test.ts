import { describe, expect, it, vi } from "vitest";
import { ComputerAccessGate } from "./computerAccess";

describe("computer access gate", () => {
  it("lets a power start while the switch is on and refuses it while off", () => {
    let on = true;
    const gate = new ComputerAccessGate(() => on);
    expect(gate.decide("network")).toEqual({ allowed: true });
    on = false;
    for (const power of ["network", "browser", "command", "screen"] as const) expect(gate.decide(power)).toEqual({ allowed: false, reason: "switchedOff" });
    expect(gate.begin({ id: "a", power: "command", agent: "Operatore", label: "ls", stop: () => undefined })).toBeNull();
    expect(gate.actions()).toEqual([]);
  });

  it("stops every action in progress when the switch goes off, and reports them", async () => {
    const gate = new ComputerAccessGate(() => true);
    const stop = vi.fn();
    gate.begin({ id: "a", power: "command", agent: "Operatore", label: "npm install", stop });
    gate.begin({ id: "b", power: "browser", agent: "Ricerca", label: "docs", stop: () => Promise.reject(new Error("gone")) });
    const finished = gate.begin({ id: "c", power: "screen", agent: "Operatore", label: "screenshot", stop })!;
    finished.done();
    const stopped = await gate.stopAll();
    expect(stopped.map((action) => action.id)).toEqual(["a", "b"]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(gate.actions()).toEqual([]);
  });
});
