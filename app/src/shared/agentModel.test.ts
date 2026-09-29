import { describe, expect, it } from "vitest";
import { agentModelState, effortLabel, personModel } from "./agentModel";
import type { AgentModelChoice, Specialist } from "./domain";
import { translator } from "./i18n";

const choice = (extra: Partial<AgentModelChoice> = {}): AgentModelChoice => ({ provider: "claudeAgent", model: "opus", effort: "high", chosenAt: "", ...extra });
const agent = (chosenModel: AgentModelChoice | null) => ({ id: "S1", chosenModel }) as Specialist;

describe("agentModelState", () => {
  it("says whether the person's model can run the next assignment", () => {
    expect(agentModelState(null, [])).toBe("none");
    expect(agentModelState(choice(), [{ id: "codex", models: [] }])).toBe("providerOff");
    expect(agentModelState(choice(), [{ id: "claudeAgent", models: ["sonnet"] }])).toBe("modelGone");
    expect(agentModelState(choice(), [{ id: "claudeAgent", models: ["opus", "sonnet"] }])).toBe("ready");
    // A catalogue not read yet offers every model.
    expect(agentModelState(choice(), [{ id: "claudeAgent", models: [] }])).toBe("ready");
  });
});

describe("personModel", () => {
  it("gives the person's model only when it can run the work", () => {
    const providers = [{ id: "claudeAgent" as const, models: ["opus"] }];
    expect(personModel(agent(choice()), providers, false)).toMatchObject({ provider: "claudeAgent", model: "opus", effort: "high" });
    expect(personModel(agent(null), providers, true)).toBeNull();
    expect(personModel(agent(choice({ model: "haiku" })), providers, true)).toBeNull();
  });
});

describe("effortLabel", () => {
  it("names the known levels and keeps the provider's id for the others", () => {
    expect(effortLabel(translator("it"), "high")).toBe("Alto");
    expect(effortLabel(translator("en"), "xhigh")).toBe("Very high");
    expect(effortLabel(translator("it"), "turbo")).toBe("turbo");
  });
});
