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
// Issue #330: the window is laid out as VS Code. The activity bar picks a view, the side bar shows it; until the slices
// B02-B08 build the new views, the panels of today are the view's tabs. Opening a view from the activity bar shows
// its first tab, as a click on the panel's row in the old sidebar showed that panel.
const activityBar = () => page.getByRole("navigation", { name: "Viste" });
const VIEWS = { Progetti: "projects", "Aspetta te": "waiting", Lavoro: "work", Squadre: "teams", Regole: "rules", Memoria: "memory" };
const openView = async (view, tab) => {
  const sideBar = page.getByTestId("side-bar");
  if ((await sideBar.count()) && (await sideBar.getAttribute("data-view")) === VIEWS[view]) {
    await activityBar().getByRole("button", { name: view, exact: true }).click();
    await sideBar.waitFor({ state: "detached" });
  }
  await activityBar().getByRole("button", { name: view, exact: true }).click();
  await page.locator(`[data-testid="side-bar"][data-view="${VIEWS[view]}"]`).waitFor();
  if (tab) await sideBar.getByRole("tab", { name: tab, exact: true }).click();
};
// The work in focus and the queue open from the status bar (issue #330).
const openFocusPanel = async (timeout = 20_000) => {
  if (!(await page.getByTestId("focus-bar").count())) await page.getByTestId("status-focus").click({ timeout });
  await page.getByTestId("focus-bar").waitFor();
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
  const item = page.getByTestId("side-bar").locator(`[data-testid="waiting-item"][data-waiting-key="${key}"]`);
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
  if (await page.getByTestId("side-bar").locator('[data-testid="waiting-item"]').count()) return;
  await page.getByTestId("waiting-summary").getByRole("button").click();
  await page.getByTestId("side-bar").locator('[data-testid="waiting-item"]').first().waitFor();
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
// The window opens hidden and shows on ready-to-show (main.ts); the DOM can be ready before that, and a screenshot of a
// hidden or not yet painted window fails ("Unable to capture screenshot"). So each frame waits for a visible window and
// for a painted frame after the animations are set, instead of assuming a fixed time is enough.
const windowShown = async () => {
  const end = Date.now() + 10_000;
  while (!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false))) {
    if (Date.now() > end) throw new Error("The window did not show within 10s");
    await page.waitForTimeout(20);
  }
  await page.waitForFunction(() => document.visibilityState === "visible");
};
const painted = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const introFrames = async (label, times) => {
  await windowShown();
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
    await painted();
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
// Issue #330: the window laid out as VS Code, following the prototype B of issue #314. The activity bar picks the view,
// the side bar shows it attached, the conversation is the editor and the status bar says what happens now.
{
  const windowLook = await lookOf();
  // The room left to the conversation: from the top of the timeline to the top of the dock over the composer.
  const conversationHeight = () =>
    page.evaluate(() => {
      const timeline = document.querySelector(".chat-timeline-scroll").getBoundingClientRect();
      const dock = document.querySelector(".chat-composer-dock").getBoundingClientRect();
      return Math.round(dock.top - timeline.top);
    });
  const filledButtons = () =>
    page.locator('button[data-variant="default"]').evaluateAll((buttons) => buttons.filter((b) => b.getBoundingClientRect().width > 0).length);
  const bars = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="title-bar"]').getBoundingClientRect().height,
    activity: document.querySelector('[data-testid="activity-bar"]').getBoundingClientRect().width,
    status: document.querySelector('[data-testid="status-bar"]').getBoundingClientRect().height,
  }));
  if (bars.title !== 46 || bars.activity !== 48 || bars.status !== 24) throw new Error(`The window's bars are not 46, 48 and 24 px: ${JSON.stringify(bars)}`);
  if (await page.getByTestId("side-bar").count()) throw new Error("The side bar is open at the first launch");
  // One badge in the activity bar, the count of Aspetta te.
  const badges = await activityBar().getByTestId("activity-badge").allInnerTexts();
  if (badges.join() !== "1") throw new Error(`The activity bar's badges: ${badges.join(", ")}`);
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    if (size === "1280x800") {
      const room = await conversationHeight();
      if (room < 580) throw new Error(`The conversation has ${room}px at 1280x800 with the side bar closed, under 580`);
      console.log(`conversation at 1280x800: ${room}px`);
    }
    if ((await filledButtons()) > 1) throw new Error(`More than one filled button in the window at ${size}`);
    await noHorizontalScroll(`window ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`30-window-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(windowLook.provider, windowLook.dark);
    await openView("Aspetta te");
    const sideWidth = await page.getByTestId("side-bar").evaluate((bar) => bar.getBoundingClientRect().width);
    if (sideWidth !== (width >= 1500 ? 340 : 300)) throw new Error(`The side bar is ${sideWidth}px at ${size}`);
    if ((await activityBar().getByRole("button", { name: "Aspetta te", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("The open view's icon is not pressed");
    if ((await filledButtons()) > 1) throw new Error(`More than one filled button with the side bar open at ${size}`);
    await noHorizontalScroll(`window ${size} with the side bar`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`30-window-${size}-side-bar-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(windowLook.provider, windowLook.dark);
    // The icon of the open view closes the side bar, as in VS Code.
    await activityBar().getByRole("button", { name: "Aspetta te", exact: true }).click();
    await page.getByTestId("side-bar").waitFor({ state: "detached" });
  }
  // A 1280x800 window at 120%: the side bar at its widest leaves the chat 420 px.
  await page.setViewportSize({ width: 1066, height: 666 });
  await openView("Regole");
  await page.getByTestId("side-bar").getByRole("button", { name: "Allarga la barra laterale" }).click();
  await page.waitForTimeout(300);
  const zoomed = await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width);
  if (zoomed < 420) throw new Error(`The chat is ${zoomed}px wide at 1066x666 with the widest side bar`);
  await shot("30-window-1066x666-side-bar-wide");
  await page.getByTestId("side-bar").getByRole("button", { name: "Larghezza normale" }).click();
  // The sash between the side bar and the editor, dragged.
  await page.setViewportSize({ width: 1280, height: 800 });
  // The side bar eases to its new width: the grip is measured once it has settled.
  await page.waitForTimeout(500);
  const windowSash = page.getByRole("separator", { name: /Larghezza della barra laterale/ });
  const windowSashBox = await windowSash.boundingBox();
  await page.mouse.move(windowSashBox.x + windowSashBox.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(windowSashBox.x + windowSashBox.width / 2 + 80, 400, { steps: 6 });
  await page.waitForTimeout(200);
  await shot("30-window-sash-drag");
  await page.mouse.up();
  await page.mouse.move(640, 500);
  if (Number(await windowSash.getAttribute("aria-valuenow")) !== 380) throw new Error("Dragging the sash does not widen the side bar to 380 px");
  await windowSash.dblclick();
  await page.waitForFunction(() => document.querySelector('[role="separator"][aria-label^="Larghezza della barra laterale"]')?.getAttribute("aria-valuenow") === "300");
  await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
  await page.setViewportSize({ width: 1280, height: 820 });
}
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
await page.getByTestId("side-bar").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"]').first().waitFor();
await shot("04-work-expanded");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("[proponi-team]");
await page.keyboard.press("Enter");
const teamItem = await openWaiting("team");
await teamItem.getByRole("button", { name: "Conferma il team" }).waitFor({ timeout: 20_000 });
await shot("04b-team-proposal");
await teamItem.getByRole("button", { name: "Conferma il team" }).click();
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Scrivi", exact: true }).click();
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await shot("04c-mandate-granted");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.getByLabel("Messaggio al Coordinatore").fill("[assegna]");
await page.keyboard.press("Enter");
await page.getByText("Concluso", { exact: true }).first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(500);
await shot("04d-assignment-done");
await openView("Squadre");
// W09: the full team, moment by moment, with the fixed roles next to the confirmed developer.
const teamPanel = page.getByTestId("side-bar");
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
  const inspector = el.closest('[data-testid="side-bar"]').getBoundingClientRect();
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await openView("Squadre");
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
// W16, cost: CSS runs the steady moves; the frame loop runs only while a bot morphs, at most 24 times per second,
// and not at all at rest. The eyes do not follow the cursor. Reduced motion stops everything and keeps the still pose.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
await page.waitForFunction(() => !document.documentElement.classList.contains("bots-paused"), null, { timeout: 5_000 });
const botFrames = () => page.evaluate(() => ({ frames: window.__tramaBots.frames, at: performance.now() }));
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
// The eyes stay where they are while the cursor moves, and the loop draws no frame for it. The cursor moves over the
// composer, away from every bot, so no hover wink starts a morph; blinks and winks change the eyes' size, not where
// they sit, so only the position is compared.
const eyePositions = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="agent-bot"] [data-part^="eye-"]')].map((eye) => /translate\([^)]*\)/.exec(eye.getAttribute("transform") ?? "")?.[0]),
  );
const composerBox = await page.getByLabel("Messaggio al Coordinatore").boundingBox();
// First let any morph under way finish: the loop is idle once a whole second passes without a frame.
for (let quiet = 0, last = (await botFrames()).frames, tries = 0; quiet < 4 && tries < 40; tries++) {
  await page.waitForTimeout(250);
  const now = (await botFrames()).frames;
  quiet = now === last ? quiet + 1 : 0;
  last = now;
}
const eyesBefore = await eyePositions();
const movingFrom = await botFrames();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(composerBox.x + composerBox.width / 2 + (composerBox.width / 3) * Math.cos(i / 6), composerBox.y + composerBox.height / 2 + 10 * Math.sin(i / 6));
  await page.waitForTimeout(50);
}
const movingFrames = (await botFrames()).frames - movingFrom.frames;
if (movingFrames > 0) throw new Error(`The bot loop ran ${movingFrames} frames while only the cursor moved`);
if (JSON.stringify(await eyePositions()) !== JSON.stringify(eyesBefore)) throw new Error("The eyes moved with the cursor");
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
  `bots: ${botSizes.length} on screen, ${movingFrames} frames with the cursor moving, ${restFrames} frames in 3 s at rest, ` +
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await shot("04e8-bots-chat-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("04e9-bots-chat-light");

// Learning (ADR 0014): the Coordinator saves a note, then a review the person asks for writes memory and a skill.
await page.getByLabel("Messaggio al Coordinatore").fill("[memoria] ricorda il gestore di pacchetti");
await page.keyboard.press("Enter");
await page.getByText(/^Salvato\./).first().waitFor({ timeout: 20_000 });
await openView("Memoria");
await page.getByRole("button", { name: "Rivedi ora" }).click();
await page.getByText("Skill 'release-flow' creata").first().waitFor({ timeout: 30_000 });
await shot("04i-memory");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// Candidate: correct the mandate to allow integration, then declare, verify, review and clear.
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
const waitingTitle = page.getByTestId("side-bar-title");
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /^Root/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await domainCard.getByText("Scritta", { exact: true }).waitFor({ timeout: 30_000 });
await domainCard.getByText(/ha scritto la proposta nella copia di lavoro dell'incarico di /).waitFor();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await domainCard.scrollIntoViewIfNeeded();
await shot("04k-domain-proposal-written");
// #305 and #313: the context meter reads the request that fills the window, the same rule for every provider: no
// provider name and no number past the window. Past the threshold Trama reorders the context at the end of the turn
// (ADR 0018), so the reading is taken under a 95% threshold. Light and dark.
{
  const providerNames = ["ChatGPT", "Codex", "Claude", "Cursor", "Antigravity", "Grok", "Droid", "Devin", "OpenCode", "Pi"];
  const noProviderName = (text, where) => {
    const found = providerNames.find((name) => new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, "u").test(text));
    if (found) throw new Error(`${where} names the provider ${found}: ${text}`);
  };
  await page.evaluate(() => window.trama.invoke("coordinator:setContextThreshold", { percent: 95 }));
  const reordersBefore = await page.getByTestId("context-rollover").count();
  await composer().fill("[pieno] Quanto contesto resta?");
  await page.keyboard.press("Enter");
  await page.getByText("[pieno] Quanto contesto resta?", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
  const meter = page.getByTestId("context-meter");
  await page.waitForFunction(() => document.querySelector('[data-testid="context-meter"]')?.textContent?.trim() === "89%", null, { timeout: 20_000 });
  if ((await meter.getAttribute("title")) !== "230.000 su 258.000 token") throw new Error(`The context meter's tokens: ${await meter.getAttribute("title")}`);
  await meter.click();
  const meterPopup = page.getByTestId("context-meter-popup");
  await meterPopup.waitFor();
  const meterText = (await meterPopup.innerText()).replace(/\s+/g, " ");
  noProviderName(meterText, "The context meter");
  if (!meterText.includes("Contesto del Coordinatore: 89%")) throw new Error(`The context meter does not read the context in use: ${meterText}`);
  await themeShots("04m-context-meter");
  await page.keyboard.press("Escape");
  await meterPopup.waitFor({ state: "hidden" });
  if ((await page.getByTestId("context-rollover").count()) !== reordersBefore) throw new Error("Trama reordered the context under the threshold");
  // The threshold stays at 95% in this project: the reorder itself is checked on its own project, in steps 29a to 29c.
}
await openView("Regole", "Mappa");
await shot("05-map");
// #229: every panel separator is the same sash, as in VS Code (base/browser/ui/sash). At rest the sash draws nothing and
// the 1px line is the panel's own border; no grip dots anywhere. After 300ms of hover its 4px ::before takes VS Code's
// focusBorder, and while dragged it stays lit. Double-click and the arrow keys change the width. The panels meet edge
// to edge as in VS Code: the side panels a shade darker than the chat, a 1px border that shows in light and dark.
// Issue #330: the inspector left the window. The side bar's sash, on the edge of the editor, carries the same checks,
// and the activity bar joins the side bar with the same 1px border.
{
  const sidebarSash = page.getByRole("separator", { name: /Larghezza della barra laterale/ });
  const look = (sash) =>
    sash.evaluate((element) => {
      const style = getComputedStyle(element);
      const color = (value) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        element.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      const strip = getComputedStyle(element, "::before");
      return {
        background: style.backgroundColor,
        strip: strip.backgroundColor,
        stripWidth: strip.width,
        after: getComputedStyle(element, "::after").content,
        accent: color("var(--app-focus-border)"),
        width: element.getBoundingClientRect().width,
        cursor: style.cursor,
        zIndex: style.zIndex,
        children: element.childElementCount,
        text: element.textContent,
      };
    });
  const transparent = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
  // The strip lights up after the 300ms hover delay plus a 0.1s transition, so a read at a fixed time can catch it
  // halfway (rgba(0, 95, 184, 0.957)). These helpers read again every 20ms, up to 1.5s, until the strip is the opaque
  // accent, and return the last reading either way: the assertions below decide.
  const channels = (color) => {
    const [r, g, b, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
    return { r, g, b, a };
  };
  const opaqueAccent = ({ strip, accent }) => {
    const [lit, wanted] = [channels(strip), channels(accent)];
    return lit.a === 1 && lit.r === wanted.r && lit.g === wanted.g && lit.b === wanted.b;
  };
  const settledLook = async (sash) => {
    const end = Date.now() + 1_500;
    let reading = await look(sash);
    while (!opaqueAccent(reading) && Date.now() < end) {
      await page.waitForTimeout(20);
      reading = await look(sash);
    }
    return reading;
  };
  for (const sash of [sidebarSash]) {
    const rest = await look(sash);
    if (!transparent(rest.background) || !transparent(rest.strip) || rest.children || rest.text || (rest.after !== "none" && rest.after !== "normal"))
      throw new Error(`A sash shows something at rest: ${JSON.stringify(rest)}`);
    if (rest.width !== 4 || !["col-resize", "ew-resize"].includes(rest.cursor) || rest.zIndex !== "35") throw new Error(`A sash is not a 4px resize grip at z-index 35: ${JSON.stringify(rest)}`);
  }
  // The line at rest is the panels' border: the side bar's right edge and the activity bar's right edge.
  const borders = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--app-panel-border)";
    document.body.append(probe);
    const border = getComputedStyle(probe).color;
    probe.remove();
    const sidebar = getComputedStyle(document.querySelector('[data-testid="side-bar"]'));
    const activity = getComputedStyle(document.querySelector('[data-testid="activity-bar"]'));
    return { border, sidebar: [sidebar.borderRightWidth, sidebar.borderRightColor], activity: [activity.borderRightWidth, activity.borderRightColor] };
  });
  for (const [width, color] of [borders.sidebar, borders.activity])
    if (width !== "1px" || color !== borders.border) throw new Error(`A panel has no 1px border line: ${JSON.stringify(borders)}`);
  // On screen, in light and dark: the border differs from the panels on both sides, and the side bar differs from the
  // chat next to it. Pixels come from the window capture, [r, g, b].
  const pixel = (x, y) =>
    app.evaluate(
      async ({ BrowserWindow }, point) => {
        const [b, g, r] = (await BrowserWindow.getAllWindows()[0].webContents.capturePage({ ...point, width: 1, height: 1 })).toBitmap();
        return [r, g, b];
      },
      { x: Math.round(x), y: Math.round(y) },
    );
  const apart = (one, other) => Math.max(...one.map((channel, index) => Math.abs(channel - other[index])));
  await page.mouse.move(640, 500);
  for (const mode of ["light", "dark"]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), mode === "dark");
    await page.waitForTimeout(400);
    const edges = await page.evaluate(() => ({
      sidebar: document.querySelector('[data-testid="side-bar"]').getBoundingClientRect().right,
    }));
    const y = 620;
    const [sidebarLine, sidebarPanel, chat] = await Promise.all([pixel(edges.sidebar - 1, y), pixel(edges.sidebar - 12, y), pixel(edges.sidebar + 12, y)]);
    const seen = JSON.stringify({ mode, sidebarLine, sidebarPanel, chat });
    if (apart(sidebarLine, sidebarPanel) < 8 || apart(sidebarLine, chat) < 8) throw new Error(`A panel border does not show at rest: ${seen}`);
    if (apart(sidebarPanel, chat) < 3) throw new Error(`The side bar does not stand apart from the chat: ${seen}`);
    await shot(`22-sash-rest-${mode}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  // Nothing covers the grip: it sits over the content on both sides of each edge.
  for (const sash of [sidebarSash]) {
    const box = await sash.boundingBox();
    const onTop = await sash.evaluate((element, points) => points.every(([x, y]) => document.elementFromPoint(x, y) === element), [
      [box.x + 0.5, 620],
      [box.x + box.width - 0.5, 620],
    ]);
    if (!onTop) throw new Error(`Something covers the sash ${await sash.getAttribute("aria-label")}`);
  }
  const sidebarBox = await sidebarSash.boundingBox();
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, 300);
  await page.waitForTimeout(100);
  if (!transparent((await look(sidebarSash)).strip)) throw new Error("The sash lights up before the hover delay");
  const hovered = await settledLook(sidebarSash);
  if (hovered.strip !== hovered.accent || hovered.stripWidth !== "4px") throw new Error(`After the hover delay the sash is not a 4px focusBorder strip: ${JSON.stringify(hovered)}`);
  // VS Code's focusBorder: #005FB8 in Light Modern, #0078D4 in Dark Modern.
  for (const [mode, focusBorder] of [["light", "rgb(0, 95, 184)"], ["dark", "rgb(0, 120, 212)"]]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), mode === "dark");
    const lit = (await settledLook(sidebarSash)).strip;
    if (lit !== focusBorder) throw new Error(`The ${mode} hovered sash is ${lit}, not VS Code's focusBorder ${focusBorder}`);
    await shot(`22-sash-hover-${mode}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const dragBox = await sidebarSash.boundingBox();
  const startWidth = Number(await sidebarSash.getAttribute("aria-valuenow"));
  await page.mouse.move(dragBox.x + dragBox.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 60, 300, { steps: 6 });
  const dragged = await settledLook(sidebarSash);
  if (dragged.strip !== dragged.accent) throw new Error(`The dragged sash is not lit: ${JSON.stringify(dragged)}`);
  await shot("22-sash-drag-light");
  await page.mouse.up();
  await page.mouse.move(640, 500);
  if (Number(await sidebarSash.getAttribute("aria-valuenow")) !== startWidth + 60) throw new Error("Dragging the sash does not widen the side bar");
  // The drag does not count as a click: the side bar stays open.
  await page.getByTestId("side-bar").waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="separator"][aria-label^="Larghezza della barra laterale"]'), "::before").backgroundColor === "rgba(0, 0, 0, 0)");
  await sidebarSash.dblclick();
  await page.waitForFunction(() => document.querySelector('[role="separator"][aria-label^="Larghezza della barra laterale"]')?.getAttribute("aria-valuenow") === "300");
  await sidebarSash.focus();
  await page.keyboard.press("ArrowRight");
  if ((await sidebarSash.getAttribute("aria-valuenow")) !== "316") throw new Error("ArrowRight does not widen the side bar");
  await page.keyboard.press("Shift+ArrowLeft");
  if ((await sidebarSash.getAttribute("aria-valuenow")) !== "252") throw new Error("Shift+ArrowLeft does not narrow the side bar by 64px");
  await page.keyboard.press("Home");
  if ((await sidebarSash.getAttribute("aria-valuenow")) !== "300") throw new Error("Home does not reset the side bar");
  if ((await sidebarSash.getAttribute("aria-orientation")) !== "vertical") throw new Error("The sash has no vertical orientation");
  await sidebarSash.blur();
  await page.getByTestId("side-bar").waitFor();
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
await openView("Regole", "Patto");
await shot("08-pact");
await openView("Regole", "Mandato");
await shot("09-mandate");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await shot("10-dark");
await page.locator(".chat-card", { has: page.getByTestId("domain-proposal") }).last().scrollIntoViewIfNeeded();
await shot("10a-dark-domain-proposal");
// Goals (UX01, UX02, UX07): the project has only the goal the Coordinator proposed, so it offers the first one.
// Issue #292: the proposed goal waits for the person in Aspetta te; the chat keeps its reference.
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first().waitFor();
// Issue #292: what waits for the person while the Coordinator's goal is proposed, with the list open.
if (await page.getByTestId("waiting-summary").count()) await page.getByTestId("waiting-summary").getByRole("button").click();
await themeShots("10b-waiting-proposed-goal");
if (await page.getByRole("button", { name: "Chiudi la barra laterale" }).count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
// Issue #330: the chat's row sits under the project in the Projects view.
await openView("Progetti");
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
// The overview (UX03) lists the project with its open goals. It opens from the Projects view (issue #330).
await openView("Progetti");
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await page.getByTestId("overview-project").first().getByText("Ordini annullati in revisione").waitFor({ timeout: 10_000 });
await shot("10e-overview");
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// W03: withdraw a grilling question with a reason; the round then waits only for the other answer. It works on
// the round the W01 steps opened: a second grilling request would open a second "turno 1" and make the round ambiguous.
const round = page.getByRole("region", { name: "Chiarimento, turno 1" }).first();
await round.waitFor({ timeout: 20_000 });
// U01: with open questions, the sidebar under the project still lists only the chat, the goals and the agents.
// Issue #330: those rows are in the Projects view of the side bar.
await openView("Progetti");
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
await page.getByTestId("status-line").getByRole("button", { name: "Pausa del Coordinatore", exact: true }).click();
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await page.getByTestId("status-line").getByRole("button", { name: "Riprendi il Coordinatore" }).click();
await page.locator('[data-testid="status-line"][data-paused="true"]').waitFor({ state: "detached", timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await openView("Lavoro", "Obiettivi");
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
await openView("Progetti");
await page.getByTestId("sidebar-project-rows").waitFor();
if (await page.getByTestId("sidebar-goal").filter({ hasText: "Obiettivo creato per sbaglio" }).count()) throw new Error("The deleted goal is still in the sidebar");
// A sent message never comes back as the draft, even the one deleted from the queue.
if ((await page.getByLabel("Messaggio al Coordinatore").inputValue()).includes("Questo messaggio resta in coda")) throw new Error("A sent message came back as the draft");
const goalRow = page.getByTestId("sidebar-goal").filter({ hasText: goalTitle });
await goalRow.hover();
await goalRow.getByRole("button", { name: `Archivia ${goalTitle}` }).click();
await goalRow.waitFor({ state: "detached" });
await openView("Lavoro", "Obiettivi");
const inspectorPanel = page.getByTestId("side-bar");
await inspectorPanel.getByText("Archiviati (1)").waitFor();
await shot("14e-goal-archived");
await inspectorPanel.getByRole("button", { name: new RegExp(goalTitle) }).click();
await inspectorPanel.getByRole("button", { name: "Ripristina" }).click();
await openView("Progetti");
await page.getByTestId("sidebar-goal").filter({ hasText: goalTitle }).waitFor();
await shot("14f-goal-restored");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// W12: the main action of every screen does what its label says, with an effect the person sees. Mandato, Memoria,
// candidato, Obiettivi, Panoramica, guida and the chat cards are clicked above; Issue and Gruppo after the restart.
// Header: a rescan that changes nothing still confirms it ran.
await page.getByRole("button", { name: "Aggiorna progetto" }).click();
const refreshed = page.getByRole("status").filter({ hasText: "Progetto riletto" });
await refreshed.waitFor({ timeout: 10_000 });
await refreshed.getByRole("button", { name: "Chiudi" }).click();
// Goal card: "Modifica la proposta" opens the proposal with its editor ready.
await (await openWaiting("goal")).getByTestId("goal-card").getByRole("button", { name: "Modifica la proposta" }).click();
const editor = page.getByTestId("side-bar").getByTestId("goal-editor");
await editor.waitFor();
await shot("16a-goal-proposal-edit");
await editor.getByRole("button", { name: "Annulla" }).click();
await editor.waitFor({ state: "detached" });
// Mappa: asking about a module puts the question in the composer with the module as the message's context.
await openView("Regole", "Mappa");
await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
await page.getByTestId("side-bar").getByRole("button", { name: "Chiedi al Coordinatore su questo modulo" }).click();
await expectAsked("Cosa fa il modulo Orders", "Mappa, Chiedi al Coordinatore su questo modulo");
if (!(await page.getByRole("button", { name: "Contesto del messaggio" }).innerText()).includes("Orders")) throw new Error("The module is not the message's context");
await shot("16b-module-ask");
await page.getByRole("button", { name: "Contesto del messaggio" }).click();
await page.getByRole("listbox", { name: "Contesto" }).getByRole("option", { name: /Intero progetto/ }).click();
await composer().fill("");
// Patto: "Nuova decisione" opens the editor, "Annulla" closes it.
await openView("Regole", "Patto");
await page.getByTestId("side-bar").getByRole("button", { name: "Nuova decisione" }).click();
const recordDecision = page.getByTestId("side-bar").getByRole("button", { name: "Registra decisione", exact: true });
await recordDecision.waitFor();
await page.getByTestId("side-bar").getByRole("button", { name: "Annulla", exact: true }).click();
await recordDecision.waitFor({ state: "detached" });
// Team: asking about a specialist names its latest assignment; the action is the last in the cta-row.
await openView("Squadre");
await page.getByTestId("side-bar").getByTestId("team-developer").first().click();
await page.getByTestId("side-bar").getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).waitFor();
const developerName = (await page.getByTestId("side-bar").locator("h3.text-ui-lg").first().textContent()).trim();
const specialistActions = await page.getByTestId("side-bar").locator(".cta-row").first().locator("button").allTextContents();
if (specialistActions.at(-1)?.trim() !== "Chiedi al Coordinatore") throw new Error(`Chiedi al Coordinatore is not the last call to action: ${specialistActions}`);
await page.getByTestId("side-bar").getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked(`di ${developerName}`, "Team, Chiedi al Coordinatore");
if (!(await composer().inputValue()).includes("Aggiornami sul lavoro di ") || /A-[0-9A-F]{8}/.test(await composer().inputValue())) throw new Error(`The question does not name ${developerName}'s assignment`);
await shot("16c-specialist-ask");
await composer().fill("");
// Lavoro: a candidate opens with its diff; the card inside it offers no "Apri il diff" that would do nothing.
await openView("Lavoro", "Candidati");
// Issue #272: Lavoro names the plan as its chat card does, and a finished candidate never reads "In costruzione".
{
  const workPanel = page.getByTestId("side-bar");
  await workPanel.getByText("Fette confermate dal Coordinatore").first().waitFor({ timeout: 10_000 });
  if (await workPanel.getByText("In costruzione", { exact: true }).count()) throw new Error("Lavoro calls a candidate under construction");
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
    await shot(`10h-work-states-${dark ? "dark" : "light"}`);
  }
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), wasDark);
}
await page.getByTestId("side-bar").locator('button[data-record-id^="C-"]').first().click();
await page.getByTestId("side-bar").getByText(/^Diff catturato da Trama/).waitFor();
if (await page.getByTestId("side-bar").getByRole("button", { name: "Apri il diff" }).count()) throw new Error("The candidate view offers a diff it already shows");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// Ricerca: "Scrivi al Coordinatore" from the overview goes back to the dialog with the cursor in the composer.
await openView("Progetti");
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
await openView("Progetti");
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// A05: the Pause of continuous work is always on the status line. In pause the line says so, Riprendi takes the place
// of Pausa as the primary on the right, and nothing automatic starts; Riprendi brings the line back.
await statusLine.getByRole("button", { name: "Pausa del Coordinatore", exact: true }).click();
const pausedLine = page.locator('[data-testid="status-line"][data-paused="true"]');
await pausedLine.waitFor({ timeout: 20_000 });
await pausedLine.getByTestId("status-line-text").getByText(/Coordinatore in pausa: i turni in corso finiscono/).waitFor();
const resumeButton = pausedLine.getByRole("button", { name: "Riprendi il Coordinatore" });
await resumeButton.waitFor();
// The last action sits on the right: Riprendi, unless the person has a move of their own, which stays last. Issue #330:
// in the status bar Riprendi is an icon and the person's move is text, so the window keeps one filled button.
const lastButton = pausedLine.getByRole("button").last();
const lastBox = await lastButton.boundingBox();
const pausedBox = await pausedLine.boundingBox();
if (!lastBox || !pausedBox || pausedBox.x + pausedBox.width - (lastBox.x + lastBox.width) > 2) throw new Error("The last action of the paused line is not on the right");
if ((await lastButton.getAttribute("aria-label")) !== "Riprendi" && !(await pausedLine.locator("button:not([aria-label])").count())) {
  throw new Error("The last action of the paused line is neither Riprendi nor the person's move");
}
await themeShots("15c-status-line-paused");
await page.waitForTimeout(300);
if (await statusLine.getByRole("button", { name: /^Ferma/ }).count()) throw new Error("Trama started a move in pause");
await resumeButton.click();
await page.locator('[data-testid="status-line"][data-paused="false"]').waitFor({ timeout: 20_000 });
await statusLine.getByRole("button", { name: "Pausa del Coordinatore", exact: true }).waitFor();
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
// Issue #71: every provider, ChatGPT included, shows its capabilities in the same panel.
const capabilityToggles = settings.getByRole("button", { name: /^Capacità/ });
await capabilityToggles.first().click();
await themeShots("11b-connections-capabilities");
await capabilityToggles.first().click();
await settings.getByRole("button", { name: /^Generale/ }).first().click();
// Issue #301: the language sits in Generale and changes the page at once.
await settings.getByTestId("language-choice").getByRole("radio", { name: "Italiano", checked: true }).waitFor();
await shot("12-settings");
await settings.getByTestId("language-choice").getByRole("radio", { name: "English" }).click();
await settings.getByRole("button", { name: /^Connections/ }).first().waitFor();
await settings.getByRole("heading", { name: "General" }).waitFor();
await shot("12-settings-en");
// Issue #348: Informazioni shows the version of app/package.json, in each language.
const appVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const aboutVersion = settings.getByTestId("about-version");
if (!(await aboutVersion.textContent())?.startsWith(`Version ${appVersion}.`)) throw new Error(`About does not show Version ${appVersion}`);
await settings.getByTestId("language-choice").getByRole("radio", { name: "Italiano" }).click();
await settings.getByRole("button", { name: /^Collegamenti/ }).first().waitFor();
await settings.getByTestId("about-version").getByText(`Versione ${appVersion}.`, { exact: false }).waitFor();
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
if ((await page.getByTestId("side-bar").getByTestId("waiting-item").filter({ hasText: "Prima proposta di mandato" }).count()) !== 0) {
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
await openView("Regole", "Mandato");
const mandateInspector = page.getByTestId("side-bar");
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// With no proposal left the next move would be the Coordinator's: keep it from starting by itself here.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
const rejectCard = await openWaiting("mandate", "Seconda proposta di mandato");
await rejectCard.getByRole("button", { name: "Rifiuta la proposta" }).click();
await rejectCard.getByLabel("Motivo del rifiuto").fill("Serve ancora il worktree");
await rejectCard.getByRole("button", { name: "Rifiuta la proposta" }).click();
// Answered, the proposal leaves Aspetta te and the chat shows it as one line with its outcome (issue #271).
const rejectedCard = page.getByTestId("settled-card").filter({ hasText: "Seconda proposta di mandato" }).last();
await rejectedCard.getByText("Rifiutata", { exact: true }).waitFor({ timeout: 20_000 });
await openView("Regole", "Mandato");
await mandateInspector.getByText(/^Mandato (v\d+|revocato)/).first().waitFor();
if ((await mandateState()) !== stateBefore) throw new Error(`Rejecting a proposal changed the mandate in force: ${await mandateState()}`);
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
// Issue #330: the bar left the top of the chat; the status bar names the work in focus and opens the same panel.
await openFocusPanel();
const focusBar = page.getByTestId("focus-bar");
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
// Issue #272: suspending the task in focus and the Coordinator's Pause never share a name.
const pause = focusBar.getByRole("button", { name: "Sospendi questo lavoro" });
if (await focusBar.getByRole("button", { name: /^(Metti in pausa|Pausa)$/ }).count()) throw new Error("A pause in the focus bar has an ambiguous name");
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
await pausedItem.getByText(/^Sospeso/).waitFor();
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
// Issue #330: the side bar is attached and narrows before the chat, which keeps at least 420 px beside it.
for (const [width, height] of [[720, 640], [1040, 700], [1280, 800], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  if (await page.getByTestId("side-bar").count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
  const composer = await page.getByLabel("Messaggio al Coordinatore").boundingBox();
  if (!composer || composer.width < 300) throw new Error(`Composer squeezed at ${width}x${height}: ${JSON.stringify(composer)}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll at ${width}x${height}`);
  await openView("Regole", "Mappa");
  await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
  const chatWidth = await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width);
  if (chatWidth < 419.5) throw new Error(`The chat is ${chatWidth}px wide next to the side bar at ${width}x${height}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll with the side bar at ${width}x${height}`);
  await shot(`13-size-${width}x${height}-module`);
  // Escape inside the inspector closes it, at every size.
  await page.getByTestId("side-bar").getByRole("button", { name: "Chiudi la barra laterale" }).focus();
  await page.keyboard.press("Escape");
  await page.getByTestId("side-bar").waitFor({ state: "detached" });
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
// Issue #330: the goals are the first tab of Lavoro, opened from its icon in the activity bar.
const goalsRow = page.getByRole("navigation", { name: "Viste" }).getByRole("button", { name: "Lavoro", exact: true });
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
await page.getByTestId("side-bar").getByRole("heading", { name: goalTitle }).waitFor();
await shot("13a-goal-reopened");
console.log("reopened goal", goalId);

// W12, Issue: "Chiedi al Coordinatore" cites the issue in the composer, ready to edit or send. The folder chooser is
// native, so the project opens through the same action as a recent project in the sidebar.
await page.evaluate((path) => window.trama.invoke("project:open", { path }), githubProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-negozio" }).waitFor({ timeout: 30_000 });
await openView("Lavoro", "Issue");
const issuesPanel = page.getByTestId("side-bar");
await issuesPanel.getByRole("button", { name: /Il pulsante Annulla non fa niente/ }).click({ timeout: 30_000 });
await issuesPanel.getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked("@issue:7 «Il pulsante Annulla non fa niente»", "Issue, Chiedi al Coordinatore");
if (await page.getByRole("button", { name: "Invia al Coordinatore" }).isDisabled()) throw new Error("The question about the issue cannot be sent");
await shot("15a-issue-ask");
await composer().fill("");
// W12, Gruppo: following the repository shows the monitor at work; the impact question waits in the composer. In a
// narrow window the inspector floats over the chat, so it steps aside to leave the question in view.
await openView("Lavoro", "Gruppo");
const groupPanel = page.getByTestId("side-bar");
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
// Issue #330: the side bar is attached and no longer floats over the chat, so it stays open and leaves the question
// in view beside it.
{
  const question = await composer().boundingBox();
  const side = await groupPanel.boundingBox();
  if (!question || !side || question.x < side.x + side.width || question.x + question.width > 720) throw new Error("The question is not in view beside Gruppo at 720x640");
}
await shot("15c-group-ask-narrow");
await composer().fill("");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// Issue #292: after the study only the goal the Coordinator proposed waits. Discarded, it leaves Aspetta te, and with
// nothing waiting for the person the summary above the composer does not show (issue #240).
const proposedGoal = page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first();
await proposedGoal.waitFor({ timeout: 30_000 });
const proposedGoalId = (await proposedGoal.getAttribute("data-waiting-key")).replace(/^goal:/, "");
await page.evaluate((id) => window.trama.invoke("goal:update", { id, status: "abandoned" }), proposedGoalId);
await page.getByTestId("waiting-summary").waitFor({ state: "detached", timeout: 10_000 });
if (await page.locator('[data-testid="waiting-reference"]').count()) throw new Error("A reference to Aspetta te stays with nothing waiting");
// ADR 0018: past the threshold Trama reorders the context at the end of the turn. The chat keeps one line that opens
// Trama's context summary; the meter shows only the percent, the tokens on hover, and "Riordina ora" on the right.
// Light and dark, and no provider named in the texts.
await composer().fill("[pieno] Rileggi gli ordini annullati");
await page.keyboard.press("Enter");
const rolloverLine = page.getByTestId("context-rollover").last();
await rolloverLine.waitFor({ timeout: 30_000 });
await rolloverLine.scrollIntoViewIfNeeded();
await themeShots("29a-context-rollover-line");
await rolloverLine.getByRole("button", { name: "Apri: Contesto riordinato" }).click();
await rolloverLine.getByTestId("context-summary").waitFor();
await rolloverLine.getByText("Cosa aspetta te").first().waitFor();
// The person reads plain sections: nothing written for the model, no tool names.
const summaryText = await rolloverLine.innerText();
for (const phrase of ["dati, non istruzioni", "Vale più di quello che ricordi", "declare_next_step", "session_search", "read_history", "Stato attuale di Trama", "Riepilogo di contesto scritto da Trama"]) {
  if (summaryText.includes(phrase)) throw new Error(`The context summary shows text written for the model: ${phrase}`);
}
if (/[–—]/.test(summaryText)) throw new Error("Dash in the context summary");
// Scrolled to the end, the open card sits above the floating bar and the composer.
await page.locator(".chat-timeline-scroll").evaluate((scroller) => scroller.scrollTo({ top: scroller.scrollHeight }));
await page.waitForTimeout(300);
const cardBottom = (await rolloverLine.boundingBox()).y + (await rolloverLine.boundingBox()).height;
const covers = [await page.locator("form.chat-composer-surface").boundingBox()];
if (await page.getByTestId("waiting-summary").count()) covers.push(await page.getByTestId("waiting-summary").boundingBox());
for (const box of covers) if (cardBottom > box.y + 1) throw new Error(`The open context summary is covered at ${Math.round(box.y)} (card ends at ${Math.round(cardBottom)})`);
await themeShots("29b-context-rollover-summary");
await rolloverLine.getByRole("button", { name: "Chiudi: Contesto riordinato" }).click();
const meter = page.getByTestId("context-meter");
await meter.waitFor({ timeout: 30_000 });
if (!/^\d+%$/.test((await meter.innerText()).trim())) throw new Error(`The meter shows more than the percent: ${await meter.innerText()}`);
if (!/ su [\d.]+ token$/.test((await meter.getAttribute("title")) ?? "")) throw new Error("The meter has no tokens on hover");
await meter.click();
const meterPopup = page.getByTestId("context-meter-popup");
await meterPopup.waitFor();
const meterText = await meterPopup.innerText();
for (const name of ["Codex", "Claude", "OpenCode", "Cursor", "Devin", "Droid", "Grok", "Antigravity"]) {
  if (meterText.includes(name)) throw new Error(`The meter names a provider: ${name}`);
}
if (/[–—]/.test(meterText)) throw new Error("Dash in the meter");
const reorderNow = meterPopup.getByRole("button", { name: "Riordina ora" });
const reorderRow = await reorderNow.evaluate((button) => {
  const row = button.closest(".cta-row");
  return row ? { right: row.getBoundingClientRect().right, button: button.getBoundingClientRect().right } : null;
});
if (!reorderRow || Math.abs(reorderRow.right - reorderRow.button) > 1) throw new Error("Riordina ora is not on the right of its row");
await themeShots("29c-context-meter");
const reordersSoFar = await page.getByTestId("context-rollover").count();
await reorderNow.click();
await page.getByTestId("context-rollover").nth(reordersSoFar).waitFor({ timeout: 30_000 });
await page.keyboard.press("Escape").catch(() => undefined);
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
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Scrivi", exact: true }).click();
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await failedCard.getByText("Da sistemare", { exact: true }).waitFor();
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
await secretCandidate.getByText("Da sistemare", { exact: true }).waitFor();
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
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Aprire pull request/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
const referenceInspector = page.getByTestId("side-bar");
await referenceInspector.and(page.locator('[aria-label="Candidato"]')).waitFor({ timeout: 10_000 });
// Issue #270: the panel names the candidate; its id is on the title's hover and on the card's title.
await referenceInspector.locator(`[data-testid="side-bar-title"][title="${citedCandidate}"]`).waitFor();
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
await referenceInspector.locator(`[data-testid="side-bar-title"][title="${citedDecision}"]`).waitFor();
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// M06: the developer of a slice runs implement and tdd with their original text and reports the seams it tested.
// The candidate shows that report apart from Trama's evidence; the build and the tests wait for Trama's own run.
await openView("Regole", "Mandato");
await page.getByRole("button", { name: "Correggi", exact: true }).click();
await page.getByRole("checkbox", { name: /Preparare piani/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await send("[piano]");
// Continuous work is off here, so the seams and the slices stay the person's, as without a mandate (A06).
await (await openWaiting("seams")).getByRole("button", { name: "Conferma i punti di prova" }).click({ timeout: 20_000 });
await (await openWaiting("slices")).getByTestId("plan-slices").getByRole("button", { name: "Conferma le fette" }).click({ timeout: 20_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
// F04: from a finding to work, one click each. This candidate's project has no GitHub remote: the verified finding
// goes to Trama's backlog, and its correction becomes an assignment for Ada, who wrote the candidate, within the
// mandate. The hypothesis cannot become an assignment; as a trade-off it becomes a Pact card. Without GitHub the report
// stays in Trama and there is nothing to publish.
const verifiedFinding = auditFinding("standards", "verified");
const hypothesisFinding = auditFinding("spec", "hypothesis");
const findingActions = await verifiedFinding.getByTestId("audit-finding-actions").locator(":scope > button").allTextContents();
if (findingActions.join("|") !== "Metti nel backlog|È un compromesso|Affida la correzione") throw new Error(`Finding actions out of order: ${findingActions}`);
if (await hypothesisFinding.getByRole("button", { name: "Affida la correzione" }).count()) throw new Error("A hypothesis can become an assignment");
await focusAudit.getByTestId("focus-audit-publication").getByText(/Con GitHub collegato puoi pubblicarlo/).waitFor();
if (await page.getByRole("button", { name: "Pubblica su GitHub" }).count()) throw new Error("A report can be published without GitHub");
await verifiedFinding.scrollIntoViewIfNeeded();
await themeShots("20g-finding-actions");
await verifiedFinding.getByRole("button", { name: "Metti nel backlog" }).click();
await verifiedFinding.locator('[data-testid="audit-finding-followups"] [data-kind="ticket"]').getByText("backlog di Trama").waitFor({ timeout: 20_000 });
await hypothesisFinding.getByRole("button", { name: "È un compromesso" }).click();
await hypothesisFinding.locator('[data-testid="audit-finding-followups"] [data-kind="pactCard"]').getByText(/^Scheda del Patto: /).waitFor({ timeout: 20_000 });
await verifiedFinding.getByRole("button", { name: "Affida la correzione" }).click();
await verifiedFinding.locator('[data-testid="audit-finding-followups"] [data-kind="assignment"]').getByText(/^Incarico: /).waitFor({ timeout: 20_000 });
const leftActions = await verifiedFinding.getByTestId("audit-finding-actions").locator(":scope > button").allTextContents();
if (leftActions.join("|") !== "È un compromesso") throw new Error(`A finding offers the same work twice: ${leftActions}`);
if (await hypothesisFinding.getByRole("button", { name: "È un compromesso" }).count()) throw new Error("A finding offers the same Pact card twice");
await verifiedFinding.scrollIntoViewIfNeeded();
await themeShots("20h-finding-work");
// The correction is Ada's new assignment in the work's dialog; it ends before the next step gives her work.
const correctionWork = assignmentCards.nth(6);
await waitInCard(correctionWork, (card) => card.getByText(/Correggere il rilievo: Possibile Mysterious Name/), "finding correction");
await waitInCard(correctionWork, (card) => card.getByText("Concluso", { exact: true }), "finding correction ended", 30_000);
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await showWaiting();
await correctedCard.getByRole("button", { name: "Esame approfondito" }).click();
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// W06: a developer with a doubt asks the Coordinator with ask_coordinator, and the slice pauses. The question stays in
// the report's doubts. The Coordinator puts it on a Pact card that blocks the work; the person's answer resumes the
// developer in the same session, and the card and the assignment say so.
await send("[assegna:S1] [test] [domanda]");
const questionWork = assignmentCards.nth(7);
await questionWork.getByText("Aspetta una risposta", { exact: true }).waitFor({ timeout: 20_000 });
await questionWork.locator('[data-testid="assignment-question"][data-state="asked"]').getByText(/buono/).waitFor();
await questionWork.getByText("Aspetta il Coordinatore").waitFor();
await questionWork.getByTestId("report-doubts").getByText(/Domanda al Coordinatore/).waitFor();
await sliceSpec.locator('[data-testid="plan-slice"][data-state="paused"]').getByText("Aspetta una risposta").waitFor({ timeout: 20_000 });
await questionWork.scrollIntoViewIfNeeded();
await shot("19e-developer-question");
await send("[blocca-dubbio]");
// The card keeps the developer's question after the answer; only the "Blocca il lavoro" badge goes.
// While it waits, the card sits in Aspetta te, first because it holds the most work.
const blockingItem = await openWaiting("question", "Domanda di uno sviluppatore");
if ((await page.getByTestId("side-bar").getByTestId("waiting-item").first().getAttribute("data-waiting-key")) !== (await blockingItem.getAttribute("data-waiting-key"))) {
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
const verifiedSliceWork = assignmentCards.nth(8);
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
if ((await assignmentCards.count()) !== 9) throw new Error("A developer took a slice while continuous work was off");
// Continuous work on: at the next event of the work (here the end of a Coordinator turn) Ada is free and takes S2 in
// autonomy; the assignment card says so and the slice shows who took it.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));
// "Come procede il lavoro?" would ask for a recap, which opens no turn (issue #242): the check writes to the Coordinator.
await send("Vai avanti con il lavoro");
const pickedCard = assignmentCards.nth(9);
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
// Issue #330: in the 300 px side bar the row may wrap; the primary then sits on the row below, still on the right.
const routeBefore = skipRoute && startRoute && (startRoute.y > skipRoute.y + skipRoute.height / 2 || (Math.abs(startRoute.y - skipRoute.y) < 2 && skipRoute.x < startRoute.x));
if (!skipRoute || !startRoute || !routeBox || !routeBefore || routeBox.x + routeBox.width - (startRoute.x + startRoute.width) > 20) {
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
// Issue #328: editorial typography. A message and its titles read in Newsreader, the controls in Inter and the code in
// JetBrains Mono, all bundled with the app: the computed families use the tokens and each font is really loaded.
// Every provider theme, light and dark, and the narrow window keep the 18px body inside the chat.
await composer().fill("## Annullare un ordine\n\nUn ordine pagato e annullato va in revisione, come in `CancelPaidOrder.swift`.\n\n```swift\nlet stato = ordine.annulla()\n```");
await page.keyboard.press("Enter");
const typeMessage = page.locator(".chat-markdown--user").filter({ hasText: "Annullare un ordine" }).last();
await typeMessage.locator("pre code").waitFor({ timeout: 20_000 });
await page.getByText("Questa risposta arriva dal server di prova").last().waitFor({ timeout: 30_000 });
const typography = () =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const user = [...document.querySelectorAll(".chat-markdown--user")].filter((node) => node.textContent.includes("Annullare un ordine")).pop();
    const reply = [...document.querySelectorAll(".chat-markdown:not(.chat-markdown--user)")].filter((node) => node.textContent.includes("server di prova")).pop();
    const style = (node) => {
      if (!node) return null;
      const s = getComputedStyle(node);
      return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, optical: s.fontOpticalSizing };
    };
    const loaded = (family) => [...document.fonts].some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded");
    return {
      message: style(reply?.querySelector("p") ?? reply),
      title: style(user?.querySelector("h2")),
      button: style(document.querySelector("form.chat-composer-surface button")),
      code: style(user?.querySelector("pre code")),
      inline: style(user?.querySelector("p code")),
      fonts: Object.fromEntries(
        [
          ["Newsreader Variable", '400 18px "Newsreader Variable"'],
          ["Newsreader Variable 500", '500 24px "Newsreader Variable"'],
          ["Inter Variable", '500 13px "Inter Variable"'],
          ["JetBrains Mono Variable", '400 14px "JetBrains Mono Variable"'],
        ].map(([name, font]) => [name, document.fonts.check(font, "Aa") && loaded(name.replace(/ 500$/, ""))]),
      ),
    };
  });
const types = await typography();
const firstFamily = (style) => style?.family.split(",")[0].replace(/["']/g, "").trim();
if (firstFamily(types.message) !== "Newsreader Variable" || types.message.size !== "18px" || types.message.optical !== "auto") throw new Error(`Message typography: ${JSON.stringify(types.message)}`);
if (Math.abs(parseFloat(types.message.lineHeight) / 18 - 1.68) > 0.01) throw new Error(`Message line height: ${JSON.stringify(types.message)}`);
if (firstFamily(types.title) !== "Newsreader Variable" || types.title.weight !== "500") throw new Error(`Title typography: ${JSON.stringify(types.title)}`);
const titleLeading = parseFloat(types.title.lineHeight) / parseFloat(types.title.size);
if (titleLeading < 1.3 || titleLeading > 1.35) throw new Error(`Title line height: ${JSON.stringify(types.title)}`);
if (firstFamily(types.button) !== "Inter Variable") throw new Error(`Button typography: ${JSON.stringify(types.button)}`);
if (firstFamily(types.code) !== "JetBrains Mono Variable" || firstFamily(types.inline) !== "JetBrains Mono Variable") throw new Error(`Code typography: ${JSON.stringify([types.code, types.inline])}`);
const missingFonts = Object.entries(types.fonts).filter(([, ok]) => !ok).map(([name]) => name);
if (missingFonts.length) throw new Error(`Fonts not loaded: ${missingFonts.join(", ")}`);
// Nothing leaves the chat: no horizontal page scroll, every message inside the timeline, no text wider than its box.
const typographyOverflow = () =>
  page.evaluate(() => {
    const timeline = document.querySelector(".chat-timeline-scroll")?.getBoundingClientRect();
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth) problems.push("page scroll");
    for (const node of document.querySelectorAll(".chat-timeline-scroll .chat-markdown")) {
      const box = node.getBoundingClientRect();
      if (!box.width) continue;
      if (timeline && (box.left < timeline.left - 1 || box.right > timeline.right + 1)) problems.push(`message outside the timeline: ${node.textContent.slice(0, 40)}`);
      for (const child of node.querySelectorAll(":scope > :not(pre, table, .chat-compare)")) {
        if (child.scrollWidth > child.clientWidth + 1) problems.push(`text wider than its box: ${child.textContent.slice(0, 40)}`);
      }
    }
    return problems;
  });
const typeLook = await lookOf();
await typeMessage.scrollIntoViewIfNeeded();
for (const provider of ["codex", "claudeAgent", "cursor", "antigravity", "grok", "droid", "devin", "opencode", "pi"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    const problems = await typographyOverflow();
    if (problems.length) throw new Error(`Typography with ${provider} ${dark ? "dark" : "light"}: ${problems.join("; ")}`);
    if (provider === "codex" || provider === "claudeAgent") await shot(`16d1-typography-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(typeLook.provider, typeLook.dark);
// In a narrow window the side bar sits beside the chat: closed, the messages are what the shot shows.
if (await page.getByTestId("side-bar").count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.setViewportSize({ width: 720, height: 640 });
await typeMessage.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const narrowProblems = await typographyOverflow();
if (narrowProblems.length) throw new Error(`Typography at 720x640: ${narrowProblems.join("; ")}`);
await shot("16d2-typography-narrow");
await page.setViewportSize({ width: 1280, height: 820 });
// G02: Gruppo is the picture of who works on what. One row per person and per agent, with identity, active branch,
// "anche su", the request, the files and the freshness; the person's own switch is in the view, on the right.
await openView("Lavoro", "Gruppo");
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
const ownSwitch = page.getByTestId("side-bar").getByRole("switch", { name: "Condividi la presenza", checked: true });
await ownSwitch.waitFor();
const groupInspector = await page.getByTestId("side-bar").boundingBox();
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
await page.getByTestId("side-bar").getByRole("button", { name: "Allarga la barra laterale" }).click();
await page.waitForTimeout(400);
await shot("16d-presence-group-wide");
await page.getByTestId("side-bar").getByRole("button", { name: "Larghezza normale" }).click();
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(400);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal page scroll in Gruppo at 720x640");
if (await page.getByTestId("side-bar").evaluate((node) => node.scrollWidth > node.clientWidth + 1)) throw new Error("Gruppo overflows the inspector at 720x640");
await shot("16e-presence-group-narrow");
await page.setViewportSize({ width: 1280, height: 820 });
await page.getByRole("button", { name: "Impostazioni" }).click();
await page.getByTestId("settings").getByRole("button", { name: /^Presenza/ }).first().click();
await page.getByTestId("settings").getByRole("switch", { name: "Condividi la presenza", checked: true }).waitFor();
await page.getByTestId("settings").getByRole("button", { name: "Metti in pausa" }).click();
await page.getByTestId("settings").getByRole("button", { name: "Riprendi" }).waitFor();
await shot("16c-presence-settings");
await page.getByTestId("settings").getByRole("button", { name: "Riprendi" }).click();
// Issue #272: the Monitor never says "no repository" above the repository it then offers.
await page.getByTestId("settings").getByRole("button", { name: /^Monitor/ }).first().click();
await page.getByTestId("settings").getByText("Repository osservati").waitFor();
{
  const text = await page.getByTestId("settings").innerText();
  if (/Nessun repository/.test(text) && /Repository del progetto aperto/.test(text)) throw new Error("The Monitor says no repository above the project's one");
}
await shot("16f-monitor-settings");

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
// Issue #330: the work in focus in the status bar carries the overlap's badge and opens the panel with the warning.
await page.locator('[data-testid="status-focus"][data-overlap="conflict"]').waitFor({ timeout: 10_000 });
await openFocusPanel();
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
await openView("Regole", "Mappa");
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
// Issues #270 and #272: Clean Code's card reads plain. The fake recommends only when the review received its skill,
// no path or delivery proof shows, the options are the proposals' titles, and its work is named, not cited by id.
await reviewCard.getByText(/Partire dall'annullamento/).first().waitFor();
const reviewText = await reviewCard.innerText();
if (/skill:|SKILL\.md|Skill ricevute|Approfondire: |incarico A-[0-9A-F]{8}/.test(reviewText)) throw new Error(`Clean Code's card is not plain: ${reviewText}`);
await reviewCard.evaluate((item) => item.scrollIntoView({ block: "start" }));
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`26a-plain-clean-code-card-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
const blockedRead = page.getByRole("button", { name: "Lettura fuori dal progetto bloccata" });
// The chat's lines only: the side bar sits before the chat (issue #330) and its Activity lists the same names.
for (const group of await page.getByRole("main").getByRole("button", { name: /ha lavorato per/ }).all()) {
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
await openView("Squadre");
const dutyPanel = page.getByTestId("side-bar");
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
// Issue #272: the Clean Code card offers the proposals by their own titles and no text of the fake's own checks; once
// the person answers, the review's work says what was chosen, never "proposte da decidere" again.
{
  const reference = page.locator('[data-testid="waiting-reference"][data-waiting-kind="question"]').first();
  const requestId = (await reference.getAttribute("data-waiting-key")).replace(/^question:/, "");
  const body = await page.locator("body").innerText();
  if (/Approfondire: /.test(body)) throw new Error("A Clean Code option repeats the verb of the question");
  if (/Skill ricevute/.test(body)) throw new Error("The Clean Code card shows the fake's delivery proof");
  await page.evaluate((id) => window.trama.invoke("decision:answer", { requestId: id, alternativeIndex: 1, freeText: null }), requestId);
  await dutyPanel.getByText("Revisione dell'architettura: hai scelto «Unire i pagamenti»").first().waitFor({ timeout: 20_000 });
  if (/proposte da decidere/.test(await page.locator("body").innerText())) throw new Error("The review still asks to decide after the answer");
  const answeredWork = dutyPanel.getByText("Revisione dell'architettura: hai scelto «Unire i pagamenti»").first();
  await answeredWork.scrollIntoViewIfNeeded();
  for (const dark of [false, true]) {
    await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
    await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
    await shot(`22c-clean-code-answered-${dark ? "dark" : "light"}`);
  }
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
// Issue #330: the status bar counts the files in conflict and opens the notice over itself.
const openDivergence = async () => {
  if (!(await divergenceNotice.count())) await page.getByTestId("status-conflict").click({ timeout: 30_000 });
  await divergenceNotice.waitFor({ timeout: 30_000 });
};
if (!/^18 file in conflitto$/.test((await page.getByTestId("status-conflict").innerText({ timeout: 30_000 })).trim())) throw new Error("The status bar does not count the files in conflict");
await openDivergence();
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
await openDivergence();
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
const focusedTurn = page.getByTestId("side-bar").locator('[data-testid="work-turn"][data-focused]');
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await workLines.filter({ hasNotText: "Luca" }).last().getByRole("button").click();
await page.getByTestId("side-bar").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"][data-count="7"]').filter({ hasText: "read_issues" }).waitFor();
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
await openView("Regole", "Mandato");
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await page.getByTestId("side-bar").getByTestId("fixed-bans").waitFor();
await page.getByRole("button", { name: "Restringi", exact: true }).click();
const restrict = page.getByTestId("mandate-restrict");
await restrict.getByRole("checkbox", { name: "Integrare candidati verificati" }).uncheck();
await primaryLast(restrict.locator(".cta-row"), "Mandate restriction");
// Before it takes effect the form says which work stops (C06): here nothing runs, so nothing stops.
await restrict.getByText(/si ferma subito; il resto continua\. Nessun lavoro in corso si ferma\./).waitFor();
await lookShots("26b-mandate-restrict");
await restrict.getByRole("button", { name: "Restringi il mandato" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
const restriction = await page.getByTestId("mandate-restriction").innerText();
if (!restriction.includes("integrare candidati verificati") || /[–—]/.test(restriction)) throw new Error(`Restriction: ${restriction}`);
await page.getByText(/Ho ristretto il mandato/).first().waitFor({ timeout: 20_000 });
await page.getByText(/Nessun lavoro in corso era fuori dal mandato ristretto/).first().waitFor({ timeout: 20_000 });
await lookShots("26c-mandate-restricted");
// The correction form starts from the restricted version: saving it never brings back what the restriction took away.
await page.getByRole("button", { name: "Correggi", exact: true }).click();
if (await page.getByTestId("side-bar").getByRole("checkbox", { name: "Integrare candidati verificati" }).isChecked()) {
  throw new Error("The correction form brings back an action the restriction removed");
}
await page.getByTestId("side-bar").getByRole("button", { name: "Annulla", exact: true }).click();
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// A force push is refused whatever the mandate: the turn stops and the action waits in Aspetta te with its reason.
await page.getByLabel("Messaggio al Coordinatore").fill("[vietato:git push --force origin main]");
await page.keyboard.press("Enter");
// The refusal is not a card of the chat: the summary above the composer opens it in Aspetta te.
await page.getByTestId("waiting-summary").getByText("Azione vietata").waitFor({ timeout: 20_000 });
await page.getByTestId("waiting-summary").getByRole("button", { name: /aspett(a|ano) te$/ }).click();
const bannedItem = page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-waiting-kind="fixedBan"]');
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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


// Issue #42 (C10): the Coordinator reports on a ticket. A partial increment leaves the issue open, and Activity says what
// is missing in Italian, with the criteria by name; a GitHub write that fails is a step "non riuscito", never an update.
const ticketFile = join(await mkdtemp(join(tmpdir(), "trama-ui-ticket-gh-")), "ticket.json");
const ticketIssue = { number: 42, title: "Annullo degli ordini dal riepilogo", state: "open", body: "## Criteri\n\n- [ ] Il riepilogo mostra l'annullo\n- [ ] Le verifiche passano", comments: [], pulls: {} };
await writeFile(ticketFile, JSON.stringify(ticketIssue));
({ app, page } = await launch({ PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_TICKET: ticketFile }));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((project) => window.trama.invoke("project:open", { path: project }), await problemProject("ticket", "https://github.com/trama-ui/ticket.git"));
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-ticket" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.evaluate(() =>
  window.trama.invoke("mandate:grant", {
    requestId: null,
    objectives: ["Chiudere i ticket con le prove"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["openPullRequest", "integrateCandidate"],
    limits: [],
  }),
);
await page.getByText("Ho concesso il mandato (versione 1).").first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
const askTicket = async (text, reply) => {
  await composer().click({ timeout: 60_000 });
  await composer().pressSequentially(text);
  await page.keyboard.press("Enter");
  await page.getByText(reply).first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 30_000 });
};
// Opens the turn's steps in Activity from its line in the chat, with the ticket's steps unfolded.
const ticketSteps = async (reply) => {
  await page.getByTestId("work-line").getByRole("button", { name: /^Ha lavorato per/ }).last().click();
  const steps = page.getByTestId("side-bar").getByTestId("technical-step").filter({ hasText: /^Issue #42 «Annullo degli ordini dal riepilogo»/ });
  const step = steps.filter({ hasText: reply }).first();
  await step.waitFor({ timeout: 10_000 });
  if ((await step.locator("button + *").count()) === 0) await step.getByRole("button").click();
  return step;
};
await askTicket("[ticket] Aggiorna la issue 42", /Ho registrato l'avanzamento sulla issue #42/);
const partialStep = await ticketSteps("avanzamento registrato");
await partialStep.getByText("Resta aperta: manca «Il riepilogo mostra l'annullo»; manca «Le verifiche passano»; nessuna pull request di questo lavoro è stata unita.").waitFor();
if (/Criterion|pull request of this work|[–—]/.test(await partialStep.innerText())) throw new Error("The ticket step is not plain Italian");
let ticketState = JSON.parse(await readFile(ticketFile, "utf8"));
if (ticketState.state !== "open" || ticketState.comments.length !== 1 || ticketState.body !== ticketIssue.body) throw new Error("The partial report closed the issue or ticked a criterion");
await partialStep.scrollIntoViewIfNeeded();
await lookShots("30a-ticket-partial");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await writeFile(ticketFile, JSON.stringify({ ...ticketState, failComment: true }));
await askTicket("[ticket:errore] Aggiorna ancora la issue 42", /Non sono riuscito ad aggiornare la issue #42/);
const failedStep = await ticketSteps("aggiornamento non riuscito");
await failedStep.getByText("GitHub non ha risposto come atteso: il resoconto non è stato pubblicato, la issue resta aperta.").waitFor();
ticketState = JSON.parse(await readFile(ticketFile, "utf8"));
if (ticketState.state !== "open" || ticketState.comments.length !== 1) throw new Error("The failed report changed the issue");
await failedStep.scrollIntoViewIfNeeded();
await lookShots("30b-ticket-failed");
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
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// The page changes at each launch: the line is looked up again every time.
const checkWaitingLine = async (where) => {
  const waitingLine = page.locator('[data-testid="status-line"][data-provider-wait="true"]');
  await waitingLine.waitFor({ timeout: 30_000 });
  await waitingLine.getByTestId("status-line-text").getByText(/^Aspetto che la quota di ChatGPT si sblocchi/).waitFor();
  await waitingLine.getByTestId("status-line-reason").getByText("Fino ad allora non parte nessun turno. Poi riprendo da solo.").waitFor();
  // The Pause stays reachable while the Coordinator waits.
  await waitingLine.getByRole("button", { name: "Pausa del Coordinatore", exact: true }).waitFor();
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
const reopenedRow = page.getByTestId("side-bar").getByText("Turno ripreso alla riapertura", { exact: true }).last();
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
await page.locator('[data-testid="status-line"]').getByRole("button", { name: "Pausa del Coordinatore", exact: true }).click();
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

// Issue #40: the chat tells an overlap, a reproduced conflict and a semantic hypothesis apart. Each card names the
// project, the assignments, the base and the copies compared, with the time of the GitHub reading apart from the time
// of the AI analysis. A hypothesis stays an interpretation until the scenario on the combined candidate fails; only
// then it blocks the green light. Both themes.
const conflictsProject = await mkdtemp(join(tmpdir(), "trama-ui-conflitti-"));
await cp(resolve("resources/DemoProject"), conflictsProject, { recursive: true });
const conflictsGit = (...args) => execFileSync("git", ["-C", conflictsProject, ...args], { encoding: "utf8" });
conflictsGit("init", "-q", "-b", "main");
conflictsGit("add", ".");
conflictsGit("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
const conflictsBase = conflictsGit("rev-parse", "HEAD").trim();
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), conflictsProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
let conflictsPath = null;
for (const file of await readdir(join(dataDir, "Projects"))) {
  if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-conflitti-")) conflictsPath = join(dataDir, "Projects", file);
}
if (!conflictsPath) throw new Error("Conflicts: the project's state was not saved");
{
  const document = JSON.parse(await readFile(conflictsPath, "utf8"));
  const at = (hour, minute = 0) => `2026-09-28T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
  const work = (id, specialistId, objective, hour, branch, issueNumber) => ({
    id,
    specialistId,
    requestId: null,
    kind: "agreedTicket",
    objective,
    issueNumber,
    exercise: null,
    moduleIds: [],
    dependencies: [],
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    requiredChecks: ["node_test"],
    instructions: "",
    mandateVersion: 1,
    createdAt: at(hour),
    status: "completed",
    workspace: { sourceRoot: conflictsProject, worktreeRoot: join(conflictsProject, "..", `wt-${id}`), branch, baseSHA: conflictsBase },
    threadId: null,
    turns: [],
    stops: [],
    result: "Fatto.",
    failure: null,
    updatedAt: at(hour),
    lastUpdate: "",
    reportedStatus: "completed",
  });
  const cart = work("A-1C0A7E21", "S-ADA", "Sconto nel carrello", 9, "feature/sconto-carrello", 41);
  const orders = work("A-6B3F90D4", "S-ADA", "Totale degli ordini", 10, "feature/totale-ordini", 43);
  const rounding = work("A-94E2B7C8", "S-BEA", "Arrotondamento dei prezzi", 9, "feature/arrotondamento-prezzi", 44);
  const specialist = (id, name, color, assignments) => ({
    id,
    name,
    competence: "Next.js",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color,
    tag: "Next.js",
    createdAt: at(8),
    status: "available",
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    updatedAt: at(12),
    lastUpdate: "",
    removal: null,
    assignments,
  });
  document.team.specialists.push(specialist("S-ADA", "Ada", "blue", [cart, orders]), specialist("S-BEA", "Bea", "green", [rounding]));
  const candidate = (id, assignment, snapshotId, hour, changedFiles) => ({
    id,
    assignmentId: assignment.id,
    specialistId: assignment.specialistId,
    snapshotId,
    baseSHA: conflictsBase,
    diff: "",
    changedFiles,
    touchedModules: [],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["node_test"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: at(hour),
    updatedAt: at(hour),
    evidence: { node_test: { check: "node_test", result: "pass", command: "npm test", output: "", snapshotId, decisionVersions: {}, recordedAt: at(hour) } },
    technicalReview: null,
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  });
  const cartWork = candidate("C-3F1A9B20", cart, "5e2c8a17d09b4f6e", 10, ["src/lib/prezzi.ts", "src/app/carrello/page.tsx"]);
  const roundingWork = candidate("C-7D42C1E5", rounding, "a81f3c90b27d4e55", 11, ["src/lib/prezzi.ts"]);
  const ordersWork = candidate("C-51B0E7A3", orders, "c4d9e012f7a35b68", 12, ["src/lib/ordini.ts"]);
  document.candidates.push(cartWork, roundingWork, ordersWork);
  const pullSHA = "8e1d4c7b2a9f0e3d6c5b4a39281706f5e4d3c2b1";
  document.conflicts = [
    {
      id: `${roundingWork.snapshotId}:worktree:${cartWork.snapshotId}`,
      candidateId: roundingWork.id,
      snapshotId: roundingWork.snapshotId,
      remoteSHA: "0b7e5d3c1a2f4e6d8c9b0a1f2e3d4c5b6a7f8e9d",
      references: [cartWork.id],
      otherCandidateId: cartWork.id,
      otherSnapshotId: cartWork.snapshotId,
      classification: "overlap",
      conflictingFiles: ["src/lib/prezzi.ts"],
      detail: "Nessun conflitto testuale tra le due copie di lavoro, ma entrambe cambiano src/lib/prezzi.ts.",
      checkedAt: at(11, 2),
    },
    {
      id: `${cartWork.snapshotId}:${pullSHA}`,
      candidateId: cartWork.id,
      snapshotId: cartWork.snapshotId,
      remoteSHA: pullSHA,
      references: ["#42 feature/coupon-checkout"],
      classification: "conflict",
      conflictingFiles: ["src/app/carrello/page.tsx"],
      conflictingLines: { "src/app/carrello/page.tsx": [{ start: 14, end: 18 }] },
      detail: "La fusione temporanea produce conflitti testuali.",
      checkedAt: at(10, 6),
      remoteReadAt: at(10, 5),
    },
  ];
  document.conflicts.push(
    {
      id: `${ordersWork.snapshotId}:semantic:${cartWork.snapshotId}`,
      candidateId: ordersWork.id,
      snapshotId: ordersWork.snapshotId,
      remoteSHA: conflictsBase,
      references: [cartWork.id],
      otherCandidateId: cartWork.id,
      otherSnapshotId: cartWork.snapshotId,
      classification: "hypothesis",
      conflictingFiles: [],
      detail: "Lo scenario sul candidato combinato passa: l'incompatibilità resta un'ipotesi.",
      checkedAt: at(12, 20),
      semantic: {
        explanation: "Il totale degli ordini somma i prezzi prima dello sconto del carrello: il totale potrebbe non coincidere con quello pagato.",
        analyzedAt: at(12, 10),
        check: "node_test",
        scenario: { result: "pass", command: "npm test", output: "", ranAt: at(12, 20) },
      },
    },
    {
      id: `${ordersWork.snapshotId}:semantic:${roundingWork.snapshotId}`,
      candidateId: ordersWork.id,
      snapshotId: ordersWork.snapshotId,
      remoteSHA: conflictsBase,
      references: [roundingWork.id],
      otherCandidateId: roundingWork.id,
      otherSnapshotId: roundingWork.snapshotId,
      classification: "semantic",
      conflictingFiles: [],
      detail: "Ognuno passa da solo, ma sul candidato combinato test Node fallisce: le due modifiche sono incompatibili.",
      checkedAt: at(12, 25),
      semantic: {
        explanation: "Bea arrotonda i prezzi unitari, Ada arrotonda il totale: insieme il totale può perdere un centesimo.",
        analyzedAt: at(12, 12),
        check: "node_test",
        scenario: { result: "fail", command: "npm test", output: "FAIL ordini.test.ts > totale con tre righe\nexpected 30.00, received 29.99", ranAt: at(12, 25) },
      },
    },
  );
  let sequence = Math.max(0, ...document.events.map((e) => e.sequence));
  const card = (kind, referenceId, minute) => ({ id: `E-c08-${++sequence}`, sequence, origin: "trama", requestId: null, createdAt: at(12, minute), content: { type: "card", kind, title: kind, detail: null, referenceId } });
  document.events.push(...document.conflicts.map((a, index) => card("conflict", a.id, 30 + index)), card("candidate", ordersWork.id, 40));
  await writeFile(conflictsPath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), conflictsProject);
await page.locator(".chat-card").filter({ hasText: "Pull request aperta" }).first().waitFor({ timeout: 30_000 });
const conflictShots = ["overlap", "conflict", "hypothesis", "semantic"];
for (const kind of conflictShots) {
  const one = page.locator(`[data-testid="conflict-card"][data-classification="${kind}"]`);
  if ((await one.count()) !== 1) throw new Error(`Conflicts: ${await one.count()} cards for ${kind}`);
  const text = await one.innerText();
  if (/[–—]|[A-Z]-[0-9A-F]{8}/.test(text)) throw new Error(`Conflicts: a dash or an id in the ${kind} card: ${text}`);
  for (const wanted of ["Progetto trama-ui-conflitti-", "Ada, ", "base ", "copi"]) {
    if (!text.includes(wanted)) throw new Error(`Conflicts: the ${kind} card does not say ${wanted}: ${text}`);
  }
}
{
  const pullCard = await page.locator('[data-testid="conflict-card"][data-classification="conflict"]').innerText();
  if (!pullCard.includes("GitHub letto alle") || !pullCard.includes("prova di fusione alle")) throw new Error(`Conflicts: the GitHub card mixes its times: ${pullCard}`);
  const hypothesis = await page.locator('[data-testid="conflict-card"][data-classification="hypothesis"]').innerText();
  if (!hypothesis.includes("analisi AI alle") || !hypothesis.includes("non ancora una prova")) throw new Error(`Conflicts: the hypothesis is not an interpretation: ${hypothesis}`);
  const semantic = page.locator('[data-testid="conflict-card"][data-classification="semantic"]');
  await semantic.locator('[data-testid="semantic-scenario"][data-result="fail"]').waitFor();
  if (!(await semantic.innerText()).includes("Incompatibili") && !(await page.locator(".chat-card", { has: semantic }).innerText()).includes("Incompatibili")) {
    throw new Error("Conflicts: the proved case is not marked incompatible");
  }
}
for (const kind of conflictShots) {
  const one = page.locator(`[data-testid="conflict-card"][data-classification="${kind}"]`);
  await one.evaluate((element) => element.scrollIntoView({ block: "center" }));
  for (const dark of [false, true]) {
    await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
    await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
    await shot(`29-conflicts-${kind}-${dark ? "dark" : "light"}`);
  }
}
// The proved case blocks the green light of the newer candidate; the hypothesis next to it does not.
const blockedCandidate = page.locator('[data-testid="candidate-blockers"]').filter({ hasText: "Incompatibile con un altro lavoro" });
await blockedCandidate.waitFor({ timeout: 10_000 });
if ((await blockedCandidate.locator("li").filter({ hasText: "Incompatibile" }).count()) !== 1) throw new Error("Conflicts: the hypothesis blocks the green light too");
await blockedCandidate.evaluate((element) => element.scrollIntoView({ block: "center" }));
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`29-conflicts-blocked-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #260 (A19): a developer's slice in a Claude Code cloud session, with the place of work the person chooses. The
// project's setting sits in the settings; the assignment card says where the work runs, who chose it and why, the step
// that enables the cloud when it cannot be used, and the session's link and state. The sessions are a declared fixture:
// their state is written in the project's document and no real session opens. Light and dark.
const cloudProject = await mkdtemp(join(tmpdir(), "trama-ui-cloud-"));
await cp(resolve("resources/DemoProject"), cloudProject, { recursive: true });
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), cloudProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
let cloudPath = null;
for (const file of await readdir(join(dataDir, "Projects"))) {
  if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-cloud-")) cloudPath = join(dataDir, "Projects", file);
}
if (!cloudPath) throw new Error("Cloud sessions: the project's state was not saved");
{
  const document = JSON.parse(await readFile(cloudPath, "utf8"));
  const start = Date.now();
  const at = (minute) => new Date(start + minute * 60_000).toISOString();
  const session = (overrides) => ({
    provider: "claudeAgent",
    url: "https://claude.ai/code/session_01ui",
    branch: "feature/issue-21-carrello-trama-0c1a2b3c",
    baseBranch: "main",
    status: "working",
    pullRequest: null,
    startedAt: at(2),
    checkedAt: at(3),
    failure: null,
    instructions: [{ text: "Lavora sul branch, esegui i controlli di pubblicazione prima del push e apri la pull request in bozza verso main.", at: at(2) }],
    macChecks: null,
    ...overrides,
  });
  const work = (id, specialistId, objective, extra) => ({
    id,
    specialistId,
    requestId: null,
    kind: "agreedTicket",
    objective,
    issueNumber: null,
    exercise: null,
    moduleIds: [],
    dependencies: [],
    model: "claude-sonnet-5",
    provider: "claudeAgent",
    modelReason: "Fetta di codice di media difficoltà.",
    tools: ["commands", "edits"],
    requiredChecks: ["git_status"],
    instructions: "",
    mandateVersion: 1,
    createdAt: at(1),
    workspace: null,
    threadId: null,
    stops: [],
    failure: null,
    updatedAt: at(3),
    reportedStatus: null,
    ...extra,
  });
  const cloudReason = "È una fetta di codice senza prove dal vivo: in cloud libera il Mac e continua anche con Trama chiusa.";
  const working = work("A-C10D0001", "S-ADA", "Il carrello ricorda i prodotti tra due visite", {
    status: "running",
    turns: [{ id: "cloud-1", number: 1, model: "claude-sonnet-5", provider: "claudeAgent", startedAt: at(2), endedAt: null, outcome: null }],
    result: null,
    lastUpdate: "Al lavoro in una sessione cloud sul branch feature/issue-21-carrello-trama-0c1a2b3c",
    place: { where: "cloud", chosenBy: "coordinator", reason: cloudReason, cloudBlocked: null, at: at(2) },
    cloud: session({}),
  });
  const returned = work("A-C10D0002", "S-BRUNO", "Il prezzo scontato si vede nella scheda", {
    status: "completed",
    turns: [{ id: "cloud-2", number: 1, model: "claude-sonnet-5", provider: "claudeAgent", startedAt: at(1), endedAt: at(3), outcome: "completed" }],
    result: "La sessione cloud ha aperto la pull request in bozza #34.",
    lastUpdate: "Incarico concluso",
    workspace: { sourceRoot: cloudProject, worktreeRoot: join(cloudProject, "..", "wt-cloud-2"), branch: "feature/issue-22-prezzo-scontato-trama-5d6e7f80", baseSHA: "0".repeat(40) },
    place: { where: "cloud", chosenBy: "setting", reason: "Il progetto usa il cloud quando possibile.", cloudBlocked: null, at: at(1) },
    cloud: session({
      url: "https://claude.ai/code/session_02ui",
      branch: "feature/issue-22-prezzo-scontato-trama-5d6e7f80",
      status: "returned",
      pullRequest: { number: 34, url: "https://github.com/acme/negozio/pull/34", draft: true },
      macChecks: { snapshotId: "snap-cloud-2", problems: [], at: at(3) },
    }),
  });
  const local = work("A-C10D0003", "S-CARLA", "La pagina dell'ordine mostra lo stato della spedizione", {
    status: "stopped",
    turns: [],
    result: null,
    lastUpdate: "Fermato: la persona ha fermato il lavoro",
    place: {
      where: "local",
      chosenBy: "coordinator",
      reason: "Il cloud non si può usare ora, quindi lavora in locale. Il progetto non è su GitHub, e la sessione cloud parte dal repository su GitHub.",
      cloudBlocked: {
        reason: "Il progetto non è su GitHub, e la sessione cloud parte dal repository su GitHub.",
        enable: "Pubblica il progetto su GitHub con il remoto origin, poi riprendi l'incarico.",
      },
      at: at(1),
    },
  });
  const developer = (id, name, color, assignment) => ({
    id,
    name,
    competence: "Next.js",
    reason: "",
    moduleIds: [],
    role: "developer",
    origin: "teamProposal",
    color,
    tag: "Next.js",
    createdAt: at(0),
    status: assignment.status === "running" ? "working" : "available",
    model: "claude-sonnet-5",
    tools: ["commands", "edits"],
    updatedAt: at(3),
    lastUpdate: "",
    removal: null,
    assignments: [assignment],
  });
  document.team.specialists.push(developer("S-ADA", "Ada", "blue", working), developer("S-BRUNO", "Bruno", "green", returned), developer("S-CARLA", "Carla", "orange", local));
  document.settings = { ...(document.settings ?? {}), workPlace: "cloud" };
  let sequence = Math.max(0, ...document.events.map((e) => e.sequence));
  const card = (minute, referenceId) => ({ id: `E-cloud-${++sequence}`, sequence, origin: "trama", requestId: null, createdAt: at(minute), content: { type: "card", kind: "assignment", title: "assignment", detail: null, referenceId } });
  document.events.push(card(1, local.id), card(2, working.id), card(3, returned.id));
  await writeFile(cloudPath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), cloudProject);
const cloudCard = (name) => page.locator('.chat-card:not([data-testid="settled-card"] .chat-card), [data-testid="settled-card"]').filter({ hasText: /^Incarico / }).filter({ hasText: name }).last();
// Trama closing and reopening does not stop a running cloud session (Q28): Ada's work is still at work.
for (const [name, testid, file] of [
  ["Ada", '[data-testid="cloud-session"][data-status="working"]', "31b-cloud-session-working"],
  ["Bruno", '[data-testid="cloud-mac-checks"][data-passed="yes"]', "31c-cloud-session-returned"],
  ["Carla", '[data-testid="assignment-place-enable"]', "31d-cloud-blocked-local"],
]) {
  const found = cloudCard(name);
  await waitInCard(found, (card) => card.locator(testid), `${name}: ${testid}`, 30_000);
  // The card from its top, so its buttons stay above the composer.
  await found.evaluate((card) => card.scrollIntoView({ block: "start" }));
  for (const dark of [false, true]) {
    await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
    await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
    await shot(`${file}-${dark ? "dark" : "light"}`);
  }
}
if (!(await cloudCard("Ada").getByRole("button", { name: "Controlla la sessione" }).isVisible())) throw new Error("Cloud sessions: a running session has no check");
if (!(await cloudCard("Carla").getByRole("button", { name: "Sposta in cloud" }).isVisible())) throw new Error("Cloud sessions: stopped local work cannot move to the cloud");
const cloudState = await page.evaluate(async () => (await window.trama.getState()).project.document.team.specialists.find((s) => s.name === "Ada").assignments[0]);
if (cloudState.status !== "running" || cloudState.cloud.status !== "working") throw new Error(`Cloud sessions: reopening stopped the cloud work: ${cloudState.status}`);
// The person moves Carla's work to the cloud for its next resume: the card says so.
await cloudCard("Carla").getByRole("button", { name: "Sposta in cloud" }).click();
await cloudCard("Carla").getByText("Alla prossima ripresa lavora in cloud, come hai scelto.").waitFor();
await cloudCard("Carla").getByRole("button", { name: "Sposta in locale" }).waitFor();
// The project's setting: three values, the person's choice kept.
await page.getByRole("button", { name: "Impostazioni" }).click();
const cloudSettings = page.getByTestId("settings");
await cloudSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
const workPlace = cloudSettings.getByTestId("work-place");
await workPlace.getByRole("radio", { name: "Cloud quando possibile", checked: true }).waitFor();
await workPlace.getByRole("radio", { name: "Automatico" }).click();
await workPlace.getByRole("radio", { name: "Automatico", checked: true }).waitFor();
await workPlace.scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`31a-work-place-setting-${dark ? "dark" : "light"}`);
}
const savedSetting = await page.evaluate(async () => (await window.trama.getState()).project.document.settings.workPlace);
if (savedSetting !== "automatic") throw new Error(`Cloud sessions: the setting was not saved: ${savedSetting}`);
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #247: with the Coordinator's green light and the gate passed, Trama publishes and merges a candidate by itself,
// and Activity says so. A candidate that changes the interface waits in Aspetta te with the screenshots before and
// after, in light and dark, from the project's screenshots script; a refusal with a reason goes back to the developer,
// and the person's ok merges the corrected one. The fake gh opens and merges the pull requests; pushes reach a local
// bare repository.
const vetrinaGhLog = join(await mkdtemp(join(tmpdir(), "trama-ui-vetrina-gh-")), "gh.log");
const vetrina = await mkdtemp(join(tmpdir(), "trama-ui-vetrina-"));
await cp(resolve("resources/DemoProject"), vetrina, { recursive: true });
await mkdir(join(vetrina, "web"));
await writeFile(join(vetrina, "web/index.css"), ":root { --accent: #336699; }\n");
await writeFile(join(vetrina, "package.json"), JSON.stringify({ name: "vetrina", private: true, scripts: { screenshots: `node ${resolve("test-fixtures/fake-screenshots.mjs")}` } }));
const vetrinaRemote = await mkdtemp(join(tmpdir(), "trama-ui-vetrina-remote-"));
execFileSync("git", ["init", "-q", "--bare", "-b", "main", vetrinaRemote]);
const inVetrina = (...args) => execFileSync("git", ["-C", vetrina, ...args], { stdio: "ignore" });
inVetrina("init", "-q", "-b", "main");
inVetrina("config", "user.name", "Trama UI");
inVetrina("config", "user.email", "ui@trama.local");
inVetrina("add", ".");
inVetrina("commit", "-q", "-m", "Vetrina");
inVetrina("remote", "add", "origin", "https://github.com/trama-ui/vetrina.git");
inVetrina("config", "remote.origin.pushurl", vetrinaRemote);
({ app, page } = await launch({ PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_PULLS: "1", FAKE_GH_LOG: vetrinaGhLog, TRAMA_MERGE_CHECKS_MS: "500" }));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), vetrina);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-vetrina" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
const stateUntil = async (check, what, timeout = 60_000) => {
  const start = Date.now();
  for (;;) {
    const state = await page.evaluate(() => window.trama.getState());
    const value = state.project ? check(state.project.document, state.project) : null;
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`${what}: timeout`);
    await page.waitForTimeout(250);
  }
};
await stateUntil((_, project) => project.github.repository === "trama-ui/vetrina", "GitHub remote");
await page.evaluate(() => window.trama.invoke("pact:decide", { id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "Evita rimborsi errati" }));
const vetrinaDecision = await stateUntil((document) => document.decisions[0]?.id, "Decision");
await page.evaluate(() =>
  window.trama.invoke("mandate:grant", {
    requestId: null,
    objectives: ["Rinnovare la vetrina"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders"],
    authorizedActions: ["executeInWorktree", "openPullRequest", "integrateCandidate"],
    limits: [],
  }),
);
await page.getByText("Ho concesso il mandato (versione 1).").first().waitFor({ timeout: 20_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
// Typed, not filled: a draft filled right after the grant does not reach the composer's state and is not sent.
await composer().click({ timeout: 60_000 });
await composer().pressSequentially("[proponi-team]");
await page.keyboard.press("Enter");
await page.getByText("[proponi-team]", { exact: true }).first().waitFor({ timeout: 20_000 });
await (await openWaiting("team")).getByRole("button", { name: "Conferma il team" }).click({ timeout: 20_000 });
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
if (await page.getByRole("button", { name: "Chiudi la barra laterale" }).count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
const adaWork = (document) => document.team.specialists.find((s) => s.name === "Ada")?.assignments.at(-1);
const workDone = async (before) => {
  await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
  return stateUntil((document) => {
    const work = adaWork(document);
    return work && work.id !== before && work.status === "completed" ? work.id : null;
  }, "Ada's work");
};
const candidateOfWork = (document, assignmentId) => document.candidates.filter((c) => c.assignmentId === assignmentId).at(-1);

// No interface change: merged by Trama on the green light, told in Activity.
await send("[assegna]");
const plainWork = await workDone(null);
await send(`[candidato:${plainWork}:${vetrinaDecision}]`);
await stateUntil((document) => candidateOfWork(document, plainWork)?.pullRequest?.mergedAt, "Merge with the green light");
const mergeCalls = (await readFile(vetrinaGhLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
if (!mergeCalls.some((call) => call.includes("PUT") && call.some((arg) => /\/pulls\/21\/merge$/.test(arg)))) throw new Error("Trama did not merge the pull request");
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await page.getByTestId("status-line").getByRole("button", { name: "Attività" }).click();
const mergedEntry = page.getByTestId("activity-log").locator('[data-testid="activity-merge"][data-outcome="done"]').filter({ hasText: "Candidato unito con il via libera del Coordinatore" });
await mergedEntry.waitFor({ timeout: 20_000 });
await mergedEntry.getByRole("button", { name: "Apri la pull request" }).waitFor();
if (/[–—]/.test(await mergedEntry.innerText())) throw new Error("A dash in the merge entry");
await themeShots("30a-merge-activity");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();

// An interface change waits for the person with the screenshots before and after, in light and dark.
await send("[assegna] [interfaccia]");
const styledWork = await workDone(plainWork);
await send(`[candidato:${styledWork}:${vetrinaDecision}]`);
const styledItem = await openWaiting("candidate", undefined, 60_000);
if (!(await styledItem.innerText()).includes("Interfaccia da guardare")) throw new Error("The interface candidate does not say it changes the interface");
await styledItem.locator('[data-testid="interface-shots"][data-status="ready"]').waitFor({ timeout: 60_000 });
const styledShots = styledItem.locator('[data-testid="interface-shot"] img');
await styledShots.nth(3).waitFor({ timeout: 20_000 });
if ((await styledShots.count()) !== 4) throw new Error(`Expected four screenshots, found ${await styledShots.count()}`);
await styledItem.getByText("web/index.css").first().waitFor();
const styledActions = styledItem.locator(".cta-row").filter({ has: page.getByRole("button", { name: "Approva e unisci" }) });
await primaryLast(styledActions, "Interface candidate");
if (await styledItem.getByRole("button", { name: "Approva questo candidato" }).count()) throw new Error("The interface candidate offers the plain approval");
if (/[–—]/.test(await styledItem.innerText())) throw new Error("A dash in the interface candidate");
await styledItem.locator('[data-testid="interface-shots"]').evaluate((node) => node.scrollIntoView({ block: "center" }));
await themeShots("30b-interface-candidate-waiting");
await page.setViewportSize({ width: 900, height: 820 });
await styledItem.locator('[data-testid="interface-shots"]').evaluate((node) => node.scrollIntoView({ block: "center" }));
await themeShots("30b2-interface-candidate-narrow");
await page.setViewportSize({ width: 1280, height: 820 });

// The person refuses it with a reason: it leaves Aspetta te and the reason reaches the developer.
await styledItem.getByRole("button", { name: "Rifiuta", exact: true }).click();
await styledItem.getByLabel("Motivo del rifiuto del candidato").fill("Il rosso del pulsante Paga è troppo acceso in scuro");
await primaryLast(styledItem.locator(".cta-row").filter({ has: page.getByRole("button", { name: "Rifiuta il candidato" }) }), "Refusal");
await themeShots("30c-interface-candidate-refusing");
await styledItem.getByRole("button", { name: "Rifiuta il candidato" }).click();
await styledItem.waitFor({ state: "detached", timeout: 20_000 });
await stateUntil((document) => (adaWork(document)?.gateReturn?.findings ?? []).some((f) => f.includes("troppo acceso in scuro")), "Refusal back to the developer");
await workDone(null);
if (await page.getByRole("button", { name: "Chiudi la barra laterale" }).count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// The refused candidate is one line of the chat with the reason; the line opens the whole card.
const refusedLine = page.getByTestId("settled-card").filter({ hasText: "Rifiutato da te" }).filter({ hasText: "troppo acceso in scuro" }).last();
await refusedLine.waitFor({ timeout: 20_000 });
await refusedLine.evaluate((node) => node.scrollIntoView({ block: "center" }));
await themeShots("30d-interface-candidate-refused");

// The corrected candidate: the person's ok merges it.
await send("[assegna] [interfaccia]");
const correctedWork = await workDone(styledWork);
await send(`[candidato:${correctedWork}:${vetrinaDecision}]`);
const correctedItem = await openWaiting("candidate", undefined, 60_000);
await correctedItem.locator('[data-testid="interface-shots"][data-status="ready"]').waitFor({ timeout: 60_000 });
await correctedItem.getByRole("button", { name: "Approva e unisci" }).click();
await stateUntil((document) => candidateOfWork(document, correctedWork)?.pullRequest?.mergedBy === "person", "Merge on the person's ok");
await correctedItem.waitFor({ state: "detached", timeout: 20_000 });
if (await page.getByRole("button", { name: "Chiudi la barra laterale" }).count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.getByTestId("status-line").getByRole("button", { name: "Attività" }).click();
await page.getByTestId("activity-log").locator('[data-testid="activity-merge"]').filter({ hasText: "Candidato unito con il tuo ok" }).waitFor({ timeout: 20_000 });
await themeShots("30e-merge-activity-person");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #39: the projects share the developers. The overview says how many work in all projects and keeps the
// Product Owner's order of the projects: the arrows move a project, opening another one leaves the order as it is.
({ app, page } = await launch());
await page.getByTestId("dialog-title").first().waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
const priority = page.getByTestId("overview-priority");
await priority.waitFor({ timeout: 10_000 });
await priority.getByTestId("shared-capacity").filter({ hasText: /Sviluppatori al lavoro in tutti i progetti: \d+ su 6/ }).waitFor();
const priorityNames = () => priority.getByTestId("overview-priority-row").locator("span.truncate").allInnerTexts();
const before39 = await priorityNames();
if (before39.length < 2) throw new Error("The overview ranks fewer than two projects");
await priority.getByRole("button", { name: `Sposta ${before39[1]} più in alto` }).click();
await page.waitForFunction(
  ([first]) => document.querySelector('[data-testid="overview-priority-row"] span.truncate')?.textContent === first,
  [before39[1]],
  { timeout: 10_000 },
);
const moved39 = await priorityNames();
if (moved39[0] !== before39[1] || moved39[1] !== before39[0]) throw new Error(`The project did not move up: ${moved39.join(", ")}`);
await priority.scrollIntoViewIfNeeded();
await themeShots("39a-overview-priority");
// Opening a project from the overview does not rank it.
await page.getByTestId("overview-project").filter({ hasText: before39[0] }).getByRole("button", { name: before39[0], exact: true }).click();
await page.getByTestId("overview").waitFor({ state: "detached", timeout: 30_000 });
await page.waitForTimeout(1_500);
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await priority.waitFor();
let reopened39 = await priorityNames();
for (const end = Date.now() + 10_000; reopened39.join("|") !== moved39.join("|") && Date.now() < end; reopened39 = await priorityNames()) await page.waitForTimeout(250);
if (reopened39.join("|") !== moved39.join("|")) throw new Error(`Opening a project changed the order of the projects: ${moved39.join(", ")} became ${reopened39.join(", ")}`);
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
// The shared limit sits next to the project's own limit in the settings.
await page.getByRole("button", { name: "Impostazioni" }).click();
const sharedSettings = page.getByTestId("settings");
await sharedSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
const sharedPicker = sharedSettings.getByTestId("shared-developers");
await sharedPicker.getByRole("radio", { name: "6", checked: true }).waitFor();
await sharedPicker.getByRole("radio", { name: "4" }).click();
await sharedPicker.getByRole("radio", { name: "4", checked: true }).waitFor();
await sharedPicker.scrollIntoViewIfNeeded();
await noHorizontalScroll("shared developers");
await themeShots("39b-shared-developers");
await app.close();
