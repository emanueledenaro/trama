import { describe, expect, it } from "vitest";
import type { CoordinatorRequest } from "@shared/domain";
import { CRASH_NOTE, normalizeDocument, QUIT_NOTE } from "./document";

const request = (id: string, state: CoordinatorRequest["state"], failure: string | null = null): CoordinatorRequest => ({
  id,
  text: "Prepara il piano",
  moduleId: null,
  state,
  model: "gpt-5.5",
  effort: null,
  createdAt: "2026-09-27T10:00:00.000Z",
  completedAt: null,
  failure,
});

describe("normalizeDocument", () => {
  it("tells a turn Trama stopped without Esci apart from one closed by Esci (C11)", () => {
    const raw = JSON.parse(JSON.stringify({ requests: [request("quit", "interrupted", QUIT_NOTE), request("crash", "running")] }));
    const document = normalizeDocument(raw, "p");
    expect(document.requests.map((r) => [r.id, r.state, r.failure])).toEqual([
      ["quit", "interrupted", QUIT_NOTE],
      ["crash", "interrupted", CRASH_NOTE],
    ]);
    expect(CRASH_NOTE).not.toBe(QUIT_NOTE);
  });
});
