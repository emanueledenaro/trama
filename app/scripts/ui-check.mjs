// Launches the built app with the fake Codex server and saves screenshots of the main screens.
// Usage: node scripts/ui-check.mjs <output-dir>
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
      // The check reads Italian texts: the system's language is fixed, whatever the machine's (issue #301).
      TRAMA_SYSTEM_LANGUAGE: "it",
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
// Every screenshot has its own name: a second one with the same name would overwrite the first without a word.
const shotNames = new Set();
const shot = async (name) => {
  if (shotNames.has(name)) throw new Error(`Two screenshots named ${name}`);
  shotNames.add(name);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("saved", name);
};
// Issue #271: a card that asks nothing more is one line; this opens the line when it is closed.
const openSettled = async (line) => {
  if ((await line.getAttribute("data-testid")) !== "settled-card") return;
  const toggle = line.getByRole("button", { name: /^Apri: / }).first();
  if (await toggle.count()) await toggle.click();
};
// A card that may settle while the check reads it: opens its line until `find` shows what the check looks for.
const waitInCard = async (card, find, what, timeout = 20_000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(250)) {
    await openSettled(card).catch(() => undefined);
    if (await find(card).first().isVisible().catch(() => false)) return;
  }
  throw new Error(`Not found in the card: ${what}`);
};
// Issue #240: a card that waits for the person sits in Aspetta te; the chat keeps a reference that opens it there.
const waitingItem = async (reference, timeout = 20_000) => {
  await reference.waitFor({ timeout });
  const key = await reference.getAttribute("data-waiting-key");
  await reference.getByRole("button", { name: "Apri in Aspetta te" }).click();
  const item = page.getByTestId("inspector").locator(`[data-testid="waiting-item"][data-waiting-key="${key}"]`);
  await item.waitFor();
  return item;
};
const openWaiting = (kind, text, timeout) => {
  let reference = page.locator(`[data-testid="waiting-reference"][data-waiting-kind="${kind}"]`);
  if (text) reference = reference.filter({ hasText: text });
  return waitingItem(reference.last(), timeout);
};
// Issue #292: a verified candidate waits for the person in Aspetta te, where its card is. Opens the list if closed.
const showWaiting = async () => {
  if (await page.getByTestId("inspector").locator('[data-testid="waiting-item"]').count()) return;
  await page.getByTestId("waiting-summary").getByRole("button").click();
  await page.getByTestId("inspector").locator('[data-testid="waiting-item"]').first().waitFor();
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

// W17: the seam, the bots' stitch used as an accent. At most one shows on a screen, and only on the approved uses;
// each use is saved in light and dark. With high contrast the stitch becomes a continuous edge.
const visibleSeams = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("svg[data-seam]")]
      .filter((svg) => {
        const box = svg.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
      })
      .map((svg) => svg.dataset.seam),
  );
