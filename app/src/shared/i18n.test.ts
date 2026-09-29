import { describe, expect, it } from "vitest";
import {
  CATALOGS,
  formatAgo,
  formatDate,
  formatNumber,
  formatRelativeTime,
  LANGUAGES,
  languageFromSystem,
  placeholders,
  translate,
  translator,
} from "./i18n";

const keysOf = (language: (typeof LANGUAGES)[number]) => Object.keys(CATALOGS[language]).sort();

describe("translation catalogs (issue #301)", () => {
  it("has every key in every language", () => {
    const reference = new Set(keysOf("it"));
    for (const language of LANGUAGES) {
      const keys = new Set(keysOf(language));
      expect([...reference].filter((key) => !keys.has(key)), `keys missing in ${language}`).toEqual([]);
      expect([...keys].filter((key) => !reference.has(key)), `keys in ${language} that Italian does not have`).toEqual([]);
    }
  });

  it("uses the same placeholders in every language", () => {
    for (const key of keysOf("it")) {
      const expected = placeholders(CATALOGS.it[key as keyof typeof CATALOGS.it]);
      for (const language of LANGUAGES) {
        expect(placeholders(CATALOGS[language][key as keyof typeof CATALOGS.it]), `${language}: ${key}`).toEqual(expected);
      }
    }
  });

  it("leaves no text empty and writes no em or en dashes", () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(CATALOGS[language])) {
        expect(text.trim(), `${language}: ${key}`).not.toBe("");
        expect(text, `${language}: ${key}`).not.toMatch(/[–—]/);
      }
    }
  });

  it("gives every singular a plural to fall back to", () => {
    for (const key of keysOf("it").filter((k) => k.endsWith(".one"))) {
      expect(keysOf("it"), key).toContain(key.slice(0, -".one".length));
    }
  });
});

describe("translate", () => {
  it("fills the placeholders and formats numbers for the language", () => {
    expect(translate("it", "welcome.setup.count", { done: 1, total: 3 })).toBe("1 su 3 fatti");
    expect(translate("en", "welcome.setup.count", { done: 1, total: 3 })).toBe("1 of 3 done");
    expect(translate("it", "settings.connections.models", { count: 12000 })).toBe("12.000 modelli");
    expect(translate("en", "settings.connections.models", { count: 12000 })).toBe("12,000 models");
  });

  it("takes the singular when count is 1", () => {
    expect(translate("en", "settings.connections.models", { count: 1 })).toBe("1 model");
    expect(translate("it", "settings.connections.models", { count: 1 })).toBe("1 modello");
    expect(translate("it", "settings.connections.models", { count: 0 })).toBe("0 modelli");
  });

  it("keeps a placeholder without a value, for the renderer to fill with a node", () => {
    expect(translate("en", "github.detail.signedOut")).toBe("gh is not signed in. Run {command} in the terminal, then press Check again.");
  });

  it("falls back to Italian for an unknown language", () => {
    expect(translator("fr" as never)("welcome.title")).toBe("Benvenuto in Trama");
    expect(translator(undefined)("welcome.title")).toBe("Benvenuto in Trama");
  });
});

describe("system language", () => {
  it("takes the first preferred language Trama has", () => {
    expect(languageFromSystem(["en-GB", "it-IT"])).toBe("en");
    expect(languageFromSystem(["de-DE", "it_IT.UTF-8"])).toBe("it");
    expect(languageFromSystem(["EN"])).toBe("en");
  });

  it("falls back to Italian", () => {
    expect(languageFromSystem([])).toBe("it");
    expect(languageFromSystem(["de-DE", null, ""])).toBe("it");
  });
});

describe("formatters", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const before = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("writes relative times with the units of the language", () => {
    expect(formatRelativeTime("it", before(10), now)).toBe("ora");
    expect(formatRelativeTime("en", before(10), now)).toBe("now");
    expect(formatRelativeTime("it", before(3 * 86_400), now)).toBe("3g");
    expect(formatRelativeTime("en", before(3 * 86_400), now)).toBe("3d");
    expect(formatRelativeTime("en", before(14 * 86_400), now)).toBe("2w");
    expect(formatRelativeTime("en", before(400 * 86_400), now)).toBe("1y");
  });

  it("says how long ago, leaving now as it is", () => {
    expect(formatAgo("it", before(300), now)).toBe("5m fa");
    expect(formatAgo("en", before(300), now)).toBe("5m ago");
    expect(formatAgo("en", before(5), now)).toBe("now");
  });

  it("formats numbers and dates for the language", () => {
    expect(formatNumber("it", 1234.5)).toBe("1234,5");
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatDate("en", "2026-03-05T09:30:00Z")).toMatch(/Mar/);
    expect(formatDate("it", "2026-03-05T09:30:00Z")).toMatch(/mar/);
  });
});
