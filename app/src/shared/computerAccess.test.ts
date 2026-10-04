import { describe, expect, it } from "vitest";
import { accessChangeEntries, accessIsOn, followPause, personSwitch } from "./computerAccess";
import { translator } from "./i18n";

describe("computer access switch", () => {
  it("is on unless the person turned it off", () => {
    expect(accessIsOn({})).toBe(true);
    expect(accessIsOn({ computerAccess: false })).toBe(false);
  });

  it("is turned off by a Pause and back on, as it was, by the resume", () => {
    const paused = followPause({}, "p1", true)!;
    expect(paused).toMatchObject({ on: false, settings: { computerAccess: false, computerAccessPausedBy: ["p1"] } });
    const resumed = followPause(paused.settings, "p1", false)!;
    expect(resumed).toMatchObject({ on: true, settings: { computerAccess: true, computerAccessPausedBy: [] } });
  });

  it("stays off at the resume when the person had turned it off before the Pause", () => {
    const off = personSwitch(false);
    expect(followPause(off, "p1", true)).toBeNull();
    expect(followPause(off, "p1", false)).toBeNull();
  });

  it("leaves the person's choice standing: switching it on during a Pause clears what the Pause remembered", () => {
    const paused = followPause({}, "p1", true)!;
    const switchedOn = { ...paused.settings, ...personSwitch(true) };
    expect(followPause(switchedOn, "p1", false)).toBeNull();
    const switchedOff = { ...paused.settings, ...personSwitch(false) };
    expect(followPause(switchedOff, "p1", false)).toBeNull();
    expect(accessIsOn(switchedOff)).toBe(false);
  });

  it("comes back on only when the last paused project resumes", () => {
    const first = followPause({}, "p1", true)!;
    const second = followPause(first.settings, "p2", true)!;
    expect(second.settings.computerAccessPausedBy).toEqual(["p1", "p2"]);
    const afterFirst = followPause(second.settings, "p1", false)!;
    expect(afterFirst).toMatchObject({ on: false, settings: { computerAccess: false, computerAccessPausedBy: ["p2"] } });
    expect(followPause(afterFirst.settings, "p2", false)).toMatchObject({ on: true });
  });

  it("tells each change in Activity in both languages, with what it stopped", () => {
    const changes = [{ id: "a", at: "2026-10-03T10:00:00.000Z", on: false, by: "person" as const, stopped: [{ agent: "Operatore", label: "npm install" }] }];
    const [it_] = accessChangeEntries(translator("it"), changes);
    expect(it_).toMatchObject({ kind: "access", label: "Accesso al computer spento", outcome: "done" });
    expect(it_!.detail).toBe("Lo hai cambiato tu con l'interruttore. Fermata un'azione di Operatore: npm install.");
    const [en] = accessChangeEntries(translator("en"), [{ ...changes[0]!, on: true, by: "pause", stopped: [] }]);
    expect(en).toMatchObject({ label: "Computer access turned on", detail: "The Coordinator's Pause changed it." });
  });
});
