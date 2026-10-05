import { describe, expect, it } from "vitest";
import { addAppConsent, appConsentFor, appConsentStatements, withdrawAppConsent } from "./appConsents";
import type { AppConsent } from "./domain";

const AT = "2026-10-05T10:00:00.000Z";

describe("the consents per app (issue #412)", () => {
  it("reads a consent the person wrote, with the app and their sentence", () => {
    expect(appConsentStatements("Puoi usare l'app Finder.")).toEqual([{ action: "grant", app: "Finder", phrase: "Puoi usare l'app Finder." }]);
    expect(appConsentStatements("Hai il mio consenso per l'app Visual Studio Code.")).toMatchObject([{ action: "grant", app: "Visual Studio Code" }]);
    expect(appConsentStatements("You can use the app \"System Settings\".")).toMatchObject([{ action: "grant", app: "System Settings" }]);
    expect(appConsentStatements("Ti do il consenso per l'applicazione «Note»")).toMatchObject([{ action: "grant", app: "Note" }]);
  });

  it("reads a withdrawal the same way", () => {
    expect(appConsentStatements("Ritiro il consenso per l'app Finder.")).toMatchObject([{ action: "withdraw", app: "Finder" }]);
    expect(appConsentStatements("Withdraw my consent for the app Notes.")).toMatchObject([{ action: "withdraw", app: "Notes" }]);
  });

  it("gives nothing for a denial, a condition, a question, or a name without the word app", () => {
    expect(appConsentStatements("Non puoi usare l'app Finder.")).toEqual([]);
    expect(appConsentStatements("Se serve puoi usare l'app Finder.")).toEqual([]);
    expect(appConsentStatements("Posso usare l'app Finder?")).toEqual([]);
    expect(appConsentStatements("Puoi usare Finder.")).toEqual([]);
    expect(appConsentStatements("Hai il mio consenso per github.com.")).toEqual([]);
    expect(appConsentStatements("Puoi usare l'app.")).toEqual([]);
  });

  it("finds a consent only for the app it names, ignoring case", () => {
    const list: AppConsent[] = [{ id: "a", app: "Finder", grantedAt: AT, by: "button", phrase: null }];
    expect(appConsentFor(list, "finder")?.id).toBe("a");
    expect(appConsentFor(list, "  FINDER ")?.id).toBe("a");
    expect(appConsentFor(list, "Finder Pro")).toBeNull();
    expect(appConsentFor(undefined, "Finder")).toBeNull();
  });

  it("records a consent once, and says why it did not", () => {
    const first = addAppConsent([], { app: "Finder", by: "composer", phrase: "Puoi usare l'app Finder.", id: "1", at: AT });
    expect(first.consent).toMatchObject({ app: "Finder", by: "composer", phrase: "Puoi usare l'app Finder.", grantedAt: AT });
    expect(addAppConsent(first.list, { app: "finder", by: "button", phrase: null, id: "2", at: AT }).problem).toBe("duplicate");
    expect(addAppConsent([], { app: "  ", by: "button", phrase: null, id: "3", at: AT }).problem).toBe("invalid");
  });

  it("withdraws a consent and leaves the others", () => {
    const list = [
      addAppConsent([], { app: "Finder", by: "button", phrase: null, id: "1", at: AT }).consent!,
      addAppConsent([], { app: "Notes", by: "button", phrase: null, id: "2", at: AT }).consent!,
    ];
    const result = withdrawAppConsent(list, "finder");
    expect(result.consent?.app).toBe("Finder");
    expect(result.list.map((item) => item.app)).toEqual(["Notes"]);
    expect(withdrawAppConsent(result.list, "Finder").consent).toBeNull();
  });
});