const expectSeam = async (use) => {
  const seams = await visibleSeams();
  if (seams.length > 1) throw new Error(`More than one seam on the screen: ${seams.join(", ")}`);
  if ((seams[0] ?? null) !== use) throw new Error(`Expected the seam on ${use ?? "nothing"}, found ${seams[0] ?? "none"}`);
};
const seamShots = async (use, name) => {
  await expectSeam(use);
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  for (const mode of ["light", "dark"]) {
    await page.evaluate((isDark) => document.documentElement.classList.toggle("dark", isDark), mode === "dark");
    await shot(`21-seam-${name}-${mode}`);
  }
  await page.evaluate((isDark) => document.documentElement.classList.toggle("dark", isDark), dark);
};
const expectContrastFallback = async () => {
  for (const media of [{ contrast: "more" }, { forcedColors: "active" }]) {
    await page.emulateMedia(media);
    const dash = await page.evaluate(() => {
      const rect = document.querySelector("svg[data-seam] rect");
      return rect ? getComputedStyle(rect).strokeDasharray : null;
    });
    if (dash !== "none") throw new Error(`With ${JSON.stringify(media)} the seam is still dashed: ${dash}`);
  }
  await page.emulateMedia({ contrast: "no-preference", forcedColors: "none" });
};
const dragFiles = (type) =>
  page.evaluate((eventType) => {
    const files = new DataTransfer();
    files.items.add(new File(["Note"], "note.txt", { type: "text/plain" }));
    document.querySelector("form.chat-composer-surface").dispatchEvent(new DragEvent(eventType, { dataTransfer: files, bubbles: true, cancelable: true }));
  }, type);

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
// Light and dark, then the theme the check had.
const themeShots = async (name) => {
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
    await shot(`${name}-${dark ? "dark" : "light"}`);
  }
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), wasDark);
};
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
// The dialog takes the focus once it has opened, which a slow machine shows after the heading: wait for it first.
await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-testid="welcome"]')), null, { timeout: 10_000 });
for (let press = 0; press < 8; press++) {
  await page.keyboard.press("Tab");
  // A Tab that lands on a focus guard is sent back inside on the next frame; a person never types faster than that,
  // but Playwright does, and a second Tab before the redirect reached the window behind on a loaded runner.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
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
// Issue #301: the language comes first, with the system's already chosen; the welcome changes at once, without a restart.
const languageChoice = welcome.getByTestId("welcome-language");
await languageChoice.getByRole("radio", { name: "Italiano", checked: true }).waitFor();
await languageChoice.getByRole("radio", { name: "English" }).click();
await welcome.getByRole("heading", { name: "Welcome to Trama" }).waitFor();
await welcome.getByRole("button", { name: "Set up", exact: true }).waitFor();
if ((await page.evaluate(() => document.documentElement.lang)) !== "en") throw new Error("The page language did not follow the choice");
await primaryLast(welcome.locator(".cta-row").last(), "Welcome in English");
for (const [label, theme] of themes) {
  await setTheme(theme);
  await noHorizontalScroll(`welcome english ${label}`);
  await shot(`00a-welcome-en-${label}`);
}
await setTheme("system");
await welcome.getByRole("button", { name: "Set up", exact: true }).click();
await welcome.getByRole("heading", { name: /Connect GitHub/ }).waitFor();
await shot("00c-welcome-github-en");
await welcome.getByRole("button", { name: "Back" }).click();
await welcome.getByRole("button", { name: "Back" }).click();
await languageChoice.getByRole("radio", { name: "Italiano" }).click();
await welcome.getByRole("heading", { name: "Benvenuto in Trama" }).waitFor();
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
const startLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
if ((await page.locator('[data-testid="brand-slot"] [data-trama-mark="glyph"]').count()) !== 1) throw new Error("No Trama mark in the sidebar's brand slot");
if ((await page.locator("[data-trama-mark]").count()) < 2) throw new Error("No Trama mark on the project picker");
const markColors = new Set();
for (const provider of ["codex", "claudeAgent", "grok"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
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
await setLookTo(startLook.provider, startLook.dark);
await seamShots("logo", "logo");
await expectContrastFallback();
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
// Issue #292: at the start only the goal the Coordinator proposed waits for the person, in the summary, in the sidebar
// counter and as a reference in the chat.
const startSummary = (await page.getByTestId("waiting-summary").innerText()).replace(/\s+/g, " ");
if (!startSummary.includes("Obiettivo proposto") || !startSummary.includes("1 cosa aspetta te")) throw new Error(`Aspetta te at the start: ${startSummary}`);
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').waitFor();
// A place to fill: the project has no goal yet. Files dragged over the composer take the seam while they are there.
await page.getByTestId("first-goal").scrollIntoViewIfNeeded();
await seamShots("firstGoal", "first-goal");
await dragFiles("dragover");
await page.getByText("Rilascia le immagini per allegarle al messaggio").waitFor();
await seamShots("fileDrop", "file-drop");
await dragFiles("dragleave");
await expectSeam("firstGoal");
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
await page.getByRole("main").getByText("Cosa succede a un ordine pagato annullato?").first().waitFor({ timeout: 20_000 });
await shot("03b-decision-card");
const firstDecision = await openWaiting("question", "Cosa succede a un ordine pagato annullato?");
await shot("03b2-decision-waiting");
// The summary sits above the composer with its button on the right; one click opens the list. Light and dark.
const waitingBar = page.getByTestId("waiting-summary");
const waitingButton = waitingBar.getByRole("button", { name: /cose aspettano te$/ });
const waitingBarBox = await waitingBar.boundingBox();
const waitingButtonBox = await waitingButton.boundingBox();
if (!waitingBarBox || !waitingButtonBox || waitingBarBox.x + waitingBarBox.width - (waitingButtonBox.x + waitingButtonBox.width) > 12) {
  throw new Error("The Aspetta te summary button is not on the right");
}
for (const [label, theme] of themes) {
  await setTheme(theme);
  await shot(`03b3-waiting-${label}`);
}
await setTheme("system");
await firstDecision.getByRole("button", { name: /Va in revisione/ }).click();
await firstDecision.getByRole("button", { name: "Registra la decisione" }).click();
// Issue #271: an answered card is one line with the choice; the line opens the whole card.
const answeredLine = page.getByTestId("settled-card").filter({ has: page.getByTestId("settled-answer") }).first();
await answeredLine.waitFor({ timeout: 20_000 });
if (!(await answeredLine.innerText()).includes("Hai scelto: ")) throw new Error(`Answered decision line: ${await answeredLine.innerText()}`);
await page.waitForTimeout(800);
await shot("03c-decision-answered");
await answeredLine.getByRole("button", { name: /^Apri: / }).click();
await answeredLine.getByText("Apri nel Patto").waitFor();
await answeredLine.getByRole("button", { name: /^Chiudi: / }).click();
// The turn's technical steps are in Activity, grouped; the chat keeps one line that opens them there.
await page.getByTestId("work-line").getByText("Ha lavorato per").first().click();
await page.getByTestId("inspector").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"]').first().waitFor();
await shot("04-work-expanded");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("[proponi-team]");
await page.keyboard.press("Enter");
const teamItem = await openWaiting("team");
await teamItem.getByRole("button", { name: "Conferma il team" }).waitFor({ timeout: 20_000 });
await shot("04b-team-proposal");
await teamItem.getByRole("button", { name: "Conferma il team" }).click();
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
// W16: right after the team is generated, every agent rests with its eyes open; only an agent out of the team sleeps.
const teamEyes = await teamPanel.evaluate((el) =>
  [...el.querySelectorAll('[data-testid="agent-bot"]')].map((bot) => ({
    agent: bot.dataset.agent,
    activity: bot.dataset.activity,
    eyes: Number(bot.querySelector('[data-part="eyes"]')?.getAttribute("opacity") ?? 0),
    open: Math.max(...[...bot.querySelectorAll('[data-part^="eye-"]')].map((eye) => eye.getBBox().height)),
  })),
);
const shut = teamEyes.filter((bot) => bot.activity === "inactive" || bot.eyes < 1 || bot.open < 5);
if (shut.length) throw new Error(`Bots without open eyes right after the team: ${JSON.stringify(shut)}`);
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
// W16: at the inspector's minimum width, with a long name, the header keeps the name on one line and the status whole.
await page.setViewportSize({ width: 980, height: 820 });
await page.waitForTimeout(300);
const header = await teamPanel.getByTestId("specialist-header").evaluate((el) => {
  const inspector = el.closest('[data-testid="inspector"]').getBoundingClientRect();
  const status = el.querySelector('[data-testid="specialist-status"]');
  const name = el.querySelector("h3");
  const box = status.getBoundingClientRect();
  return {
    inspector: Math.round(inspector.width),
    statusInside: box.left >= inspector.left && box.right <= inspector.right,
    statusWhole: status.scrollWidth <= status.clientWidth + 1,
    nameLines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
  };
});
if (header.inspector > 345) throw new Error(`The inspector is not at its minimum width: ${header.inspector}`);
if (!header.statusInside || !header.statusWhole) throw new Error(`The specialist's status is cut at the minimum width: ${JSON.stringify(header)}`);
if (header.nameLines !== 1) throw new Error(`The specialist's name wraps at the minimum width: ${JSON.stringify(header)}`);
await shot("04e2b-specialist-narrow");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("04e2c-specialist-narrow-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.setViewportSize({ width: 1280, height: 820 });
if (await teamPanel.getByRole("button", { name: "Rinomina", exact: true }).count()) throw new Error("A fixed role offers a rename");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// W13: the person asks the Coordinator to rename the developer, without a new mandate; the chat follows the new name.
await page.getByLabel("Messaggio al Coordinatore").fill("[rinomina:Giulia:Bea]");
await page.keyboard.press("Enter");
await page.getByText("Ho rinominato Giulia in Bea.").first().waitFor({ timeout: 20_000 });
await page.getByText(/^Bea$/).first().waitFor({ timeout: 20_000 });
await page.getByText("ha lavorato per").first().waitFor();
await shot("04e5-team-renamed-in-chat");

// W16: each agent is a bot in its own color; no two agents of the team share a body, the chat shows them too, the
// bots move only without reduced motion, and they read in light and dark.
const botState = (root) =>
  root.evaluate((el) =>
    [...el.querySelectorAll('[data-testid="agent-bot"]')].map((bot) => ({
      shape: bot.dataset.shape,
      color: bot.style.getPropertyValue("--agent-light"),
      name: bot.dataset.agent,
      d: bot.querySelector('[data-part="blob-0"]')?.getAttribute("d"),
    })),
  );
const chatBots = await botState(page.locator("main").first());
if (!chatBots.length) throw new Error("The chat shows no agent bot");
await page.getByRole("button", { name: /^Team/ }).first().click();
await teamPanel.getByText("Chiarimento e spec", { exact: true }).waitFor();
const teamBots = await botState(teamPanel);
const bodies = new Map();
for (const bot of teamBots) {
  const other = bodies.get(`${bot.shape}${bot.color}`);
  if (other && other !== bot.name) throw new Error(`${bot.name} and ${other} look the same: ${bot.shape}`);
  bodies.set(`${bot.shape}${bot.color}`, bot.name);
}
if (new Set(teamBots.map((b) => b.shape)).size < 12) throw new Error(`The team has too few bodies: ${[...new Set(teamBots.map((b) => b.shape))]}`);
// W16, sizes: 32 px in the Team rows and in the chat, and never a bot under 20 px anywhere.
const botSizes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="agent-bot"]')].map((bot) => Math.round(bot.getBoundingClientRect().width)));
if (Math.min(...botSizes) < 20) throw new Error(`A bot is smaller than 20 px: ${botSizes}`);
const rowBot = await teamPanel.getByTestId("team-figure").first().getByTestId("agent-bot").boundingBox();
if (!rowBot || rowBot.width < 32) throw new Error(`The Team rows' bots are under 32 px: ${rowBot?.width}`);
// W16, cost: CSS runs the steady moves; the frame loop runs only while the cursor moves or a bot morphs, at most
// 24 times per second, and not at all at rest. Reduced motion stops everything and keeps the still pose.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
await page.waitForFunction(() => !document.documentElement.classList.contains("bots-paused"), null, { timeout: 5_000 });
const botFrames = () => page.evaluate(() => ({ frames: window.__tramaBots.frames, at: performance.now() }));
const perSecond = (from, to) => ((to.frames - from.frames) * 1000) / (to.at - from.at);
// CPU of the renderer and GPU processes over a few seconds, from Electron's own metrics.
const cpuOver = async (ms) => {
  await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  await page.waitForTimeout(ms);
  return app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((m) => m.type === "Tab" || m.type === "GPU")
      .reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
  );
};
const liveBot = teamPanel.locator('[data-testid="agent-bot"][data-live]').first();
if (!(await liveBot.evaluate((bot) => bot.getAnimations().length > 0))) throw new Error("The bots in view do not breathe");
// The steady moves advance in steps, so the window is redrawn a few times per second, not at every frame.
const smooth = await page.evaluate(() =>
  document
    .getAnimations()
    .filter((a) => a.effect?.target?.closest?.(".agent-bot"))
    .filter((a) => !a.effect.getKeyframes().slice(0, -1).every((k) => String(k.easing).startsWith("steps"))).length,
);
if (smooth) throw new Error(`${smooth} bot animations run at every frame instead of in steps`);
const eyeOf = (bot) => bot.locator('[data-part="eye-0"]').getAttribute("transform");
const follower = teamPanel.locator('[data-testid="agent-bot"][data-live]:is([data-activity="idle"], [data-activity="done"], [data-activity="waiting"])').first();
const followerBox = await follower.boundingBox();
const eyesBefore = await eyeOf(follower);
const movingFrom = await botFrames();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(followerBox.x + followerBox.width / 2 + 200 * Math.cos(i / 6), followerBox.y + followerBox.height / 2 + 120 * Math.sin(i / 6));
  await page.waitForTimeout(50);
}
const movingRate = perSecond(movingFrom, await botFrames());
if (movingRate > 24 * 1.1) throw new Error(`The bot loop ran ${movingRate.toFixed(1)} frames per second while the cursor moved, over 24`);
if ((await eyeOf(follower)) === eyesBefore) throw new Error("The eyes do not follow the cursor");
await page.waitForTimeout(800);
const restFrom = await botFrames();
await page.waitForTimeout(3_000);
const restFrames = (await botFrames()).frames - restFrom.frames;
if (restFrames > 3) throw new Error(`The bot loop ran ${restFrames} frames in 3 s at rest`);
const cpuMoving = await cpuOver(3_000);
await page.emulateMedia({ reducedMotion: "reduce" });
const cpuStill = await cpuOver(3_000);
await page.emulateMedia({ reducedMotion: "no-preference" });
if (cpuMoving - cpuStill > 5) throw new Error(`The bots at rest cost ${(cpuMoving - cpuStill).toFixed(1)}% of CPU, over 5%`);
console.log(
  `bots: ${botSizes.length} on screen, ${movingRate.toFixed(1)} frames/s with the cursor moving, ${restFrames} frames in 3 s at rest, ` +
    `renderer+GPU CPU at rest ${cpuMoving.toFixed(1)}% animated, ${cpuStill.toFixed(1)}% with reduced motion`,
);
const firstBot = teamPanel.getByTestId("agent-bot").first();
const outline = () => firstBot.locator('[data-part="blob-0"]').getAttribute("d");
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(200);
const stillBefore = await outline();
if (await liveBot.evaluate((bot) => bot.getAnimations().some((a) => a.playState === "running"))) throw new Error("A bot breathes with reduced motion");
await page.waitForTimeout(600);
if ((await outline()) !== stillBefore) throw new Error("A bot moves with reduced motion");
await page.emulateMedia({ reducedMotion: "no-preference" });
await shot("04e6-bots-team-light");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("04e7-bots-team-dark");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await shot("04e8-bots-chat-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("04e9-bots-chat-light");

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
// Issue #270: cards name their records; the id stays on the title's hover and in data attributes.
const recordId = (scope, prefix) => scope.locator(`[data-record-id^="${prefix}-"]`).first().getAttribute("data-record-id");
const assignmentId = await recordId(page, "A");
// An answered card is one line (issue #271): the decision's id comes from the state, not from the card's text.
const decisionOf = (question) =>
  page.evaluate(async (text) => (await window.trama.getState()).project.document.decisionRequests.find((r) => r.outcome && r.question.includes(text))?.outcome.decisionId, question);
const decisionId = await decisionOf("Cosa succede a un ordine pagato annullato?");
if (!/^D-[0-9A-F]{8}$/.test(decisionId ?? "")) throw new Error(`No decision recorded: ${decisionId}`);
await page.getByLabel("Messaggio al Coordinatore").fill(`[candidato:${assignmentId}:${decisionId}]`);
await page.keyboard.press("Enter");
// Issue #292: the verified candidate waits for the person in Aspetta te; the chat keeps its reference.
const demoCandidate = await openWaiting("candidate", undefined, 30_000);
await demoCandidate.getByText("Deciso", { exact: true }).waitFor({ timeout: 30_000 });
// Issue #270: Aspetta te opened on the candidate names it in its title, with the id on hover; the card names its work.
const waitingTitle = page.getByTestId("inspector-title");
if (!/^Aspetta te\s*Candidato di /.test(await waitingTitle.innerText())) throw new Error(`Aspetta te does not name the candidate: ${await waitingTitle.innerText()}`);
if (!/^C-[0-9A-F]{8}$/.test((await waitingTitle.getAttribute("title")) ?? "")) throw new Error("The candidate's id is not on the title's hover");
if (/(Candidato|incarico) [AC]-[0-9A-F]{8}/.test(await demoCandidate.innerText())) throw new Error(`The candidate card shows raw ids: ${await demoCandidate.innerText()}`);
await page.waitForTimeout(500);
await shot("04f-candidate");
await themeShots("04f2-waiting-candidate");
await demoCandidate.getByRole("button", { name: "Apri il diff" }).click();
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
await domainCard.getByText(/Il mandato non permette di lavorare in una copia di lavoro su root/).waitFor();
for (const expected of ["Ordine in revisione", "Ordine sospeso, Rimborso in attesa", "Gli ordini pagati annullati vanno in revisione", "docs/adr/NNNN-"]) {
  if (!(await domainCard.innerText()).includes(expected)) throw new Error(`The domain proposal does not show "${expected}"`);
}
// The role's name also shows among the candidate's reviewers (W10): only an assignment card of the role is writing.
const documentationWork = page.locator('.chat-card:not([data-testid="settled-card"] .chat-card), [data-testid="settled-card"]').filter({ hasText: /^Incarico / }).filter({ hasText: "Documentazione e dominio" });
if (await documentationWork.count()) throw new Error("The documentation role started writing outside the mandate");
await domainCard.scrollIntoViewIfNeeded();
await shot("04j-domain-proposal-waiting");
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /^Root/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await domainCard.getByText("Scritta", { exact: true }).waitFor({ timeout: 30_000 });
await domainCard.getByText(/ha scritto la proposta nella copia di lavoro dell'incarico di /).waitFor();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await domainCard.scrollIntoViewIfNeeded();
await shot("04k-domain-proposal-written");
await page.getByRole("button", { name: "Mappa del progetto" }).click();
await shot("05-map");
// #229: every panel separator is the same sash. At rest it draws nothing over the panel border; after a short hover
// it takes the provider's accent, and while dragged it stays lit. Double-click and the arrow keys change the width.
{
  const sidebarSash = page.getByRole("separator", { name: /Larghezza della barra laterale/ });
  const inspectorSash = page.getByRole("separator", { name: "Larghezza dell'ispettore" });
  const look = (sash) =>
    sash.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.style.color = "var(--color-text-accent)";
      element.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const drawn = ["::before", "::after"].filter((pseudo) => getComputedStyle(element, pseudo).content !== "none");
      return { background: style.backgroundColor, accent, width: element.getBoundingClientRect().width, cursor: style.cursor, drawn, children: element.childElementCount };
    });
  const transparent = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
  for (const sash of [sidebarSash, inspectorSash]) {
    const rest = await look(sash);
    if (!transparent(rest.background) || rest.drawn.length || rest.children) throw new Error(`A sash shows at rest: ${JSON.stringify(rest)}`);
    if (rest.width !== 4 || rest.cursor !== "col-resize") throw new Error(`A sash is not a 4px col-resize grip: ${JSON.stringify(rest)}`);
  }
  const sidebarBox = await sidebarSash.boundingBox();
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, 300);
  await page.waitForTimeout(100);
  if (!transparent((await look(sidebarSash)).background)) throw new Error("The sash lights up before the hover delay");
  await page.waitForTimeout(500);
  const hovered = await look(sidebarSash);
  if (hovered.background !== hovered.accent) throw new Error(`The hovered sash is not the provider's accent: ${JSON.stringify(hovered)}`);
  for (const mode of ["light", "dark"]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), mode === "dark");
    await shot(`22-sash-hover-${mode}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const inspectorBox = await inspectorSash.boundingBox();
  const startWidth = Number(await inspectorSash.getAttribute("aria-valuenow"));
  await page.mouse.move(inspectorBox.x + inspectorBox.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(inspectorBox.x + inspectorBox.width / 2 - 60, 300, { steps: 6 });
  await page.waitForTimeout(200);
  const dragged = await look(inspectorSash);
  if (dragged.background !== dragged.accent) throw new Error(`The dragged sash is not lit: ${JSON.stringify(dragged)}`);
  await shot("22-sash-drag-light");
  await page.mouse.up();
  await page.mouse.move(640, 500);
  if (Number(await inspectorSash.getAttribute("aria-valuenow")) !== startWidth + 60) throw new Error("Dragging the sash does not widen the inspector");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Larghezza dell\'ispettore"]')).backgroundColor === "rgba(0, 0, 0, 0)");
  await inspectorSash.dblclick();
  await page.waitForFunction(() => document.querySelector('[aria-label="Larghezza dell\'ispettore"]')?.getAttribute("aria-valuenow") === "420");
  await inspectorSash.focus();
  await page.keyboard.press("ArrowLeft");
  if ((await inspectorSash.getAttribute("aria-valuenow")) !== "436") throw new Error("ArrowLeft does not widen the inspector");
  await page.keyboard.press("Shift+ArrowRight");
  if ((await inspectorSash.getAttribute("aria-valuenow")) !== "372") throw new Error("Shift+ArrowRight does not narrow the inspector by 64px");
  await page.keyboard.press("Home");
  if ((await inspectorSash.getAttribute("aria-valuenow")) !== "420") throw new Error("Home does not reset the inspector");
  if ((await inspectorSash.getAttribute("aria-orientation")) !== "vertical") throw new Error("The sash has no vertical orientation");
  await inspectorSash.blur();
}
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
// Issue #292: the proposed goal waits for the person in Aspetta te; the chat keeps its reference.
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first().waitFor();
// Issue #292: what waits for the person while the Coordinator's goal is proposed, with the list open.
if (await page.getByTestId("waiting-summary").count()) await page.getByTestId("waiting-summary").getByRole("button").click();
await themeShots("10b-waiting-proposed-goal");
if (await page.getByRole("button", { name: "Chiudi l'ispettore" }).count()) await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.getByRole("button", { name: "Formula il primo obiettivo" }).first().click();
await page.getByLabel("Titolo dell'obiettivo").fill("Ordini annullati in revisione");
await page.getByLabel("Risultato atteso").fill("Un ordine pagato e annullato resta in revisione finché una persona non decide.");
await page.getByLabel("Esempio 1").fill("Ordine 42 pagato e annullato: stato review");
await page.getByRole("button", { name: "Crea l'obiettivo" }).click();
await page.getByTestId("dialog-title").filter({ hasText: "Ordini annullati in revisione" }).waitFor();
await page.getByTestId("goal-dialog-header").waitFor();
// The goal is saved before the dialog opens; its detail keeps the stable id used after the restart on hover (issue #270).
const goalTitle = "Ordini annullati in revisione";
const goalId = await page.locator("[data-goal-id]").first().getAttribute("data-goal-id");
if (!/^G-[0-9A-F]{8}$/.test(goalId ?? "")) throw new Error(`The goal has no id on hover: ${goalId}`);
if (await page.getByText(/^G-[0-9A-F]{8}$/).count()) throw new Error("The goal's id shows as text");
await page.getByLabel("Messaggio al Coordinatore").fill("Da dove partiamo per questo obiettivo?");
await page.keyboard.press("Enter");
// Issue #277: the echoed goal id ("Messaggio sull'obiettivo G-...") is a link that shows the goal's title.
const goalReference = page.locator(`.chat-markdown a[data-reference="goal"][data-reference-id="${goalId}"]`);
await goalReference.filter({ hasText: goalTitle }).first().waitFor({ timeout: 20_000 });
await shot("10d-goal-dialog");
// U01: one chat per project. The goal filter shows only the goal's messages; the whole chat shows everything, in
// order, with the goal next to the messages about it. The composer and its draft stay the same across filters.
if (await page.getByText("Ho letto lo studio").count()) throw new Error("The goal filter shows messages outside the goal");
await page.getByLabel("Messaggio al Coordinatore").fill("Bozza che resta nella chat");
await page.getByRole("button", { name: "Chat del Coordinatore" }).click();
await page.getByText("Ho letto lo studio").first().waitFor();
await goalReference.first().waitFor();
await page.getByTestId("chat-goal-tag").filter({ hasText: goalTitle }).last().scrollIntoViewIfNeeded();
if ((await page.getByLabel("Messaggio al Coordinatore").inputValue()) !== "Bozza che resta nella chat") throw new Error("The chat's draft changed with the filter");
await shot("10f-single-chat-dark");
await page.getByTestId("chat-filter").click();
await page.getByRole("menuitem", { name: goalTitle }).waitFor();
await shot("10g-chat-filter-menu-dark");
await page.keyboard.press("Escape");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "light";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByTestId("chat-goal-tag").filter({ hasText: goalTitle }).last().scrollIntoViewIfNeeded();
await shot("10f-single-chat-light");
await page.getByTestId("chat-filter").click();
await page.getByRole("menuitem", { name: goalTitle }).click();
await page.getByTestId("dialog-title").filter({ hasText: goalTitle }).waitFor();
if (await page.getByText("Ho letto lo studio").count()) throw new Error("The goal filter shows messages outside the goal");
await shot("10h-chat-filtered-light");
await page.getByTestId("chat-filter").click();
await page.getByRole("menuitem", { name: "Tutta la chat" }).click();
await page.getByText("Ho letto lo studio").first().waitFor();
await page.getByLabel("Messaggio al Coordinatore").fill("");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
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
// U01: with open questions, the sidebar under the project still lists only the chat, the goals and the agents.
const projectRows = await page
  .getByTestId("sidebar-project-rows")
  .evaluate((list) => [...list.children].map((row) => row.getAttribute("data-testid")));
if (projectRows[0] !== "sidebar-chat" || projectRows.some((id) => !["sidebar-chat", "sidebar-goal", "sidebar-agent"].includes(id))) {
  throw new Error(`The sidebar lists more than the chat, goals and agents under the project: ${projectRows.join(", ")}`);
}
if (await page.getByTestId("sidebar-project-rows").getByText(/Chiarimento, turno/).count()) throw new Error("A grilling round is listed in the sidebar");
await shot("14-sidebar-project-rows-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "light";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("14-sidebar-project-rows-light");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
const withdrawnItem = await waitingItem(round.getByTestId("waiting-reference").first());
await withdrawnItem.getByRole("button", { name: "Ritira", exact: true }).click();
await withdrawnItem.getByLabel("Motivo del ritiro").fill("Chi vede la revisione lo decidiamo dopo il primo rilascio");
await shot("14a-withdraw-reason");
await withdrawnItem.getByRole("button", { name: "Ritira la domanda" }).click();
await round.getByTestId("withdrawn-question").waitFor({ timeout: 20_000 });
await page.getByText(/Ho ritirato la domanda 1 del chiarimento, turno 1/).first().waitFor({ timeout: 20_000 });
const otherItem = await waitingItem(round.getByTestId("waiting-reference").first());
await otherItem.getByRole("button", { name: /Anche il cliente/ }).click();
await otherItem.getByRole("button", { name: "Registra la decisione" }).click();
// Issue #271: the complete round is one line; the line opens it with the withdrawn question.
const roundLine = page.getByTestId("settled-card").filter({ hasText: "Chiarimento prima del piano, turno 1" }).filter({ hasText: "Turno completo" }).first();
await roundLine.waitFor({ timeout: 20_000 });
// A06: with no question open, the conflict of Bea's work with the main branch is a technical block the mandate lets
// the Coordinator resolve by itself: Trama starts the move and the status line names it, with its stop on the right.
const resolveConflict = page.getByTestId("status-line").getByRole("button", { name: "Ferma: Risolvi il conflitto" });
await resolveConflict.waitFor({ timeout: 20_000 });
await page.getByTestId("status-line").getByTestId("status-line-text").getByText(/^Sto risolvendo il conflitto/).waitFor();
for (const dark of [false, true]) {
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await shot(`14b0-block-resolution-${dark ? "dark" : "light"}`);
}
// The check stops it, so the plan below starts from an idle Coordinator.
await resolveConflict.click();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await roundLine.getByRole("button", { name: /^Apri: / }).click();
await round.getByTestId("withdrawn-question").waitFor();
await round.scrollIntoViewIfNeeded();
await shot("14b-grilling-withdrawn");
// M04: the plan follows to-spec, once the grilling round above is complete (a plan waits for open questions).
// The seams come first and wait for the person, with the confirmation on the right; then the spec with the
// template's sections, which stays in Trama without GitHub. The mandate allows planning, so the Coordinator would
// confirm the seams and the slices by itself (A06): the check pauses continuous work, and in pause they stay the person's.
await page.getByTestId("status-line").getByRole("button", { name: "Pausa", exact: true }).click();
await page.locator('[data-testid="status-line"][data-paused="true"]').waitFor({ timeout: 20_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("[piano]");
await page.keyboard.press("Enter");
const seamsItem = await openWaiting("seams");
const seamCheck = seamsItem.locator('[data-testid="plan-spec"][data-status="seams"]');
const confirmSeams = seamCheck.getByRole("button", { name: "Conferma i punti di prova" });
await confirmSeams.waitFor({ timeout: 20_000 });
await seamCheck.scrollIntoViewIfNeeded();
const confirmBox = await confirmSeams.boundingBox();
const seamBox = await seamCheck.boundingBox();
if (!confirmBox || !seamBox || seamBox.x + seamBox.width - (confirmBox.x + confirmBox.width) > 2) throw new Error("Conferma i punti di prova is not on the right");
await shot("04c1-plan-seams");
// The next step "Conferma i punti di prova" targets the plan, which waits in Aspetta te: the button opens it there.
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("[passo:confirmSeams] A che punto è il piano?");
await page.keyboard.press("Enter");
const seamsStep = page.getByTestId("next-step").getByRole("button", { name: "Conferma i punti di prova" }).last();
await seamsStep.waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await seamsStep.click();
await page.waitForTimeout(800);
if (!(await seamCheck.evaluate((card) => { const box = card.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight; }))) {
  throw new Error("The next step Conferma i punti di prova did not open the plan in Aspetta te");
}
await shot("04c1b-next-step-seams");
await confirmSeams.click();
const writtenSpec = (await openWaiting("slices")).locator('[data-testid="plan-spec"][data-status="ready"]');
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
// The slices held the work for the person while in pause. After Riprendi, the end of the next turn lets the
// Coordinator confirm them by itself within the mandate (A06): they stay in Trama without GitHub, the first is ready
// and the others wait for it, and the work goes on by itself (W04). The example project runs no periodic round.
await page.getByTestId("status-line").getByRole("button", { name: "Riprendi" }).click();
await page.locator('[data-testid="status-line"][data-paused="true"]').waitFor({ state: "detached", timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("A che punto sono le fette?");
await page.keyboard.press("Enter");
await page.getByText("Fette confermate dal Coordinatore").last().waitFor({ timeout: 20_000 });
// Confirmed, the plan leaves Aspetta te and the chat shows it again in full.
const confirmedSlices = page.locator('[data-testid="plan-spec"][data-status="ready"]').last().getByTestId("plan-slices");
await confirmedSlices.getByText("Restano in Trama").waitFor({ timeout: 20_000 });
await confirmedSlices.scrollIntoViewIfNeeded();
const sliceStates = await confirmedSlices.getByTestId("plan-slice").evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
if (sliceStates[0] === "blocked" || sliceStates.slice(1).some((state) => state !== "blocked")) throw new Error(`The slices do not respect their blockers: ${sliceStates}`);
await shot("04c4-plan-slices-confirmed");
for (const dark of [false, true]) {
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await shot(`04c4a-slices-by-coordinator-${dark ? "dark" : "light"}`);
}
const statusLine = page.getByTestId("status-line");
// The check stops the automatic assignment from the status line, so the queue below starts from an idle Coordinator.
// The move is not a row of the chat (issue #241): the status line names it and carries its stop.
await statusLine.getByRole("button", { name: "Ferma: Assegna il lavoro" }).click({ timeout: 20_000 });
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
await page.getByTestId("goal-dialog-header").getByRole("button", { name: "Elimina l'obiettivo" }).click();
const confirmDelete = page.getByRole("dialog", { name: "Eliminare l'obiettivo vuoto?" });
await confirmDelete.waitFor();
await shot("14d-delete-empty-dialog");
await confirmDelete.getByRole("button", { name: "Elimina l'obiettivo" }).click();
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
await (await openWaiting("goal")).getByTestId("goal-card").getByRole("button", { name: "Modifica la proposta" }).click();
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
if (!(await composer().inputValue()).includes("Aggiornami sul lavoro di ") || /A-[0-9A-F]{8}/.test(await composer().inputValue())) throw new Error(`The question does not name ${developerName}'s assignment`);
await shot("16c-specialist-ask");
await composer().fill("");
// Lavoro: a candidate opens with its diff; the card inside it offers no "Apri il diff" that would do nothing.
await page.getByRole("button", { name: /^Lavoro/ }).first().click();
await page.getByTestId("inspector").locator('button[data-record-id^="C-"]').first().click();
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

// W04, A06: within the mandate the Coordinator goes on by itself. In the goal dialog, once the grilling is answered,
// the Coordinator confirms the understanding and Trama starts the plan as its own line with a stop on the right.
await page.getByTestId("sidebar-goal").filter({ hasText: goalTitle }).click();
await page.getByTestId("dialog-title").filter({ hasText: goalTitle }).waitFor();
await page.getByLabel("Messaggio al Coordinatore").fill("[grilling:1] Gli ordini pagati annullati restano in revisione");
await page.keyboard.press("Enter");
const goalRound = page.getByRole("region", { name: "Chiarimento, turno 1" }).first();
await goalRound.getByText("0 di 2 risposte").waitFor({ timeout: 20_000 });
const goalFirst = await waitingItem(goalRound.getByTestId("waiting-reference").first());
await goalFirst.getByRole("button", { name: /Anche il cliente/ }).click();
await goalFirst.getByRole("button", { name: "Registra la decisione" }).click();
await goalRound.getByText("1 di 2 risposte").waitFor({ timeout: 20_000 });
const goalSecond = await waitingItem(goalRound.getByTestId("waiting-reference").first());
await goalSecond.getByRole("button", { name: /Anche il cliente/ }).click();
await goalSecond.getByRole("button", { name: "Registra la decisione" }).click();
await page.getByTestId("settled-card").filter({ hasText: "Chiarimento prima del piano, turno 1" }).filter({ hasText: "Turno completo" }).first().waitFor({ timeout: 20_000 });
// A06: the mandate allows planning, so once no question is open the Coordinator confirms the shared understanding by
// itself: the person has no step button to press, and Trama starts the plan.
if (await page.getByTestId("next-step").getByRole("button", { name: "Conferma la comprensione" }).count()) {
  throw new Error("The shared understanding still waits for the person within a mandate that allows planning");
}
// Issue #241: the automatic move is in the status line, "Sto preparando il piano", with its stop on the right before
// the person's move; the chat keeps no row for it.
const stopMove = statusLine.getByRole("button", { name: "Ferma: Prepara il piano" });
await stopMove.waitFor({ timeout: 20_000 });
await statusLine.getByTestId("status-line-text").getByText(/^Sto preparando il piano/).waitFor();
if (await page.getByText(/Il Coordinatore va avanti da solo|^Mossa automatica/).count()) throw new Error("The automatic move is a row of the chat");
const stopBox = await stopMove.boundingBox();
const lineBox = await statusLine.boundingBox();
if (!stopBox || !lineBox || lineBox.x + lineBox.width - (stopBox.x + stopBox.width) > 2) throw new Error("The stop of the automatic move is not on the right");
await themeShots("15a-status-line-move");
await stopMove.click();
await stopMove.waitFor({ state: "detached", timeout: 20_000 });
await page.waitForTimeout(500);
if (await statusLine.getByRole("button", { name: /^Ferma/ }).count()) throw new Error("Trama started another move after the stop");
// Activity opens from the status line and lists the move with its time and outcome.
await statusLine.getByRole("button", { name: "Attività" }).click();
const activity = page.getByTestId("activity-log");
await activity.locator('[data-testid="activity-entry"][data-outcome="stopped"]').filter({ hasText: "Prepara il piano" }).first().waitFor({ timeout: 20_000 });
await activity.getByText("Fermata").first().waitFor();
// A06: the understanding the Coordinator confirmed by itself is listed too, with its Correggi on the right.
const understandingStep = activity.getByTestId("activity-step").filter({ hasText: "Comprensione confermata dal Coordinatore" }).first();
await understandingStep.waitFor({ timeout: 20_000 });
await understandingStep.getByRole("button", { name: "Correggi" }).waitFor();
await themeShots("15b-activity");
// Correggi opens the person's words for the step, with Invia la correzione as the primary on the right.
await understandingStep.getByRole("button", { name: "Correggi" }).click();
await understandingStep.getByLabel("Correzione del passo").fill("Anche il cliente vede che l'ordine è in revisione.");
const correctActions = await understandingStep.locator(".cta-row").last().locator("button").allTextContents();
if (correctActions.join("|") !== "Annulla|Invia la correzione") throw new Error(`Correction buttons out of order: ${correctActions.join(", ")}`);
await themeShots("15b1-activity-step-correct");
await understandingStep.getByRole("button", { name: "Annulla" }).click();
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// A05: the Pause of continuous work is always on the status line. In pause the line says so, Riprendi takes the place
// of Pausa as the primary on the right, and nothing automatic starts; Riprendi brings the line back.
await statusLine.getByRole("button", { name: "Pausa", exact: true }).click();
const pausedLine = page.locator('[data-testid="status-line"][data-paused="true"]');
await pausedLine.waitFor({ timeout: 20_000 });
await pausedLine.getByTestId("status-line-text").getByText(/In pausa: i turni in corso finiscono/).waitFor();
const resumeButton = pausedLine.getByRole("button", { name: "Riprendi" });
await resumeButton.waitFor();
// The primary sits last on the right: Riprendi, unless the person has a move of their own, which stays the primary.
const lastButton = pausedLine.getByRole("button").last();
const lastBox = await lastButton.boundingBox();
const pausedBox = await pausedLine.boundingBox();
if (!lastBox || !pausedBox || pausedBox.x + pausedBox.width - (lastBox.x + lastBox.width) > 2) throw new Error("The primary of the paused line is not on the right");
if ((await lastButton.getAttribute("data-variant")) !== "default") throw new Error("The last button of the paused line is not the primary");
await themeShots("15c-status-line-paused");
await page.waitForTimeout(300);
if (await statusLine.getByRole("button", { name: /^Ferma/ }).count()) throw new Error("Trama started a move in pause");
await resumeButton.click();
await page.locator('[data-testid="status-line"][data-paused="false"]').waitFor({ timeout: 20_000 });
await statusLine.getByRole("button", { name: "Pausa", exact: true }).waitFor();
// Issue #242: the person asks for the recap with /riepilogo, offered first by the composer's menu. Trama writes it
// in the chat from the records at once: what I did, what I do, what I need from you, with
// each item of Aspetta te opening on the right. The chat before the recap, then the recap, in light and dark.
await themeShots("15d-recap-before");
await composer().fill("/riep");
await page.getByRole("option", { name: /^\/riepilogo/ }).first().waitFor();
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector('textarea[aria-label="Messaggio al Coordinatore"]')?.value.startsWith("/riepilogo"));
await page.keyboard.press("Enter");
const recapCard = page.getByTestId("recap-card").last();
await recapCard.waitFor({ timeout: 20_000 });
for (const part of ["Cosa ho fatto", "Cosa faccio", "Cosa mi serve da te"]) await recapCard.getByText(part, { exact: true }).waitFor();
const recapDoing = (await recapCard.getByTestId("recap-doing").innerText()).trim();
if (!recapDoing) throw new Error("The recap does not say what the Coordinator does");
if ((await recapCard.getAttribute("data-reason")) !== "request") throw new Error("The recap the person asked for is not marked as asked");
const recapNeeds = recapCard.locator('[data-testid="recap-need"][data-waiting="true"]');
if (await recapNeeds.count()) {
  const needBox = await recapNeeds.first().boundingBox();
  const openBox = await recapNeeds.first().getByRole("button", { name: "Apri in Aspetta te" }).boundingBox();
  if (!needBox || !openBox || needBox.x + needBox.width - (openBox.x + openBox.width) > 2) throw new Error("The recap's Apri in Aspetta te is not on the right");
} else {
  await recapCard.getByText("Niente: per ora vado avanti da solo.").waitFor();
}
await recapCard.evaluate((card) => card.scrollIntoView({ block: "center" }));
await themeShots("15e-recap");
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
// Issue #301: the language sits in Generale and changes the page at once.
await settings.getByTestId("language-choice").getByRole("radio", { name: "Italiano", checked: true }).waitFor();
await shot("12-settings");
await settings.getByTestId("language-choice").getByRole("radio", { name: "English" }).click();
await settings.getByRole("button", { name: /^Connections/ }).first().waitFor();
await settings.getByRole("heading", { name: "General" }).waitFor();
await shot("12-settings-en");
await settings.getByTestId("language-choice").getByRole("radio", { name: "Italiano" }).click();
await settings.getByRole("button", { name: /^Collegamenti/ }).first().waitFor();
// B01: Informazioni shows the mark on its tile with the version, in every provider theme.
await settings.getByTestId("about-trama").locator('[data-trama-mark="tile"]').waitFor();
for (const provider of ["codex", "claudeAgent", "grok"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await settings.getByTestId("about-trama").scrollIntoViewIfNeeded();
    await shot(`12b-about-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(startLook.provider, startLook.dark);
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
// Issue #271: the superseded request is one line; the line opens its card.
const supersededLine = page.getByTestId("settled-card").filter({ hasText: "Superata" }).filter({ hasText: "Prima proposta di mandato" });
await supersededLine.waitFor({ timeout: 20_000 });
await openSettled(supersededLine);
const supersededNote = page.getByTestId("superseded-mandate");
await supersededNote.waitFor({ timeout: 20_000 });
if ((await supersededNote.count()) !== 1) throw new Error("Expected exactly one superseded mandate card");
const supersededCard = page.locator(".chat-card", { has: supersededNote });
if (!(await supersededCard.getByText("Prima proposta di mandato").count())) throw new Error("The superseded card is not the first request");
if (await supersededCard.getByRole("button").count()) throw new Error("The superseded mandate card still has buttons");
// The pending request waits in Aspetta te, where it can be accepted; the superseded one is not listed there.
const pendingCard = await openWaiting("mandate", "Seconda proposta di mandato");
await pendingCard.getByRole("button", { name: "Concedi", exact: true }).waitFor();
if ((await page.getByTestId("inspector").getByTestId("waiting-item").filter({ hasText: "Prima proposta di mandato" }).count()) !== 0) {
  throw new Error("A superseded mandate request is listed in Aspetta te");
}
await supersededCard.scrollIntoViewIfNeeded();
await shot("15-mandate-superseded");

// U03: a proposal shows what it changes in the mandate in force and which work would stop. Its buttons are
// Rifiuta la proposta, Correggi and Concedi, primary last; revoking the mandate in force lives only in the
// Mandate view, behind a confirmation. Rejecting leaves the mandate in force as it was.
await pendingCard.getByTestId("mandate-diff").waitFor();
if (!(await pendingCard.getByTestId("mandate-diff-actions").getByTestId("mandate-diff-removed").count())) {
  throw new Error("The proposal does not say which authorized actions it takes away");
}
await pendingCard.getByTestId("mandate-diff-stopped").waitFor();
if (await pendingCard.getByRole("button", { name: /Revoca/ }).count()) throw new Error("A mandate proposal still offers to revoke the mandate");
const proposalButtons = await pendingCard.locator(".cta-row").last().getByRole("button").evaluateAll((buttons) =>
  buttons.map((b) => ({ name: b.textContent.trim(), x: b.getBoundingClientRect().x })).sort((a, b) => a.x - b.x).map((b) => b.name),
);
if (proposalButtons.join("|") !== "Rifiuta la proposta|Correggi|Concedi") throw new Error(`Proposal buttons out of order: ${proposalButtons.join(", ")}`);
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await pendingCard.locator(".cta-row").last().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(`15m1-mandate-proposal-card-${theme}`);
}
await page.getByRole("button", { name: /^Mandato/ }).first().click();
const mandateInspector = page.getByTestId("inspector");
await mandateInspector.getByTestId("mandate-diff").waitFor();
const mandateState = async () => (await mandateInspector.getByText(/^Mandato (v\d+|revocato)/).first().textContent()).trim();
const stateBefore = await mandateState();
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await mandateInspector.getByTestId("mandate-diff").scrollIntoViewIfNeeded();
  await shot(`15m2-mandate-proposal-view-${theme}`);
}
await mandateInspector.getByRole("button", { name: "Revoca il mandato" }).click();
const revokeConfirm = mandateInspector.getByTestId("mandate-revoke-confirm");
await revokeConfirm.waitFor();
if (!(await revokeConfirm.getByRole("button", { name: "Revoca il mandato" }).isDisabled())) throw new Error("The mandate can be revoked without a reason");
await revokeConfirm.getByLabel("Motivo della revoca").fill("Pausa sul progetto");
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await revokeConfirm.scrollIntoViewIfNeeded();
  await shot(`15m3-mandate-revoke-confirm-${theme}`);
}
await revokeConfirm.getByRole("button", { name: "Annulla" }).click();
await revokeConfirm.waitFor({ state: "detached" });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// With no proposal left the next move would be the Coordinator's: keep it from starting by itself here.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
const rejectCard = await openWaiting("mandate", "Seconda proposta di mandato");
await rejectCard.getByRole("button", { name: "Rifiuta la proposta" }).click();
await rejectCard.getByLabel("Motivo del rifiuto").fill("Serve ancora il worktree");
await rejectCard.getByRole("button", { name: "Rifiuta la proposta" }).click();
// Answered, the proposal leaves Aspetta te and the chat shows it as one line with its outcome (issue #271).
const rejectedCard = page.getByTestId("settled-card").filter({ hasText: "Seconda proposta di mandato" }).last();
await rejectedCard.getByText("Rifiutata", { exact: true }).waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await mandateInspector.getByText(/^Mandato (v\d+|revocato)/).first().waitFor();
if ((await mandateState()) !== stateBefore) throw new Error(`Rejecting a proposal changed the mandate in force: ${await mandateState()}`);
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await openSettled(rejectedCard);
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await rejectedCard.getByText("Hai rifiutato la proposta", { exact: false }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(`15m4-mandate-proposal-rejected-${theme}`);
}
await setTheme("system");
// The checks below expect a proposal waiting for the person.
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-mandato:Nuova proposta di mandato]");
await page.keyboard.press("Enter");
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="mandate"]').filter({ hasText: "Nuova proposta di mandato" }).waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));

// W02: the focus bar at the top of the chat shows the task in focus with its phase and what holds it; the queue
// lists the others. Pausing the task in focus passes the focus to the next one; "Metti in primo piano" takes it back.
const focusBar = page.getByTestId("focus-bar");
await focusBar.waitFor({ timeout: 20_000 });
const focusTitle = async () => (await focusBar.getByTestId("focus-title").textContent()).trim();
const firstFocus = await focusTitle();
// Issue #241: the bar is titled with the goal, never with the first message of a dialog.
if (/^\[/.test(firstFocus)) throw new Error(`The focus bar is titled with a message: ${firstFocus}`);
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
await pausedItem.getByRole("button", { name: "Metti in primo piano" }).click();
await focusIs(firstFocus, true);
await queue.locator('[data-status="paused"]').first().waitFor({ state: "detached", timeout: 10_000 });
await shot("17b-focus-back");
// The work going on now: the task in focus takes the seam.
await seamShots("focus", "focus");
// Light and dark on two providers' themes, then a narrow window where the bar wraps without a horizontal scroll.
const look = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await shot(`17c-focus-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(look.provider, look.dark);
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(400);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal page scroll with the focus bar at 720x640");
await actionsOnRight("720x640");
await shot("17d-focus-narrow");
// Issue #241: the status line stays in the bar at the minimum window size, its actions on the right, in light and dark.
// With Pausa (A05) the actions take more room: they share one row, and the last one touches the right edge.
const activityButton = statusLine.getByRole("button", { name: "Attività" });
const statusBox = await statusLine.boundingBox();
const activityBox = await activityButton.boundingBox();
const lastActionBox = await statusLine.getByRole("button").last().boundingBox();
if (
  !statusBox ||
  !activityBox ||
  !lastActionBox ||
  Math.abs(lastActionBox.x + lastActionBox.width - (statusBox.x + statusBox.width)) > 2 ||
  Math.abs(activityBox.y + activityBox.height / 2 - (lastActionBox.y + lastActionBox.height / 2)) > 2 ||
  activityBox.x < statusBox.x + statusBox.width / 3
) {
  throw new Error("The status line's actions are not on the right at 720x640");
}
for (const dark of [false, true]) {
  await setLookTo(look.provider, dark);
  await shot(`17e-status-line-narrow-${dark ? "dark" : "light"}`);
}
await setLookTo(look.provider, look.dark);
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
// FAKE_CODEX_LIGHT_MODEL gives the catalogue a light model, so focus mode has a stronger one to confirm serious findings (F02).
({ app, page } = await launch({ PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_TEAM: "1", TRAMA_PROVIDER_RETRY_MS: "4000", FAKE_CODEX_RATE_LIMITS: "2", FAKE_CODEX_LIGHT_MODEL: "gpt-5.5-mini" }));
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
// Issue #270: the goal keeps its id after the restart, on the hover of its detail.
await page.locator(`[data-goal-id="${goalId}"]`).waitFor();
// Issue #277: the chat's echoed headings also name the goal by its title, so the check stays in the inspector.
await page.getByTestId("inspector").getByRole("heading", { name: goalTitle }).waitFor();
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
// Issue #244: the project mandate waits at the opening. Here the person writes a narrower mandate of their own.
const declinedMandate = await openWaiting("mandate");
await declinedMandate.getByRole("button", { name: "Rifiuta la proposta" }).click();
await declinedMandate.getByLabel("Motivo del rifiuto").fill("Scrivo io un mandato più stretto");
await declinedMandate.getByRole("button", { name: "Rifiuta la proposta" }).click();
await declinedMandate.waitFor({ state: "detached", timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// Issue #292: after the study only the goal the Coordinator proposed waits. Discarded, it leaves Aspetta te, and with
// nothing waiting for the person the summary above the composer does not show (issue #240).
const proposedGoal = page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first();
await proposedGoal.waitFor({ timeout: 30_000 });
const proposedGoalId = (await proposedGoal.getAttribute("data-waiting-key")).replace(/^goal:/, "");
await page.evaluate((id) => window.trama.invoke("goal:update", { id, status: "abandoned" }), proposedGoalId);
await page.getByTestId("waiting-summary").waitFor({ state: "detached", timeout: 10_000 });
if (await page.locator('[data-testid="waiting-reference"]').count()) throw new Error("A reference to Aspetta te stays with nothing waiting");
const send = async (text) => {
  await composer().fill(text);
  await page.keyboard.press("Enter");
};
await send("[proponi-team]");
await (await openWaiting("team")).getByRole("button", { name: "Conferma il team" }).click({ timeout: 20_000 });
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
await send("[chiedi-decisione]");
const candidateQuestion = await openWaiting("question", "Cosa succede a un ordine pagato annullato?");
await candidateQuestion.getByRole("button", { name: /Va in revisione/ }).click({ timeout: 20_000 });
await candidateQuestion.getByRole("button", { name: "Registra la decisione" }).click();
await page.getByTestId("settled-answer").or(page.getByText("Apri nel Patto")).first().waitFor({ timeout: 20_000 });
const candidateDecision = await page.evaluate(
  async () => (await window.trama.getState()).project.document.decisionRequests.find((r) => r.outcome && r.question.includes("Cosa succede a un ordine pagato annullato?"))?.outcome.decisionId,
);
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Scrivi", exact: true }).click();
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// Issue #271: finished work is one settled line, with the same title, developer and outcome as its card.
const assignmentCards = page.locator('.chat-card:not([data-testid="settled-card"] .chat-card), [data-testid="settled-card"]').filter({ hasText: /^Incarico / }).filter({ hasText: "Ada" });
const cardAssignment = (card) => recordId(card, "A");

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
// The turn's activities are one line in the chat; its steps open in Activity (issue #271).
const stoppedTurn = page.getByRole("button", { name: /ha lavorato per/ }).first();
await stoppedTurn.click();
await page.getByText("Arresto confermato").first().waitFor({ timeout: 20_000 });
await stoppedTurn.scrollIntoViewIfNeeded();
await shot("18a-specialist-stopped");
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await slowCard.getByRole("button", { name: "Riprendi" }).click();
await slowCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });

// Issue #204: the work ends, Trama starts the checks by itself and the Coordinator verifies the assignment instead of a
// candidate, as in the live run. The move comes back under the reply with Trama's reason and its button on the right.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));
await send("[assegna] [luna]");
const lunaCard = assignmentCards.nth(1);
await lunaCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
const lunaAssignment = await cardAssignment(lunaCard);
// Issue #241: the status line says the move did not work, with Trama's reason and the move as its button on the right.
// Issue #277: the reason names the assignment by its link, with the id on hover.
const retryStep = page.getByTestId("status-line").filter({
  has: page
    .getByTestId("status-line-reason")
    .filter({ hasText: "è concluso ma il suo candidato non è stato dichiarato" })
    .filter({ has: page.locator(`[data-reference="assignment"][data-reference-id="${lunaAssignment}"]`) }),
});
await retryStep.waitFor({ timeout: 30_000 });
const retryButton = retryStep.getByRole("button", { name: "Esegui le verifiche" });
const retryBox = await retryButton.boundingBox();
const retryRowBox = await retryStep.boundingBox();
if (!retryBox || !retryRowBox || retryRowBox.x + retryRowBox.width - (retryBox.x + retryBox.width) > 2) throw new Error("Esegui le verifiche is not on the right");
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
await shot("18a2-automatic-move-stalled");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("18a3-automatic-move-stalled-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// Issue #241: the tool's English error stays out of the chat; the reply says it in Italian and Activity keeps the detail.
if (await page.getByText(/is an assignment, not a candidate/).count()) throw new Error("A tool error reached the chat");
await page.getByText(/uno strumento di Trama ha rifiutato la richiesta/).last().waitFor();
await page.getByTestId("status-line").getByRole("button", { name: "Attività" }).click();
const toolErrors = page.getByTestId("activity-log").locator('[data-testid="activity-entry"][data-outcome="stalled"]').first().getByTestId("activity-tool-errors");
await toolErrors.locator("summary").click();
await toolErrors.getByText(/is an assignment, not a candidate/).first().waitFor();
for (const dark of [false, true]) {
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await shot(`18a4-activity-tool-errors-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// The person takes the move again: it reaches the Coordinator as the person's message, and the button goes away.
await retryButton.click();
await page.getByText("Esegui le verifiche del lavoro.").last().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
if (await retryStep.count()) throw new Error("The stalled move is still offered after the person took it");

// V05: the work leaves trailing whitespace; git_diff_check fails on the candidate with git's own output.
await send("[assegna] [spazi]");
const spacesCard = assignmentCards.nth(2);
await spacesCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(spacesCard)}:${candidateDecision}:tutte]`);
const candidateCards = page.locator(".chat-card").filter({ has: page.getByTestId("candidate-evidence") });
// The card of an assignment's candidate, in the chat or, while it waits for the person, in Aspetta te (issue #292).
const candidateOf = async (card) => candidateCards.filter({ has: page.locator(`[data-reference-id="${await cardAssignment(card)}"]`) }).first();
const failedCard = await candidateOf(spacesCard);
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
const fixCard = assignmentCards.nth(3);
await fixCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(fixCard)}:${candidateDecision}:tutte]`);
const correctedCard = await candidateOf(fixCard);
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="candidate"]').waitFor({ timeout: 30_000 });
await showWaiting();
await correctedCard.getByText("Deciso", { exact: true }).waitFor({ timeout: 30_000 });
await correctedCard.locator('[data-testid="candidate-evidence"][data-check="git_diff_check"][data-result="pass"]').waitFor();
await correctedCard.getByText("Revisione tecnica, approvata").waitFor();
await correctedCard.getByText("Via libera del Coordinatore.").waitFor();
if ((await failedCard.innerText()).includes("Deciso")) throw new Error("The failed candidate took the correction's state");
await correctedCard.scrollIntoViewIfNeeded();
await shot("18d-candidate-corrected");
// W10: the candidate gate on the card. Trama's checks came first; then every candidate figure of the team reviewed the
// diff in parallel, each with its outcome: who found nothing signs "Niente da segnalare". Both themes.
const passedGate = correctedCard.locator('[data-testid="candidate-gate"][data-status="passed"]');
await passedGate.waitFor({ timeout: 20_000 });
const passedRoles = await passedGate.getByTestId("gate-review").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-role")));
if (passedRoles.join() !== "specReviewer,cleanCode,regressionGuardian,security,performance,ux,devops,documentation") throw new Error(`Unexpected gate figures: ${passedRoles}`);
await passedGate.locator('[data-testid="gate-review"][data-role="security"]').getByText("Niente da segnalare").waitFor();
await passedGate.locator('[data-testid="gate-review"][data-role="specReviewer"][data-status="skipped"]').getByText("Nessun piano da confrontare").waitFor();
await passedGate.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("18e1-candidate-gate-passed");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("18e2-candidate-gate-passed-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// W10: a blocking finding goes back to the developer. Ada's note leaves a key in the diff: Trama's scan finds it for
// Sicurezza and no model receives the diff, so the other figures do not start. The green light is refused, and the
// finding reaches Ada in her work, where she resumes it.
await send("[assegna] [segreto]");
const secretWork = assignmentCards.nth(4);
await secretWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(secretWork)}:${candidateDecision}]`);
const secretCandidate = await candidateOf(secretWork);
const blockedGate = secretCandidate.locator('[data-testid="candidate-gate"][data-status="blocked"]');
await blockedGate.waitFor({ timeout: 60_000 });
if ((await blockedGate.getByTestId("gate-review").count()) !== 8) throw new Error("The gate does not show every candidate figure");
await blockedGate.locator('[data-testid="gate-review"][data-role="security"]').getByText("1 rilievo bloccante").waitFor();
await blockedGate.locator('[data-testid="gate-finding"][data-severity="blocking"]').getByText("Segreto nel diff: chiave API in NOTE.md").waitFor();
await blockedGate.locator('[data-testid="gate-review"][data-role="devops"][data-status="skipped"]').getByText(/il diff contiene un segreto/).waitFor();
await blockedGate.getByTestId("gate-returned").getByText(/Rimandato a Ada con i rilievi bloccanti/).waitFor();
// The refusal's technical text stays in the turn's activity (issue #241); the card above says why in Italian.
await page.getByText(/^Via libera rifiutato: /).last().waitFor({ timeout: 20_000 });
await secretCandidate.getByText("I revisori hanno trovato un problema da correggere").waitFor();
await secretCandidate.getByText("In costruzione", { exact: true }).waitFor();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await secretWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 30_000 });
await blockedGate.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("24a-candidate-gate-blocked");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("24b-candidate-gate-blocked-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// Security's message is in Ada's work, with the turn she resumed with it: the person reads what the agents said.
await page.getByRole("button", { name: /ha lavorato per/ }).last().click();
const toDeveloper = page.getByRole("button", { name: /^Sicurezza a Ada: 1 rilievo bloccante sul candidato C-/ });
await toDeveloper.waitFor({ timeout: 10_000 });
await toDeveloper.click();
await page.getByText(/Segreto nel diff: chiave API in NOTE\.md/).last().waitFor();
await toDeveloper.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("24c-gate-finding-to-developer");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("24d-gate-finding-to-developer-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));

// Q03: the technical review checks the diff against Trama's Clean Code standard. The card shows Trama's measures as
// evidence and the reviewer's findings, with file and line, as judgement; in the light and the dark theme.
await showWaiting();
const review = correctedCard.getByTestId("technical-review");
await review.getByTestId("review-measures").getByText(/Misure di Trama, standard v1/).waitFor();
const suggestion = review.locator('[data-testid="review-finding"][data-severity="suggestion"]');
await suggestion.getByText("NOTE.md:1").waitFor();
await suggestion.getByText("Suggerimento").waitFor();
await review.getByText(/non un'evidenza/).waitFor();
await review.scrollIntoViewIfNeeded();
await shot("18d1-review-findings");
// Q01: before publishing, the card shows the quality standard. The corrected candidate meets it, with its Conventional
// Commits message; the failed one says what is missing and how to fix it. Both themes.
// Issue #273: the mandate grants no pull requests, so the standard stops the publication and says how to allow it.
const stoppedQuality = correctedCard.locator('[data-testid="candidate-quality"][data-ready="no"]');
const mandateItem = stoppedQuality.locator('[data-testid="quality-item"][data-code="MANDATE"][data-passed="no"]');
await mandateItem.getByText(/Il mandato non permette di aprire pull request/).waitFor({ timeout: 20_000 });
await mandateItem.getByText(/^Come sistemarlo: Concedi o correggi il mandato/).waitFor();
if ((await stoppedQuality.locator('[data-testid="quality-item"][data-passed="no"]').count()) !== 1) throw new Error("Only the mandate should stop the corrected candidate");
if (await correctedCard.getByRole("button", { name: /Prepara la pull request/ }).count()) throw new Error("A pull request can be prepared outside the mandate");
await mandateItem.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("18e3-publication-outside-mandate");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("18e4-publication-outside-mandate-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Aprire pull request/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await showWaiting();
const correctedQuality = correctedCard.locator('[data-testid="candidate-quality"][data-ready="yes"]');
await correctedQuality.waitFor({ timeout: 20_000 });
await correctedQuality.locator('[data-testid="quality-item"][data-code="MANDATE"][data-passed="yes"]').getByText("Il mandato permette di aprire pull request.").waitFor();
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
await review.scrollIntoViewIfNeeded();
await shot("18d2-review-findings-dark");
// The project's switches: Impostazioni, Standard del codice lists the rules; one turns off for this project.
await page.getByRole("button", { name: "Impostazioni" }).click();
const standardSettings = page.getByTestId("settings");
await standardSettings.getByRole("button", { name: /^Standard del codice/ }).first().click();
const rules = standardSettings.getByTestId("clean-code-settings");
await rules.getByText(/Robert C\. Martin/).waitFor();
const solid = rules.getByRole("switch", { name: "SOLID" });
await solid.click();
await rules.locator('[role="switch"][aria-label="SOLID"][aria-checked="false"]').waitFor({ timeout: 10_000 });
const standardActions = await rules.locator(".cta-row button").allTextContents();
if (standardActions.at(-1)?.trim() !== "Salva") throw new Error(`Salva is not the last call to action: ${standardActions}`);
await shot("18d3-standard-settings-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("18d4-standard-settings");
await solid.click();
await rules.locator('[role="switch"][aria-label="SOLID"][aria-checked="true"]').waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Impostazioni" }).click();
await standardSettings.waitFor({ state: "hidden" });
await showWaiting();
const correctedId = await recordId(correctedCard, "C");
await send(`[riverifica:${correctedId}:git_status]`);
await correctedCard.getByText("Il via libera del Coordinatore non vale più: sono cambiate evidenze o decisioni.").waitFor({ timeout: 20_000 });
await correctedCard.getByText("Verificato", { exact: true }).waitFor();
await correctedCard.scrollIntoViewIfNeeded();
await shot("18e-clearance-withdrawn");

// Issue #277: the Coordinator cites the real ids Trama listed for it. Each one is a link that shows the readable name,
// keeps the id on hover and opens the right record inside Trama; an id that names nothing stays plain text.
await send("[cita]");
const citing = page.locator(".chat-markdown").filter({ hasText: "invece non c'è" }).last();
const candidateLink = citing.locator('a[data-reference="candidate"]');
await candidateLink.waitFor({ timeout: 20_000 });
const citedCandidate = await candidateLink.getAttribute("data-reference-id");
if (!/^C-[0-9A-F]{8}$/.test(citedCandidate ?? "")) throw new Error(`The candidate link names no candidate: ${citedCandidate}`);
const candidateText = await candidateLink.innerText();
if (candidateText.includes(citedCandidate) || !/^di \S/.test(candidateText)) throw new Error(`The candidate link does not show a readable name: ${candidateText}`);
if (!(await candidateLink.getAttribute("title"))?.startsWith(citedCandidate)) throw new Error("The candidate link keeps no id on hover");
const decisionLink = citing.locator('a[data-reference="decision"]');
await citing.locator('a[data-reference="assignment"]').waitFor();
await decisionLink.waitFor();
await citing.locator('[data-reference-unknown="C-00000000"]').waitFor();
if (await citing.locator('a[data-reference-id="C-00000000"]').count()) throw new Error("An id that names nothing became a link");
await citing.scrollIntoViewIfNeeded();
await candidateLink.hover();
await shot("23a-references-light");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("23b-references-dark");
await candidateLink.click();
const referenceInspector = page.getByTestId("inspector");
await referenceInspector.and(page.locator('[aria-label="Candidato"]')).waitFor({ timeout: 10_000 });
// Issue #270: the panel names the candidate; its id is on the title's hover and on the card's title.
await referenceInspector.locator(`[data-testid="inspector-title"][title="${citedCandidate}"]`).waitFor();
await referenceInspector.locator(`[data-record-id="${citedCandidate}"]`).first().waitFor();
await shot("23c-reference-opened-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("23d-reference-opened-light");
const citedDecision = await decisionLink.getAttribute("data-reference-id");
await decisionLink.click();
await referenceInspector.and(page.locator('[aria-label="Decisione"]')).waitFor({ timeout: 10_000 });
await referenceInspector.locator(`[data-testid="inspector-title"][title="${citedDecision}"]`).waitFor();
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// M06: the developer of a slice runs implement and tdd with their original text and reports the seams it tested.
// The candidate shows that report apart from Trama's evidence; the build and the tests wait for Trama's own run.
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Preparare piani/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await send("[piano]");
// Continuous work is off here, so the seams and the slices stay the person's, as without a mandate (A06).
await (await openWaiting("seams")).getByRole("button", { name: "Conferma i punti di prova" }).click({ timeout: 20_000 });
await (await openWaiting("slices")).getByTestId("plan-slices").getByRole("button", { name: "Conferma le fette" }).click({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
const sliceSpec = page.locator('[data-testid="plan-spec"][data-status="ready"]').last();
await sliceSpec.getByText("Restano in Trama").waitFor({ timeout: 20_000 });
// W05: an assignment without its contract (seams, Pact decisions) is refused with a clear tool failure; no card appears.
await send("[assegna] [senza-contratto]");
await page.getByText(/Rifiutato: .*incomplete_contract/).last().waitFor({ timeout: 20_000 });
// The tool's own words stay in the turn's activity, out of the reply (issue #241).
const contractRefusal = await page.evaluate(async () => {
  const state = await window.trama.getState();
  return state.project.document.events.findLast((e) => e.content.type === "activity" && e.content.tone === "error")?.content.detail ?? "";
});
if (!/seams.*decisionIDs/.test(contractRefusal)) throw new Error(`The contract refusal does not name the missing fields: ${contractRefusal}`);
if ((await assignmentCards.count()) !== 5) throw new Error("An assignment without its contract reached a developer");
await send("[assegna] [test]");
const sliceWork = assignmentCards.nth(5);
await sliceWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await openSettled(sliceWork);
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
await developerReport.getByTestId("report-exceptions").getByText("Nessuna").waitFor();
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
// The Coordinator asks for the green light without the candidate gate (W10), so Trama's build and tests never ran.
await send(`[candidato:${await cardAssignment(sliceWork)}:${candidateDecision}] [senza-revisione]`);
const sliceCandidate = await candidateOf(sliceWork);
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
// An examination that ends in "failed" says why: the check reports that text instead of waiting out its timeout.
const auditDone = async () => {
  await page.locator('[data-testid="focus-audit"]:is([data-status="done"], [data-status="failed"])').waitFor({ timeout: 60_000 });
  if ((await focusAudit.getAttribute("data-status")) !== "done") throw new Error(`Focus mode failed: ${await focusAudit.innerText()}`);
};
const focusActions = await sliceCandidate.locator(".cta-row button").allTextContents();
if (!focusActions.some((label) => label.includes("Esame approfondito"))) throw new Error(`No Esame approfondito on the candidate: ${focusActions}`);
await sliceCandidate.getByRole("button", { name: "Esame approfondito" }).click();
await focusAudit.waitFor({ timeout: 20_000 });
await auditDone();
for (const check of ["swift_build", "swift_test"]) {
  await focusAudit.locator(`[data-testid="candidate-evidence"][data-check="${check}"]:not([data-result="missing"])`).waitFor();
}
await focusAudit.locator('[data-testid="audit-axis"][data-axis="standards"][data-status="done"]').getByText(/Mysterious Name/).first().waitFor();
// Issue #277: the report names the slice it read, as a link with the slice's title.
const specAxis = focusAudit.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="done"]');
await specAxis.getByText(/Fonte: Fetta/).waitFor();
await specAxis.locator('a[data-reference="slice"][data-reference-id="S1"]').filter({ hasText: /^1, / }).waitFor();
const auditText = await focusAudit.innerText();
const [checksAt, standardsAt, specAt] = ["Verifiche reali", "Standards", "Spec"].map((heading) => auditText.indexOf(heading));
if (!(checksAt >= 0 && checksAt < standardsAt && standardsAt < specAt)) throw new Error("Focus mode: the checks are not first, or Standards and Spec are out of order");
await focusAudit.getByTestId("focus-audit-summary").getByText(/Standards: 1 rilievo.*Spec: 2 rilievi/).waitFor();
// F02: each finding shows its proof and its state. Trama reread the Standards line; the stronger model confirmed the
// serious Spec finding; the minor one, whose command is not one of Trama's checks, stays a hypothesis.
const auditFinding = (axis, status) => focusAudit.locator(`[data-testid="audit-axis"][data-axis="${axis}"] [data-testid="audit-finding"][data-status="${status}"]`);
await auditFinding("standards", "verified").getByText("Verificato da Trama").waitFor();
await auditFinding("spec", "confirmed").getByText(/Confermato da gpt-5\.5:/).waitFor();
await auditFinding("spec", "hypothesis").getByText("Ipotesi", { exact: true }).waitFor();
if ((await auditFinding("spec", "hypothesis").getByTestId("audit-finding-evidence").innerText()) !== "Prova: make check") throw new Error("Focus mode: the hypothesis does not show its proof");
if (await focusAudit.locator('[data-testid="audit-finding"][data-status="verified"]').filter({ hasText: "Prova: Nessuna prova" }).count()) throw new Error("Focus mode: a finding is verified without a proof");
await focusAudit.getByTestId("focus-audit-tally").getByText("Stato dei rilievi: 1 verificato da Trama, 1 confermato da un secondo modello, 1 ipotesi.").waitFor();
await shot("20a-focus-audit");
await auditFinding("spec", "hypothesis").scrollIntoViewIfNeeded();
await shot("20e-focus-audit-findings");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("20f-focus-audit-findings-dark");
await focusAudit.getByTestId("focus-audit-status").scrollIntoViewIfNeeded();
await shot("20b-focus-audit-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await showWaiting();
await correctedCard.scrollIntoViewIfNeeded();
await correctedCard.getByRole("button", { name: "Esame approfondito" }).click();
await auditDone();
await focusAudit.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="skipped"]').getByText("Nessun piano da confrontare", { exact: true }).waitFor();
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
await showWaiting();
await correctedCard.getByRole("button", { name: "Esame approfondito" }).click();
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// W06: a developer with a doubt asks the Coordinator with ask_coordinator, and the slice pauses. The question stays in
// the report's doubts. The Coordinator puts it on a Pact card that blocks the work; the person's answer resumes the
// developer in the same session, and the card and the assignment say so.
await send("[assegna:S1] [test] [domanda]");
const questionWork = assignmentCards.nth(6);
await questionWork.getByText("In pausa", { exact: true }).waitFor({ timeout: 20_000 });
await questionWork.locator('[data-testid="assignment-question"][data-state="asked"]').getByText(/buono/).waitFor();
await questionWork.getByText("Aspetta il Coordinatore").waitFor();
await questionWork.getByTestId("report-doubts").getByText(/Domanda al Coordinatore/).waitFor();
await sliceSpec.locator('[data-testid="plan-slice"][data-state="paused"]').getByText("In pausa").waitFor({ timeout: 20_000 });
await questionWork.scrollIntoViewIfNeeded();
await shot("19e-developer-question");
await send("[blocca-dubbio]");
// The card keeps the developer's question after the answer; only the "Blocca il lavoro" badge goes.
// While it waits, the card sits in Aspetta te, first because it holds the most work.
const blockingItem = await openWaiting("question", "Domanda di uno sviluppatore");
if ((await page.getByTestId("inspector").getByTestId("waiting-item").first().getAttribute("data-waiting-key")) !== (await blockingItem.getAttribute("data-waiting-key"))) {
  throw new Error("The card that blocks a developer is not first in Aspetta te");
}
const blockingCard = blockingItem.locator(".chat-card", { has: page.getByTestId("blocked-work") });
await blockingCard.waitFor({ timeout: 20_000 });
await blockingCard.getByTestId("blocks-work").getByText("Blocca il lavoro").waitFor();
await blockingCard.getByTestId("blocked-work").getByText(/buono/).waitFor();
await blockingCard.getByText("Il lavoro resta in pausa finché non rispondi. Il resto del team va avanti.").waitFor();
await questionWork.locator('[data-testid="assignment-question"][data-state="waitingForPerson"]').getByText("Blocca il lavoro").waitFor();
await blockingCard.getByRole("button", { name: /Va in revisione come gli altri/ }).click();
const blockingActions = await blockingCard.locator(".cta-row").last().locator("button").allTextContents();
if (blockingActions.at(-1)?.trim() !== "Registra la decisione") throw new Error(`Registra la decisione is not the last call to action: ${blockingActions}`);
const recordBox = await blockingCard.getByRole("button", { name: "Registra la decisione" }).boundingBox();
const blockingBox = await blockingCard.boundingBox();
if (!recordBox || !blockingBox || blockingBox.x + blockingBox.width - (recordBox.x + recordBox.width) > 20) throw new Error("Registra la decisione is not on the right");
await blockingCard.scrollIntoViewIfNeeded();
await shot("19f-blocking-card");
const questionLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  await setLookTo(provider, true);
  await shot(`19g-blocking-card-${provider}-dark`);
}
await setLookTo(questionLook.provider, questionLook.dark);
await blockingCard.getByRole("button", { name: "Registra la decisione" }).click();
await questionWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 30_000 });
await openSettled(questionWork);
await questionWork.locator('[data-testid="assignment-question"][data-state="resumed"]').getByText("Lavoro ripreso").waitFor();
await questionWork.getByTestId("question-answer").getByText(/Va in revisione come gli altri/).waitFor();
// Answered, the card leaves Aspetta te and the chat shows it again in full.
const answeredBlockingLine = page.getByTestId("settled-card").filter({ has: page.getByTestId("settled-answer") }).last();
await openSettled(answeredBlockingLine);
const answeredBlocking = answeredBlockingLine.locator(".chat-card", { has: page.getByTestId("blocked-work") });
await answeredBlocking.getByText("Il lavoro è ripreso con la tua risposta.").waitFor();
if (await answeredBlocking.getByTestId("blocks-work").count()) throw new Error("An answered card still says it blocks the work");
await questionWork.scrollIntoViewIfNeeded();
await shot("19h-developer-question-resumed");
await setLookTo("claudeAgent", true);
await shot("19i-developer-question-resumed-claude-dark");
await setLookTo(questionLook.provider, questionLook.dark);
// W07: the developer's question lives in a conversation between agents, recorded with the author of every message:
// the developer's question, the Coordinator's Pact card, the person's answer on it. The person reads it from the
// assignment's card or the specialist's page, never from the sidebar, and cannot write in it: the person talks only
// with the Coordinator (Q32 of #239).
if (await page.getByTestId("sidebar-agent-thread").count()) throw new Error("A conversation between agents is in the sidebar");
const threadLink = questionWork.getByTestId("assignment-threads").getByRole("button", { name: /Domanda al Coordinatore, fetta S1/ });
await threadLink.waitFor({ timeout: 10_000 });
await threadLink.click();
const agentThread = page.locator('[data-testid="agent-thread"][data-kind="question"]');
await agentThread.waitFor();
const threadMessages = agentThread.getByTestId("agent-thread-message");
await threadMessages.nth(2).waitFor();
const authors = await threadMessages.evaluateAll((nodes) => nodes.map((node) => node.dataset.author));
if (authors.join(",") !== "specialist,coordinator,person") throw new Error(`Unexpected authors in the conversation: ${authors}`);
await threadMessages.nth(0).getByText(/buono/).first().waitFor();
await threadMessages.nth(0).getByTestId("agent-tag").waitFor();
await threadMessages.nth(1).getByText("Coordinatore", { exact: true }).waitFor();
await threadMessages.nth(2).getByText(/Dalla scheda del Patto .*Va in revisione come gli altri/).waitFor();
if (await agentThread.locator("textarea, button[data-variant]").count()) throw new Error("The conversation between agents is not read-only");
await agentThread.getByText("Per dire qualcosa a un agente scrivi al Coordinatore, che lo inoltra.", { exact: false }).waitFor();
await shot("19j-agent-thread");
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await shot(`19l-agent-thread-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(questionLook.provider, questionLook.dark);
// The specialist's page lists every conversation the developer takes part in.
await agentThread.getByRole("button", { name: "Apri lo sviluppatore" }).click();
const specialistThreads = page.getByTestId("specialist-threads").getByRole("button", { name: /Domanda al Coordinatore, fetta S1/ });
await specialistThreads.waitFor();
await specialistThreads.scrollIntoViewIfNeeded();
await shot("19m-specialist-threads");
await specialistThreads.click();
await agentThread.waitFor();
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// W08: independent movement, after the work of #204 and W06 (two more assignment cards). The person sets the project's
// parallel limit in the settings; a verified slice unblocks the ones that depended on it, and with continuous work on
// the free developer takes the next ready one in its modules by itself, without a Coordinator turn.
await page.getByRole("button", { name: "Impostazioni" }).click();
const parallelSettings = page.getByTestId("settings");
await parallelSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
const parallelPicker = parallelSettings.getByTestId("parallel-developers");
await parallelPicker.getByRole("radio", { name: "3", checked: true }).waitFor();
await parallelPicker.getByRole("radio", { name: "2" }).click();
await parallelPicker.getByRole("radio", { name: "2", checked: true }).waitFor();
await parallelPicker.scrollIntoViewIfNeeded();
await shot("22a-parallel-developers");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("22b-parallel-developers-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });
// The first slice is verified on new work that passes its check and the technical review: S2 and S3 become ready.
await send("[assegna:S1]");
const verifiedSliceWork = assignmentCards.nth(7);
await verifiedSliceWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });
await send(`[candidato:${await cardAssignment(verifiedSliceWork)}:${candidateDecision}]`);
const teamSlices = sliceSpec.getByTestId("plan-slices");
await teamSlices.locator('[data-testid="plan-slice"][data-state="done"]').first().waitFor({ timeout: 30_000 });
const unblocked = await teamSlices.getByTestId("plan-slice").evaluateAll((items) => items.map((item) => item.getAttribute("data-state")));
if (unblocked.join() !== "done,ready,ready") throw new Error(`A verified slice did not unblock its dependents: ${unblocked}`);
// Issue #242: the slice done is a milestone, told in one recap of the Coordinator in the chat, in light and dark.
const milestoneRecap = page.locator('[data-testid="recap-card"][data-reason="milestone"]').filter({ hasText: "Fetta 1 fatta" });
await milestoneRecap.waitFor({ timeout: 20_000 });
if ((await milestoneRecap.count()) !== 1) throw new Error("The slice done was told in more than one recap");
await milestoneRecap.evaluate((card) => card.scrollIntoView({ block: "center" }));
await themeShots("22c-recap-milestone");
if ((await assignmentCards.count()) !== 8) throw new Error("A developer took a slice while continuous work was off");
// Continuous work on: at the next event of the work (here the end of a Coordinator turn) Ada is free and takes S2 in
// autonomy; the assignment card says so and the slice shows who took it.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));
// "Come procede il lavoro?" would ask for a recap, which opens no turn (issue #242): the check writes to the Coordinator.
await send("Vai avanti con il lavoro");
const pickedCard = assignmentCards.nth(8);
await waitInCard(pickedCard, (card) => card.getByTestId("assignment-self-picked"), "self-picked");
await waitInCard(pickedCard, (card) => card.getByText(/^S2 Il supporto vede gli ordini in revisione$/), "slice S2");
const pickedSlice = teamSlices.locator('[data-testid="plan-slice"][data-self-picked="yes"]').first();
await pickedSlice.getByTestId("plan-slice-worker").getByText("Ada, presa in autonomia").waitFor({ timeout: 20_000 });
if ((await pickedSlice.locator("span").first().textContent())?.trim() !== "2. Il supporto vede gli ordini in revisione") throw new Error("The free developer did not take the next ready slice");
await teamSlices.getByTestId("plan-slices-parallel").getByText(/Sviluppatori al lavoro: \d di 2\./).waitFor();
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
// A Coordinator move that continuous work started meanwhile keeps running in this check (FAKE_CODEX_AUTOMATIC=wait):
// the person stops it before the next project opens.
const runningMoves = page.getByTestId("status-line").getByRole("button", { name: /^Ferma/ });
for (let tries = 0; (await runningMoves.count()) && tries < 10; tries += 1) {
  await runningMoves.first().click().catch(() => undefined);
  await page.waitForTimeout(500);
}
await pickedSlice.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("22c-slice-self-picked");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("22d-slice-self-picked-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// M07, Ask Trama: /ask-trama is in the composer with the original skill's description, and its button starts the
// message. The Coordinator runs ask-trama and proposes a route instead of naming a command; each step says how Trama
// runs it. "Avvia il percorso" starts the first flow inside Trama: here grilling, round 1.
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await composer().fill("");
await composer().pressSequentially("/ask");
const skillMenu = page.getByRole("listbox", { name: "Skill" });
await skillMenu.getByRole("option", { name: /\/ask-trama/ }).getByText("Ask which skill or flow fits your situation. A router over the skills in this repo.").waitFor({ timeout: 10_000 });
await shot("21-ask-trama-menu");
await page.keyboard.press("Escape");
await composer().fill("");
await page.getByRole("button", { name: "Ask Trama", exact: true }).click();
await expectAsked("/ask-trama ", "Ask Trama");
await page.keyboard.type("Gli ordini pagati annullati devono andare in revisione invece del rimborso automatico.");
await page.keyboard.press("Enter");
// Issue #292: the proposed route waits for the person in Aspetta te; the chat keeps its reference.
const routeCard = (await openWaiting("route")).locator('[data-anchor="route"]');
await routeCard.getByText("Proposto", { exact: true }).waitFor({ timeout: 20_000 });
for (const expected of ["Flusso principale", "grill-with-docs", "Grilling prima del piano, con glossario e ADR", "prototype", "Skill nel Coordinatore", "Piano scritto come spec", "Revisione del candidato ed esame approfondito", "Confine di fase: Continua"]) {
  if (!(await routeCard.innerText()).includes(expected)) throw new Error(`The Ask Trama route does not show "${expected}"`);
}
if (await page.getByText("Chi vede gli ordini in revisione?").count()) throw new Error("Ask Trama started a flow before the person confirmed the route");
const skipRoute = await routeCard.getByRole("button", { name: "Non avviare" }).boundingBox();
const startRoute = await routeCard.getByRole("button", { name: "Avvia il percorso" }).boundingBox();
const routeBox = await routeCard.boundingBox();
if (!skipRoute || !startRoute || !routeBox || skipRoute.x >= startRoute.x || routeBox.x + routeBox.width - (startRoute.x + startRoute.width) > 20) {
  throw new Error("Ask Trama route: Non avviare and Avvia il percorso are not on the right, primary last");
}
await routeCard.scrollIntoViewIfNeeded();
await shot("21a-ask-trama-route");
const routeLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await shot(`21b-ask-trama-route-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(routeLook.provider, routeLook.dark);
await routeCard.getByRole("button", { name: "Avvia il percorso" }).click();
// Started, the route leaves Aspetta te and the chat shows its card again in full.
const startedRoute = page.getByRole("main").locator('[data-anchor="route"]').last();
await startedRoute.getByText("Avviato", { exact: true }).waitFor({ timeout: 20_000 });
// Issue #270: the message names the route by its situation; the id stays on the link's hover.
await page.getByText(/^Avvia il percorso «.+» di Ask Trama/).last().waitFor({ timeout: 20_000 });
await page.locator('.chat-markdown a[data-reference="route"][data-reference-id^="AT-"]').last().waitFor();
await page.getByText("Chi vede gli ordini in revisione?").last().waitFor({ timeout: 20_000 });
if (await startedRoute.getByRole("button", { name: "Avvia il percorso" }).count()) throw new Error("A started route can be started again");
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await page.getByText("Chi vede gli ordini in revisione?").last().scrollIntoViewIfNeeded();
await shot("21c-ask-trama-started");

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
// Issue #292: the proposal waits for the person in Aspetta te; the chat keeps its reference.
const consentCard = (await openWaiting("presence", undefined, 30_000)).locator('[data-anchor="presence-consent"]');
await consentCard.getByRole("button", { name: "Condividi" }).waitFor({ timeout: 30_000 });
const notNow = await consentCard.getByRole("button", { name: "Non ora" }).boundingBox();
const share = await consentCard.getByRole("button", { name: "Condividi" }).boundingBox();
const consentBox = await consentCard.boundingBox();
if (!notNow || !share || !consentBox || notNow.x >= share.x || consentBox.x + consentBox.width - (share.x + share.width) > 20) {
  throw new Error("Presence consent: Non ora and Condividi are not on the right, primary last");
}
if (presenceGit(presenceRemote, "for-each-ref", "refs/trama/presence/ada-at-example.com").trim()) throw new Error("Presence shared before consent");
await shot("16-presence-consent");
await themeShots("16a-waiting-presence");
await consentCard.getByRole("button", { name: "Condividi" }).click();
// Answered, the proposal leaves Aspetta te and the chat shows its card again in full.
await page.getByRole("main").locator('[data-anchor="presence-consent"]').getByText("Condivisa").waitFor({ timeout: 10_000 });
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
// W16: the agent of a colleague who is idle sleeps: same body and color, eyes closed, and Z's rising above it.
const liaBot = liaRow.getByTestId("agent-bot");
if ((await liaBot.getAttribute("data-move")) !== "sleep") throw new Error("An idle colleague's agent does not sleep");
const sleeping = await liaBot.evaluate((bot) => ({
  shape: bot.dataset.shape,
  zzz: getComputedStyle(bot.querySelector('[data-part="zzz"]')).display,
  risingZ: bot.querySelectorAll(".bot-z").length,
  moving: bot.getAnimations({ subtree: true }).filter((a) => a.effect?.target?.classList?.contains("bot-z")).length,
}));
if (!sleeping.shape || sleeping.zzz === "none" || sleeping.risingZ !== 3 || sleeping.moving !== 3) throw new Error(`The sleeping bot has no rising Z's: ${JSON.stringify(sleeping)}`);
await shot("16a-presence-group");
const groupLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await shot(`16b-presence-group-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(groupLook.provider, groupLook.dark);
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
    await setLookTo(provider, dark);
    await shot(`20b-provider-limit-waiting-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(null, false);
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
  await setLookTo(null, dark);
  await shot(`20c-provider-limit-actions-${dark ? "dark" : "light"}`);
}
await setLookTo(null, false);
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
  await setLookTo(null, dark);
  await shot(`20f-provider-recovered-${dark ? "dark" : "light"}`);
}
await setLookTo(null, false);

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

// L03 #206: agents stay in the project. As in the live proof of 26 September, Clean Code's architecture review greps
// Codex's global memory (~/.codex/memories/MEMORY.md). The fake Codex applies the thread's permission profile like the
// real sandbox: the file stays hidden, nothing from it reaches Trama, and the review's activity shows the refused read.
const scopeCodexHome = await mkdtemp(join(tmpdir(), "trama-ui-codex-home-"));
await mkdir(join(scopeCodexHome, "memories"));
const scopeMemory = join(scopeCodexHome, "memories", "MEMORY.md");
await writeFile(scopeMemory, "ordini: nota privata di un altro progetto\n");
const scopeProject = await mkdtemp(join(tmpdir(), "trama-ui-perimetro-"));
await cp(resolve("resources/DemoProject"), scopeProject, { recursive: true });
await writeFile(join(scopeProject, "package.json"), JSON.stringify({ name: "negozio", private: true, scripts: { test: "node -e \"process.exit(1)\"" } }));
execFileSync("git", ["-C", scopeProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", scopeProject, "add", "."]);
execFileSync("git", ["-C", scopeProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
({ app, page } = await launch({ CODEX_HOME: scopeCodexHome, FAKE_CODEX_MEMORY_PROBE: "1" }));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), scopeProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-perimetro" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.evaluate(() =>
  window.trama.invoke("mandate:grant", {
    requestId: null,
    objectives: ["Correggere i bug"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree"],
    limits: [],
  }),
);
await composer().fill("[verifica:node_test]");
await page.keyboard.press("Enter");
// The failed check is diagnosed and fixed; then the free team gets the architecture review, which ends with a Pact card.
// The card waits for the person in Aspetta te; the chat keeps its reference (issue #240).
const reviewCard = await waitingItem(page.locator('[data-testid="waiting-reference"][data-waiting-kind="question"]').first(), 90_000);
await reviewCard.getByText(/Approfondire l'annullamento/).first().waitFor();
// Issue #270: Clean Code's card reads plain. The skill it received shows by name, not as "skill:<name>:<path>", the
// proposal says "Approfondire" once, and its work is named, not cited by id. Both themes.
await reviewCard.getByText(/Skill ricevute: .*improve-codebase-architecture/).first().waitFor();
const reviewText = await reviewCard.innerText();
if (/skill:|SKILL\.md|Approfondire: Approfondire|incarico A-[0-9A-F]{8}/.test(reviewText)) throw new Error(`Clean Code's card is not plain: ${reviewText}`);
await reviewCard.evaluate((item) => item.scrollIntoView({ block: "start" }));
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`26a-plain-clean-code-card-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
const blockedRead = page.getByRole("button", { name: "Lettura fuori dal progetto bloccata" });
for (const group of await page.getByRole("button", { name: /ha lavorato per/ }).all()) {
  if (await blockedRead.count()) break;
  await group.click();
}
await blockedRead.first().waitFor({ timeout: 10_000 });
if ((await blockedRead.count()) !== 1) throw new Error(`Expected one refused read, got ${await blockedRead.count()}`);
await blockedRead.first().click();
const blockedDetail = await blockedRead.first().locator("xpath=..").innerText();
if (!blockedDetail.includes(scopeMemory) || !blockedDetail.includes("rg -n -i")) throw new Error(`Refused read without its path and request: ${blockedDetail}`);
if ((await page.locator("body").innerText()).includes("nota privata")) throw new Error("Codex's memory reached Trama");
await blockedRead.first().scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`21-read-outside-project-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #231: the fixed roles' automatic work says where it stands and why it has not started, in the Team view and on
// the role's page; the person starts Clean Code's review now, with the call to action on the right. Both themes.
const dutyProject = await mkdtemp(join(tmpdir(), "trama-ui-compiti-"));
await cp(resolve("resources/DemoProject"), dutyProject, { recursive: true });
execFileSync("git", ["-C", dutyProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", dutyProject, "add", "."]);
execFileSync("git", ["-C", dutyProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), dutyProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-compiti" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: /^Team/ }).first().click();
const dutyPanel = page.getByTestId("inspector");
const reviewWork = dutyPanel.locator('[data-testid="automatic-work"][data-work="architectureReview"]');
await reviewWork.waitFor({ timeout: 20_000 });
// Without a mandate nothing starts, and the view says why.
await reviewWork.getByText(/Senza un mandato concesso/).waitFor();
if (!(await reviewWork.getByTestId("automatic-work-start").isDisabled())) throw new Error("The review can start without a mandate");
await dutyPanel.locator('[data-testid="automatic-work"][data-work="triage"]').waitFor();
await page.evaluate(() =>
  window.trama.invoke("mandate:grant", {
    requestId: null,
    objectives: ["Rivedere l'architettura"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree"],
    limits: [],
  }),
);
const startReview = reviewWork.locator('[data-testid="automatic-work-start"]:not([disabled])');
await startReview.waitFor({ timeout: 20_000 });
await primaryLast(reviewWork.locator(".cta-row"), "Lavoro automatico");
const startBox = await startReview.boundingBox();
const workBox = await reviewWork.boundingBox();
if (!startBox || !workBox || workBox.x + workBox.width - (startBox.x + startBox.width) > 2) throw new Error("Avvia ora la revisione is not on the right");
await reviewWork.scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`22a-automatic-work-${dark ? "dark" : "light"}`);
}
await startReview.click();
// The review runs on request and ends with its Pact card; the card waits for the person, so the button says why it waits.
// The finished review may already be one settled line (issue #271): the line opens the card that says why it ran.
const onRequest = page.getByRole("main").getByText("Su richiesta tua: revisione al commit", { exact: false }).first();
const reviewLine = page.getByRole("main").getByTestId("settled-card").filter({ hasText: "Clean Code" }).filter({ hasText: "Concluso" }).last();
await onRequest.or(reviewLine).first().waitFor({ timeout: 30_000 });
if (!(await onRequest.isVisible())) {
  await reviewLine.getByRole("button", { name: /^Apri: / }).click();
  await onRequest.waitFor();
}
// The Pact card waits in Aspetta te: the chat shows its reference (issue #240).
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="question"]').first().waitFor({ timeout: 60_000 });
await reviewWork.getByText(/aspetta ancora la tua risposta/).waitFor({ timeout: 20_000 });
await dutyPanel.getByTestId("team-figure").filter({ hasText: "Clean Code" }).first().click();
const roleWork = dutyPanel.locator('[data-testid="automatic-work"][data-work="architectureReview"]');
await roleWork.waitFor();
await roleWork.scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`22b-automatic-work-role-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #267: the project's branch and main on GitHub went different ways. The chat says it once, above the dialog,
// with the files on request and the question for the Coordinator; the conflicts that only repeated it on each candidate
// point to the notice, and the candidate Luca replaced on the same issue is superseded, not a conflict between
// developers. No colleague is named: nobody shares a presence here. Both themes.
const divergenceProject = await mkdtemp(join(tmpdir(), "trama-ui-divergenza-"));
await cp(resolve("resources/DemoProject"), divergenceProject, { recursive: true });
const divergenceGit = (...args) => execFileSync("git", ["-C", divergenceProject, ...args], { encoding: "utf8" });
divergenceGit("init", "-q", "-b", "main");
divergenceGit("add", ".");
divergenceGit("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
divergenceGit("checkout", "-q", "-b", "chore/pre-apertura");
const divergenceHead = divergenceGit("rev-parse", "HEAD").trim();
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), divergenceProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
let divergencePath = null;
for (const file of await readdir(join(dataDir, "Projects"))) {
  if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-divergenza-")) divergencePath = join(dataDir, "Projects", file);
}
if (!divergencePath) throw new Error("Divergence: the project's state was not saved");
{
  const document = JSON.parse(await readFile(divergencePath, "utf8"));
  const at = (hour) => `2026-09-27T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const mainSHA = "4df3c14a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
  const files = [
    "package.json",
    "package-lock.json",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/prodotti/page.tsx",
    "src/app/carrello/page.tsx",
    "src/lib/commerce.ts",
    "src/lib/prezzi.ts",
    "src/lib/ordini.ts",
    "src/components/Header.tsx",
    "src/components/Footer.tsx",
    "src/components/Scheda.tsx",
    "next.config.js",
    "tsconfig.json",
    "README.md",
    "AGENTS.md",
    ".env.example",
    "vercel.json",
  ];
  const work = (id, objective, hour, branch) => ({
    id,
    specialistId: "S-LUCA",
    requestId: null,
    kind: "agreedTicket",
    objective,
    issueNumber: 13,
    exercise: null,
    moduleIds: [],
    dependencies: [],
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    requiredChecks: ["git_status"],
    instructions: "",
    mandateVersion: 1,
    createdAt: at(hour),
    status: "completed",
    workspace: { sourceRoot: divergenceProject, worktreeRoot: join(divergenceProject, "..", `wt-${id}`), branch, baseSHA: divergenceHead },
    threadId: null,
    turns: [],
    stops: [],
    result: "Fatto.",
    failure: null,
    updatedAt: at(hour),
    lastUpdate: "",
    reportedStatus: "completed",
  });
  const first = work("A-48ED83CA", "Primo script typecheck", 10, "chore/issue-13-sbloccare-la-verifica-tecnica-di-s1");
  const second = work("A-4025CB6B", "Script typecheck corretto", 11, "chore/issue-13-correggere-lo-script-typecheck");
  document.team.specialists.push({
    id: "S-LUCA",
    name: "Luca",
    competence: "Next.js",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color: "blue",
    tag: "Next.js",
    createdAt: at(9),
    status: "available",
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    updatedAt: at(11),
    lastUpdate: "",
    removal: null,
    assignments: [first, second],
  });
  const candidate = (id, assignment, snapshotId, hour) => ({
    id,
    assignmentId: assignment.id,
    specialistId: "S-LUCA",
    snapshotId,
    baseSHA: divergenceHead,
    diff: "",
    changedFiles: ["package.json"],
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["git_status"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: at(hour),
    updatedAt: at(hour),
    evidence: { git_status: { check: "git_status", result: "pass", command: "git status", output: "", snapshotId, decisionVersions: {}, recordedAt: at(hour) } },
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  });
  const older = candidate("C-AC540E8F", first, "snap-1", 10);
  const newer = candidate("C-2AB1376F", second, "snap-2", 11);
  document.candidates.push(older, newer);
  const conflict = (id, of, fields) => ({ id, candidateId: of.id, snapshotId: of.snapshotId, classification: "conflict", detail: "La fusione temporanea produce conflitti testuali.", checkedAt: at(12), ...fields });
  document.conflicts = [
    conflict(`snap-1:${mainSHA}`, older, { remoteSHA: mainSHA, references: ["main"], conflictingFiles: files }),
    conflict(`snap-2:${mainSHA}`, newer, { remoteSHA: mainSHA, references: ["main"], conflictingFiles: files }),
    conflict("snap-2:worktree:snap-1", newer, {
      remoteSHA: "9a50f20a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e",
      references: [`C-AC540E8F di Luca (${first.workspace.branch})`],
      otherCandidateId: older.id,
      otherSnapshotId: older.snapshotId,
      conflictingFiles: ["package.json"],
    }),
  ];
  // What Trama finds comparing the checkout with main on GitHub; the example project has no GitHub remote to read.
  document.branchDivergence = { branch: "chore/pre-apertura", defaultBranch: "main", headSHA: divergenceHead, remoteSHA: mainSHA, ahead: 13, behind: 7, conflictingFiles: files, checkedAt: at(12) };
  let sequence = Math.max(0, ...document.events.map((e) => e.sequence));
  const card = (kind, referenceId) => ({ id: `E-div-${++sequence}`, sequence, origin: "trama", requestId: null, createdAt: at(12), content: { type: "card", kind, title: kind, detail: null, referenceId } });
  document.events.push(card("candidate", older.id), card("candidate", newer.id), ...document.conflicts.map((a) => card("conflict", a.id)));
  await writeFile(divergencePath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), divergenceProject);
const divergenceNotice = page.getByTestId("branch-divergence");
await divergenceNotice.waitFor({ timeout: 30_000 });
const divergenceText = await divergenceNotice.getByTestId("branch-divergence-text").innerText();
if (!divergenceText.includes("chore/pre-apertura") || !divergenceText.includes("18 file in conflitto") || /[A-Z]-[0-9A-F]{6,}|[–—]/.test(divergenceText)) {
  throw new Error(`Divergence notice: ${divergenceText}`);
}
await primaryLast(divergenceNotice.locator(".cta-row"), "Divergence notice");
// Issue #271: the conflicts in the notice and the replaced work are settled, one line each; a line opens its card.
const settledLines = page.getByTestId("settled-card");
const divergenceCards = settledLines.filter({ hasText: "Nell'avviso del progetto" });
if ((await divergenceCards.count()) !== 2) throw new Error(`Divergence: ${await divergenceCards.count()} conflicts with main still shown on their own`);
const supersededConflict = settledLines.filter({ hasText: "Due incarichi del team" }).filter({ hasText: "Superato" });
if ((await supersededConflict.count()) !== 1) throw new Error("Divergence: the conflict with the replaced candidate is not superseded");
const replacedLine = settledLines.filter({ hasText: /^Candidato / }).filter({ hasText: "Superato" });
if ((await replacedLine.count()) !== 1) throw new Error("Divergence: the replaced candidate is not marked superseded");
await replacedLine.getByRole("button", { name: /^Apri: / }).click();
await replacedLine.getByTestId("candidate-superseded").waitFor();
if (await replacedLine.getByRole("button", { name: "Approva questo candidato" }).count()) throw new Error("Divergence: the replaced candidate can still be approved");
await replacedLine.getByRole("button", { name: /^Chiudi: / }).click();
await supersededConflict.getByRole("button", { name: /^Apri: / }).click();
if (await page.getByRole("main").getByText(/colleg[ah]i?\b/).count()) throw new Error("Divergence: a colleague is named with nobody sharing a presence");
if (await page.getByText("Conflitto con C-AC540E8F").count()) throw new Error("Divergence: the newer candidate still conflicts with the replaced one");
await page.getByTestId("conflict-superseded").scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`25a-branch-divergence-${dark ? "dark" : "light"}`);
}
await divergenceNotice.getByRole("button", { name: /^Mostra i 18 file/ }).click();
await divergenceNotice.getByTestId("branch-divergence-files").getByText("vercel.json").waitFor();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`25b-branch-divergence-files-${dark ? "dark" : "light"}`);
}
await divergenceNotice.getByRole("button", { name: "Chiedi al Coordinatore come riallineare" }).click();
await expectAsked("Come li riallineiamo?", "Divergence notice, Chiedi al Coordinatore come riallineare");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #271: a noisy history stays compact. The technical steps of each turn (seven read_issues in a row, empty
// notes, the same command three times) are in Activity, grouped; the chat keeps one line per turn. A card that asks
// nothing more is one line with its outcome, and a conflict lists its first files with the rest on request.
const timelineProject = await mkdtemp(join(tmpdir(), "trama-ui-cronologia-"));
await cp(resolve("resources/DemoProject"), timelineProject, { recursive: true });
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), timelineProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
let timelinePath = null;
for (const file of await readdir(join(dataDir, "Projects"))) {
  if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-cronologia-")) timelinePath = join(dataDir, "Projects", file);
}
if (!timelinePath) throw new Error("Compact timeline: the project's state was not saved");
{
  const document = JSON.parse(await readFile(timelinePath, "utf8"));
  // After the study, so the history reads in order below it.
  const start = Date.now();
  const at = (minute) => new Date(start + minute * 60_000).toISOString();
  const files = [
    "package.json",
    "package-lock.json",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/prodotti/page.tsx",
    "src/app/carrello/page.tsx",
    "src/lib/commerce.ts",
    "src/lib/prezzi.ts",
    "src/lib/ordini.ts",
    "src/components/Header.tsx",
    "src/components/Footer.tsx",
    "src/components/Scheda.tsx",
    "next.config.js",
    "tsconfig.json",
    "README.md",
    "AGENTS.md",
    ".env.example",
    "vercel.json",
  ];
  const assignment = {
    id: "A-5E1C0DE1",
    specialistId: "S-LUCA",
    requestId: "R-CRONO-1",
    kind: "agreedTicket",
    objective: "Correggere lo script typecheck",
    issueNumber: 13,
    exercise: null,
    moduleIds: [],
    dependencies: [],
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    requiredChecks: ["git_status"],
    instructions: "",
    mandateVersion: 1,
    createdAt: at(12),
    status: "completed",
    workspace: null,
    threadId: null,
    turns: [],
    stops: [],
    result: "Ho corretto lo script typecheck in package.json.",
    failure: null,
    updatedAt: at(20),
    lastUpdate: "Incarico concluso",
    reportedStatus: "completed",
  };
  document.team.specialists.push({
    id: "S-LUCA",
    name: "Luca",
    competence: "Next.js",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color: "blue",
    tag: "Next.js",
    createdAt: at(1),
    status: "available",
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    updatedAt: at(20),
    lastUpdate: "",
    removal: null,
    assignments: [assignment],
  });
  document.candidates.push({
    id: "C-5E1C0DE1",
    assignmentId: assignment.id,
    specialistId: "S-LUCA",
    snapshotId: "snap-crono",
    baseSHA: "0000000000000000000000000000000000000000",
    diff: "",
    changedFiles: ["package.json"],
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["git_status"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: at(20),
    updatedAt: at(20),
    evidence: {},
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  });
  document.conflicts = [
    {
      id: "snap-crono:main",
      candidateId: "C-5E1C0DE1",
      snapshotId: "snap-crono",
      remoteSHA: "4df3c14a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e",
      references: ["main"],
      classification: "conflict",
      detail: "La fusione temporanea produce conflitti testuali.",
      conflictingFiles: files,
      checkedAt: at(21),
    },
  ];
  document.requests.push({ id: "R-CRONO-1", text: "situazione?", moduleId: null, state: "completed", model: "gpt-6-luna", effort: null, createdAt: at(10), completedAt: at(11), failure: null });
  document.decisionRequests.push({
    id: "Q-5E1C0DE1",
    requestId: "R-CRONO-1",
    category: "product",
    question: "Quali pagamenti accetta il negozio all'apertura?",
    concreteCase: "Un cliente paga l'ordine 42 alla cassa online.",
    alternatives: [
      { behavior: "Solo carta", example: "Visa e Mastercard", consequence: null },
      { behavior: "Carta e bonifico", example: "Visa, Mastercard e bonifico SEPA", consequence: "L'ordine resta in attesa finché arriva il bonifico." },
    ],
    revisesDecisionId: null,
    askedAt: at(11),
    outcome: { answer: "Carta e bonifico", alternativeIndex: 1, decisionId: "D-5E1C0DE1", version: 1, answeredAt: at(12) },
  });
  document.mandateRequests.push({
    id: "M-5E1C0DE1",
    requestId: "R-CRONO-1",
    reason: "Serve il permesso di lavorare sullo script typecheck.",
    objectives: ["Sbloccare la verifica tecnica"],
    priorities: [],
    scopeModuleIds: [],
    authorizedActions: ["executeInWorktree"],
    limits: [],
    askedAt: at(11),
    resolution: { kind: "granted", version: 1, resolvedAt: at(12) },
  });
  let sequence = Math.max(0, ...document.events.map((e) => e.sequence));
  const event = (minute, content, extra = {}) => ({ id: `E-crono-${++sequence}`, sequence, origin: "trama", requestId: "R-CRONO-1", createdAt: at(minute), content, ...extra });
  const activity = (minute, title, detail, tone, extra) => event(minute, { type: "activity", title, detail, tone }, extra);
  const card = (minute, kind, referenceId) => event(minute, { type: "card", kind, title: kind, detail: null, referenceId }, { requestId: null });
  const luca = { requestId: null, assignmentId: assignment.id, workKey: `${assignment.id}:1` };
  document.events.push(
    event(10, { type: "personMessage", text: "situazione?", moduleId: null, moduleName: null, imageCount: 0 }, { origin: "person" }),
    activity(10, "Messaggio inviato al Coordinatore", "gpt-6-luna, fase: lavoro", "info"),
    ...Array.from({ length: 7 }, () => activity(10, "Strumento di Trama: read_issues", null, "tool")),
    activity(11, "Nota del Coordinatore", "", "info"),
    card(11, "decision", "Q-5E1C0DE1"),
    card(11, "mandate", "M-5E1C0DE1"),
    activity(12, "Avvio dell'incarico", "Correggere lo script typecheck", "info", luca),
    activity(12, "Worktree pronto", "chore/issue-13-correggere-lo-script-typecheck", "info", luca),
    activity(12, "Nota dello specialista", "", "info", luca),
    activity(13, "Nota dello specialista", "  ", "info", luca),
    ...[14, 15, 16].map((minute) => activity(minute, "/bin/zsh -lc 'npm run typecheck'", "tsc --noEmit", "tool", luca)),
    activity(17, "Modifica di 1 file", "package.json", "tool", luca),
    activity(20, "Incarico concluso", "Ho corretto lo script typecheck in package.json.", "info", luca),
    card(20, "assignment", assignment.id),
    event(21, { type: "coordinatorText", text: "Luca ha corretto lo script typecheck. Il candidato è in conflitto con main su 18 file.", model: "gpt-6-luna", references: [] }),
    card(21, "conflict", "snap-crono:main"),
  );
  await writeFile(timelinePath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), timelineProject);
const timelineConflict = page.locator(".chat-card", { has: page.getByTestId("conflict-files") });
await timelineConflict.waitFor({ timeout: 30_000 });
// A wheel up unpins the chat from its bottom, so it stays on the compact history.
const timelineScroller = page.locator(".chat-timeline-scroll");
await timelineScroller.hover();
await page.mouse.wheel(0, -400);
await page.waitForTimeout(300);
await timelineScroller.getByTestId("work-line").filter({ hasText: "Luca" }).evaluate((line) => line.scrollIntoView({ block: "center" }));
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`29a-compact-timeline-${dark ? "dark" : "light"}`);
}
const chatPane = page.locator(".chat-timeline-scroll");
// One line for each turn of work, none of its steps.
const workLines = chatPane.getByTestId("work-line");
if ((await workLines.filter({ hasText: "Luca" }).count()) !== 1) throw new Error(`Compact timeline: Luca's turn is not one line: ${await workLines.allInnerTexts()}`);
if (await chatPane.getByTestId("technical-step").count()) throw new Error("Compact timeline: technical steps in the chat");
for (const noise of ["read_issues", "Nota dello specialista", "npm run typecheck"]) {
  if (await chatPane.getByText(noise).count()) throw new Error(`Compact timeline: "${noise}" in the chat`);
}
// The answered decision, the granted mandate and the finished work are one line each, with their outcome.
const settled = chatPane.getByTestId("settled-card");
// Issue #270: the work's line names it; its id is on the title's hover.
for (const [what, outcome] of [["Decisione", "Hai scelto: Carta e bonifico"], ["Mandato", "Concesso, v1"], ["A-5E1C0DE1", "Concluso"]]) {
  const line = (/^A-/.test(what) ? settled.filter({ has: page.locator(`[data-record-id="${what}"]`) }) : settled.filter({ hasText: what })).filter({ hasText: outcome });
  if ((await line.count()) !== 1) throw new Error(`Compact timeline: no settled line for ${what} with ${outcome}`);
  const box = await line.boundingBox();
  if (!box || box.height > 48) throw new Error(`Compact timeline: the line of ${what} is ${box?.height} px high`);
}
// The line opens the whole card, and closes it again.
const decisionLine = settled.filter({ hasText: "Decisione" });
await decisionLine.getByRole("button", { name: /^Apri: / }).click();
await decisionLine.getByText("Apri nel Patto").waitFor();
await decisionLine.getByRole("button", { name: /^Chiudi: / }).click();
if (await decisionLine.getByText("Apri nel Patto").count()) throw new Error("Compact timeline: the decision did not close");
// The live conflict stays whole, with its first files and the rest on request.
const conflictChips = timelineConflict.getByTestId("conflict-files").locator("span.font-mono");
if ((await conflictChips.count()) !== 5) throw new Error(`Compact timeline: the conflict shows ${await conflictChips.count()} files`);
await timelineConflict.getByRole("button", { name: "Mostra tutti i 18 file" }).click();
await timelineConflict.getByText("vercel.json").waitFor();
// Luca's line opens its turn in Activity: the empty notes are gone, the same command three times is one entry.
await workLines.filter({ hasText: "Luca" }).getByRole("button").click();
const focusedTurn = page.getByTestId("inspector").locator('[data-testid="work-turn"][data-focused]');
await focusedTurn.getByTestId("technical-steps").waitFor();
const lucaSteps = await focusedTurn.getByTestId("technical-step").allInnerTexts();
if (lucaSteps.some((text) => text.includes("Nota dello specialista"))) throw new Error(`Compact timeline: empty notes in Activity: ${lucaSteps}`);
const command = focusedTurn.locator('[data-testid="technical-step"][data-count="3"]');
if (!(await command.innerText()).includes("npm run typecheck")) throw new Error(`Compact timeline: the command is not grouped: ${lucaSteps}`);
await command.getByRole("button").click();
await command.getByText("tsc --noEmit").waitFor();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`29b-activity-steps-${dark ? "dark" : "light"}`);
}
// The Coordinator's seven read_issues in a row are one entry.
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await workLines.filter({ hasNotText: "Luca" }).last().getByRole("button").click();
await page.getByTestId("inspector").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"][data-count="7"]').filter({ hasText: "read_issues" }).waitFor();
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// C11: while Trama stays open the Coordinator's turn waits out a network outage and a used up quota and resumes by
// itself, with no burst of turns; a turn cut by Esci comes back as interrupted after the restart and resumes only on
// request. The quota file stands in for the ChatGPT usage limit; the waits are shortened for the check.
const resumeProject = await mkdtemp(join(tmpdir(), "trama-ui-ripresa-"));
await cp(resolve("resources/DemoProject"), resumeProject, { recursive: true });
execFileSync("git", ["-C", resumeProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", resumeProject, "add", "."]);
execFileSync("git", ["-C", resumeProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
const quotaFile = join(await mkdtemp(join(tmpdir(), "trama-ui-quota-")), "exhausted");
const resumeEnv = { TRAMA_PROVIDER_RETRY_MS: "3000", TRAMA_PROVIDER_CHECK_MS: "3000", FAKE_CODEX_QUOTA_FILE: quotaFile };
({ app, page } = await launch(resumeEnv));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), resumeProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-ripresa" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
const serverReplies = () => page.getByText("Questa risposta arriva dal server di prova").count();
const waitForReply = async (before, what) => {
  for (let tries = 0; (await serverReplies()) <= before; tries++) {
    if (tries > 120) throw new Error(`${what}: the turn did not resume`);
    await page.waitForTimeout(250);
  }
};
const lookShots = async (name) => {
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await shot(`${name}-${provider}-${dark ? "dark" : "light"}`);
    }
  }
  await setLookTo(null, false);
};

// Network outage: the failure says so, Trama retries by itself once, and the turn ends with the provider's reply.
let repliesSoFar = await serverReplies();
await page.getByLabel("Messaggio al Coordinatore").fill("[rete-assente] Il servizio dei pagamenti risponde?");
await page.keyboard.press("Enter");
const outageCard = page.locator('[role="alert"][data-failure-kind="unreachable"]').last();
await outageCard.waitFor({ timeout: 30_000 });
await outageCard.getByText("Provider non raggiungibile").waitFor();
await outageCard.getByTestId("provider-retry").getByText(/Trama riprova da sola tra \d+ secondi, tentativo 1 di 5\./).waitFor();
await primaryLast(outageCard.locator(".cta-row"), "Outage wait");
await lookShots("23a-coordinator-outage-waiting");
await outageCard.getByTestId("provider-retry").waitFor({ state: "detached", timeout: 30_000 });
await waitForReply(repliesSoFar, "Network outage");
await shot("23b-coordinator-outage-resumed");

// Used up quota: Trama checks the account, starts no turn while the quota is used up, and resumes when it is back.
await writeFile(quotaFile, "");
repliesSoFar = await serverReplies();
await page.getByLabel("Messaggio al Coordinatore").fill("Prepara il riepilogo degli annullamenti");
await page.keyboard.press("Enter");
const quotaCard = page.locator('[role="alert"][data-failure-kind="quotaExhausted"]').last();
await quotaCard.waitFor({ timeout: 30_000 });
await quotaCard.getByTestId("provider-retry").getByText(/Trama controlla di nuovo la quota tra \d+ secondi e riprende il turno da sola appena si sblocca\./).waitFor();
await quotaCard.getByRole("button", { name: "Smetti di aspettare" }).waitFor();
await primaryLast(quotaCard.locator(".cta-row"), "Quota wait");
await lookShots("23c-coordinator-quota-waiting");
// Two account checks pass with the quota still used up: one failure in the chat, no new turn.
await page.waitForTimeout(7_000);
if ((await page.locator('[role="alert"][data-failure-kind="quotaExhausted"]').count()) !== 1) throw new Error("Trama retried the turn while the quota was used up");
await quotaCard.getByTestId("provider-retry").waitFor();
await rm(quotaFile);
await quotaCard.getByTestId("provider-retry").waitFor({ state: "detached", timeout: 30_000 });
await waitForReply(repliesSoFar, "Quota");
if ((await page.getByText("Prepara il riepilogo degli annullamenti", { exact: true }).count()) !== 1) throw new Error("The resumed turn wrote the message again");
await shot("23d-coordinator-quota-resumed");

// Esci during a turn: after the restart the turn reads as interrupted with its reason, and nothing starts by itself.
await page.getByLabel("Messaggio al Coordinatore").fill("[attesa] Controlla i test degli annullamenti");
await page.keyboard.press("Enter");
await page.getByText("[attesa] Controlla i test degli annullamenti", { exact: true }).waitFor();
await page.waitForTimeout(1_500);
await app.close();
({ app, page } = await launch({ ...resumeEnv, FAKE_CODEX_NO_WAIT: "1" }));
const quitRow = page.getByRole("status").filter({ hasText: "Trama è stato chiuso mentre il Coordinatore lavorava." });
await quitRow.waitFor({ timeout: 30_000 });
await quitRow.getByText("Turno interrotto").waitFor();
await page.waitForTimeout(1_000);
repliesSoFar = await serverReplies();
await lookShots("23e-coordinator-closed-turn");
if ((await serverReplies()) !== repliesSoFar) throw new Error("The interrupted turn resumed without the person");
await quitRow.getByRole("button", { name: "Riprendi" }).click();
await waitForReply(repliesSoFar, "Esci");
if ((await page.getByText("[attesa] Controlla i test degli annullamenti", { exact: true }).count()) !== 1) throw new Error("The resumed turn wrote the message again");
await shot("23f-coordinator-closed-turn-resumed");
await app.close();

// Issue #244: a project opened without a mandate gets the project mandate for the whole cycle in Aspetta te. Every
// mandate lists the fixed bans with no control to turn them on; the person narrows the mandate without revoking it,
// and an action a fixed ban covers stops before it starts and waits in Aspetta te with its reason.
const mandateProject = await mkdtemp(join(tmpdir(), "trama-ui-mandato-"));
await cp(resolve("resources/DemoProject"), mandateProject, { recursive: true });
execFileSync("git", ["-C", mandateProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", mandateProject, "add", "."]);
execFileSync("git", ["-C", mandateProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), mandateProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-mandato" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.getByTestId("waiting-summary").getByText("Mandato di progetto").waitFor();
const projectMandate = await openWaiting("mandate");
await projectMandate.getByText("Proposta di mandato di progetto").waitFor();
const fixedBans = projectMandate.getByTestId("fixed-bans");
if ((await fixedBans.locator("li").count()) !== 6) throw new Error("The project mandate does not list the six fixed bans");
if (await fixedBans.locator("input, button, [role='switch']").count()) throw new Error("A fixed ban has a control to turn it on");
await primaryLast(projectMandate.locator(".cta-row"), "Project mandate");
await fixedBans.scrollIntoViewIfNeeded();
await lookShots("26a-project-mandate");
await projectMandate.getByRole("button", { name: "Concedi", exact: true }).click();
await page.getByText("Ho concesso il mandato (versione 1).").first().waitFor({ timeout: 20_000 });
// The goal the study proposed may still wait (issue #292): only the mandate must have left Aspetta te.
if (await page.locator('[data-waiting-kind="mandate"]').count()) throw new Error("The granted project mandate still waits in Aspetta te");

// Restricting: the mandate stays in force, one action less, a new version in the history.
await page.getByRole("button", { name: /^Mandato/ }).first().click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await page.getByTestId("inspector").getByTestId("fixed-bans").waitFor();
await page.getByRole("button", { name: "Restringi", exact: true }).click();
const restrict = page.getByTestId("mandate-restrict");
await restrict.getByRole("checkbox", { name: "Integrare candidati verificati" }).uncheck();
await primaryLast(restrict.locator(".cta-row"), "Mandate restriction");
await lookShots("26b-mandate-restrict");
await restrict.getByRole("button", { name: "Restringi il mandato" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
const restriction = await page.getByTestId("mandate-restriction").innerText();
if (!restriction.includes("integrare candidati verificati") || /[–—]/.test(restriction)) throw new Error(`Restriction: ${restriction}`);
await page.getByText(/Ho ristretto il mandato/).first().waitFor({ timeout: 20_000 });
await lookShots("26c-mandate-restricted");
// The correction form starts from the restricted version: saving it never brings back what the restriction took away.
await page.getByRole("button", { name: "Correggi", exact: true }).click();
if (await page.getByTestId("inspector").getByRole("checkbox", { name: "Integrare candidati verificati" }).isChecked()) {
  throw new Error("The correction form brings back an action the restriction removed");
}
await page.getByTestId("inspector").getByRole("button", { name: "Annulla", exact: true }).click();
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();

// A force push is refused whatever the mandate: the turn stops and the action waits in Aspetta te with its reason.
await page.getByLabel("Messaggio al Coordinatore").fill("[vietato:git push --force origin main]");
await page.keyboard.press("Enter");
// The refusal is not a card of the chat: the summary above the composer opens it in Aspetta te.
await page.getByTestId("waiting-summary").getByText("Azione vietata").waitFor({ timeout: 20_000 });
await page.getByTestId("waiting-summary").getByRole("button", { name: /aspett(a|ano) te$/ }).click();
const bannedItem = page.getByTestId("inspector").locator('[data-testid="waiting-item"][data-waiting-kind="fixedBan"]');
await bannedItem.waitFor();
const bannedCard = bannedItem.getByTestId("fixed-ban-card");
await bannedCard.getByText("git push --force origin main").waitFor();
await bannedCard.getByText("Force push", { exact: true }).waitFor();
await primaryLast(bannedCard.locator(".cta-row"), "Fixed ban");
await lookShots("26d-fixed-ban");
await bannedCard.getByRole("button", { name: "Ho visto" }).click();
await bannedItem.waitFor({ state: "detached", timeout: 20_000 });
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #248: a check red on the project's branch is a problem outside the work in progress. With GitHub the
// Coordinator opens one issue for it, the bug triage takes it and Trama puts it in the backlog or with the assignment
// that works on it; Activity lists each choice with the issue on the right. Without GitHub the problem is a backlog
// item in Trama. Codex and Claude, light and dark.
const problemProject = async (name, remote) => {
  const path = await mkdtemp(join(tmpdir(), `trama-ui-${name}-`));
  await cp(resolve("resources/DemoProject"), path, { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify({ name: "negozio", private: true, scripts: { test: 'node -e "process.exit(1)"' } }));
  execFileSync("git", ["-C", path, "init", "-q", "-b", "main"]);
  if (remote) execFileSync("git", ["-C", path, "remote", "add", "origin", remote]);
  execFileSync("git", ["-C", path, "add", "."]);
  execFileSync("git", ["-C", path, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
  return path;
};
const redCheckWithMandate = async (path, title) => {
  await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
  await page.evaluate((project) => window.trama.invoke("project:open", { path: project }), path);
  await page.getByTestId("dialog-title").filter({ hasText: title }).waitFor({ timeout: 30_000 });
  await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
  await page.evaluate(() =>
    window.trama.invoke("mandate:grant", {
      requestId: null,
      objectives: ["Correggere i bug"],
      priorities: [],
      scopeModuleIds: ["Sources/Orders"],
      authorizedActions: ["executeInWorktree"],
      limits: [],
    }),
  );
  // The grant is a turn of the Coordinator: the red check is asked once it ends.
  await page.getByText("Ho concesso il mandato (versione 1).").first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
  // Typed, not filled: a draft filled right after the grant does not reach the composer's state and is not sent.
  await composer().click({ timeout: 60_000 });
  await composer().pressSequentially("[verifica:node_test]");
  await page.keyboard.press("Enter");
  await page.getByText("[verifica:node_test]", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.getByTestId("status-line").getByRole("button", { name: "Attività" }).click();
};
const problemsGhLog = join(await mkdtemp(join(tmpdir(), "trama-ui-problemi-gh-")), "gh.log");
({ app, page } = await launch({ PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_LOG: problemsGhLog, FAKE_GH_ISSUE_BASE: "20" }));
await redCheckWithMandate(await problemProject("problemi", "https://github.com/trama-ui/problemi.git"), "trama-ui-problemi");
const problemLog = page.getByTestId("activity-log");
await problemLog.locator('[data-testid="activity-problem"]').filter({ hasText: "Aperta la issue #21" }).waitFor({ timeout: 90_000 });
const placedProblem = problemLog.locator('[data-testid="activity-problem"]').filter({ hasText: /La issue #21 (va nel backlog|è assegnata all'incarico)/ });
await placedProblem.waitFor({ timeout: 90_000 });
await placedProblem.getByText(/Triage: /).waitFor();
await placedProblem.locator(".cta-row").getByRole("button", { name: "Apri la issue #21" }).waitFor();
const problemCalls = (await readFile(problemsGhLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const openedIssues = problemCalls.filter((call) => call.includes("POST") && call.some((arg) => /\/issues$/.test(arg)));
if (openedIssues.length !== 1) throw new Error(`Expected one issue for the red check, got ${openedIssues.length}`);
if (!openedIssues[0].includes("labels[]=needs-triage")) throw new Error("The issue of the problem does not carry the needs-triage label");
if (!problemCalls.some((call) => call.includes("POST") && call.some((arg) => /\/issues\/21\/labels$/.test(arg)))) throw new Error("Trama did not apply the triage labels");
if (/[–—]/.test(await problemLog.innerText())) throw new Error("A dash in the steps of the found problem");
await lookShots("27a-found-problem-issue");
// The recap cites the issue the Coordinator opened, with its number.
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
await composer().fill("/riep");
await page.getByRole("option", { name: /^\/riepilogo/ }).first().waitFor();
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector('textarea[aria-label="Messaggio al Coordinatore"]')?.value.startsWith("/riepilogo"));
await page.keyboard.press("Enter");
const problemRecap = page.getByTestId("recap-card").last();
await problemRecap.getByText(/Aperta la issue #21 per un problema trovato/).waitFor({ timeout: 20_000 });
await problemRecap.scrollIntoViewIfNeeded();
await lookShots("27b-found-problem-recap");
await app.close();

({ app, page } = await launch());
await redCheckWithMandate(await problemProject("problemi-locali", null), "trama-ui-problemi-locali");
const localBacklog = page.getByTestId("problem-backlog");
await localBacklog.getByTestId("problem-backlog-item").filter({ hasText: "Solo in Trama" }).waitFor({ timeout: 90_000 });
await page.getByTestId("activity-log").locator('[data-testid="activity-problem"]').filter({ hasText: "Nel backlog di Trama" }).waitFor();
await localBacklog.scrollIntoViewIfNeeded();
await lookShots("27c-found-problem-local-backlog");
await app.close();


// Issue #249: the always active Coordinator of a project with a mandate. A provider limit holds moves, rounds and new
// turns, and the status line says what it waits for; on reopening Trama the turn that waited for the limit waits again
// and resumes by itself at its end, the turn Esci ended resumes by itself, reconciled first, and a project in Pause
// stays in Pause with its turn interrupted. The quota file stands in for the ChatGPT usage limit.
const alwaysProject = await mkdtemp(join(tmpdir(), "trama-ui-sempre-attivo-"));
await cp(resolve("resources/DemoProject"), alwaysProject, { recursive: true });
execFileSync("git", ["-C", alwaysProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", alwaysProject, "add", "."]);
execFileSync("git", ["-C", alwaysProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
const alwaysQuota = join(await mkdtemp(join(tmpdir(), "trama-ui-quota-")), "exhausted");
const alwaysEnv = { TRAMA_PROVIDER_RETRY_MS: "3000", TRAMA_PROVIDER_CHECK_MS: "3000", FAKE_CODEX_QUOTA_FILE: alwaysQuota };
({ app, page } = await launch(alwaysEnv));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), alwaysProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-sempre-attivo" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
const alwaysMandate = await openWaiting("mandate");
await alwaysMandate.getByRole("button", { name: "Concedi", exact: true }).click();
await page.getByText("Ho concesso il mandato (versione 1).").first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi l'ispettore" }).click();
// The page changes at each launch: the line is looked up again every time.
const checkWaitingLine = async (where) => {
  const waitingLine = page.locator('[data-testid="status-line"][data-provider-wait="true"]');
  await waitingLine.waitFor({ timeout: 30_000 });
  await waitingLine.getByTestId("status-line-text").getByText(/^Aspetto che la quota di ChatGPT si sblocchi/).waitFor();
  await waitingLine.getByTestId("status-line-reason").getByText("Fino ad allora non parte nessun turno. Poi riprendo da solo.").waitFor();
  // The Pause stays reachable while the Coordinator waits.
  await waitingLine.getByRole("button", { name: "Pausa", exact: true }).waitFor();
  if (/[–—]/.test(await waitingLine.innerText())) throw new Error(`${where}: dash in the status line`);
};
const alwaysReplies = () => page.getByText("Questa risposta arriva dal server di prova").count();
const waitForAlwaysReply = async (before, what) => {
  for (let tries = 0; (await alwaysReplies()) <= before; tries++) {
    if (tries > 160) throw new Error(`${what}: the turn did not resume`);
    await page.waitForTimeout(250);
  }
};

// A used up quota: the turn fails, and the status line says the Coordinator waits for the quota and resumes by itself.
await writeFile(alwaysQuota, "");
await page.getByLabel("Messaggio al Coordinatore").fill("Prepara il riepilogo dei resi");
await page.keyboard.press("Enter");
await page.locator('[role="alert"][data-failure-kind="quotaExhausted"]').last().waitFor({ timeout: 30_000 });
await checkWaitingLine("Limit");
await page.getByTestId("status-line").scrollIntoViewIfNeeded();
await lookShots("28a-status-line-provider-wait");

// Esci while the quota is still used up: after reopening, the turn waits again, and no new turn starts meanwhile.
await app.close();
({ app, page } = await launch(alwaysEnv));
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-sempre-attivo" }).waitFor({ timeout: 30_000 });
await checkWaitingLine("Reopened limit");
await page.waitForTimeout(7_000);
if ((await page.locator('[role="alert"][data-failure-kind="quotaExhausted"]').count()) !== 1) throw new Error("Trama started a turn while the quota was used up");
await lookShots("28b-reopened-provider-wait");
let alwaysSoFar = await alwaysReplies();
await rm(alwaysQuota);
await waitForAlwaysReply(alwaysSoFar, "Reopened limit");
await page.locator('[data-testid="status-line"][data-provider-wait="false"]').waitFor({ timeout: 30_000 });
if ((await page.getByText("Prepara il riepilogo dei resi", { exact: true }).count()) !== 1) throw new Error("The resumed turn wrote the message again");
await shot("28c-reopened-limit-resumed");

// Esci during a turn: after reopening, the turn resumes by itself, and the Coordinator checks first what was done.
await page.getByLabel("Messaggio al Coordinatore").fill("[attesa] Controlla i test dei resi");
await page.keyboard.press("Enter");
await page.getByText("[attesa] Controlla i test dei resi", { exact: true }).waitFor();
await page.waitForTimeout(1_500);
alwaysSoFar = await alwaysReplies();
await app.close();
({ app, page } = await launch({ ...alwaysEnv, FAKE_CODEX_NO_WAIT: "1" }));
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-sempre-attivo" }).waitFor({ timeout: 30_000 });
// Nobody presses Riprendi: the resumed turn replies by itself, its work lists Trama's line, and the message is not
// written again.
await waitForAlwaysReply(alwaysSoFar, "Reopened turn");
if ((await page.getByText("[attesa] Controlla i test dei resi", { exact: true }).count()) !== 1) throw new Error("The resumed turn wrote the message again");
// The turn's steps are in Activity (issue #271): once the turn ends, its line opens them there. The newest line
// that holds Trama's line is the resumed turn; on a slow runner the reply comes before the turn is closed.
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 30_000 });
const reopenedRow = page.getByTestId("inspector").getByText("Turno ripreso alla riapertura", { exact: true }).last();
const turnLines = page.getByTestId("work-line").getByRole("button", { name: /^Ha lavorato per/ });
for (let index = (await turnLines.count()) - 1; index >= 0 && !(await reopenedRow.isVisible()); index -= 1) {
  await turnLines.nth(index).click();
  await page.waitForTimeout(300);
}
await reopenedRow.waitFor({ timeout: 10_000 });
await page.waitForTimeout(1_000);
await reopenedRow.scrollIntoViewIfNeeded();
await lookShots("28d-reopened-turn-resumed");

// A project in Pause stays in Pause after the restart: the turn Esci ended waits for the person.
await page.locator('[data-testid="status-line"]').getByRole("button", { name: "Pausa", exact: true }).click();
await page.locator('[data-testid="status-line"][data-paused="true"]').waitFor();
await app.close();
({ app, page } = await launch(alwaysEnv));
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-sempre-attivo" }).waitFor({ timeout: 30_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("[attesa] Rileggi gli esempi dei resi");
await page.keyboard.press("Enter");
await page.getByText("[attesa] Rileggi gli esempi dei resi", { exact: true }).waitFor();
await page.waitForTimeout(1_500);
alwaysSoFar = await alwaysReplies();
await app.close();
({ app, page } = await launch({ ...alwaysEnv, FAKE_CODEX_NO_WAIT: "1" }));
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-sempre-attivo" }).waitFor({ timeout: 30_000 });
const pausedAgain = page.locator('[data-testid="status-line"][data-paused="true"]');
await pausedAgain.waitFor({ timeout: 30_000 });
const pausedQuit = page.getByRole("status").filter({ hasText: "Trama è stato chiuso mentre il Coordinatore lavorava." }).last();
await pausedQuit.waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_000);
if ((await alwaysReplies()) !== alwaysSoFar) throw new Error("A turn resumed in Pause");
await lookShots("28e-reopened-paused");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();
