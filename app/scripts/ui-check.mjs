// Launches the built app with the fake Codex server and saves screenshots of the main screens.
// Usage: node scripts/ui-check.mjs <output-dir>
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const out = resolve(process.argv[2] ?? "ui-check");
const dataDir = await mkdtemp(join(tmpdir(), "trama-ui-"));
// Each launch uses the same Trama data folder, so a second launch is a real reopening.
const launch = async () => {
  const app = await electron.launch({
    // Its own Electron profile, so the check runs next to an open Trama instead of hitting its single-instance lock.
    args: [".", "--no-sandbox", `--user-data-dir=${await mkdtemp(join(tmpdir(), "trama-ui-profile-"))}`],
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
  return { app, page };
};
let { app, page } = await launch();
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("saved", name);
};

await page.getByText("Su cosa vuoi lavorare?").waitFor();
// First launch: the guide opens by itself once, with the real state of each step.
const guide = page.getByRole("dialog", { name: "Guida introduttiva" });
await guide.waitFor();
await guide.locator('[data-step="github"][data-status]:not([data-status="checking"])').waitFor();
await shot("00-guide-first-run");
await guide.getByRole("button", { name: /Collega GitHub CLI/ }).click();
await shot("00b-guide-github");
await guide.getByRole("button", { name: "Continua più tardi" }).click();
await guide.waitFor({ state: "hidden" });
await shot("01-landing");
await page.getByText("Esplora il progetto di esempio").click();
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 20_000 });
await shot("02-demo-study");
// The context and model pickers share one panel.
await page.getByRole("button", { name: "Contesto del messaggio" }).click();
await page.getByRole("listbox", { name: "Contesto" }).waitFor();
await shot("02c-context-picker");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /^Provider e modello del Coordinatore/ }).click();
await page.getByRole("listbox", { name: "Modelli" }).waitFor();
await shot("02d-model-picker");
await page.keyboard.press("Escape");
await page.getByLabel("Messaggio al Coordinatore").pressSequentially("Guarda @cancelpa");
await page.getByRole("listbox", { name: "Menzioni" }).waitFor();
await shot("02b-mentions");
await page.keyboard.press("Enter");
const composed = await page.getByLabel("Messaggio al Coordinatore").inputValue();
if (!composed.includes("@Sources/Orders/CancelPaidOrder.swift ")) throw new Error(`Mention not inserted: ${composed}`);
await page.getByLabel("Messaggio al Coordinatore").fill("Cosa succede quando si annulla un ordine pagato?");
await page.keyboard.press("Enter");
await page.getByText("Ha lavorato per").first().waitFor({ timeout: 20_000 });
await shot("03-reply");
// W01: a question for information leaves no step; a request for work ends with one step, on the right.
if (await page.getByTestId("next-step").count()) throw new Error("A next step appeared after a question for information");
if (await page.getByRole("button", { name: "Prepara un piano" }).count()) throw new Error("The fixed plan button is back");
await page.getByLabel("Messaggio al Coordinatore").fill("[grilling:1] [passo:answerQuestions] Gli ordini pagati annullati vanno in revisione");
await page.keyboard.press("Enter");
const nextStep = page.getByTestId("next-step").getByRole("button", { name: "Rispondi alle 2 domande" });
await nextStep.waitFor({ timeout: 20_000 });
const stepBox = await nextStep.boundingBox();
const replyBox = await page.getByTestId("next-step").boundingBox();
if (!stepBox || !replyBox || replyBox.x + replyBox.width - (stepBox.x + stepBox.width) > 2) throw new Error("The next step is not on the right");
await shot("03a-next-step");
await nextStep.click();
await page.waitForTimeout(600);
await shot("03a2-next-step-questions");
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-decisione]");
await page.keyboard.press("Enter");
await page.getByRole("main").getByText("Cosa succede a un ordine pagato annullato?").waitFor({ timeout: 20_000 });
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
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
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
// W09: the full team, moment by moment, with the fixed roles next to the confirmed developer.
const teamPanel = page.getByTestId("inspector");
await teamPanel.getByText("Chiarimento e spec", { exact: true }).waitFor();
await teamPanel.getByRole("button", { name: /^Ada/ }).waitFor();
await shot("04e-team-inspector");
await teamPanel.getByText("In sottofondo", { exact: true }).scrollIntoViewIfNeeded();
await shot("04e1-team-candidate-background");
await teamPanel.getByTestId("team-figure").filter({ hasText: "Guardiano delle regressioni" }).first().click();
await teamPanel.getByText("Quando interviene").waitFor();
if (await teamPanel.getByRole("button", { name: "Togli dal team" }).count()) throw new Error("A fixed role offers to leave the team");
await shot("04e2-team-fixed-role");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// Learning (ADR 0014): the Coordinator saves a note, then a review the person asks for writes memory and a skill.
await page.getByLabel("Messaggio al Coordinatore").fill("[memoria] ricorda il gestore di pacchetti");
await page.keyboard.press("Enter");
await page.getByText(/^Salvato\./).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: /^Memoria/ }).first().click();
await page.getByRole("button", { name: "Rivedi ora" }).click();
await page.getByText("Skill 'release-flow' created").first().waitFor({ timeout: 30_000 });
await shot("04i-memory");
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
// C13: the first exercise's steps come from the document and from observed navigation.
await page.getByRole("button", { name: "Esercizi", exact: true }).click();
const exercise = page.getByRole("complementary", { name: "Esercizio" });
await exercise.getByRole("button", { name: "Mostra la scheda di studio" }).click();
await exercise.getByRole("button", { name: "Scegli un modulo nella mappa" }).click();
await shot("07a-exercise-first");
await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
await exercise.getByText("Esercizio completato.").waitFor({ timeout: 10_000 });
await shot("07b-exercise-first-done");
// C14: the conflict exercise compares the candidate with two simulated local changes.
await exercise.getByRole("tab", { name: "4" }).click();
await exercise.getByRole("button", { name: "Crea le modifiche simulate" }).click();
await exercise.getByText("Esercizio completato.").waitFor({ timeout: 30_000 });
await page.getByText("Modifica simulata da Trama in una copia locale separata").first().waitFor();
await shot("07c-exercise-conflict");
await exercise.getByRole("tab", { name: "2" }).click();
await shot("07d-exercise-change");
await exercise.getByRole("button", { name: "Chiudi l'esercizio" }).click();
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
// Goals (UX01, UX02, UX07): the project has only the goal the Coordinator proposed, so it offers the first one.
await page.getByTestId("goal-card").first().waitFor();
await page.getByRole("button", { name: "Formula il primo obiettivo" }).first().click();
await page.getByLabel("Titolo dell'obiettivo").fill("Ordini annullati in revisione");
await page.getByLabel("Risultato atteso").fill("Un ordine pagato e annullato resta in revisione finché una persona non decide.");
await page.getByLabel("Esempio 1").fill("Ordine 42 pagato e annullato: stato review");
await page.getByRole("button", { name: "Crea l'obiettivo" }).click();
await page.getByTestId("dialog-title").filter({ hasText: "Ordini annullati in revisione" }).waitFor();
await page.getByTestId("goal-dialog-header").waitFor();
// The goal is saved before the dialog opens; its detail shows the stable id used after the restart.
const goalTitle = "Ordini annullati in revisione";
const goalId = (await page.getByText(/^G-[0-9A-F]{8}$/).first().textContent()).trim();
await page.getByLabel("Messaggio al Coordinatore").fill("Da dove partiamo per questo obiettivo?");
await page.keyboard.press("Enter");
await page.getByText(/Dialogo dell'obiettivo G-/).first().waitFor({ timeout: 20_000 });
await shot("10d-goal-dialog");
// The project dialog keeps its own conversation.
await page.getByRole("button", { name: "Dialogo del progetto" }).click();
await page.getByText("Ho letto lo studio").first().waitFor();
if (await page.getByText(/Dialogo dell'obiettivo G-/).count()) throw new Error("The goal dialog leaked into the project dialog");
// The overview (UX03) lists the project with its open goals.
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await page.getByTestId("overview-project").first().getByText("Ordini annullati in revisione").waitFor({ timeout: 10_000 });
await shot("10e-overview");
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// W03: withdraw a grilling question with a reason; the round then waits only for the other answer.
await page.getByLabel("Messaggio al Coordinatore").fill("[grilling:1] Gli ordini pagati annullati vanno in revisione");
await page.keyboard.press("Enter");
const round = page.getByRole("region", { name: "Chiarimento, turno 1" });
await round.waitFor({ timeout: 20_000 });
await round.getByRole("button", { name: "Ritira", exact: true }).first().click();
await round.getByLabel("Motivo del ritiro").fill("Chi vede la revisione lo decidiamo dopo il primo rilascio");
await shot("14a-withdraw-reason");
await round.getByRole("button", { name: "Ritira la domanda" }).click();
await round.getByTestId("withdrawn-question").waitFor({ timeout: 20_000 });
await page.getByText(/Ho ritirato la domanda 1 del chiarimento, turno 1/).first().waitFor({ timeout: 20_000 });
await round.getByRole("button", { name: /Anche il cliente/ }).last().click();
await round.getByRole("button", { name: "Registra la decisione" }).click();
await round.getByText("Turno completo").waitFor({ timeout: 20_000 });
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await round.scrollIntoViewIfNeeded();
await shot("14b-grilling-withdrawn");
// A message sent while the Coordinator works waits in the queue and can be deleted after a confirmation.
await page.getByLabel("Messaggio al Coordinatore").fill("[attesa] Spiegami gli ordini");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Interrompi" }).waitFor({ timeout: 20_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("Questo messaggio resta in coda");
await page.keyboard.press("Enter");
const queuedRow = page.getByTestId("queued-message").filter({ hasText: "Questo messaggio resta in coda" });
await queuedRow.waitFor();
await queuedRow.getByRole("button", { name: "Elimina il messaggio in coda" }).click();
await shot("14c-queued-delete");
await queuedRow.getByRole("button", { name: "Elimina il messaggio", exact: true }).click();
await queuedRow.waitFor({ state: "detached" });
await page.getByRole("button", { name: "Interrompi" }).click();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
if (await page.getByText("Questo messaggio resta in coda").count()) throw new Error("The deleted queued message reached the chat");
// An empty goal dialog is deleted after a confirmation; a goal with history is archived and restored.
await page.getByRole("button", { name: /^Obiettivi/ }).first().click();
await page.getByRole("button", { name: "Nuovo obiettivo" }).click();
await page.getByLabel("Titolo dell'obiettivo").fill("Obiettivo creato per sbaglio");
await page.getByLabel("Risultato atteso").fill("Nessuno: è un doppione.");
await page.getByRole("button", { name: "Crea l'obiettivo" }).click();
await page.getByTestId("dialog-title").filter({ hasText: "Obiettivo creato per sbaglio" }).waitFor();
await page.getByTestId("goal-dialog-header").getByRole("button", { name: "Elimina il dialogo" }).click();
const confirmDelete = page.getByRole("dialog", { name: "Eliminare il dialogo vuoto?" });
await confirmDelete.waitFor();
await shot("14d-delete-empty-dialog");
await confirmDelete.getByRole("button", { name: "Elimina il dialogo" }).click();
await confirmDelete.waitFor({ state: "hidden" });
await page.getByTestId("dialog-title").filter({ hasText: "Progetto di esempio" }).waitFor();
if (await page.getByTestId("sidebar-goal").filter({ hasText: "Obiettivo creato per sbaglio" }).count()) throw new Error("The deleted goal is still in the sidebar");
// A sent message never comes back as the draft, even the one deleted from the queue.
if ((await page.getByLabel("Messaggio al Coordinatore").inputValue()).includes("Questo messaggio resta in coda")) throw new Error("A sent message came back as the draft");
const goalRow = page.getByTestId("sidebar-goal").filter({ hasText: goalTitle });
await goalRow.hover();
await goalRow.getByRole("button", { name: `Archivia ${goalTitle}` }).click();
await goalRow.waitFor({ state: "detached" });
await page.getByRole("button", { name: /^Obiettivi/ }).first().click();
const inspectorPanel = page.getByTestId("inspector");
await inspectorPanel.getByText("Archiviati (1)").waitFor();
await shot("14e-goal-archived");
await inspectorPanel.getByRole("button", { name: new RegExp(goalTitle) }).click();
await inspectorPanel.getByRole("button", { name: "Ripristina" }).click();
await page.getByTestId("sidebar-goal").filter({ hasText: goalTitle }).waitFor();
await shot("14f-goal-restored");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.keyboard.press("Control+K");
await page.getByRole("textbox", { name: "Cerca in Trama" }).fill("cancel");
await page.getByRole("option").first().waitFor();
await shot("10b-search");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await shot("10c-search-result");
await page.getByRole("button", { name: "Indietro" }).first().click();
await page.getByRole("button", { name: /^ChatGPT/ }).click();
await page.getByTestId("settings").waitFor();
await shot("11-connections");
await page.getByRole("button", { name: "Impostazioni" }).click();
await shot("12-settings");
await page.getByRole("button", { name: "Apri la guida" }).click();
await guide.waitFor();
await shot("12a-guide-resume-dark");
await guide.getByRole("button", { name: "Continua più tardi" }).click();
await guide.waitFor({ state: "hidden" });
// Impostazioni again closes the settings page and returns to the dialog.
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });

// T19: the window sizes the layout is checked at, from the minimum (720x640) to full HD.
// A narrow dialog gets the inspector floating over it, so the chat and the composer keep their width.
for (const [width, height] of [[720, 640], [1040, 700], [1280, 800], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  if (await page.getByTestId("inspector").count()) await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
  const composer = await page.getByLabel("Messaggio al Coordinatore").boundingBox();
  if (!composer || composer.width < 300) throw new Error(`Composer squeezed at ${width}x${height}: ${JSON.stringify(composer)}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll at ${width}x${height}`);
  await page.getByRole("button", { name: "Mappa del progetto" }).click();
  await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
  await shot(`13-size-${width}x${height}-module`);
  // Escape inside the inspector closes it, at every size.
  await page.getByTestId("inspector").getByRole("button", { name: "Chiudi l'ispettore" }).focus();
  await page.keyboard.press("Escape");
  await page.getByTestId("inspector").waitFor({ state: "detached" });
  await shot(`13-size-${width}x${height}-chat`);
}
await app.close();

// Reopening (UX01): after a restart the same goal is in the list and opens from the keyboard alone.
({ app, page } = await launch());
const goalsRow = page.getByRole("button", { name: /^Obiettivi/ }).first();
await goalsRow.waitFor({ timeout: 30_000 });
await goalsRow.focus();
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Nuovo obiettivo" }).focus();
let reached = false;
for (let step = 0; step < 12 && !reached; step++) {
  await page.keyboard.press("Tab");
  reached = await page.evaluate((title) => document.activeElement?.textContent?.includes(title) ?? false, goalTitle);
}
if (!reached) throw new Error("The goal is not reachable with Tab after reopening");
await shot("13-goals-reopened");
await page.keyboard.press("Enter");
await page.getByText(goalId, { exact: true }).waitFor();
await page.getByRole("heading", { name: goalTitle }).waitFor();
await shot("13a-goal-reopened");
console.log("reopened goal", goalId);
await app.close();
