import { describe, expect, it } from "vitest";
import {
  chooseActiveBranch,
  closedRecord,
  emptyConsent,
  freshnessLabel,
  isShareablePath,
  parsePresenceRecord,
  presenceEntries,
  presenceFreshness,
  presenceMode,
  type PresenceRecord,
  presenceUser,
  shouldProposeConsent,
  shouldReproposeConsent,
} from "./presence";

const now = new Date("2026-09-26T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function record(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    version: 1,
    user: "bea",
    name: "Bea",
    activeBranch: "feature/pagamenti",
    alsoOn: [],
    localBranches: ["main", "feature/pagamenti"],
    files: ["src/payments.ts"],
    task: { kind: "goal", title: "Pagamenti con carta" },
    since: ago(30),
    lastActivityAt: ago(1),
    updatedAt: ago(0.5),
    closedAt: null,
    agents: [],
    ...overrides,
  };
}

describe("presence freshness (decision 7)", () => {
  it("is active while changes are recent and idle after 10 minutes", () => {
    expect(presenceFreshness(record(), now).status).toBe("active");
    const idle = presenceFreshness(record({ lastActivityAt: ago(12) }), now);
    expect(idle).toEqual({ status: "idle", idleMinutes: 12, lastSeenAt: null });
    expect(freshnessLabel(idle, now)).toBe("inattivo da 12 min");
  });

  it("shows the last time seen after a close or a missing heartbeat", () => {
    const closed = presenceFreshness(record({ closedAt: ago(90), updatedAt: ago(90) }), now);
    expect(closed.status).toBe("offline");
    expect(freshnessLabel(closed, now)).toBe("visto l'ultima volta 2 ore fa");
    expect(presenceFreshness(record({ updatedAt: ago(5) }), now).status).toBe("offline");
  });

  it("drops a presence after 7 days", () => {
    expect(presenceFreshness(record({ updatedAt: ago(7 * 24 * 60 + 1) }), now).status).toBe("expired");
    const entries = presenceEntries([record({ user: "old", updatedAt: ago(8 * 24 * 60) }), record(), record({ user: "me" })], "me", now);
    expect(entries.map((e) => e.record.user)).toEqual(["bea"]);
  });
});

describe("active branch (decision 8)", () => {
  const branches = [
    { name: "main", lastChangeAt: ago(60) },
    { name: "feature/a", lastChangeAt: ago(5) },
    { name: "feature/old", lastChangeAt: ago(30 * 24 * 60) },
  ];

  it("takes the branch of the work in focus", () => {
    expect(chooseActiveBranch({ focusBranch: "main", branches, now })).toEqual({ active: "main", alsoOn: ["feature/a"] });
  });

  it("otherwise takes the branch changed last, and lists the other recent ones as also on", () => {
    expect(chooseActiveBranch({ focusBranch: null, branches, now })).toEqual({ active: "feature/a", alsoOn: ["main"] });
    expect(chooseActiveBranch({ focusBranch: "gone", branches, now }).active).toBe("feature/a");
  });
});

describe("presence records", () => {
  it("builds a valid ref name from a login or an e-mail", () => {
    expect(presenceUser("Emanuele-Denaro")).toBe("emanuele-denaro");
    expect(presenceUser("ada@example.com")).toBe("ada-at-example.com");
    expect(presenceUser("../x..lock")).toBe("x");
    expect(presenceUser("  ")).toBeNull();
  });

  it("never shares paths that may name a secret or leave the repository", () => {
    expect(isShareablePath("src/payments.ts")).toBe(true);
    expect(isShareablePath(".github/workflows/ci.yml")).toBe(true);
    for (const path of [".env", "config/.env.local", "keys/server.pem", "aws-credentials.json", "/etc/passwd", "../x", "a//b"]) {
      expect(isShareablePath(path)).toBe(false);
    }
  });

  it("reads a colleague's record as untrusted data", () => {
    const raw = { ...record(), files: ["src/ok.ts", "../../etc/passwd", ".env", 42], activeBranch: "bad branch", extra: "ignored" };
    const parsed = parsePresenceRecord(raw, "bea")!;
    expect(parsed.files).toEqual(["src/ok.ts"]);
    expect(parsed.activeBranch).toBeNull();
    expect("extra" in parsed).toBe(false);
    expect(parsePresenceRecord(record(), "someone-else")).toBeNull();
    expect(parsePresenceRecord({ ...record(), version: 2 }, "bea")).toBeNull();
  });

  it("keeps only who and when in a closed record", () => {
    const closed = closedRecord(record({ agents: [{ id: "S-1", name: "Ada", color: "blue", tag: "UI", branch: "x", files: ["a"], task: null, since: ago(1), lastActivityAt: ago(1) }] }), now);
    expect(closed).toMatchObject({ activeBranch: null, files: [], task: null, agents: [], localBranches: [], closedAt: now.toISOString() });
  });
});

describe("consent (decision 6)", () => {
  it("is proposed once, when there are other collaborators", () => {
    expect(shouldProposeConsent(undefined, false)).toBe(false);
    expect(shouldProposeConsent(undefined, true)).toBe(true);
    expect(shouldProposeConsent({ ...emptyConsent(), proposedAt: ago(1) }, true)).toBe(false);
  });

  it("is proposed again only once, after a No and at the first conflict", () => {
    const declined = { ...emptyConsent(), choice: "declined" as const, proposedAt: ago(10), decidedAt: ago(9) };
    expect(shouldReproposeConsent(declined, "clean")).toBe(false);
    expect(shouldReproposeConsent(declined, "conflict")).toBe(true);
    expect(shouldReproposeConsent(declined, "overlap")).toBe(true);
    expect(shouldReproposeConsent({ ...declined, reproposedAt: ago(1) }, "conflict")).toBe(false);
    expect(shouldReproposeConsent({ ...declined, choice: "shared" }, "conflict")).toBe(false);
    expect(shouldReproposeConsent(undefined, "conflict")).toBe(false);
  });

  it("shares only with consent, without pause and with push", () => {
    const shared = { ...emptyConsent(), choice: "shared" as const };
    expect(presenceMode({ hasRemote: false, consent: shared, canShare: true })).toBe("local");
    expect(presenceMode({ hasRemote: true, consent: shared, canShare: null })).toBe("shared");
    expect(presenceMode({ hasRemote: true, consent: { ...shared, paused: true }, canShare: true })).toBe("readOnly");
    expect(presenceMode({ hasRemote: true, consent: shared, canShare: false })).toBe("readOnly");
    expect(presenceMode({ hasRemote: true, consent: null, canShare: true })).toBe("readOnly");
  });
});
