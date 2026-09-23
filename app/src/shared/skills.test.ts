import { describe, expect, it } from "vitest";
import { codexSkillText, skillCandidates, skillInvocations } from "./skills";

const skills = [
  { name: "tdd", path: "/p/tdd/SKILL.md", enabled: true, description: "Test-driven development" },
  { name: "code-review", path: "/p/cr/SKILL.md", enabled: true, description: "Review a diff" },
  { name: "off", path: "/p/off/SKILL.md", enabled: false, description: null },
];

describe("composer skills", () => {
  it("finds, invokes and rewrites skills", () => {
    expect(skillCandidates("rev", skills)[0]!.name).toBe("code-review");
    expect(skillCandidates("zzz", skills)).toEqual([]);
    expect(skillCandidates("", skills).map((s) => s.name)).toEqual(["code-review", "tdd"]);
    expect(skillInvocations("Usa /tdd e $tdd poi $off.", skills).map((s) => s.name)).toEqual(["tdd"]);
    expect(codexSkillText("Usa /tdd e /off", skills)).toBe("Usa $tdd e /off");
  });
});
