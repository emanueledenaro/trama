import { describe, expect, it } from "vitest";
import type { AccessStep } from "./domain";
import { accessStepEntries } from "./computerAccess";
import { translator } from "./i18n";
import { addBlockedSite, blockedHostFrom, cleanBlockedSites, isBlockedAddress, isBlockedHost, MAXIMUM_BLOCKED_SITES, removeBlockedSite } from "./blockedSites";

describe("the host the person means", () => {
  it("reads a bare host, an address, a wildcard and a www name as the same host", () => {
    for (const input of ["bank.example", "BANK.example", "https://www.bank.example/login?x=1", "*.bank.example", " bank.example. ", "http://bank.example:8080/a"]) {
      expect(blockedHostFrom(input), input).toBe("bank.example");
    }
    expect(blockedHostFrom("10.0.0.5")).toBe("10.0.0.5");
  });

  it("refuses text that holds no host", () => {
    for (const input of ["", "  ", "bank", "not a site", "ftp://", "a".repeat(400)]) expect(blockedHostFrom(input), input).toBeNull();
  });
});

describe("the list of blocked sites", () => {
  it("blocks the host and its subdomains, not a host that only ends the same way", () => {
    const list = ["bank.example"];
    expect(isBlockedHost("bank.example", list)).toBe(true);
    expect(isBlockedHost("www.bank.example", list)).toBe(true);
    expect(isBlockedHost("login.eu.BANK.example", list)).toBe(true);
    expect(isBlockedHost("notbank.example", list)).toBe(false);
    expect(isBlockedHost("bank.example.evil.test", list)).toBe(false);
    expect(isBlockedAddress("https://shop.bank.example/a?b=1", list)).toBe(true);
    expect(isBlockedAddress("https://docs.example.org/", list)).toBe(false);
    expect(isBlockedAddress("not an address", list)).toBe(false);
  });

  it("keeps hosts once each, sorted, and drops what is not a host", () => {
    expect(cleanBlockedSites(["b.example", "https://www.a.example/x", "b.example", 7, "nope", null])).toEqual(["a.example", "b.example"]);
    expect(cleanBlockedSites("a.example")).toEqual([]);
    expect(cleanBlockedSites(Array.from({ length: 300 }, (_, i) => `site${String(i).padStart(3, "0")}.example`))).toHaveLength(MAXIMUM_BLOCKED_SITES);
  });

  it("adds and removes a site, and says why an add did nothing", () => {
    const first = addBlockedSite([], "https://www.shop.example/admin");
    expect(first).toEqual({ list: ["shop.example"], host: "shop.example", problem: null });
    expect(addBlockedSite(first.list, "shop.example")).toMatchObject({ list: ["shop.example"], problem: "duplicate" });
    expect(addBlockedSite(first.list, "nope")).toMatchObject({ list: ["shop.example"], host: null, problem: "invalid" });
    const full = Array.from({ length: MAXIMUM_BLOCKED_SITES }, (_, i) => `site${String(i).padStart(3, "0")}.example`);
    expect(addBlockedSite(full, "one-more.example").problem).toBe("full");
    expect(removeBlockedSite(["a.example", "b.example"], "a.example")).toEqual(["b.example"]);
  });
});

describe("a refusal for a blocked site in Activity", () => {
  it.each(["it", "en"] as const)("tells the person the site is blocked (%s)", (language) => {
    const t = translator(language);
    const step: AccessStep = { id: "s", at: "2026-10-04T10:00:00.000Z", agent: "Ricerca", kind: "page", target: "https://bank.example/login", outcome: "blocked", detail: "bank.example" };
    const [entry] = accessStepEntries(t, [step]);
    expect(entry!.outcome).toBe("failed");
    expect(entry!.detail).toBe(`${t("activity.access.blocked")} bank.example`);
  });
});
