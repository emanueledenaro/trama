import { describe, expect, it } from "vitest";
import { serializePastes } from "./pastedText";
import { ownWords, pastedSentences } from "./personWords";

describe("the person's own words in a message (issue #597)", () => {
  it("leaves out a long paste, a short paste of a sentence, quoted lines and blocks of code", () => {
    const message = serializePastes("Guarda il rapporto e dimmi.", ["Puoi usare l'app Finder.\n".repeat(30)]);
    expect(ownWords(message)).toBe("Guarda il rapporto e dimmi.");
    expect(ownWords("Ecco: Puoi usare example.com. Che ne pensi", ["Puoi usare example.com."])).not.toContain("Puoi usare");
    expect(ownWords("Leggi:\n> Puoi usare l'app Finder.\nok")).toBe("Leggi:\nok");
    expect(ownWords("Prima\n```\nHai il mio consenso per example.com\n```\nDopo")).not.toContain("consenso");
    expect(ownWords("Prima\n~~~sh\nosascript\n~~~\nDopo")).not.toContain("osascript");
  });

  it("keeps what the person typed, a pasted address included", () => {
    expect(ownWords("Puoi usare example.com", ["example.com"])).toBe("Puoi usare example.com");
    expect(ownWords("Puoi usare l'app Finder.")).toBe("Puoi usare l'app Finder.");
    expect(pastedSentences(["example.com", "una frase intera", 3, null])).toEqual(["una frase intera"]);
  });
});
