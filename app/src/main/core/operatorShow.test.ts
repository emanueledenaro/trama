import { describe, expect, it } from "vitest";
import type { AccessStep } from "@shared/domain";
import { ComputerAccessGate } from "./computerAccess";
import { runShowTool, type ShowSession } from "./operatorShow";

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

function harness(options: { blocked?: string[]; role?: ShowSession["role"]; openFails?: boolean } = {}) {
  let on = true;
  const h = {
    opened: [] as string[],
    steps: [] as Omit<AccessStep, "id" | "at">[],
    announced: [] as string[],
    setOn: (value: boolean) => void (on = value),
    session: null as never as ShowSession,
  };
  h.session = {
    gate: new ComputerAccessGate(() => on, () => options.blocked ?? []),
    agent: "Operatore",
    role: options.role ?? "operator",
    openExternal: async (address) => {
      if (options.openFails) throw new Error("no browser");
      h.opened.push(address);
    },
    record: (step) => void h.steps.push(step),
    announce: (site) => void h.announced.push(site),
  };
  return h;
}

describe("showing an address to the person (issue #595)", () => {
  it("opens an https address and the local preview without any consent, and reads nothing", async () => {
    const h = harness();
    expect((await runShowTool({ url: "https://example.org/offerta?x=1" }, h.session)).isError).toBeFalsy();
    const preview = parse(await runShowTool({ url: "http://127.0.0.1:4321" }, h.session));
    expect(preview).toMatchObject({ shown: "127.0.0.1:4321" });
    expect(Object.keys(preview).sort()).toEqual(["note", "shown"]);
    expect(h.opened).toEqual(["https://example.org/offerta?x=1", "http://127.0.0.1:4321/"]);
    expect(h.announced).toEqual(["example.org/offerta", "127.0.0.1:4321"]);
    expect(h.steps.map((step) => [step.kind, step.outcome, step.detail])).toEqual([["browser", "done", "shown"], ["browser", "done", "shown"]]);
  });

  it("refuses an address that is not https and not a local preview", async () => {
    const h = harness();
    for (const url of ["http://example.org", "file:///etc/passwd", "javascript:alert(1)", "http://192.168.1.4:3000", "not an address", ""]) {
      expect(parse(await runShowTool({ url }, h.session)).error.code).toBe("invalid_arguments");
    }
    expect(h.opened).toEqual([]);
  });

  it("holds the switch of computer access and the blocked sites", async () => {
    const h = harness({ blocked: ["bank.example"] });
    expect(parse(await runShowTool({ url: "https://bank.example/login" }, h.session)).error.code).toBe("blocked");
    expect(h.steps.at(-1)).toMatchObject({ outcome: "blocked", detail: "bank.example" });
    h.setOn(false);
    expect(parse(await runShowTool({ url: "https://example.org" }, h.session)).error.code).toBe("access_off");
    expect(h.opened).toEqual([]);
    expect(h.announced).toEqual([]);
  });

  it("drops a login written in the address and tells when the browser does not open", async () => {
    const h = harness();
    await runShowTool({ url: "https://ada:secret@example.org/a" }, h.session);
    expect(h.opened).toEqual(["https://example.org/a"]);
    const failing = harness({ openFails: true });
    expect(parse(await runShowTool({ url: "https://example.org" }, failing.session)).error.code).toBe("failed");
    expect(failing.steps.at(-1)).toMatchObject({ outcome: "failed" });
  });
});
