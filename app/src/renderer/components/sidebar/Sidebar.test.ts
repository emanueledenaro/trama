import { describe, expect, it } from "vitest";
import type { Specialist, TeamRole } from "@shared/domain";
import { sidebarSpecialists } from "./Sidebar";

describe("sidebarSpecialists (W09)", () => {
  it("lists the developers first, then a fixed role only while it has work to show", () => {
    const s = (name: string, role: TeamRole, status: Specialist["status"]) => ({ name, role, status }) as Specialist;
    const rows = sidebarSpecialists([
      s("QA", "qa", "available"),
      s("Clean Code", "cleanCode", "working"),
      s("Sicurezza", "security", "stopped"),
      s("Ada", "developer", "available"),
      s("Bruno", "developer", "removed"),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Ada", "Clean Code", "Sicurezza"]);
  });
});
