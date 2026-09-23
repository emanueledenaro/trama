// Launches the built app with the fake Codex server and saves screenshots of the main screens.
// Usage: node scripts/ui-check.mjs <output-dir>
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const out = resolve(process.argv[2] ?? "ui-check");
const dataDir = await mkdtemp(join(tmpdir(), "trama-ui-"));
const app = await electron.launch({
  args: [".", "--no-sandbox"],
  env: {
    ...process.env,
    TRAMA_DATA_DIR: dataDir,
    TRAMA_CODEX_PATH: resolve("test-fixtures/fake-codex.mjs"),
  },
});
const page = await app.firstWindow();
page.on("console", (m) => console.log("[renderer]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.setViewportSize({ width: 1280, height: 820 });
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("saved", name);
};

await page.getByText("Su cosa vuoi lavorare?").waitFor();
await shot("01-landing");
await page.getByText("Esplora il progetto di esempio").click();
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 20_000 });
await shot("02-demo-study");
await page.getByLabel("Messaggio al Coordinatore").fill("Cosa succede quando si annulla un ordine pagato?");
await page.keyboard.press("Enter");
await page.getByText("Ha lavorato per").first().waitFor({ timeout: 20_000 });
await shot("03-reply");
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-decisione]");
await page.keyboard.press("Enter");
await page.getByText("Registra la decisione").waitFor({ timeout: 20_000 });
await shot("03b-decision-card");
await page.getByRole("button", { name: /Va in revisione/ }).click();
await page.getByRole("button", { name: "Registra la decisione" }).click();
await page.getByText("Apri nel Patto").waitFor({ timeout: 20_000 });
await page.waitForTimeout(800);
await shot("03c-decision-answered");
await page.getByText("Ha lavorato per").first().click();
await shot("04-work-expanded");
await page.getByRole("button", { name: "Mappa del progetto" }).click();
await shot("05-map");
await page.getByRole("button", { name: /Orders/ }).first().click();
await shot("06-module");
await page.getByRole("button", { name: /CancelPaidOrder.swift/ }).first().click();
await shot("07-file");
await page.getByRole("button", { name: /^Patto/ }).first().click();
await shot("08-pact");
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await shot("09-mandate");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await shot("10-dark");
await page.getByRole("button", { name: /Codex di OpenAI/ }).click();
await shot("11-connections");
await app.close();
