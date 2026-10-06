import { describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { plainSmellNames, SMELL_NAMES } from "./smellNames";

describe("English code smell names in the interface", () => {
  it("writes the names in Italian for an Italian interface", () => {
    const t = translator("it");
    expect(plainSmellNames(t, "Possibile Mysterious Name in Sources/Orders/Order.swift")).toBe("Possibile Nome poco chiaro in Sources/Orders/Order.swift");
    expect(plainSmellNames(t, "Long Parameter List e long function")).toBe("Troppi parametri e Funzione troppo lunga");
    expect(plainSmellNames(t, "Nessun difetto")).toBe("Nessun difetto");
  });

  it("keeps the English names for an English interface", () => {
    const t = translator("en");
    expect(plainSmellNames(t, "Possible Mysterious Name in Order.swift")).toBe("Possible Mysterious Name in Order.swift");
  });

  it("leaves no English name in the Italian catalog", () => {
    const it = translator("it");
    for (const smell of SMELL_NAMES) expect(it(smell.key), smell.english).not.toBe(smell.english);
  });
});
