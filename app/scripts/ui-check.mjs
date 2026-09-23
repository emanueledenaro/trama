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
await page.getByRole("button", { name: "Prepara un piano" }).click();
await page.getByText("Da rivedere").first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(400);
await shot("03a-plan");
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-decisione]");
await page.keyboard.press("Enter");
await page.getByText("Ordine 42, già pagato, annullato dal cliente").waitFor({ timeout: 20_000 });
await shot("03b-decision-card");
await page.getByRole("button", { name: /Va in revisione/ }).click();
await page.getByRole("button", { name: "Registra la decisione" }).last().click();
await page.getByText("Apri nel Patto").first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(800);
await shot("03c-decision-answered");
await page.getByText("Ha lavorato per").first().click();
await shot("04-work-expanded");
await page.getByLabel("Messaggio al Coordinatore").fill("[proponi-team]");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Conferma il team" }).waitFor({ timeout: 20_000 });
await shot("04b-team-proposal");
await page.getByRole("button", { name: "Conferma il team" }).click();
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Scrivi", exact: true }).click();
await page.getByLabel("Obiettivi").fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await shot("04c-mandate-granted");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("[assegna]");
await page.keyboard.press("Enter");
await page.getByText("Concluso", { exact: true }).first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(500);
await shot("04d-assignment-done");
await page.getByRole("button", { name: /^Team/ }).first().click();
await shot("04e-team-inspector");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// Candidate: correct the mandate to allow integration, then declare, verify, review and clear.
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
const body = await page.locator("body").innerText();
const assignmentId = body.match(/Incarico (A-[0-9A-F]{8})/)[1];
const decisionId = body.match(/Decisione (D-[0-9A-F]{8})/)[1];
await page.getByLabel("Messaggio al Coordinatore").fill(`[candidato:${assignmentId}:${decisionId}]`);
await page.keyboard.press("Enter");
await page.getByText("Deciso", { exact: true }).first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(500);
await shot("04f-candidate");
await page.getByRole("button", { name: "Apri il diff" }).first().click();
await shot("04g-candidate-diff");
await page.getByRole("button", { name: "Approva questo candidato" }).first().click();
await page.waitForTimeout(500);
await shot("04h-candidate-approved");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
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
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Impostazioni" }).click();
await shot("12-settings");
await app.close();
