import { describe, expect, it } from "vitest";
import type { ProviderId } from "@shared/codex";
import { PROVIDERS, type ProviderCapabilities } from "@shared/providers";
import { conformanceProblems } from "./conformance";
import { createRuntime } from "./registry";
import type { AgentRuntime } from "./types";

const NINE: ProviderId[] = ["codex", "claudeAgent", "cursor", "antigravity", "grok", "droid", "devin", "opencode", "pi"];
const codex = PROVIDERS.find((p) => p.id === "codex")!.capabilities;

describe("provider adapter shape (issue #71)", () => {
  it("describes the nine providers in display order, each with its adapter", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(NINE);
    for (const id of NINE) {
      const runtime = createRuntime(id);
      expect(runtime.providerId).toBe(id);
      runtime.stop();
    }
  });

  it("binds every declared capability of the nine adapters to the method that realizes it", () => {
    const problems = PROVIDERS.flatMap((provider) => {
      const runtime = createRuntime(provider.id);
      runtime.stop();
      return conformanceProblems(provider.capabilities, runtime);
    });
    expect(problems).toEqual([]);
  });

  it("lists a capability declared without its method and a method left undeclared", () => {
    const runtime = createRuntime("codex");
    runtime.stop();
    const claimed: ProviderCapabilities = { ...codex, supportsTurnSteering: true, conversationRollback: "native", supportsSkillDiscovery: false };
    expect(conformanceProblems(claimed, runtime)).toEqual([
      "codex: listSkills exists but supportsSkillDiscovery is false",
      "codex: supportsTurnSteering needs steerTurn",
      "codex: conversationRollback native needs rollbackThread",
    ]);
  });

  it("accepts rollback by restarting the session with stop and openThread alone", () => {
    const runtime = { providerId: "pi", stop() {}, openThread() {}, listModels() {} } as unknown as AgentRuntime;
    const capabilities: ProviderCapabilities = { ...codex, supportsSkillDiscovery: false, conversationRollback: "restartSession" };
    expect(conformanceProblems(capabilities, runtime)).toEqual([]);
  });
});
