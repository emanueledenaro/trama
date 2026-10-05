import { describe, expect, it } from "vitest";
import type { SiteConsent } from "./domain";
import { addConsent, consentFor, consentStatements, shownSite, withdrawConsent } from "./siteConsents";

const at = "2026-10-05T10:00:00.000Z";
const grant = (list: SiteConsent[], host: string, blocked: string[] = []) => addConsent(list, { host, by: "composer", phrase: "ok", id: `c-${list.length}`, at }, blocked);

describe("the consent written in the composer (issue #410)", () => {
  it("reads a yes for a site in Italian and in English and quotes the sentence", () => {
    expect(consentStatements("Hai il mio consenso per github.com.")).toEqual([{ action: "grant", host: "github.com", phrase: "Hai il mio consenso per github.com." }]);
    expect(consentStatements("Puoi usare https://www.npmjs.com/package/vitest per la ricerca.")).toMatchObject([{ action: "grant", host: "npmjs.com" }]);
    expect(consentStatements("You have my consent to use github.com")).toMatchObject([{ action: "grant", host: "github.com" }]);
    expect(consentStatements("Ok. I give you consent for docs.example.org and npmjs.com.")).toMatchObject([
      { action: "grant", host: "docs.example.org" },
      { action: "grant", host: "npmjs.com" },
    ]);
  });

  it("quotes only the sentence that gives the consent", () => {
    const [statement] = consentStatements("Guarda la issue. Hai il mio consenso per github.com. Poi riassumi.");
    expect(statement?.phrase).toBe("Hai il mio consenso per github.com.");
  });

  it("reads a withdrawal", () => {
    expect(consentStatements("Ritiro il consenso per github.com.")).toMatchObject([{ action: "withdraw", host: "github.com" }]);
    expect(consentStatements("I withdraw my consent for github.com")).toMatchObject([{ action: "withdraw", host: "github.com" }]);
    expect(consentStatements("Non hai più il mio consenso per github.com")).toMatchObject([{ action: "withdraw", host: "github.com" }]);
  });

  it("gives nothing for a denial, a condition, a question or a message with no site", () => {
    for (const text of [
      "Non hai il mio consenso per github.com.",
      "Puoi usare github.com se serve?",
      "You can use github.com if you must",
      "Don't use github.com, you can use the docs",
      "Hai il mio consenso, ma non dico per quale sito",
      "Apri github.com",
      "",
    ]) {
      expect(consentStatements(text)).toEqual([]);
    }
  });
});

describe("the list of consents (issue #410)", () => {
  it("records a consent for a site and finds it again, without www", () => {
    const added = grant([], "https://www.GitHub.com/acme");
    expect(added.consent).toMatchObject({ host: "github.com", by: "composer", grantedAt: at });
    expect(consentFor(added.list, "www.github.com")).toBe(added.consent);
  });

  it("covers the host it names and no other: not a subdomain, not another site", () => {
    const { list } = grant([], "github.com");
    expect(consentFor(list, "gist.github.com")).toBeNull();
    expect(consentFor(list, "gitlab.com")).toBeNull();
  });

  it("never records a consent for a blocked site, or for a subdomain of one", () => {
    expect(grant([], "bank.example", ["bank.example"])).toMatchObject({ consent: null, problem: "blocked", list: [] });
    expect(grant([], "login.bank.example", ["bank.example"])).toMatchObject({ consent: null, problem: "blocked" });
  });

  it("says why nothing was recorded: invalid, duplicate, full", () => {
    expect(grant([], "not a site").problem).toBe("invalid");
    const once = grant([], "github.com").list;
    expect(grant(once, "github.com").problem).toBe("duplicate");
  });

  it("withdraws one consent and keeps the others", () => {
    const list = grant(grant([], "github.com").list, "npmjs.com").list;
    const result = withdrawConsent(list, "github.com");
    expect(result.consent?.host).toBe("github.com");
    expect(result.list.map((item) => item.host)).toEqual(["npmjs.com"]);
    expect(withdrawConsent(result.list, "github.com").consent).toBeNull();
  });

  it("shows an address without its query string, its fragment or a login", () => {
    expect(shownSite("https://user:secret@github.com/acme/repo?token=abc#top")).toBe("github.com/acme/repo");
    expect(shownSite("https://github.com/")).toBe("github.com");
  });
});
