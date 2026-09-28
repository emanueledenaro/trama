import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "./process";
import { findSensitiveData, isItalianVatNumber, redactSensitiveData, repositoryLocator } from "./redaction";

// Made at run time, so the source holds no string a secret scanner takes for a real token.
const shopifyToken = ["shpat", "0123456789abcdef".repeat(2)].join("_");
const githubToken = ["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("_");

const kinds = (text: string) => findSensitiveData(text).map((f) => [f.kind, f.value]);

describe("redaction (issue #391)", () => {
  it("recognizes VAT numbers by their check digit, with or without the country code", () => {
    expect(isItalianVatNumber("01234567897")).toBe(true);
    expect(isItalianVatNumber("01234567890")).toBe(false);
    expect(isItalianVatNumber("00000000000")).toBe(false);
    expect(kinds("P.IVA 01234567897")).toEqual([["vatNumber", "01234567897"]]);
    expect(kinds("VAT IT12345678903.")).toEqual([["vatNumber", "12345678903"]]);
    // Eleven digits that are not a VAT number, an issue number or a commit hash stay.
    expect(kinds("ordine 01234567890, issue #391, commit 0123456789701234567897abcdef")).toEqual([]);
  });

  it("recognizes fiscal and SDI codes", () => {
    expect(kinds("CF RSSMRA85T10A562S")).toEqual([["fiscalCode", "RSSMRA85T10A562S"]]);
    expect(kinds("Codice destinatario: M5UXCR1")).toEqual([["sdiCode", "M5UXCR1"]]);
    expect(kinds('"sdi": "KRRH6B9"')).toEqual([["sdiCode", "KRRH6B9"]]);
    // The label alone, followed by an ordinary word, is not a code.
    expect(kinds("Il codice SDI attuale è sbagliato")).toEqual([]);
  });

  it("tells PEC from ordinary email and leaves automated and example addresses", () => {
    expect(kinds("scrivere a bottegarossi@pec.it o a ordini@bottegarossi.it")).toEqual([
      ["pec", "bottegarossi@pec.it"],
      ["email", "ordini@bottegarossi.it"],
    ]);
    expect(kinds("amministrazione@legalmail.it")).toEqual([["pec", "amministrazione@legalmail.it"]]);
    expect(kinds("Co-Authored-By: Bot <noreply@anthropic.com>, 123+ada@users.noreply.github.com, ada@example.com, git@github.com:o/r.git")).toEqual([]);
  });

  it("recognizes street addresses with their postcode and city", () => {
    expect(kinds("sede in Via Garibaldi 12, 20121 Milano.")).toEqual([["address", "Via Garibaldi 12, 20121 Milano"]]);
    expect(kinds("Piazza della Repubblica 3/B")).toEqual([["address", "Piazza della Repubblica 3"]]);
    expect(kinds("corso Vittorio Emanuele II, 45")).toEqual([["address", "corso Vittorio Emanuele II, 45"]]);
    // An Italian "via" that is not a street stays.
    expect(kinds("passa via email entro 3 giorni")).toEqual([]);
  });

  it("recognizes the shop's domains and tokens, and leaves names in code", () => {
    expect(kinds("https://bottega-rossi.myshopify.com/admin e admin.shopify.com/store/bottega-rossi")).toEqual([
      ["shopDomain", "bottega-rossi.myshopify.com"],
      ["shopDomain", "admin.shopify.com/store/bottega-rossi"],
    ]);
    expect(kinds(shopifyToken)).toEqual([["token", shopifyToken]]);
    expect(kinds(githubToken)).toEqual([["token", githubToken]]);
    expect(kinds("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----")).toEqual([["token", "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"]]);
    expect(kinds("Authorization: Bearer abcDEF123456ghiJKL789")).toEqual([["token", "abcDEF123456ghiJKL789"]]);
    expect(kinds('SHOPIFY_API_KEY="a1b2c3d4e5f6g7h8"')).toEqual([["token", "a1b2c3d4e5f6g7h8"]]);
    expect(kinds("const token = readTokenFromSettings(options)")).toEqual([]);
    expect(kinds("IBAN IT60X0542811101000000123456")).toEqual([["iban", "IT60X0542811101000000123456"]]);
  });

  it("keeps the text around each value and the label that tells what was there", async () => {
    expect(await redactSensitiveData("P.IVA 01234567897, PEC bottegarossi@pec.it.")).toBe("P.IVA [partita IVA rimossa], PEC [PEC rimossa].");
    expect(await redactSensitiveData("Nessun dato sensibile qui: issue #391, 2026-09-28.")).toBe("Nessun dato sensibile qui: issue #391, 2026-09-28.");
    // A value inside another is removed once, as the wider one.
    expect(await redactSensitiveData(`token=${githubToken}`)).toBe("token=[token rimosso]");
  });

  it("names the tracked file and line that hold each value, and nothing for a value only the text has", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-redaction-"));
    await mkdir(join(repo, "config"));
    await writeFile(join(repo, "config/negozio.yml"), "nome: Bottega Rossi\npiva: '01234567897'\n");
    await writeFile(join(repo, ".env"), "PEC=bottegarossi@pec.it\n");
    await git(["init", "-q", "-b", "main"], repo, false);
    await git(["add", "config"], repo, false);
    const text = "P.IVA 01234567897 e PEC bottegarossi@pec.it";
    expect(await redactSensitiveData(text, repositoryLocator(repo))).toBe("P.IVA [partita IVA rimossa, vedi config/negozio.yml:2] e PEC [PEC rimossa]");
    // A folder that is not a repository gives placeholders without a reference.
    expect(await redactSensitiveData(text, repositoryLocator(await mkdtemp(join(tmpdir(), "trama-empty-"))))).toBe("P.IVA [partita IVA rimossa] e PEC [PEC rimossa]");
  });
});
