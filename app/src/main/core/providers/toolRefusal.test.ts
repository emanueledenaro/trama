import { describe, expect, it } from "vitest";
import type { TurnEvent } from "./types";
import { developerInstructions, TOOL_SERVER_INSTRUCTIONS } from "../coordinatorTools";
import { externalToolKind, providerToolsRule, refusalReason, ToolRefusals } from "./toolRefusal";

const COORDINATOR = ["read_issues", "run_readonly_check", "read_study"];

describe("provider tool refusals (issue #228)", () => {
  it("recognizes GitHub, web and command tools", () => {
    expect(externalToolKind("Calling list_issues from github")).toBe("github");
    expect(externalToolKind("gh issue list", "execute")).toBe("github");
    expect(externalToolKind("mcp__github__get_pull_request")).toBe("github");
    expect(externalToolKind("web_fetch")).toBe("web");
    expect(externalToolKind("Fetch https://example.com", "fetch")).toBe("web");
    expect(externalToolKind("npm test", "execute")).toBe("command");
    expect(externalToolKind("linear create_ticket")).toBe("other");
  });

  it("names the Trama tool that does the job", () => {
    expect(refusalReason("github", COORDINATOR)).toBe(
      "Gli strumenti GitHub del provider sono bloccati: per le issue usa read_issues di Trama. Non chiedere alla persona di eseguire comandi nel terminale per leggere dati che Trama può leggere.",
    );
    expect(refusalReason("github", ["ask_coordinator"])).toContain("chiedila al Coordinatore con ask_coordinator");
    expect(refusalReason("github", [])).toContain("scrivi nella risposta cosa manca");
    expect(refusalReason("web", COORDINATOR)).toContain("Trama non consente accessi alla rete");
    expect(refusalReason("command", COORDINATOR)).toContain("Per le verifiche usa run_readonly_check.");
    expect(refusalReason("other", COORDINATOR)).toContain("usa gli strumenti di Trama");
  });

  it("records each refusal as an activity and tells the next turn once", () => {
    const refusals = new ToolRefusals(() => COORDINATOR);
    const events: TurnEvent[] = [];
    const reason = refusals.record({ itemId: "t1", tool: "github: list_issues" }, (e) => events.push(e));
    expect(events).toEqual([{ type: "toolRefused", itemId: "t1", tool: "github: list_issues", reason }]);
    expect(refusals.takeNotice()).toBe(`Nel turno precedente Trama ha bloccato questi strumenti del provider:\n- github: list_issues: ${reason}`);
    expect(refusals.takeNotice()).toBeNull();
  });

  it("tells every agent to use Trama's tools and never the person's terminal", () => {
    expect(providerToolsRule("coordinator")).toContain("use Trama's read_issues");
    expect(providerToolsRule("coordinator")).toContain("Never ask the person to run a terminal command");
    expect(providerToolsRule("developer")).toContain("ask_coordinator");
    expect(providerToolsRule("none")).not.toContain("command,");
    expect(developerInstructions("Demo")).toContain(providerToolsRule("coordinator"));
    expect(TOOL_SERVER_INSTRUCTIONS).toContain("instead of your provider's own GitHub, web and command tools");
  });
});
