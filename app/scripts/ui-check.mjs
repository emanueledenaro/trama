// Launches the built app with the fake Codex server and saves screenshots of the main screens.
// Usage: node scripts/ui-check.mjs <output-dir>
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const out = resolve(process.argv[2] ?? "ui-check");
const dataDir = await mkdtemp(join(tmpdir(), "trama-ui-"));
// Each launch uses the same Trama data folder, so a second launch is a real reopening.
const launch = async (env = {}) => {
  const app = await electron.launch({
    // Its own Electron profile, so the check runs next to an open Trama instead of hitting its single-instance lock.
    args: [".", "--no-sandbox", `--user-data-dir=${await mkdtemp(join(tmpdir(), "trama-ui-profile-"))}`],
    env: {
      ...process.env,
      TRAMA_DATA_DIR: dataDir,
      TRAMA_CODEX_PATH: resolve("test-fixtures/fake-codex.mjs"),
      // A move Trama starts by itself keeps running until the check stops it (W04).
      FAKE_CODEX_AUTOMATIC: "wait",
      ...env,
    },
  });
  app.process().on("exit", (code, signal) => console.log("[electron exit]", code, signal));
  app.process().stderr.on("data", (data) => {
    const text = String(data).trim();
    if (text && !text.startsWith("Debugger")) console.log("[electron]", text);
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
// W12: "Chiedi al Coordinatore" leaves a question in the composer, ready to edit or send, with the cursor in it.
const composer = () => page.getByLabel("Messaggio al Coordinatore");
const expectAsked = async (fragment, control) => {
  const asked = await page
    .waitForFunction(
      (text) => {
        const box = document.querySelector('textarea[aria-label="Messaggio al Coordinatore"]');
        return Boolean(box && box.value.includes(text) && document.activeElement === box);
      },
      fragment,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!asked) throw new Error(`${control}: no "${fragment}" in the focused composer, it holds: ${await composer().inputValue().catch(() => "no composer")}`);
};

// B02, first launch. The intro plays over the app while the state loads and leaves by itself; the welcome follows.
const welcome = page.getByTestId("welcome");
await welcome.waitFor();
await page.getByTestId("launch-intro").waitFor({ state: "detached", timeout: 1_500 });
const lookOf = () => page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
const setLookTo = (provider, dark) =>
  page.evaluate(
    ([name, isDark]) => {
      if (name) document.documentElement.dataset.provider = name;
      else delete document.documentElement.dataset.provider;
      document.documentElement.classList.toggle("dark", isDark);
    },
    [provider, dark],
  );
// Frames of the intro: replayed and held, its animations paused at fixed times, in the light and dark themes of two providers.
const introFrames = async (label, times) => {
  await page.evaluate(() => window.dispatchEvent(new Event("trama:replay-intro")));
  await page.getByTestId("launch-intro").waitFor();
  for (const time of times) {
    // Only the intro's own animations: pausing the others would freeze the welcome's buttons mid-transition.
    await page.evaluate((t) => {
      for (const animation of document.querySelector('[data-testid="launch-intro"]').getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = t;
      }
    }, time);
    await page.screenshot({ path: join(out, `00-intro-${label}-${String(time).padStart(4, "0")}ms.png`) });
  }
  const running = await page.evaluate(() => document.querySelector('[data-testid="launch-intro"]')?.getAnimations({ subtree: true }).length ?? 0);
  await page.evaluate(() => window.dispatchEvent(new Event("trama:end-intro")));
  await page.getByTestId("launch-intro").waitFor({ state: "detached", timeout: 1_500 });
  return running;
};
const firstLook = await lookOf();
await setLookTo(null, false);
if (!(await introFrames("light", [0, 200, 450, 700, 1100]))) throw new Error("The intro does not animate");
await setLookTo("claudeAgent", true);
await introFrames("claude-dark", [200, 700, 1100]);
await setLookTo("codex", true);
await introFrames("codex-dark", [700]);
// With reduced motion only the still mark shows.
await page.emulateMedia({ reducedMotion: "reduce" });
await setLookTo(null, false);
if (await introFrames("reduced-motion", [0])) throw new Error("The intro animates with prefers-reduced-motion");
await page.emulateMedia({ reducedMotion: "no-preference" });
await setLookTo(firstLook.provider, firstLook.dark);

// The CTA rows put the primary action last, on the right.
const primaryLast = async (row, where) => {
  const buttons = await row.locator(":scope > button").evaluateAll((nodes) =>
    nodes.map((node) => ({ variant: node.dataset.variant, right: node.getBoundingClientRect().right, top: node.getBoundingClientRect().top })),
  );
  const primary = buttons.filter((b) => b.variant === "default");
  if (primary.length !== 1) throw new Error(`${where}: expected one primary action, found ${primary.length}`);
  const lastRow = Math.max(...buttons.map((b) => b.top));
  if (primary[0].top !== lastRow || buttons.some((b) => b.top === lastRow && b.right > primary[0].right)) throw new Error(`${where}: the primary action is not last`);
};
const noHorizontalScroll = async (where) => {
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll: ${where}`);
};
const sizes = [
  ["wide", 1280, 820],
  ["narrow", 720, 640],
];
const themes = [
  ["light", "light"],
  ["dark", "dark"],
];
const setTheme = async (theme) => {
  await page.evaluate((value) => window.trama.invoke("settings:update", { theme: value }), theme);
  await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, theme === "dark");
};

// The welcome: logo, what Trama does, then the configuration in three steps that reuse the guide's states.
await welcome.getByRole("heading", { name: "Benvenuto in Trama" }).waitFor();
// Behind the welcome the window is inert: its controls cannot take the focus, whatever the timing of the dialog.
const behind = await page.evaluate(() => {
  const toggle = document.querySelector('button[aria-label="Mostra o nascondi la barra laterale"]');
  toggle?.focus();
  return { found: Boolean(toggle), focused: document.activeElement === toggle };
});
if (!behind.found || behind.focused) throw new Error(`The window behind the welcome is not inert: ${JSON.stringify(behind)}`);
// The welcome is modal: Tab cycles inside it (through the dialog's focus guards) and never reaches the window behind.
for (let press = 0; press < 8; press++) {
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      inside: Boolean(active?.closest('[data-testid="welcome"]') || active?.hasAttribute("data-base-ui-focus-guard")),
      element: active?.outerHTML.slice(0, 160) ?? "none",
    };
  });
  if (!focus.inside) throw new Error(`Tab left the welcome for ${focus.element}`);
}
await primaryLast(welcome.locator(".cta-row").last(), "Welcome");
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`welcome ${size} ${label}`);
    await shot(`00a-welcome-${size}-${label}`);
  }
}
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await welcome.getByRole("button", { name: "Configura", exact: true }).click();
// The configuration starts at the first step still open: the fake Codex account already completes the provider.
await welcome.getByRole("heading", { name: /Collega GitHub/ }).waitFor();
await welcome.getByRole("button", { name: "Indietro" }).click();
// 1. Provider: Codex and Claude with their state, the others behind a toggle, the actions to restore.
await welcome.getByRole("heading", { name: /Collega un provider/ }).waitFor();
await welcome.locator('[data-provider-row="codex"]').waitFor();
await welcome.locator('[data-provider-row="claudeAgent"]').waitFor();
if (await welcome.locator('[data-provider-row="cursor"]').count()) throw new Error("The other providers are not behind their toggle");
await welcome.getByRole("button", { name: "Controlla di nuovo" }).waitFor();
await shot("00b-welcome-provider");
await welcome.getByRole("button", { name: /^Altri provider/ }).click();
await welcome.locator('[data-provider-row="cursor"]').waitFor();
await shot("00b-welcome-provider-all");
await setTheme("dark");
await shot("00b-welcome-provider-dark");
await page.setViewportSize({ width: 720, height: 640 });
await noHorizontalScroll("welcome provider narrow");
await shot("00b-welcome-provider-narrow-dark");
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await welcome.getByRole("button", { name: "Continua" }).click();
// 2. GitHub, optional: postponed, it stays "Saltato" and the guide can take it back.
await welcome.getByRole("heading", { name: /Collega GitHub/ }).waitFor();
await welcome.locator('[data-testid="welcome-step-state"]:not([data-status="checking"])').waitFor();
await shot("00c-welcome-github");
await welcome.getByRole("button", { name: "Rimanda" }).click();
// 3. AI Hero: the answer is the step while no project is open.
await welcome.getByRole("heading", { name: /Il metodo AI Hero/ }).waitFor();
await primaryLast(welcome.locator(".cta-row").nth(0), "Welcome, AI Hero");
await shot("00d-welcome-aihero");
await page.setViewportSize({ width: 720, height: 640 });
await shot("00d-welcome-aihero-narrow");
await setTheme("dark");
await shot("00d-welcome-aihero-narrow-dark");
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await welcome.getByRole("button", { name: "Prepara il metodo" }).click();
await welcome.locator('[data-testid="welcome-step-state"][data-status="done"]').waitFor();
await shot("00e-welcome-aihero-chosen");
await welcome.getByRole("button", { name: "Scegli un progetto" }).click();
await welcome.waitFor({ state: "detached" });

// The project picker: open, clone, create and the example, with the primary action last, at every size and theme.
const picker = page.getByTestId("project-picker");
await picker.getByText("Su cosa vuoi lavorare?").waitFor();
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  await primaryLast(picker.getByTestId("picker-actions"), `Project picker ${size}`);
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`picker ${size} ${label}`);
    await shot(`01-picker-${size}-${label}`);
  }
}
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
// B01: Trama's mark sits in the sidebar's brand slot and on the project picker, in the colors of the provider theme,
// light and dark. The brand slot's gradient must change with the provider and with the theme.
const brandLook = (provider, dark) =>
  page.evaluate(
    ([name, isDark]) => {
      if (name) document.documentElement.dataset.provider = name;
      else delete document.documentElement.dataset.provider;
      document.documentElement.classList.toggle("dark", isDark);
    },
    [provider, dark],
  );
const startLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
if ((await page.locator('[data-testid="brand-slot"] [data-trama-mark="glyph"]').count()) !== 1) throw new Error("No Trama mark in the sidebar's brand slot");
if ((await page.locator("[data-trama-mark]").count()) < 2) throw new Error("No Trama mark on the project picker");
const markColors = new Set();
for (const provider of ["codex", "claudeAgent", "grok"]) {
  for (const dark of [false, true]) {
    await brandLook(provider, dark);
    const color = await page.evaluate(() => {
      const stop = document.querySelector('[data-testid="brand-slot"] [data-trama-mark] stop');
      return stop ? getComputedStyle(stop).stopColor : null;
    });
    if (!color) throw new Error(`No gradient in the brand slot's mark with ${provider}`);
    markColors.add(color);
    await shot(`01b-brand-${provider}-${dark ? "dark" : "light"}`);
  }
}
if (markColors.size !== 6) throw new Error(`The mark does not follow the provider theme: ${[...markColors].join(", ")}`);
await brandLook(startLook.provider, startLook.dark);
await picker.getByRole("button", { name: "Clona da GitHub" }).click();
const cloneDialog = page.getByRole("dialog", { name: "Clona da GitHub" });
await cloneDialog.getByRole("textbox").fill("non è un repository");
if (await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).isEnabled()) throw new Error("Clone accepts an invalid repository");
await cloneDialog.getByRole("textbox").fill("https://github.com/emanueledenaro/trama");
await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).waitFor({ state: "visible" });
if (!(await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).isEnabled())) throw new Error("Clone refuses a GitHub URL");
await shot("01a-picker-clone");
await cloneDialog.getByRole("button", { name: "Annulla" }).click();
await cloneDialog.waitFor({ state: "hidden" });

// The guide keeps the steps' state and reopens the welcome; the welcome does not reopen by itself.
await picker.getByRole("button", { name: "Guida introduttiva" }).click();
const guide = page.getByRole("dialog", { name: "Guida introduttiva" });
await guide.waitFor();
await guide.locator('[data-step="github"][data-status="skipped"]').waitFor();
await guide.locator('[data-step="aiHero"][data-status="done"]').waitFor();
await shot("01b-guide-after-welcome");
await guide.getByRole("button", { name: "Rivedi il benvenuto" }).click();
await welcome.getByRole("button", { name: "Riprendi la configurazione" }).click();
await welcome.getByRole("heading", { name: /Collega GitHub/ }).waitFor();
await shot("01c-welcome-resumed");
await welcome.getByRole("button", { name: "Chiudi il benvenuto" }).click();
await welcome.waitFor({ state: "detached" });

// The example project, as the exercise.
await picker.getByRole("button", { name: "Prova l'esempio" }).click();
await page.getByRole("complementary", { name: "Esercizio" }).waitFor({ timeout: 20_000 });
await shot("01d-picker-example-exercise");
await page.getByRole("complementary", { name: "Esercizio" }).getByRole("button", { name: "Chiudi l'esercizio" }).click();
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
// W15: each agent has an avatar with its initial and a colored tag; the tag comes from the proposal.
await teamPanel.getByTestId("team-developer").getByTestId("agent-tag").filter({ hasText: "[Ordini]" }).waitFor();
if ((await teamPanel.getByTestId("team-figure").getByTestId("agent-tag").count()) < 5) throw new Error("The fixed roles have no tag");
// W13: the person renames the developer from the Team view; the id stays and a fixed role's name is refused.
await teamPanel.getByTestId("team-developer").first().click();
const developerId = (await teamPanel.getByText(/^S-[0-9A-F]{8}$/).first().textContent()).trim();
await teamPanel.getByRole("button", { name: "Rinomina", exact: true }).click();
const rename = teamPanel.getByTestId("rename-specialist");
await rename.getByLabel("Nuovo nome").fill("Clean Code");
await rename.getByText("È il nome di un ruolo fisso").waitFor();
if (await rename.getByRole("button", { name: "Rinomina" }).isEnabled()) throw new Error("A fixed role's name can be chosen");
await rename.getByLabel("Nuovo nome").fill("Giulia");
const renameButtons = await rename.locator(".cta-row button").allTextContents();
if (renameButtons.at(-1)?.trim() !== "Rinomina") throw new Error(`Rename is not the last call to action: ${renameButtons}`);
await shot("04e3-team-rename");
await rename.getByRole("button", { name: "Rinomina" }).click();
await teamPanel.getByRole("heading", { name: "Giulia" }).waitFor({ timeout: 20_000 });
await teamPanel.getByText(developerId, { exact: true }).waitFor();
// W15: the person picks another color; only the avatar and the tag take it.
await teamPanel.getByRole("radio", { name: "Rame" }).click();
await teamPanel.locator('[role="radio"][aria-label="Rame"][aria-checked="true"]').waitFor({ timeout: 20_000 });
await shot("04e4-team-color");
await teamPanel.getByRole("button", { name: "Team", exact: true }).click();
await teamPanel.getByTestId("team-developer").filter({ hasText: "Giulia" }).waitFor();
await teamPanel.getByText("In sottofondo", { exact: true }).scrollIntoViewIfNeeded();
await shot("04e1-team-candidate-background");
await teamPanel.getByTestId("team-figure").filter({ hasText: "Guardiano delle regressioni" }).first().click();
await teamPanel.getByText("Quando interviene").waitFor();
if (await teamPanel.getByRole("button", { name: "Togli dal team" }).count()) throw new Error("A fixed role offers to leave the team");
await shot("04e2-team-fixed-role");
if (await teamPanel.getByRole("button", { name: "Rinomina", exact: true }).count()) throw new Error("A fixed role offers a rename");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// W13: the person asks the Coordinator to rename the developer, without a new mandate; the chat follows the new name.
await page.getByLabel("Messaggio al Coordinatore").fill("[rinomina:Giulia:Bea]");
await page.keyboard.press("Enter");
await page.getByText("Ho rinominato Giulia in Bea.").first().waitFor({ timeout: 20_000 });
await page.getByText(/^Bea$/).first().waitFor({ timeout: 20_000 });
await page.getByText("ha lavorato per").first().waitFor();
await shot("04e5-team-renamed-in-chat");

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
// M03: the person's decisions feed the glossary and the ADRs. The read-only Coordinator proposes them in the formats
// of domain-modeling; only within the mandate the documentation and domain role writes them, in its own worktree.
await composer().fill("[dominio]");
await page.keyboard.press("Enter");
const domainCard = page.locator(".chat-card", { has: page.getByTestId("domain-proposal") }).last();
await domainCard.getByText("In attesa", { exact: true }).waitFor({ timeout: 20_000 });
await domainCard.getByText(/Il mandato non permette di lavorare in un worktree su root/).waitFor();
for (const expected of ["Ordine in revisione", "Ordine sospeso, Rimborso in attesa", "Gli ordini pagati annullati vanno in revisione", "docs/adr/NNNN-"]) {
  if (!(await domainCard.innerText()).includes(expected)) throw new Error(`The domain proposal does not show "${expected}"`);
}
if (await page.getByText("Documentazione e dominio", { exact: true }).count()) throw new Error("The documentation role started writing outside the mandate");
await domainCard.scrollIntoViewIfNeeded();
await shot("04j-domain-proposal-waiting");
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /^Root/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await domainCard.getByText("Scritta", { exact: true }).waitFor({ timeout: 30_000 });
await domainCard.getByText(/ha scritto la proposta nel worktree dell'incarico A-/).waitFor();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await domainCard.scrollIntoViewIfNeeded();
await shot("04k-domain-proposal-written");
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
await page.locator(".chat-card", { has: page.getByTestId("domain-proposal") }).last().scrollIntoViewIfNeeded();
await shot("10a-dark-domain-proposal");
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

// W03: withdraw a grilling question with a reason; the round then waits only for the other answer. It works on
// the round the W01 steps opened: a second grilling request would open a second "turno 1" and make the round ambiguous.
const round = page.getByRole("region", { name: "Chiarimento, turno 1" }).first();
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
// M04: the plan follows to-spec, once the grilling round above is complete (a plan waits for open questions).
// The seams come first and wait for the person, with the confirmation on the right; then the spec with the
// template's sections, which stays in Trama without GitHub.
const seamChecks = page.locator('[data-testid="plan-spec"][data-status="seams"]');
const earlierSeamChecks = await seamChecks.count();
await page.getByLabel("Messaggio al Coordinatore").fill("[piano]");
await page.keyboard.press("Enter");
const seamCheck = seamChecks.nth(earlierSeamChecks);
const confirmSeams = seamCheck.getByRole("button", { name: "Conferma i seam" });
await confirmSeams.waitFor({ timeout: 20_000 });
await seamCheck.scrollIntoViewIfNeeded();
const confirmBox = await confirmSeams.boundingBox();
const seamBox = await seamCheck.boundingBox();
if (!confirmBox || !seamBox || seamBox.x + seamBox.width - (confirmBox.x + confirmBox.width) > 2) throw new Error("Conferma i seam is not on the right");
await shot("04c1-plan-seams");
// The next step "Conferma i seam" targets the plan card, like "Rivedi il piano": the button brings the card into view.
await page.getByLabel("Messaggio al Coordinatore").fill("[passo:confirmSeams] A che punto è il piano?");
await page.keyboard.press("Enter");
const seamsStep = page.getByTestId("next-step").getByRole("button", { name: "Conferma i seam" }).last();
await seamsStep.waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await seamsStep.click();
await page.waitForTimeout(800);
if (!(await seamCheck.evaluate((card) => { const box = card.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight; }))) {
  throw new Error("The next step Conferma i seam did not bring the plan card into view");
}
await shot("04c1b-next-step-seams");
await confirmSeams.click();
const writtenSpec = page.locator('[data-testid="plan-spec"][data-status="ready"]').last();
await writtenSpec.getByText("Resta in Trama").waitFor({ timeout: 20_000 });
await writtenSpec.getByRole("button", { name: /Mostra tutta la spec/ }).click();
await writtenSpec.getByText("Decisioni sui test").waitFor();
await writtenSpec.scrollIntoViewIfNeeded();
await shot("04c2-plan-spec");
// M05: the written spec is split with to-tickets. The breakdown waits for the person, with its blocking edges, and
// the confirmation sits on the right, primary last; a plan with slices has no approval of the whole plan.
const slices = writtenSpec.getByTestId("plan-slices");
const confirmSlices = slices.getByRole("button", { name: "Conferma le fette" });
await confirmSlices.waitFor({ timeout: 20_000 });
if ((await slices.getByTestId("plan-slice").count()) !== 3) throw new Error("The breakdown does not show the three slices of to-tickets");
await slices.getByText("Bloccata da: 1").first().waitFor();
await slices.getByText("Può iniziare subito").waitFor();
if (await writtenSpec.getByRole("button", { name: "Approva il piano e chiedi di realizzarlo" }).count()) throw new Error("A plan with slices still offers the approval of the whole plan");
await slices.getByRole("button", { name: "Mostra i criteri di accettazione" }).click();
await confirmSlices.evaluate((button) => button.scrollIntoView({ block: "center" }));
const sliceActions = await slices.locator(".cta-row").last().locator("button").allTextContents();
if (sliceActions.at(-1)?.trim() !== "Conferma le fette") throw new Error(`Conferma le fette is not the last call to action: ${sliceActions}`);
const confirmSlicesBox = await confirmSlices.boundingBox();
const slicesBox = await slices.boundingBox();
if (!confirmSlicesBox || !slicesBox || slicesBox.x + slicesBox.width - (confirmSlicesBox.x + confirmSlicesBox.width) > 2) throw new Error("Conferma le fette is not on the right");
await shot("04c3-plan-slices");
// The slices must read in the light theme too.
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("04c3b-plan-slices-light");
await page.evaluate(() => document.documentElement.classList.add("dark"));
// The slices held the work for the person; once confirmed they stay in Trama without GitHub, the first is ready
// and the others wait for it, and the work goes on by itself within the mandate (W04).
await confirmSlices.click();
await slices.getByText("Restano in Trama").waitFor({ timeout: 20_000 });
const sliceStates = await slices.getByTestId("plan-slice").evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
if (sliceStates[0] === "blocked" || sliceStates.slice(1).some((state) => state !== "blocked")) throw new Error(`The slices do not respect their blockers: ${sliceStates}`);
await shot("04c4-plan-slices-confirmed");
// The check stops the automatic assignment, so the queue below starts from an idle Coordinator.
const assignStep = page.getByTestId("automatic-step").filter({ hasText: "Assegna il lavoro" }).last();
await assignStep.getByRole("button", { name: "Ferma" }).click({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
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

// W12: the main action of every screen does what its label says, with an effect the person sees. Mandato, Memoria,
// candidato, Obiettivi, Panoramica, guida and the chat cards are clicked above; Issue and Gruppo after the restart.
// Header: a rescan that changes nothing still confirms it ran.
await page.getByRole("button", { name: "Aggiorna progetto" }).click();
const refreshed = page.getByRole("status").filter({ hasText: "Progetto riletto" });
await refreshed.waitFor({ timeout: 10_000 });
await refreshed.getByRole("button", { name: "Chiudi" }).click();
// Goal card: "Modifica la proposta" opens the proposal with its editor ready.
await page.getByTestId("goal-card").getByRole("button", { name: "Modifica la proposta" }).first().click();
const editor = page.getByTestId("inspector").getByTestId("goal-editor");
await editor.waitFor();
await shot("16a-goal-proposal-edit");
await editor.getByRole("button", { name: "Annulla" }).click();
await editor.waitFor({ state: "detached" });
// Mappa: asking about a module puts the question in the composer with the module as the message's context.
await page.getByRole("button", { name: "Mappa del progetto" }).click();
await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
await page.getByTestId("inspector").getByRole("button", { name: "Chiedi al Coordinatore su questo modulo" }).click();
await expectAsked("Cosa fa il modulo Orders", "Mappa, Chiedi al Coordinatore su questo modulo");
if (!(await page.getByRole("button", { name: "Contesto del messaggio" }).innerText()).includes("Orders")) throw new Error("The module is not the message's context");
await shot("16b-module-ask");
await page.getByRole("button", { name: "Contesto del messaggio" }).click();
await page.getByRole("listbox", { name: "Contesto" }).getByRole("option", { name: /Intero progetto/ }).click();
await composer().fill("");
// Patto: "Nuova decisione" opens the editor, "Annulla" closes it.
await page.getByRole("button", { name: /^Patto/ }).first().click();
await page.getByTestId("inspector").getByRole("button", { name: "Nuova decisione" }).click();
const recordDecision = page.getByTestId("inspector").getByRole("button", { name: "Registra decisione", exact: true });
await recordDecision.waitFor();
await page.getByTestId("inspector").getByRole("button", { name: "Annulla", exact: true }).click();
await recordDecision.waitFor({ state: "detached" });
// Team: asking about a specialist names its latest assignment; the action is the last in the cta-row.
await page.getByRole("button", { name: /^Team/ }).first().click();
await page.getByTestId("inspector").getByTestId("team-developer").first().click();
await page.getByTestId("inspector").getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).waitFor();
const developerName = (await page.getByTestId("inspector").locator("h3.text-ui-lg").first().textContent()).trim();
const specialistActions = await page.getByTestId("inspector").locator(".cta-row").first().locator("button").allTextContents();
if (specialistActions.at(-1)?.trim() !== "Chiedi al Coordinatore") throw new Error(`Chiedi al Coordinatore is not the last call to action: ${specialistActions}`);
await page.getByTestId("inspector").getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked(`di ${developerName}`, "Team, Chiedi al Coordinatore");
if (!(await composer().inputValue()).includes("Aggiornami sull'incarico A-")) throw new Error(`The question does not name ${developerName}'s assignment`);
await shot("16c-specialist-ask");
await composer().fill("");
// Lavoro: a candidate opens with its diff; the card inside it offers no "Apri il diff" that would do nothing.
await page.getByRole("button", { name: /^Lavoro/ }).first().click();
await page.getByTestId("inspector").getByRole("button", { name: /^C-[0-9A-F]{8}/ }).first().click();
await page.getByTestId("inspector").getByText(/^Diff catturato da Trama/).waitFor();
if (await page.getByTestId("inspector").getByRole("button", { name: "Apri il diff" }).count()) throw new Error("The candidate view offers a diff it already shows");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// Ricerca: "Scrivi al Coordinatore" from the overview goes back to the dialog with the cursor in the composer.
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await page.getByTestId("overview").waitFor();
await page.keyboard.press("Control+K");
await page.getByRole("textbox", { name: "Cerca in Trama" }).fill("Scrivi al");
await page.keyboard.press("Enter");
await page.getByTestId("overview").waitFor({ state: "detached" });
await expectAsked("", "Ricerca, Scrivi al Coordinatore");
// Dialoghi: "Crea un progetto" opens its dialog and "Annulla" closes it.
await page.getByRole("button", { name: "Crea un progetto" }).first().click();
const createDialog = page.getByRole("dialog", { name: "Crea un progetto" });
await createDialog.waitFor();
await createDialog.getByRole("button", { name: "Annulla" }).click();
await createDialog.waitFor({ state: "hidden" });

// W04: within the mandate the Coordinator goes on by itself. In the goal dialog, once the grilling is answered and
// the person confirmed it with the step's button, Trama starts the plan as its own line with a stop on the right.
await page.getByTestId("sidebar-goal").filter({ hasText: goalTitle }).click();
await page.getByTestId("dialog-title").filter({ hasText: goalTitle }).waitFor();
await page.getByLabel("Messaggio al Coordinatore").fill("[grilling:1] Gli ordini pagati annullati restano in revisione");
await page.keyboard.press("Enter");
const goalRound = page.getByRole("region", { name: "Chiarimento, turno 1" }).first();
await goalRound.getByText("0 di 2 risposte").waitFor({ timeout: 20_000 });
await goalRound.getByRole("button", { name: /Anche il cliente/ }).first().click();
await goalRound.getByRole("button", { name: "Registra la decisione" }).first().click();
await goalRound.getByText("1 di 2 risposte").waitFor({ timeout: 20_000 });
await goalRound.getByRole("button", { name: /Anche il cliente/ }).last().click();
await goalRound.getByRole("button", { name: "Registra la decisione" }).click();
await goalRound.getByText("Turno completo").waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Preparare piani/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v4/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// The correction is a turn of the project dialog, whose M04 spec is ready: Trama goes on there with the slices.
// The check stops that move, which belongs to the other dialog, before the goal dialog's own work.
await page.getByRole("button", { name: "Interrompi" }).click({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
if (await page.getByTestId("automatic-step").count()) throw new Error("Trama went on before the person confirmed the shared understanding");
await page.getByLabel("Messaggio al Coordinatore").fill("[passo:confirmUnderstanding] Riassumi quello che abbiamo deciso");
await page.keyboard.press("Enter");
const confirmStep = page.getByTestId("next-step").getByRole("button", { name: "Conferma la comprensione" });
await confirmStep.waitFor({ timeout: 20_000 });
await confirmStep.click();
const automaticStep = page.getByTestId("automatic-step").filter({ hasText: "Prepara il piano" });
const stopMove = automaticStep.getByRole("button", { name: "Ferma" });
await stopMove.waitFor({ timeout: 20_000 });
const stopBox = await stopMove.boundingBox();
const lineBox = await automaticStep.boundingBox();
if (!stopBox || !lineBox || lineBox.x + lineBox.width - (stopBox.x + stopBox.width) > 2) throw new Error("The stop of the automatic move is not on the right");
await shot("15a-automatic-step");
await stopMove.click();
await stopMove.waitFor({ state: "detached", timeout: 20_000 });
await page.getByText("Turno interrotto").last().waitFor({ timeout: 20_000 });
if ((await page.getByTestId("automatic-step").count()) !== 1) throw new Error("Trama started another move after the stop");
await shot("15b-automatic-step-stopped");
await page.keyboard.press("Control+K");
await page.getByRole("textbox", { name: "Cerca in Trama" }).fill("cancel");
await page.getByRole("option").first().waitFor();
await shot("10b-search");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await shot("10c-search-result");
await page.getByRole("button", { name: "Indietro" }).first().click();
// The sidebar footer holds only Impostazioni: Collegamenti is a section of the settings page.
await page.getByRole("button", { name: "Impostazioni" }).click();
const settings = page.getByTestId("settings");
await settings.waitFor();
await settings.getByRole("button", { name: /^Collegamenti/ }).first().click();
await shot("11-connections");
await settings.getByRole("button", { name: /^Generale/ }).first().click();
await shot("12-settings");
// B01: Informazioni shows the mark on its tile with the version, in every provider theme.
await settings.getByTestId("about-trama").locator('[data-trama-mark="tile"]').waitFor();
for (const provider of ["codex", "claudeAgent", "grok"]) {
  for (const dark of [false, true]) {
    await brandLook(provider, dark);
    await settings.getByTestId("about-trama").scrollIntoViewIfNeeded();
    await shot(`12b-about-${provider}-${dark ? "dark" : "light"}`);
  }
}
await brandLook(startLook.provider, startLook.dark);
// W12, Impostazioni: the theme follows the choice at once.
await page.getByRole("radio", { name: "Scuro" }).click();
await page.getByRole("radio", { name: "Scuro", checked: true }).waitFor();
if (!(await page.evaluate(() => document.documentElement.classList.contains("dark")))) throw new Error("Tema Scuro did not darken the window");
await page.getByRole("radio", { name: "Sistema" }).click();
await page.getByRole("radio", { name: "Sistema", checked: true }).waitFor();
await page.getByRole("button", { name: "Apri la guida" }).click();
await guide.waitFor();
await shot("12a-guide-resume-dark");
await guide.getByRole("button", { name: "Continua più tardi" }).click();
await guide.waitFor({ state: "hidden" });
// Impostazioni again closes the settings page and returns to the dialog.
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });

// W14: a new mandate request supersedes the pending one. The old card turns grey, names the new one and loses
// its buttons; it stays in the history. Only the new card can be accepted.
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-mandato:Prima proposta di mandato]");
await page.keyboard.press("Enter");
await page.getByText("Prima proposta di mandato").first().waitFor({ timeout: 20_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-mandato:Seconda proposta di mandato]");
await page.keyboard.press("Enter");
const supersededNote = page.getByTestId("superseded-mandate");
await supersededNote.waitFor({ timeout: 20_000 });
if ((await supersededNote.count()) !== 1) throw new Error("Expected exactly one superseded mandate card");
const supersededCard = page.locator(".chat-card", { has: supersededNote });
if (!(await supersededCard.getByText("Prima proposta di mandato").count())) throw new Error("The superseded card is not the first request");
if (await supersededCard.getByRole("button").count()) throw new Error("The superseded mandate card still has buttons");
const pendingCard = page.locator(".chat-card", { hasText: "Seconda proposta di mandato" }).last();
await pendingCard.getByRole("button", { name: "Accetta la proposta" }).waitFor();
await supersededCard.scrollIntoViewIfNeeded();
await shot("15-mandate-superseded");

// W02: the focus bar at the top of the chat shows the task in focus with its phase and what holds it; the queue
// lists the others. Pausing the task in focus passes the focus to the next one; "Metti in focus" takes it back.
const focusBar = page.getByTestId("focus-bar");
await focusBar.waitFor({ timeout: 20_000 });
const focusTitle = async () => (await focusBar.getByTestId("focus-title").textContent()).trim();
const firstFocus = await focusTitle();
await focusBar.getByTestId("focus-phase").first().waitFor();
const queueToggle = focusBar.getByRole("button", { name: /^In coda/ });
await queueToggle.click();
const queue = focusBar.getByTestId("focus-queue");
await queue.waitFor();
if (!(await queue.getByTestId("focus-queue-item").count())) throw new Error("The task queue is empty");
const pause = focusBar.getByRole("button", { name: "Metti in pausa" });
const actionsOnRight = async (size) => {
  const bar = await focusBar.boundingBox();
  const button = await pause.boundingBox();
  if (!bar || !button || button.x + button.width > bar.x + bar.width || button.x < bar.x + bar.width / 2) {
    throw new Error(`The focus bar's actions are not on the right at ${size}`);
  }
};
await actionsOnRight("1280x820");
await shot("17-focus-bar-queue");
await pause.click();
const focusIs = (title, equal) =>
  page.waitForFunction(([text, same]) => (document.querySelector('[data-testid="focus-title"]')?.textContent?.trim() === text) === same, [title, equal], {
    timeout: 10_000,
  });
await focusIs(firstFocus, false);
const pausedItem = queue.locator('[data-testid="focus-queue-item"][data-status="paused"]').filter({ hasText: firstFocus });
await pausedItem.waitFor({ timeout: 10_000 });
await shot("17a-focus-paused-next");
await pausedItem.getByRole("button", { name: "Metti in focus" }).click();
await focusIs(firstFocus, true);
await queue.locator('[data-status="paused"]').first().waitFor({ state: "detached", timeout: 10_000 });
await shot("17b-focus-back");
// Light and dark on two providers' themes, then a narrow window where the bar wraps without a horizontal scroll.
const look = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
const setLook = (provider, dark) =>
  page.evaluate(
    ([name, isDark]) => {
      if (name) document.documentElement.dataset.provider = name;
      else delete document.documentElement.dataset.provider;
      document.documentElement.classList.toggle("dark", isDark);
    },
    [provider, dark],
  );
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLook(provider, dark);
    await shot(`17c-focus-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLook(look.provider, look.dark);
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(400);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal page scroll with the focus bar at 720x640");
await actionsOnRight("720x640");
await shot("17d-focus-narrow");
await queueToggle.click();
await queue.waitFor({ state: "detached" });
await page.setViewportSize({ width: 1280, height: 820 });

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

// W12, Issue and Gruppo need a project with a GitHub remote. The restart puts a fake GitHub CLI first on the PATH,
// so the check never reaches GitHub; the example project does not use gh, so the reopening below is unchanged.
const ghBin = await mkdtemp(join(tmpdir(), "trama-ui-gh-"));
await writeFile(join(ghBin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${resolve("test-fixtures/fake-gh.mjs")}" "$@"\n`, { mode: 0o755 });
const githubProject = await mkdtemp(join(tmpdir(), "trama-ui-negozio-"));
const git = (...args) => execFileSync("git", ["-C", githubProject, ...args], { stdio: "ignore" });
git("init", "-q", "-b", "main");
await mkdir(join(githubProject, "src"));
await writeFile(join(githubProject, "src", "orders.js"), 'export function cancel(order) {\n  return { ...order, state: "cancelled" };\n}\n');
await writeFile(join(githubProject, "README.md"), "# Negozio\n");
git("add", ".");
git("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
git("remote", "add", "origin", "https://github.com/trama-ui/negozio.git");

// Reopening (UX01): after a restart the same goal is in the list and opens from the keyboard alone.
// P10: the fake Codex answers the "[limite-temporaneo]" turns with OpenRouter's upstream 429 twice, then works again;
// a short first wait keeps the automatic retry within the check.
({ app, page } = await launch({ PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_TEAM: "1", TRAMA_PROVIDER_RETRY_MS: "4000", FAKE_CODEX_RATE_LIMITS: "2" }));
const goalsRow = page.getByRole("button", { name: /^Obiettivi/ }).first();
await goalsRow.waitFor({ timeout: 30_000 });
// B02: after the first launch the welcome never shows by itself again.
if (await page.getByTestId("welcome").count()) throw new Error("The welcome showed again after the first launch");
// M04: the spec is still there to read after the restart.
await page.locator('[data-testid="plan-spec"][data-status="ready"]').first().getByText("Ordini pagati annullati in revisione").waitFor({ timeout: 30_000 });
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

// W12, Issue: "Chiedi al Coordinatore" cites the issue in the composer, ready to edit or send. The folder chooser is
// native, so the project opens through the same action as a recent project in the sidebar.
await page.evaluate((path) => window.trama.invoke("project:open", { path }), githubProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-negozio" }).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: /^Issue/ }).first().click();
const issuesPanel = page.getByTestId("inspector");
await issuesPanel.getByRole("button", { name: /Il pulsante Annulla non fa niente/ }).click({ timeout: 30_000 });
await issuesPanel.getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked("@issue:7 «Il pulsante Annulla non fa niente»", "Issue, Chiedi al Coordinatore");
if (await page.getByRole("button", { name: "Invia al Coordinatore" }).isDisabled()) throw new Error("The question about the issue cannot be sent");
await shot("15a-issue-ask");
await composer().fill("");
// W12, Gruppo: following the repository shows the monitor at work; the impact question waits in the composer. In a
// narrow window the inspector floats over the chat, so it steps aside to leave the question in view.
await page.getByRole("button", { name: /^Gruppo/ }).first().click();
const groupPanel = page.getByTestId("inspector");
await groupPanel.getByRole("button", { name: "Segui in background" }).click();
await groupPanel.getByText("Monitor attivo").waitFor({ timeout: 10_000 });
// G02, decision 9a: a colleague who does not use Trama appears with what GitHub shows, their pull request and branch;
// a branch nobody explains stays apart.
const githubOnly = groupPanel.locator('[data-testid="group-row"][data-kind="github"]').filter({ hasText: "collega" });
await githubOnly.getByText("#12 Annullo degli ordini dal riepilogo").waitFor({ timeout: 20_000 });
await githubOnly.getByText("feature/annullo-ordini").waitFor();
await githubOnly.getByText(/^su GitHub/).waitFor();
await groupPanel.getByTestId("group-other-branches").getByText(/spike\/vecchio-checkout/).waitFor();
await groupPanel.locator('[data-testid="group-row"][data-self="true"]').getByText("trama-ui (tu)").waitFor({ timeout: 20_000 });
await shot("15b-group-follow");
await page.setViewportSize({ width: 720, height: 640 });
await groupPanel.getByRole("button", { name: "Chiedi al Coordinatore l'impatto" }).click();
await expectAsked("Valuta l'impatto delle ultime novità dei colleghi", "Gruppo, Chiedi al Coordinatore l'impatto");
await groupPanel.waitFor({ state: "detached" });
await shot("15c-group-ask-narrow");
await composer().fill("");

// V04 and V05 on a fresh copy of the example project. The person stops a developer's work and resumes it; a check fails
// on a candidate and the card opens its original output; the correction is a new candidate that gets the green light,
// and new evidence withdraws it.
await page.setViewportSize({ width: 1280, height: 820 });
// The person drives each step here, so Trama's automatic moves (W04, checked above) stay off.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
const candidateProject = await mkdtemp(join(tmpdir(), "trama-ui-candidato-"));
await cp(resolve("resources/DemoProject"), candidateProject, { recursive: true });
const gitIn = (...args) => execFileSync("git", ["-C", candidateProject, ...args], { stdio: "ignore" });
gitIn("init", "-q", "-b", "main");
gitIn("add", ".");
gitIn("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
await page.evaluate((path) => window.trama.invoke("project:open", { path }), candidateProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-candidato" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
const send = async (text) => {
  await composer().fill(text);
  await page.keyboard.press("Enter");
};
await send("[proponi-team]");
await page.getByRole("button", { name: "Conferma il team" }).click({ timeout: 20_000 });
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
await send("[chiedi-decisione]");
await page.getByRole("button", { name: /Va in revisione/ }).click({ timeout: 20_000 });
await page.getByRole("button", { name: "Registra la decisione" }).last().click();
await page.getByText("Apri nel Patto").first().waitFor({ timeout: 20_000 });
const candidateDecision = (await page.locator("body").innerText()).match(/Decisione (D-[0-9A-F]{8})/)[1];
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Scrivi", exact: true }).click();
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
const assignmentCards = page.locator(".chat-card").filter({ hasText: /^Incarico A-/ }).filter({ hasText: "Ada" });
const cardAssignment = async (card) => (await card.innerText()).match(/Incarico (A-[0-9A-F]{8})/)[1];

// V04: the stop is first requested, then confirmed; the work and its turn stay, and it resumes in the same worktree.
await send("[assegna] [lento]");
const slowCard = assignmentCards.first();
await slowCard.getByText("Al lavoro", { exact: true }).waitFor({ timeout: 20_000 });
// Q01: the branch follows Conventional Branch and stays recognizable as Trama's work.
await slowCard.getByText(/(feature|chore)\/[a-z0-9-]+-trama-[0-9a-f]{8}/).waitFor();
const slowActions = await slowCard.locator(".cta-row button").allTextContents();
if (slowActions.at(-1)?.trim() !== "Ferma") throw new Error(`Ferma is not the last call to action: ${slowActions}`);
await slowCard.getByRole("button", { name: "Ferma" }).click();
await slowCard.getByText("Fermato", { exact: true }).waitFor({ timeout: 20_000 });
// The turn's activities are one row, opened on request.
const stoppedTurn = page.getByRole("button", { name: /ha lavorato per/ }).first();
await stoppedTurn.click();
await page.getByText("Arresto confermato").first().waitFor({ timeout: 20_000 });
await stoppedTurn.scrollIntoViewIfNeeded();
await shot("18a-specialist-stopped");
await slowCard.getByRole("button", { name: "Riprendi" }).click();
await slowCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });

// V05: the work leaves trailing whitespace; git_diff_check fails on the candidate with git's own output.
await send("[assegna] [spazi]");
const spacesCard = assignmentCards.nth(1);
await spacesCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(spacesCard)}:${candidateDecision}:tutte]`);
const candidateCards = page.locator(".chat-card").filter({ has: page.getByTestId("candidate-evidence") });
const failedCard = candidateCards.first();
await failedCard.locator('[data-testid="candidate-evidence"][data-check="git_diff_check"][data-result="fail"]').waitFor({ timeout: 30_000 });
await page.getByText(/Via libera rifiutato: .*candidate_not_verified/).first().waitFor({ timeout: 20_000 });
await failedCard.getByText("In costruzione", { exact: true }).waitFor();
await failedCard.getByText("Verifica non superata").waitFor();
await failedCard.getByRole("button", { name: "Output originale" }).click();
const failedOutput = failedCard.getByTestId("evidence-output");
await failedOutput.getByText(/trailing whitespace\./).waitFor();
await failedOutput.getByText(/git -C .* diff --check HEAD/).waitFor();
if (await failedCard.getByRole("button", { name: "Approva questo candidato" }).count()) throw new Error("A candidate with a failed check can be approved");
await failedCard.scrollIntoViewIfNeeded();
await shot("18b-candidate-check-failed");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("18c-candidate-check-failed-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));

// The correction is new work and a new candidate, with new evidence; the failed one keeps its own.
await send("[assegna] [correggi-spazi]");
const fixCard = assignmentCards.nth(2);
await fixCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(fixCard)}:${candidateDecision}:tutte]`);
const correctedCard = candidateCards.nth(1);
await correctedCard.getByText("Deciso", { exact: true }).waitFor({ timeout: 30_000 });
await correctedCard.locator('[data-testid="candidate-evidence"][data-check="git_diff_check"][data-result="pass"]').waitFor();
await correctedCard.getByText("Revisione tecnica, approvata").waitFor();
await correctedCard.getByText("Via libera del Coordinatore.").waitFor();
if ((await failedCard.innerText()).includes("Deciso")) throw new Error("The failed candidate took the correction's state");
await correctedCard.scrollIntoViewIfNeeded();
await shot("18d-candidate-corrected");
// Q01: before publishing, the card shows the quality standard. The corrected candidate meets it, with its Conventional
// Commits message; the failed one says what is missing and how to fix it. Both themes.
const correctedQuality = correctedCard.locator('[data-testid="candidate-quality"][data-ready="yes"]');
await correctedQuality.waitFor({ timeout: 20_000 });
const commitItem = correctedQuality.locator('[data-testid="quality-item"][data-code="COMMIT_MESSAGE"][data-passed="yes"]');
if (!/(feat|docs|chore)(\([a-z0-9-]+\))?: \S/.test(await commitItem.innerText())) throw new Error(`The commit message is not in Conventional Commits: ${await commitItem.innerText()}`);
const failedQuality = failedCard.locator('[data-testid="candidate-quality"][data-ready="no"]');
for (const code of ["VERIFIED", "DIFF_CHECK"]) await failedQuality.locator(`[data-testid="quality-item"][data-code="${code}"][data-passed="no"]`).waitFor();
await failedQuality.getByText(/trailing whitespace/).first().waitFor();
await failedQuality.getByText(/^Come sistemarlo:/).first().waitFor();
const correctedActions = await correctedCard.locator(".cta-row button").allTextContents();
if (correctedActions.at(-1)?.trim() !== "Approva questo candidato") throw new Error(`Unexpected calls to action on the candidate: ${correctedActions}`);
await correctedQuality.scrollIntoViewIfNeeded();
await shot("18f-publication-standard");
await failedQuality.scrollIntoViewIfNeeded();
await shot("18g-publication-standard-missing");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("18h-publication-standard-missing-dark");
await correctedQuality.scrollIntoViewIfNeeded();
await shot("18i-publication-standard-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
const correctedId = (await correctedCard.innerText()).match(/Candidato (C-[0-9A-F]{8})/)[1];
await send(`[riverifica:${correctedId}:git_status]`);
await correctedCard.getByText("Il via libera del Coordinatore non vale più: sono cambiate evidenze o decisioni.").waitFor({ timeout: 20_000 });
await correctedCard.getByText("Verificato", { exact: true }).waitFor();
await correctedCard.scrollIntoViewIfNeeded();
await shot("18e-clearance-withdrawn");

// M06: the developer of a slice runs implement and tdd with their original text and reports the seams it tested.
// The candidate shows that report apart from Trama's evidence; the build and the tests wait for Trama's own run.
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Preparare piani/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await send("[piano]");
const sliceSeams = page.locator('[data-testid="plan-spec"][data-status="seams"]').last();
await sliceSeams.getByRole("button", { name: "Conferma i seam" }).click({ timeout: 20_000 });
const sliceSpec = page.locator('[data-testid="plan-spec"][data-status="ready"]').last();
await sliceSpec.getByTestId("plan-slices").getByRole("button", { name: "Conferma le fette" }).click({ timeout: 20_000 });
await sliceSpec.getByText("Restano in Trama").waitFor({ timeout: 20_000 });
// W05: an assignment without its contract (seams, Pact decisions) is refused with a clear tool failure; no card appears.
await send("[assegna] [senza-contratto]");
await page.getByText(/Rifiutato: .*incomplete_contract.*seams.*decisionIDs/).last().waitFor({ timeout: 20_000 });
if ((await assignmentCards.count()) !== 3) throw new Error("An assignment without its contract reached a developer");
await send("[assegna] [test]");
const sliceWork = assignmentCards.nth(3);
await sliceWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
// W05: the card shows the contract the slice reached the developer with and the developer's structured report,
// as a statement apart from Trama's evidence.
const contract = sliceWork.getByTestId("assignment-contract");
await contract.getByTestId("contract-seam").getByText(/CancelPaidOrder/).waitFor();
await contract.getByText("Nessuna").first().waitFor();
const developerReport = sliceWork.getByTestId("assignment-report");
await developerReport.getByTestId("report-files").getByText("NOTE.md").waitFor();
await developerReport.getByTestId("report-tests").getByText("NOTE.md").waitFor();
await developerReport.locator('[data-testid="report-seam"][data-tested="yes"][data-agreed="yes"]').getByText(/CancelPaidOrder/).waitFor();
await developerReport.getByTestId("report-doubts").getByText(/rimborso manuale/).waitFor();
await developerReport.getByText(/non un'evidenza/).waitFor();
await developerReport.scrollIntoViewIfNeeded();
await shot("19c-assignment-contract-report");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("19d-assignment-contract-report-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await send(`[candidato:${await cardAssignment(sliceWork)}:${candidateDecision}]`);
const sliceCandidate = candidateCards.nth(2);
const testedSeams = sliceCandidate.getByTestId("candidate-tested-seams");
await testedSeams.waitFor({ timeout: 30_000 });
await testedSeams.locator('[data-testid="candidate-tested-seam"][data-tested="yes"][data-agreed="yes"]').getByText(/CancelPaidOrder/).waitFor();
await testedSeams.getByText("test: NOTE.md").waitFor();
await testedSeams.getByText(/non un'evidenza/).waitFor();
for (const check of ["swift_build", "swift_test"]) {
  await sliceCandidate.locator(`[data-testid="candidate-evidence"][data-check="${check}"][data-result="missing"]`).waitFor();
}
await page.getByText(/Via libera rifiutato: .*candidate_not_verified/).last().waitFor({ timeout: 20_000 });
if (await sliceCandidate.getByRole("button", { name: "Approva questo candidato" }).count()) throw new Error("A slice candidate without Trama's checks can be approved");
await sliceCandidate.scrollIntoViewIfNeeded();
await shot("19a-slice-candidate-seams");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("19b-slice-candidate-seams-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));

// F01: focus mode on a candidate. Trama runs the real checks first, then code-review's Standards and Spec axes, and
// the report keeps them apart. The slice candidate reads its slice as the spec; the corrected one has none.
const focusAudit = page.getByTestId("focus-audit");
const focusActions = await sliceCandidate.locator(".cta-row button").allTextContents();
if (!focusActions.some((label) => label.includes("Focus mode"))) throw new Error(`No Focus mode on the candidate: ${focusActions}`);
await sliceCandidate.getByRole("button", { name: "Focus mode" }).click();
await focusAudit.waitFor({ timeout: 20_000 });
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 60_000 });
for (const check of ["swift_build", "swift_test"]) {
  await focusAudit.locator(`[data-testid="candidate-evidence"][data-check="${check}"]:not([data-result="missing"])`).waitFor();
}
await focusAudit.locator('[data-testid="audit-axis"][data-axis="standards"][data-status="done"]').getByText(/Mysterious Name/).first().waitFor();
await focusAudit.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="done"]').getByText(/Fonte: Fetta S1/).waitFor();
const auditText = await focusAudit.innerText();
const [checksAt, standardsAt, specAt] = ["Verifiche reali", "Standards", "Spec"].map((heading) => auditText.indexOf(heading));
if (!(checksAt >= 0 && checksAt < standardsAt && standardsAt < specAt)) throw new Error("Focus mode: the checks are not first, or Standards and Spec are out of order");
await focusAudit.getByTestId("focus-audit-summary").getByText(/Standards: 1 rilievo.*Spec: 1 rilievo/).waitFor();
await shot("20a-focus-audit");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("20b-focus-audit-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await correctedCard.scrollIntoViewIfNeeded();
await correctedCard.getByRole("button", { name: "Focus mode" }).click();
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 60_000 });
await focusAudit.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="skipped"]').getByText("no spec available", { exact: true }).waitFor();
await focusAudit.locator('[data-testid="candidate-evidence"][data-check="git_diff_check"][data-result="pass"]').waitFor();
await shot("20c-focus-audit-no-spec");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("20d-focus-audit-no-spec-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// Opened again, the card shows the same examination instead of starting a new one.
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await correctedCard.getByRole("button", { name: "Focus mode" }).click();
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// G01, presenza: a project with a colleague on a local bare remote. The colleague's record is already there; Trama
// proposes the consent in the chat once, with "Non ora" and "Condividi" on the right, and publishes only after
// "Condividi": names, branches and paths, never the content of a file.
await page.setViewportSize({ width: 1280, height: 820 });
const presenceRemote = await mkdtemp(join(tmpdir(), "trama-ui-presence-remote-"));
const presenceSeed = await mkdtemp(join(tmpdir(), "trama-ui-presence-bea-"));
const presenceProject = await mkdtemp(join(tmpdir(), "trama-ui-squadra-"));
const presenceGit = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
presenceGit(presenceRemote, "init", "-q", "--bare", "-b", "main");
presenceGit(presenceSeed, "init", "-q", "-b", "main");
presenceGit(presenceSeed, "config", "user.name", "Bea");
presenceGit(presenceSeed, "config", "user.email", "bea@example.com");
await mkdir(join(presenceSeed, "src"));
await writeFile(join(presenceSeed, "src", "payments.js"), "export const pay = (order) => order.total;\n");
presenceGit(presenceSeed, "add", ".");
presenceGit(presenceSeed, "commit", "-q", "-m", "Pagamenti");
presenceGit(presenceSeed, "push", "-q", presenceRemote, "main");
// G03: Bea's branch is on the remote and changes the same line Ada changes in her checkout.
presenceGit(presenceSeed, "checkout", "-q", "-b", "feature/rimborsi");
await writeFile(join(presenceSeed, "src", "payments.js"), "export const pay = (order) => order.total - order.refund;\n");
presenceGit(presenceSeed, "commit", "-q", "-am", "Rimborsi");
presenceGit(presenceSeed, "push", "-q", presenceRemote, "feature/rimborsi");
const beaRecord = {
  version: 1,
  user: "bea-at-example.com",
  name: "Bea",
  activeBranch: "feature/rimborsi",
  alsoOn: ["fix/iva-rimborsi"],
  localBranches: ["main", "feature/rimborsi", "fix/iva-rimborsi"],
  files: ["src/payments.js"],
  task: { kind: "goal", title: "Rimborsi parziali" },
  since: new Date(Date.now() - 20 * 60_000).toISOString(),
  lastActivityAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  closedAt: null,
  agents: [
    {
      id: "lia",
      name: "Lia",
      color: "violet",
      tag: "Interfaccia",
      branch: "trama/lia-rimborsi",
      files: ["src/refunds-view.js"],
      task: { kind: "assignment", title: "Schermata dei rimborsi" },
      since: new Date(Date.now() - 30 * 60_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    },
  ],
};
presenceGit(presenceSeed, "checkout", "-q", "--orphan", "presence");
presenceGit(presenceSeed, "rm", "-rq", "--cached", ".");
await writeFile(join(presenceSeed, "presence.json"), JSON.stringify(beaRecord));
presenceGit(presenceSeed, "add", "presence.json");
presenceGit(presenceSeed, "commit", "-q", "-m", "presence");
presenceGit(presenceSeed, "push", "-q", presenceRemote, "HEAD:refs/trama/presence/bea-at-example.com");
execFileSync("git", ["clone", "-q", presenceRemote, presenceProject]);
presenceGit(presenceProject, "config", "user.name", "Ada");
presenceGit(presenceProject, "config", "user.email", "ada@example.com");
presenceGit(presenceProject, "checkout", "-q", "-b", "feature/carrello");
await writeFile(join(presenceProject, "src", "payments.js"), "export const pay = () => 'CONTENUTO PRIVATO';\n");
await page.evaluate((path) => window.trama.invoke("project:open", { path }), presenceProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-squadra" }).waitFor({ timeout: 30_000 });
const consentCard = page.locator('[data-anchor="presence-consent"]');
await consentCard.getByRole("button", { name: "Condividi" }).waitFor({ timeout: 30_000 });
const notNow = await consentCard.getByRole("button", { name: "Non ora" }).boundingBox();
const share = await consentCard.getByRole("button", { name: "Condividi" }).boundingBox();
const consentBox = await consentCard.boundingBox();
if (!notNow || !share || !consentBox || notNow.x >= share.x || consentBox.x + consentBox.width - (share.x + share.width) > 20) {
  throw new Error("Presence consent: Non ora and Condividi are not on the right, primary last");
}
if (presenceGit(presenceRemote, "for-each-ref", "refs/trama/presence/ada-at-example.com").trim()) throw new Error("Presence shared before consent");
await shot("16-presence-consent");
await consentCard.getByRole("button", { name: "Condividi" }).click();
await consentCard.getByText("Condivisa").waitFor({ timeout: 10_000 });
let adaRecord = "";
for (let attempt = 0; attempt < 60 && !adaRecord; attempt++) {
  await page.waitForTimeout(250);
  if (presenceGit(presenceRemote, "for-each-ref", "refs/trama/presence/ada-at-example.com").trim()) {
    adaRecord = presenceGit(presenceRemote, "cat-file", "blob", "refs/trama/presence/ada-at-example.com:presence.json");
  }
}
if (!adaRecord.includes("feature/carrello") || !adaRecord.includes("src/payments.js")) throw new Error(`Presence not published: ${adaRecord}`);
if (adaRecord.includes("CONTENUTO PRIVATO")) throw new Error("Presence published a file's content");
if (presenceGit(presenceRemote, "branch", "--list").includes("presence")) throw new Error("Presence shows up as a branch");
// G04: the Coordinator reads the presence. "Chi sta toccando i pagamenti?" gets Bea's branch and files from
// read_presence, and the turn's message carries the presence section with the rules for assigning around colleagues.
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await composer().fill("[presenza] Chi sta toccando i pagamenti?");
await page.keyboard.press("Enter");
const presenceAnswer = page.locator(".chat-row, [data-testid='coordinator-message'], p", { hasText: "Sta toccando i pagamenti: Bea su feature/rimborsi" }).last();
await presenceAnswer.waitFor({ timeout: 30_000 });
const presenceReply = await presenceAnswer.innerText();
if (!presenceReply.includes("src/payments.js") || !presenceReply.includes("Sezione presenza ricevuta")) throw new Error(`Presence answer: ${presenceReply}`);
await presenceAnswer.scrollIntoViewIfNeeded();
await shot("16d-presence-coordinator");
// G02: Gruppo is the picture of who works on what. One row per person and per agent, with identity, active branch,
// "anche su", the request, the files and the freshness; the person's own switch is in the view, on the right.
await page.getByRole("button", { name: /^Gruppo/ }).first().click();
const presencePanel = page.getByTestId("group-board");
const rows = presencePanel.locator('[data-testid="group-row"]');
const adaRow = rows.filter({ hasText: "Ada (tu)" });
await adaRow.getByText("feature/carrello").waitFor({ timeout: 10_000 });
const beaRow = rows.filter({ hasText: "Bea" }).and(page.locator('[data-kind="person"]'));
await beaRow.getByText("feature/rimborsi").waitFor({ timeout: 10_000 });
await beaRow.getByText(/anche su/).waitFor();
await beaRow.getByText("fix/iva-rimborsi").waitFor();
await beaRow.getByText("Rimborsi parziali").waitFor();
await beaRow.getByText("src/payments.js").waitFor();
await beaRow.getByText("attivo ora").waitFor();
const liaRow = rows.and(page.locator('[data-kind="agent"]')).filter({ hasText: "Lia" });
await liaRow.getByTestId("agent-tag").getByText("[Interfaccia]").waitFor();
await liaRow.getByText("trama/lia-rimborsi").waitFor();
await liaRow.getByText("Schermata dei rimborsi").waitFor();
await liaRow.getByText(/^inattivo da 1[2-9] min$/).waitFor();
const ownSwitch = page.getByTestId("inspector").getByRole("switch", { name: "Condividi la presenza", checked: true });
await ownSwitch.waitFor();
const groupInspector = await page.getByTestId("inspector").boundingBox();
const switchBox = await ownSwitch.boundingBox();
if (!groupInspector || !switchBox || switchBox.x < groupInspector.x + groupInspector.width / 2) throw new Error("Gruppo: the sharing switch is not on the right");
await shot("16a-presence-group");
const groupLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLook(provider, dark);
    await shot(`16b-presence-group-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLook(groupLook.provider, groupLook.dark);
// A wide inspector puts the details beside each name; a narrow window floats it over the chat without a horizontal scroll.
await page.getByTestId("inspector").getByRole("button", { name: "Allarga l'ispettore" }).click();
await page.waitForTimeout(400);
await shot("16d-presence-group-wide");
await page.getByTestId("inspector").getByRole("button", { name: "Larghezza normale" }).click();
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(400);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal page scroll in Gruppo at 720x640");
if (await page.getByTestId("inspector").evaluate((node) => node.scrollWidth > node.clientWidth + 1)) throw new Error("Gruppo overflows the inspector at 720x640");
await shot("16e-presence-group-narrow");
await page.setViewportSize({ width: 1280, height: 820 });
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").getByRole("button", { name: /^Presenza/ }).first().click();
await page.getByTestId("settings").getByRole("switch", { name: "Condividi la presenza", checked: true }).waitFor();
await page.getByTestId("settings").getByRole("button", { name: "Metti in pausa" }).click();
await page.getByTestId("settings").getByRole("button", { name: "Riprendi" }).waitFor();
await shot("16c-presence-settings");
await page.getByTestId("settings").getByRole("button", { name: "Riprendi" }).click();

// P10, GitHub CLI: with gh logged in, Collegamenti says so without the guide, and Controlla di nuovo reads it again.
await page.getByTestId("settings").getByRole("button", { name: /^Collegamenti/ }).first().click();
const githubRow = page.getByTestId("settings").getByText("Collegato come trama-ui.");
await githubRow.waitFor({ timeout: 15_000 });
if (await page.getByTestId("settings").getByText("gh auth login").count()) throw new Error("Collegamenti asks for gh auth login while gh is logged in");
await page.getByTestId("settings").getByRole("button", { name: "Controlla di nuovo" }).click();
await githubRow.waitFor({ timeout: 15_000 });
await shot("20-github-connected-light");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "dark" }));
await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
await shot("20a-github-connected-dark");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });


// G03, sovrapposizioni: Ada and Bea change the same line of src/payments.js. The merge probe runs in Trama's folders
// and confirms the conflict with its line; the Coordinator says it in the chat, the focus bar warns, the map marks the
// module and the file, and the message to Bea is ready to copy. Nothing is blocked or sent by Trama.
const overlapCard = page.locator('[data-anchor="presence-overlap"]').filter({ has: page.locator('[data-testid="overlap-card"][data-level="conflict"]') });
await overlapCard.first().waitFor({ timeout: 60_000 });
if (!(await overlapCard.first().innerText()).includes("riga 1")) throw new Error(`Overlap card without the line in conflict: ${await overlapCard.first().innerText()}`);
await overlapCard.first().scrollIntoViewIfNeeded();
await shot("16d-overlap-chat");
const focusOverlap = page.locator('[data-testid="focus-overlap"][data-level="conflict"]');
await focusOverlap.waitFor({ timeout: 10_000 });
await focusOverlap.getByRole("button", { name: /^Dettagli/ }).click();
await focusOverlap.getByRole("button", { name: "Scrivi a Bea" }).first().click();
const colleagueMessage = focusOverlap.getByTestId("colleague-message");
const draft = await colleagueMessage.getByRole("textbox").inputValue();
if (!draft.includes("Ciao Bea") || !draft.includes("src/payments.js") || !draft.includes("riga 1") || /[\u2013\u2014]/.test(draft)) {
  throw new Error(`Message to the colleague: ${draft}`);
}
const closeBox = await colleagueMessage.getByRole("button", { name: "Chiudi" }).boundingBox();
const copyBox = await colleagueMessage.getByRole("button", { name: "Copia il messaggio" }).boundingBox();
if (!closeBox || !copyBox || closeBox.x >= copyBox.x) throw new Error("Message to the colleague: Copia il messaggio is not the last call to action");
await shot("16e-overlap-focus");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "dark" }));
await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
await shot("16f-overlap-focus-dark");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await colleagueMessage.getByRole("button", { name: "Copia il messaggio" }).click();
await colleagueMessage.getByTestId("colleague-message-done").waitFor();
await page.getByRole("button", { name: "Mappa del progetto" }).click();
const markedModule = page.getByRole("listbox", { name: "Moduli" }).getByRole("option").filter({ has: page.locator('[data-overlap="conflict"]') });
await markedModule.first().waitFor({ timeout: 10_000 });
await page.getByTestId("map-overlap-legend").waitFor();
await shot("16g-overlap-map");
await markedModule.first().click();
await page.locator('[data-overlap="conflict"]').filter({ hasText: "Bea" }).first().waitFor();
await page.getByTestId("module-overlaps").waitFor();
await shot("16h-overlap-module");
// Never a block: Ada's checkout and branch are as she left them, and Bea's branch did not move.
if (!(await readFile(join(presenceProject, "src", "payments.js"), "utf8")).includes("CONTENUTO PRIVATO")) throw new Error("The probe changed the checkout");
if (presenceGit(presenceProject, "symbolic-ref", "--short", "HEAD").trim() !== "feature/carrello") throw new Error("The probe changed the branch");
if (presenceGit(presenceRemote, "rev-parse", "feature/rimborsi").trim() !== presenceGit(presenceSeed, "rev-parse", "feature/rimborsi").trim()) throw new Error("Bea's branch moved");
// P10, provider limits: a temporary 429 reads as such, with no JSON; Trama retries by itself with a growing wait,
// the person can stop it, and the actions sit on the right with the primary last. Then the provider recovers.
await page.getByLabel("Messaggio al Coordinatore").fill("[limite-temporaneo] Come si annulla un ordine?");
await page.keyboard.press("Enter");
const limitCard = page.locator('[role="alert"][data-failure-kind="temporaryLimit"]').last();
await limitCard.waitFor({ timeout: 30_000 });
await limitCard.getByText("Limite temporaneo del provider").waitFor();
await limitCard.getByTestId("provider-retry").getByText(/Trama riprova da sola tra \d+ secondi, tentativo 1 di 5\./).waitFor();
const noJson = async (where) => {
  const text = await limitCard.innerText();
  if (/[{}]|limit_source|"code"/.test(text)) throw new Error(`${where}: the limit card shows the provider's JSON: ${text}`);
};
await noJson("waiting");
for (const provider of ["codex", "pi"]) {
  for (const dark of [false, true]) {
    await setLook(provider, dark);
    await shot(`20b-provider-limit-waiting-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLook(null, false);
await limitCard.getByRole("button", { name: "Ferma i tentativi" }).click();
await limitCard.getByTestId("provider-retry").waitFor({ state: "detached", timeout: 10_000 });
const limitActions = ["Aggiungi la tua chiave", "Cambia modello", "Riprova"];
const actionBoxes = [];
for (const name of limitActions) actionBoxes.push(await limitCard.getByRole("button", { name, exact: true }).boundingBox());
const cardBox = await limitCard.boundingBox();
if (actionBoxes.some((box) => !box) || !cardBox) throw new Error("The limit card misses Aggiungi la tua chiave, Cambia modello or Riprova");
if (!actionBoxes.every((box, index) => index === 0 || box.x > actionBoxes[index - 1].x)) throw new Error("The limit actions are not in order with Riprova last");
const lastAction = actionBoxes.at(-1);
if (cardBox.x + cardBox.width - (lastAction.x + lastAction.width) > 24) throw new Error("The limit actions are not on the right");
if ((await limitCard.getByRole("button", { name: "Riprova", exact: true }).getAttribute("data-variant")) !== "default") throw new Error("Riprova is not the primary action");
await noJson("stopped");
await limitCard.getByRole("button", { name: "Dettagli tecnici" }).click();
await limitCard.getByText(/upstream_provider_shared_pool/).waitFor();
for (const dark of [false, true]) {
  await setLook(null, dark);
  await shot(`20c-provider-limit-actions-${dark ? "dark" : "light"}`);
}
await setLook(null, false);
// Cambia modello opens the picker on the provider's models.
await limitCard.getByRole("button", { name: "Cambia modello", exact: true }).click();
await page.getByRole("listbox", { name: "Modelli" }).waitFor({ timeout: 5_000 });
await shot("20d-provider-limit-change-model");
await page.keyboard.press("Escape");
await page.getByRole("listbox", { name: "Modelli" }).waitFor({ state: "detached" });
// Riprova meets the second 429, and the automatic retry after it finds the provider available again.
const personMessage = () => page.getByText("[limite-temporaneo] Come si annulla un ordine?", { exact: true }).count();
const messagesBefore = await personMessage();
const fakeReplies = () => page.getByText("Questa risposta arriva dal server di prova").count();
const repliesBefore = await fakeReplies();
await limitCard.getByRole("button", { name: "Riprova", exact: true }).click();
const retryLine = page.getByTestId("provider-retry").last();
await retryLine.getByText(/tentativo 1 di 5/).waitFor({ timeout: 30_000 });
await shot("20e-provider-limit-retrying");
await retryLine.waitFor({ state: "detached", timeout: 30_000 });
for (let tries = 0; (await fakeReplies()) <= repliesBefore; tries++) {
  if (tries > 120) throw new Error("The provider did not recover after the automatic retry");
  await page.waitForTimeout(250);
}
if ((await page.locator('[role="alert"][data-failure-kind="temporaryLimit"]').count()) !== 2) throw new Error("Expected the two 429 failures in the chat");
if ((await personMessage()) !== messagesBefore) throw new Error("A retry wrote the person's message again");
for (const dark of [false, true]) {
  await setLook(null, dark);
  await shot(`20f-provider-recovered-${dark ? "dark" : "light"}`);
}
await setLook(null, false);

// B02: with no project open the picker lists the recent projects with their path, last work, state and colleagues.
// Switching projects never replays the launch intro.
if (await page.getByTestId("launch-intro").count()) throw new Error("The launch intro played on a project switch");
await page.evaluate(() => window.trama.invoke("project:close", undefined));
const recentPicker = page.getByTestId("project-picker");
await recentPicker.waitFor();
await recentPicker.getByTestId("recent-project").filter({ hasText: /collega attivo|colleghi attivi/ }).first().waitFor({ timeout: 20_000 });
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  await primaryLast(recentPicker.getByTestId("picker-actions"), `Project picker with recents ${size}`);
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`picker with recents ${size} ${label}`);
    await shot(`01e-picker-recents-${size}-${label}`);
  }
}
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await app.close();

// P11: Antigravity works in every role. A fake agy first on the PATH and a separate HOME for its capture plugin:
// the picker offers it like the other providers, and the Coordinator runs on it in the read-only profile.
const agyBin = await mkdtemp(join(tmpdir(), "trama-ui-agy-"));
const agyHome = await mkdtemp(join(tmpdir(), "trama-ui-agy-home-"));
const agyLog = join(agyBin, "calls.log");
await writeFile(join(agyBin, "agy"), `#!/bin/sh\nexec "${process.execPath}" "${resolve("test-fixtures/fake-agy.mjs")}" "$@"\n`, { mode: 0o755 });
const agyProject = await mkdtemp(join(tmpdir(), "trama-ui-agy-project-"));
execFileSync("git", ["-C", agyProject, "init", "-q", "-b", "main"]);
await writeFile(join(agyProject, "README.md"), "# Magazzino\n");
execFileSync("git", ["-C", agyProject, "add", "."]);
execFileSync("git", ["-C", agyProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Magazzino"]);
({ app, page } = await launch({ PATH: `${agyBin}:${process.env.PATH}`, HOME: agyHome, FAKE_AGY_LOG: agyLog }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), agyProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-agy-project" }).waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: /^Provider e modello del Coordinatore/ }).click();
await page.getByRole("tab", { name: "Antigravity" }).click();
const agyModel = page.getByRole("listbox", { name: "Modelli" }).getByText("Gemini 3.5 Flash").first();
await agyModel.waitFor({ timeout: 20_000 });
if (await page.getByText("Solo per specialisti con worktree").count()) throw new Error("Antigravity is still offered only to specialists");
await shot("19-antigravity-picker");
await agyModel.click();
await page.getByRole("button", { name: "Provider e modello del Coordinatore: Antigravity" }).waitFor({ timeout: 20_000 });
await composer().fill("Cosa contiene il progetto?");
await page.keyboard.press("Enter");
await page.getByText("Ho letto il progetto in sola lettura").first().waitFor({ timeout: 30_000 });
const agyCalls = await readFile(agyLog, "utf8");
if (!/"profile":"read-only"/.test(agyCalls)) throw new Error(`The Antigravity Coordinator did not run read-only: ${agyCalls}`);
for (const expected of ["allowed view_file", "denied write_to_file", "denied run_command"]) {
  if (!agyCalls.includes(expected)) throw new Error(`Antigravity read-only hook: no "${expected}" in ${agyCalls}`);
}
if ((await readFile(join(agyProject, "README.md"), "utf8")) !== "# Magazzino\n") throw new Error("The read-only Antigravity turn changed a file");
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`19a-antigravity-coordinator-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();
