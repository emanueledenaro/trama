// Launches the built app with the fake Codex server and saves screenshots of the main screens.
// Usage: node scripts/ui-check.mjs <output-dir>
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { addCoordinatorMove, addWorkView } from "./work-view-fixture.mjs";

const out = resolve(process.argv[2] ?? "ui-check");
const dataDir = await mkdtemp(join(tmpdir(), "trama-ui-"));
// Issue #461: while this file exists, the fake Codex server replies to an unscripted turn with a plain, complete
// sentence instead of its usual test-only echo, so the four README screenshots read like a real conversation. Only
// the sections that produce those screenshots create it. Its own randomly named directory keeps the path from being
// guessed or raced by another local process, the same way dataDir does above.
const readmeShotsFlag = join(await mkdtemp(join(tmpdir(), "trama-ui-readme-shots-")), "flag");
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
      FAKE_CODEX_README_SHOTS: readmeShotsFlag,
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
// Chromium under xvfb now and then fails a capture with this protocol error even on a shown, painted window. For that
// exact error only the capture is retried up to 3 times, 250ms apart; any other error, or a fourth failure, throws.
const UNCAPTURED = "Protocol error (Page.captureScreenshot): Unable to capture screenshot";
const capture = async (options) => {
  for (let retry = 0; ; retry++) {
    try {
      return await page.screenshot(options);
    } catch (error) {
      if (retry >= 3 || !String(error?.message).includes(UNCAPTURED)) throw error;
      console.log(`[capture] ${UNCAPTURED}, retry ${retry + 1} of 3`);
      await page.waitForTimeout(250);
    }
  }
};
// Every screenshot has its own name: a second one with the same name would overwrite the first without a word.
const shotNames = new Set();
// Issue #338: the buttons of a screen. Filled buttons ("default" variant, the send arrow is "prominent" and does not
// count) and buttons a screen reader cannot name: no aria-label, no text, no title.
const buttonAudit = () =>
  page.evaluate(() => {
    // Shown means on top at its center: a button scrolled out of its panel or covered by a popup does not count.
    const shown = (node) => {
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return false;
      if (node.closest('[inert], [aria-hidden="true"]')) return false;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const top = document.elementFromPoint(x, y);
      // A disabled button lets the pointer through to what holds it.
      return Boolean(top && (node.contains(top) || (node.disabled && top.contains(node))));
    };
    const nameOf = (node) =>
      (
        node.getAttribute("aria-label") ||
        (node.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : ""))
          .join(" ") ||
        node.textContent ||
        node.getAttribute("title") ||
        ""
      ).trim();
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(shown);
    return {
      // A primary drawn as an outline, where the window's one filled button is elsewhere, is not filled.
      filled: buttons.filter((node) => node.dataset.variant === "default" && node.dataset.filled !== "false").map((node) => nameOf(node)),
      nameless: buttons.filter((node) => !nameOf(node)).map((node) => node.outerHTML.slice(0, 200)),
    };
  });
// What every screenshot showed, written next to the screenshots for the review of the button rule.
const buttonScreens = {};
const shot = async (name) => {
  if (shotNames.has(name)) throw new Error(`Two screenshots named ${name}`);
  shotNames.add(name);
  await page.waitForTimeout(400);
  await capture({ path: join(out, `${name}.png`) });
  // Issue #338: in every screenshot at most one filled button besides the send arrow, and no button without a name.
  const audit = await buttonAudit();
  buttonScreens[name] = audit;
  await writeFile(join(out, "button-audit.json"), `${JSON.stringify(buttonScreens, null, 2)}\n`);
  if (audit.nameless.length) throw new Error(`A button without a name in ${name}: ${audit.nameless[0]}`);
  if (audit.filled.length > 1) throw new Error(`More than one filled button in ${name}: ${audit.filled.join(", ")}`);
  console.log("saved", name);
};
// Issue #330: the window is laid out as VS Code. The activity bar picks a view, the side bar shows it; until the slices
// B02-B08 build the new views, the panels of today are the view's tabs. Opening a view from the activity bar shows
// its first tab, as a click on the panel's row in the old sidebar showed that panel.
const activityBar = () => page.getByRole("navigation", { name: "Viste" });
// A menu that is closing keeps its items on screen until its exit animation ends: opening another one meanwhile showed
// two "Rinomina" items (issue #460). A menu opens once the previous one is gone, and its items are looked for inside
// the one open menu. `page` changes at every launch, so the locator is built on each call.
const openMenus = () => page.getByRole("menu");
// Design of 30 September: the parts of a form or card are 16 px apart, on the 8 px grid.
const partGaps = (box) => box.evaluate((el) => [...el.children].slice(1).map((child, i) => Math.round(child.getBoundingClientRect().top - el.children[i].getBoundingClientRect().bottom)));
const expectGaps = async (name, box) => {
  const gaps = await partGaps(box);
  if (!gaps.length || gaps.some((gap) => gap < 16)) throw new Error(`${name}: the parts are not 16 px apart: ${gaps}`);
};
// The check rows of a form are at least 32 px tall, so they are easy to hit.
const expectRowsTall = async (name, rows) => {
  const heights = await rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  if (!heights.length || heights.some((height) => height < 32)) throw new Error(`${name}: a row is under 32 px: ${heights}`);
};
const openMenu = async (trigger) => {
  await openMenus().first().waitFor({ state: "hidden" });
  await trigger.click();
  await openMenus().waitFor();
  return openMenus();
};
// Issue #354: the Benvenuto reopens from the menu of the project's name (and from the Help menu).
const openWelcomeFromProjectMenu = async () => {
  const menu = await openMenu(page.getByTestId("title-bar").getByRole("button", { name: /^Progetto .*: cambia progetto$/ }));
  await menu.getByRole("menuitem", { name: "Benvenuto", exact: true }).click();
  await page.getByTestId("welcome").waitFor();
};
const VIEWS = { Progetti: "projects", "Aspetta te": "waiting", Lavoro: "work", Squadre: "teams", Regole: "rules", Memoria: "memory" };
const openView = async (view, tab) => {
  const sideBar = page.getByTestId("side-bar");
  if ((await sideBar.count()) && (await sideBar.getAttribute("data-view")) === VIEWS[view]) {
    await activityBar().getByRole("button", { name: view, exact: true }).click();
    await sideBar.waitFor({ state: "detached" });
  }
  await activityBar().getByRole("button", { name: view, exact: true }).click();
  await page.locator(`[data-testid="side-bar"][data-view="${VIEWS[view]}"]`).waitFor();
  // A tab may carry its count after the name, as Patto (issue #334).
  if (tab) await sideBar.getByRole("tab", { name: new RegExp(`^${tab}(\\s|$)`) }).click();
};
// Issue #334: Regole opens on Mandato, whose modules, changes and earlier versions are closed sections.
const openSection = async (name) => {
  const button = page.getByTestId("side-bar").getByRole("button", { name: new RegExp(`^(${name})`) }).first();
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
};
// The map of today is the Moduli section of Mandato.
const openModules = async () => {
  await openView("Regole", "Mandato");
  await openSection("Moduli");
  await page.getByRole("listbox", { name: "Moduli" }).waitFor();
};
// Restringi, Correggi, Revoca (or Scrivi without a mandate) sit in "Cambia il mandato", closed by default.
const changeMandate = async (action) => {
  await openView("Regole", "Mandato");
  await openSection("Cambia il mandato|Concedi un mandato");
  await page.getByTestId("mandate-change").getByRole("button", { name: action, exact: true }).click();
};
// The overview opens from the Projects view (issue #330); the view opens first when the side bar shows another one.
const overviewButton = async () => {
  if (!(await page.getByRole("button", { name: "Panoramica dei progetti" }).count())) await openView("Progetti");
  return page.getByRole("button", { name: "Panoramica dei progetti" });
};
// Issue #333: the shared roles of the Squads view wait in a closed section; the checks that read them open it first.
const openSharedRoles = async () => {
  const toggle = page.getByTestId("side-bar").getByTestId("shared-roles-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByTestId("side-bar").getByTestId("shared-roles").waitFor();
};
// The application menu (issue #345): an item by its id, clicked as the person would; and the label of an item.
const clickMenu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
const menuLabel = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId)?.label ?? null, id);
const menuLabelBecomes = async (id, label, timeout = 5_000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(100)) if ((await menuLabel(id)) === label) return;
  throw new Error(`The menu item ${id} is "${await menuLabel(id)}", not "${label}"`);
};
// The work in focus and the queue open from the bar above the composer while the conversation shows (UI wave of 29
// September), from the status bar over Progetti and Impostazioni (issue #330).
const openFocusPanel = async (timeout = 20_000) => {
  if (!(await page.getByTestId("focus-bar").count())) await page.getByTestId("work-bar-focus").or(page.getByTestId("status-focus")).first().click({ timeout });
  await page.getByTestId("focus-bar").waitFor();
};
// Issue #336: a detail (a person of the team, a candidate, a decision, a module, an issue, a goal) opens in a tab of
// the editor next to the conversation, not in the side bar. In a narrow window the tab covers the conversation.
const detailPane = () => page.getByTestId("editor-detail");
const closeDetail = async () => {
  const key = await page.getByTestId("editor-area").getAttribute("data-active-detail");
  if (!key) return;
  const tab = page.locator(`[data-testid="editor-tab"][data-tab="${key}"]`).first();
  await tab.getByRole("button", { name: /^Chiudi / }).click();
  await page.locator(`[data-testid="editor-tab"][data-tab="${key}"]`).waitFor({ state: "detached" });
};
const closeDetails = async () => {
  while (await page.getByTestId("editor-area").getAttribute("data-active-detail")) await closeDetail();
};
// Brings the conversation's tab forward, the detail tabs stay open.
const showConversation = async () => {
  if (await page.locator('[data-testid="editor-tab"][data-tab="conversation"]').count()) {
    await page.locator('[data-testid="editor-tab"][data-tab="conversation"]').getByRole("tab").click();
  }
  await page.locator('[data-testid="editor-area"]:not([data-covered="true"])').waitFor();
};
// Closes the side bar and the detail tabs it used to hold before issue #336, so the conversation shows again.
const closePanels = async () => {
  if (await page.getByTestId("side-bar").count()) await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
  await closeDetails();
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
// Issue #331: the whole reference is the button, and the item it opens is the open one of the view, with its card.
const waitingItem = async (reference, timeout = 20_000) => {
  await reference.waitFor({ timeout });
  const key = await reference.getAttribute("data-waiting-key");
  if ((await reference.getAttribute("title")) !== "Apri in Aspetta te") throw new Error("The reference to Aspetta te does not say where it opens");
  await reference.click();
  const item = page.getByTestId("side-bar").locator(`[data-testid="waiting-item"][data-waiting-key="${key}"][data-open="true"]`);
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
  await page.getByTestId("waiting-summary").getByRole("button", { name: "Decidi" }).click();
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

// Issue #392: Trama's ids stay on hover; the text the person reads names the records.
const rawIds = async (locator) => (await locator.innerText()).match(/(?<![\w-])(?:DQ|DM|AT|PR|[ACDFGMPQRS])-[0-9A-F]{8}(?![\w-])/g) ?? [];
const expectNoRawIds = async (locator, where) => {
  const text = await locator.innerText();
  const ids = [...text.matchAll(/(?<![\w-])(?:DQ|DM|AT|PR|[ACDFGMPQRS])-[0-9A-F]{8}(?![\w-])/g)];
  if (ids.length) throw new Error(`${where} shows raw ids: ${ids.map((m) => `…${text.slice(Math.max(0, m.index - 50), m.index + 12)}`).join(" | ")}`);
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

// B02, first launch (issue #354): the Benvenuto fills the editor area, and at its head the mark weaves in once, then
// stays still. It sits in the Benvenuto's header and covers nothing: while it plays, the Benvenuto's first action is
// the topmost thing at its own place. It ends by itself, under the 1.4 s cap plus the time a loaded machine takes to
// paint; the frames below check the weave itself.
const welcome = page.getByTestId("welcome");
await welcome.waitFor();
// Issue #460: the weave lasts under two seconds from the window showing. On a loaded machine the check can reach this
// line after it ended, and would wait for an intro that is over: the still mark says the weave ran on this launch
// (data-woven), and then the check replays it, held, to look at where it sits.
const liveIntro = welcome.getByTestId("launch-intro");
const wovenMark = welcome.locator('[data-testid="welcome-mark"][data-woven="true"]');
await liveIntro.or(wovenMark).first().waitFor({ timeout: 10_000 });
const introReplayed = !(await liveIntro.isVisible());
if (introReplayed) {
  await page.evaluate(() => window.dispatchEvent(new Event("trama:replay-intro")));
  await liveIntro.waitFor();
}
const uncovered = await welcome
  .getByTestId("welcome-start-actions")
  .getByRole("button")
  .first()
  .evaluate((link) => {
    const box = link.getBoundingClientRect();
    return link.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
if (!uncovered) throw new Error("The launch intro covers the Benvenuto");
if (introReplayed) await page.evaluate(() => window.dispatchEvent(new Event("trama:end-intro")));
await page.getByTestId("launch-intro").waitFor({ state: "detached", timeout: 3_000 });
await wovenMark.waitFor();
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
    // Only the intro's own animations: pausing the others would freeze the Benvenuto's buttons mid-transition.
    await page.evaluate((t) => {
      for (const animation of document.querySelector('[data-testid="launch-intro"]').getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = t;
      }
    }, time);
    await painted();
    await capture({ path: join(out, `00-intro-${label}-${String(time).padStart(4, "0")}ms.png`) });
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
// Design rules for Impostazioni (issues of 30 September): the settings hold no filled button (the window's one is the
// one of Aspetta te), every button, radio and navigation entry is at least 32 px tall, and the controls of a row sit on
// its right, the primary last. `settingsRules` runs on the section that is open.
const settingsRules = async (where) => {
  const found = await page.getByTestId("settings").evaluate((root) => {
    const shown = (node) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== "hidden";
    const filled = [...root.querySelectorAll('button[data-variant="default"]')].filter((b) => shown(b) && b.dataset.filled !== "false").map((b) => b.textContent.trim());
    const small = [...root.querySelectorAll('nav button, [role="radio"], [data-icon-button], .cta-row > button')]
      .filter(shown)
      .filter((b) => b.getBoundingClientRect().height < 31.5)
      .map((b) => `${b.getAttribute("aria-label") ?? b.textContent.trim()} ${Math.round(b.getBoundingClientRect().height)}px`);
    const left = [...root.querySelectorAll(".cta-row")]
      .filter(shown)
      .filter((row) => row.parentElement.getBoundingClientRect().right - row.getBoundingClientRect().right > 24)
      .map((row) => row.textContent.trim() || row.getAttribute("role") || "actions");
    return { filled, small, left };
  });
  if (found.filled.length) throw new Error(`${where}: a filled button in Impostazioni: ${found.filled}`);
  if (found.small.length) throw new Error(`${where}: click areas under 32 px in Impostazioni: ${found.small}`);
  if (found.left.length) throw new Error(`${where}: actions not on the right of their row: ${found.left}`);
};
// Design rules for Lavoro: an action that only opens or navigates is an icon (no text, an accessible name and a tooltip
// on hover) with at least 32 px of use area; an action that starts work is an icon and a text; none is a filled button.
const expectIconOnly = async (button, where) => {
  const info = await button.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { text: node.innerText.trim(), icon: Boolean(node.querySelector("svg")), label: node.getAttribute("aria-label"), width: box.width, height: box.height, filled: node.dataset.filled };
  });
  if (info.text || !info.icon || !info.label) throw new Error(`${where}: not an icon with an accessible name: ${JSON.stringify(info)}`);
  if (info.width < 32 || info.height < 32) throw new Error(`${where}: the icon's use area is ${info.width}x${info.height}, under 32 px`);
  await button.hover();
  await page.locator(".translucent-popup").filter({ hasText: info.label }).first().waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error(`${where}: no tooltip on hover`);
  });
  await page.mouse.move(0, 0);
};
const expectIconAndText = async (button, where) => {
  const info = await button.evaluate((node) => ({ text: node.innerText.trim(), icon: Boolean(node.querySelector("svg")), variant: node.dataset.variant, filled: node.dataset.filled }));
  if (!info.text || !info.icon) throw new Error(`${where}: not an icon with a text: ${JSON.stringify(info)}`);
  if (info.variant === "destructive") throw new Error(`${where}: a red button outside a confirmation`);
};
const noHorizontalScroll = async (where) => {
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll: ${where}`);
};
// Size rules (720x640 up): no box of the editor, the side bar, the bottom panel or the status bar is wider inside than
// outside. The flex, grid and scrolling boxes on screen keep scrollWidth <= clientWidth + 1; what is meant to scroll
// sideways (code, the tab strip) and text that truncates with an ellipsis on purpose are left out.
const noContainerOverflow = async (where) => {
  const overflowing = await page.evaluate(() => {
    const roots = ['[data-testid="editor-area"]', "main", '[data-testid="side-bar"]', '[data-testid="bottom-panel"]', '[data-testid="status-bar"]'];
    const scrollsSideways = 'pre, code, [data-testid="editor-tabs"], [data-scrolls-x]';
    const seen = new Set();
    const found = [];
    for (const root of document.querySelectorAll(roots.join(", "))) {
      for (const node of [root, ...root.querySelectorAll("*")]) {
        if (seen.has(node) || !(node instanceof HTMLElement)) continue;
        seen.add(node);
        if (node.closest(scrollsSideways)) continue;
        if (!node.checkVisibility({ visibilityProperty: true })) continue;
        const style = getComputedStyle(node);
        const layout = /flex|grid/.test(style.display);
        const scrolls = style.overflowX !== "visible" || style.overflowY !== "visible";
        if (!layout && !scrolls) continue;
        if (style.textOverflow === "ellipsis") continue;
        // The screen reader's text is 1 px wide by design.
        if (node.clientWidth <= 1) continue;
        if (node.scrollWidth > node.clientWidth + 1) {
          found.push({
            node: `${node.tagName.toLowerCase()}${node.dataset.testid ? `[data-testid=${node.dataset.testid}]` : ""}`,
            className: String(node.className).slice(0, 80),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          });
        }
      }
    }
    return found;
  });
  if (overflowing.length) throw new Error(`A box overflows sideways in ${where}: ${JSON.stringify(overflowing.slice(0, 5))}`);
};
// Design rules for the status bar: the branch on the left, then the status line in the middle, what asks for an action,
// the work in focus, then a line and the icons (person's note, 1 October 2026), no button takes a state tint at rest, and the bar stays 24 px.
const statusBarRules = async (where) => {
  const bar = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="status-bar"]');
    const left = (selector) => root.querySelector(selector)?.getBoundingClientRect().left ?? null;
    const order = [
      '[data-testid="status-branch"]',
      '[data-testid="status-line-text"]',
      '[data-testid="status-conflict"]',
      '[data-testid="status-setup"]',
      '[data-testid="status-focus"]',
      '[data-testid="status-divider"]',
      'button[aria-label="Attività"]',
    ]
      .map((selector) => [selector, left(selector)])
      .filter(([, x]) => x !== null);
    const tinted = [...root.querySelectorAll("button")]
      .filter((button) => !["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(button).backgroundColor))
      .map((button) => button.getAttribute("data-testid") ?? button.getAttribute("aria-label"));
    return { order, tinted, height: root.getBoundingClientRect().height };
  });
  const xs = bar.order.map(([, x]) => x);
  if (xs.some((x, i) => i > 0 && x < xs[i - 1])) throw new Error(`The status bar is not read by importance ${where}: ${JSON.stringify(bar.order)}`);
  if (bar.tinted.length) throw new Error(`A status bar button has a background at rest ${where}: ${bar.tinted.join(", ")}`);
  if (bar.height !== 24) throw new Error(`The status bar is not 24 px ${where}: ${bar.height}`);
};
// UI wave of 29 September: only the conversation holds the work bar on the composer. Over a detail tab without the
// composer, as an agent's or a candidate's, the bar is the tab's last row in a room of its own: the tab ends where the
// bar starts, so it covers nothing, and it still shows while something waits. Progetti, Impostazioni and the Benvenuto
// have no bar. `expected` is "composer", "tab" or "none".
const workBarPlace = async (where, expected) => {
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="work-bar"]');
    const row = bar?.closest('[data-testid="work-bar-row"]');
    const tab = document.querySelector('[data-testid="editor-cover"] [data-testid="editor-detail"]');
    return {
      bar: Boolean(bar),
      placement: bar?.dataset.placement ?? null,
      inCover: Boolean(bar?.closest('[data-testid="editor-cover"]')),
      inDock: Boolean(bar?.closest(".chat-composer-dock")),
      tabBottom: tab ? Math.round(tab.getBoundingClientRect().bottom) : null,
      barTop: row ? Math.round(row.getBoundingClientRect().top) : null,
    };
  });
  if (expected === "none") {
    if (layout.bar) throw new Error(`The work bar shows over ${where}`);
    return;
  }
  if (!layout.bar) {
    // Aspetta te open hides the waiting part; with nothing in focus the bar then has nothing to say.
    if ((await page.getByTestId("activity-badge").count()) && !(await page.getByTestId("waiting-view").count())) throw new Error(`The work bar is missing over ${where} while something waits`);
    return;
  }
  if (layout.placement !== expected) throw new Error(`The work bar sits on the ${layout.placement} over ${where}, not on the ${expected}`);
  if (expected === "composer" && !layout.inDock) throw new Error(`The work bar is not on the composer in ${where}: ${JSON.stringify(layout)}`);
  if (expected === "tab" && (!layout.inCover || layout.inDock || layout.tabBottom === null || layout.tabBottom > layout.barTop + 1)) {
    throw new Error(`The work bar lies over ${where}: ${JSON.stringify(layout)}`);
  }
};
// UI wave of 29 September: the header of a squad named after its area says the name once ("app", not "app app"), as
// Trama names the squads it forms; a squad whose name differs from its areas still names them. Returns the headers.
const squadHeadersNameOnce = async (where) => {
  const headers = await page
    .getByTestId("side-bar")
    .getByTestId("squad")
    .evaluateAll((squads) =>
      squads.map((squad) => ({
        name: squad.dataset.squad,
        area: squad.querySelector('[data-testid="squad-area"]')?.textContent.trim() ?? null,
        text: squad.querySelector('[data-testid="squad-header"]').textContent.replace(/\s+/g, " ").trim(),
      })),
    );
  if (!headers.length) throw new Error(`No squad in ${where}`);
  const key = (value) => value.trim().toLocaleLowerCase();
  for (const { name, area, text } of headers) {
    if (area !== null && key(area) === key(name)) throw new Error(`The header of ${name} repeats its name as its area in ${where}: ${text}`);
    if (area === null && key(text).startsWith(`${key(name)} ${key(name)} `)) throw new Error(`The header of ${name} says its name twice in ${where}: ${text}`);
  }
  return headers;
};
// The wave on the interface's priorities (29 September 2026): a view of the side bar at its narrowest (240 px, the sash
// moved from the keyboard) and at its widest, light and dark, then back to the normal width and the look it had.
const sideBarWidthNow = () => page.getByRole("separator", { name: /Larghezza della barra laterale/ }).getAttribute("aria-valuenow");
const sideBarEnds = async (name, check = async () => {}) => {
  const look = await lookOf();
  const sash = page.getByRole("separator", { name: /Larghezza della barra laterale/ });
  for (const end of ["narrow", "wide"]) {
    if (end === "narrow") {
      await sash.focus();
      await page.keyboard.press("Shift+ArrowLeft");
      for (let tries = 0; (await sideBarWidthNow()) !== "240"; tries++) {
        if (tries > 20) throw new Error(`The side bar does not reach its narrowest width for ${name}: ${await sideBarWidthNow()}`);
        await page.waitForTimeout(100);
      }
    } else {
      await sash.focus();
      await page.keyboard.press("Home");
      await page.getByTestId("side-bar").getByRole("button", { name: "Allarga la barra laterale" }).click();
    }
    await page.waitForTimeout(400);
    await noHorizontalScroll(`${name}, side bar ${end}`);
    await check(end);
    for (const dark of [false, true]) {
      await setLookTo(look.provider, dark);
      await shot(`${name}-${end}-${dark ? "dark" : "light"}`);
    }
  }
  await page.getByTestId("side-bar").getByRole("button", { name: "Larghezza normale" }).click();
  await setLookTo(look.provider, look.dark);
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

// Issue #354: the Benvenuto is a page of the editor area, as the Welcome page of VS Code, not a screen in front of the
// app. Without a project it is the only thing in the window: nothing closes it, and the activity bar shows only
// Progetti and Impostazioni. It has four blocks: Inizia, Recenti, Configura and Impara.
await welcome.getByRole("heading", { name: "Benvenuto in Trama" }).waitFor();
for (const block of ["Inizia", "Recenti", "Configura", "Impara"]) await welcome.getByRole("heading", { name: block, exact: true }).waitFor();
// Design rules: without recents Inizia comes first, and with reduced motion the page enters without animating.
{
  const order = await page.evaluate(() => ({
    recent: document.querySelector('[data-testid="welcome-recent"]').getBoundingClientRect().top,
    start: document.querySelector('[data-testid="welcome-start"]').getBoundingClientRect().top,
  }));
  if (order.start > order.recent) throw new Error(`Without recents, Inizia is not above Recenti: ${JSON.stringify(order)}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const entrance = await welcome.evaluate((node) => getComputedStyle(node).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (entrance !== "none") throw new Error(`The Benvenuto animates its entrance with reduced motion: ${entrance}`);
}
// Recenti, empty (design rules, four states): a message and the way to a first project, as a link: the filled button of
// the Benvenuto is the one of Inizia. The message no longer repeats the ways to start.
const recentEmpty = welcome.getByTestId("recent-empty");
await recentEmpty.waitFor();
if (!(await recentEmpty.getByText("Nessun progetto recente.").count())) throw new Error("Recenti, empty, has no message");
if ((await recentEmpty.locator('button[data-variant="default"]').count()) !== 0 || (await recentEmpty.getByRole("button", { name: "Apri un progetto" }).getAttribute("data-variant")) !== "ghost") {
  throw new Error("Recenti, empty, has a second main action");
}
if (/clonane|Clona|esempio/.test(await recentEmpty.innerText())) throw new Error("Recenti, empty, repeats the ways to start of Inizia");
if (await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).count()) throw new Error("The Benvenuto can be closed without a project");
const barViews = await activityBar().getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
if (barViews.join("|") !== "Progetti|Impostazioni") throw new Error(`Without a project the activity bar shows more than Progetti and Impostazioni: ${barViews}`);
// Nothing covers the window any more: its controls take the focus while the Benvenuto is open.
const around = await page.evaluate(() => {
  const toggle = document.querySelector('button[aria-label="Mostra o nascondi la barra laterale"]');
  toggle?.focus();
  return { found: Boolean(toggle), focused: document.activeElement === toggle };
});
if (!around.found || !around.focused) throw new Error(`The window around the Benvenuto is not usable: ${JSON.stringify(around)}`);
await page.evaluate(() => document.activeElement?.blur());
// Configura: the language first with its selector in the row, then provider, GitHub and the method. Each step has its
// state and one action on the right; "facoltativo" only beside the optional steps not done yet.
const welcomeStep = (id) => welcome.locator(`[data-testid="welcome-step"][data-step="${id}"]`);
await welcome.locator('[data-step="provider"]:not([data-status="checking"])').waitFor({ timeout: 20_000 });
const stepRows = await welcome.getByTestId("welcome-step").evaluateAll((nodes) =>
  nodes.map((node) => ({
    id: node.dataset.step,
    status: node.dataset.status,
    optional: node.firstElementChild.textContent.includes("facoltativo"),
    actions: node.firstElementChild.querySelectorAll(":scope > button").length,
  })),
);
if (stepRows.map((row) => row.id).join(",") !== "language,provider,github,aiHero") throw new Error(`Configura is not language, provider, GitHub, method: ${JSON.stringify(stepRows)}`);
for (const row of stepRows.slice(1)) {
  if (row.actions !== 1) throw new Error(`The step ${row.id} has ${row.actions} actions on its row instead of one`);
  if (row.status === "done" && row.optional) throw new Error(`The step ${row.id} says "facoltativo" beside Fatto`);
}
if (!stepRows.find((row) => row.id === "github").optional) throw new Error("GitHub, optional and to do, does not say so");
// Design rules: a step done asks for nothing (a check and a small "Cambia", no "Fatto"); a step to do does not repeat its
// state ("Da fare") beside the button that says what to do; the state is written only for checking, skipped, blocked.
// Secondary actions are icons of 32 px with their name, the provider's text button aside.
const stepChrome = await welcome.getByTestId("welcome-step").evaluateAll((nodes) =>
  nodes
    .filter((node) => node.dataset.step !== "language")
    .map((node) => {
      const button = node.firstElementChild.querySelector(":scope > button");
      const rect = button.getBoundingClientRect();
      return {
        id: node.dataset.step,
        status: node.dataset.status,
        state: node.querySelector('[data-testid="welcome-step-status"]')?.textContent ?? null,
        iconOnly: button.textContent.trim() === "" && Boolean(button.getAttribute("aria-label")),
        height: Math.round(rect.height),
      };
    }),
);
for (const row of stepChrome) {
  if (row.status === "done" && (row.state !== null || !row.iconOnly)) throw new Error(`A step done asks for something or repeats its state: ${JSON.stringify(row)}`);
  if (row.status === "pending" && row.state !== null) throw new Error(`A step to do repeats its state: ${JSON.stringify(row)}`);
  if (row.id !== "provider" && !row.iconOnly) throw new Error(`The action of the step ${row.id} is not an icon: ${JSON.stringify(row)}`);
  if (row.height < 32) throw new Error(`The action of the step ${row.id} is under 32 px: ${JSON.stringify(row)}`);
}
await welcomeStep("language").getByTestId("language-choice").waitFor();
// One filled button at most: Apri un progetto's, while no project is open.
if ((await welcome.locator('button[data-variant="default"]:not([data-filled="false"])').count()) > 1) throw new Error("The Benvenuto has more than one primary action");
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`welcome ${size} ${label}`);
    await shot(`00a-welcome-${size}-${label}`);
  }
}
await setTheme("system");
// The window sizes of the prototype, in the themes of Codex and Claude, light and dark.
const welcomeLook = await lookOf();
for (const [width, height] of [
  [1280, 800],
  [1680, 1050],
]) {
  await page.setViewportSize({ width, height });
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await noHorizontalScroll(`welcome ${width} ${provider} ${dark ? "dark" : "light"}`);
      await shot(`00a-welcome-${width}-${provider}-${dark ? "dark" : "light"}`);
    }
  }
}
await setLookTo(welcomeLook.provider, welcomeLook.dark);
await page.setViewportSize({ width: 1280, height: 820 });
// Issue #301: the language comes first, with the system's already chosen; the Benvenuto changes at once, without a restart.
const languageChoice = welcomeStep("language").getByTestId("language-choice");
await languageChoice.getByRole("radio", { name: "Italiano", checked: true }).waitFor();
await languageChoice.getByRole("radio", { name: "English" }).click();
await welcome.getByRole("heading", { name: "Welcome to Trama" }).waitFor();
await welcome.getByRole("heading", { name: "Set up", exact: true }).waitFor();
if ((await page.evaluate(() => document.documentElement.lang)) !== "en") throw new Error("The page language did not follow the choice");
// The application menu follows the language too (issue #345).
await menuLabelBecomes("view:waiting", "Waiting for you");
for (const [label, theme] of themes) {
  await setTheme(theme);
  await noHorizontalScroll(`welcome english ${label}`);
  await shot(`00a-welcome-en-${label}`);
}
await setTheme("system");
await welcomeStep("github").getByRole("button", { name: "Connect", exact: true }).click();
await welcomeStep("github").getByText(/With GitHub CLI/).waitFor();
await shot("00c-welcome-github-en");
await welcomeStep("github").getByRole("button", { name: "Connect", exact: true }).click();
await languageChoice.getByRole("radio", { name: "Italiano" }).click();
await welcome.getByRole("heading", { name: "Benvenuto in Trama" }).waitFor();
await menuLabelBecomes("view:waiting", "Aspetta te");
// 1. Provider: the fake Codex account already completes it. Cambia unfolds Codex and Claude with their state, the
// others behind a toggle, and the actions to restore.
await welcome.locator('[data-step="provider"][data-status="done"]').waitFor();
await welcomeStep("provider").getByRole("button", { name: "Cambia", exact: true }).click();
await welcome.locator('[data-provider-row="codex"]').waitFor();
await welcome.locator('[data-provider-row="claudeAgent"]').waitFor();
if (await welcome.locator('[data-provider-row="cursor"]').count()) throw new Error("The other providers are not behind their toggle");
await welcomeStep("provider").getByRole("button", { name: "Controlla di nuovo" }).waitFor();
if ((await welcomeStep("provider").getByRole("button", { name: "Controlla di nuovo" }).innerText()).trim() !== "") throw new Error("Controlla di nuovo is not an icon");
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
// 2. GitHub, optional: postponed, it stays "Saltato" and Riprendi questo passo takes it back.
await welcomeStep("github").getByRole("button", { name: "Collega", exact: true }).click();
if (await welcome.locator('[data-provider-row="codex"]').count()) throw new Error("Two steps of Configura are unfolded at once");
await welcome.locator('[data-step="github"]:not([data-status="checking"])').waitFor();
await shot("00c-welcome-github");
await welcomeStep("github").getByRole("button", { name: "Rimanda" }).click();
await welcome.locator('[data-step="github"][data-status="skipped"]').waitFor();
// 3. AI Hero: the answer is the step while no project is open, the primary last on the right.
await welcomeStep("aiHero").getByRole("button", { name: "Apri", exact: true }).click();
await welcomeStep("aiHero").getByText(/Le skill di Matt Pocock/).waitFor();
await primaryLast(welcomeStep("aiHero").locator(".cta-row").first(), "Welcome, AI Hero");
await shot("00d-welcome-aihero");
await page.setViewportSize({ width: 720, height: 640 });
await shot("00d-welcome-aihero-narrow");
await setTheme("dark");
await shot("00d-welcome-aihero-narrow-dark");
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await welcomeStep("aiHero").getByRole("button", { name: "Prepara il metodo" }).click();
await welcome.locator('[data-step="aiHero"][data-status="done"]').waitFor();
await shot("00e-welcome-aihero-chosen");
await welcomeStep("aiHero").getByRole("button", { name: "Cambia", exact: true }).click();

// Inizia, where the project picker of B02 went: create, clone and the example as rows, "Apri un progetto" as the action on
// the right. Without a project it is the Benvenuto's one filled button (design rules: one main action per view, never
// two), so the provider's Collega is an outline there.
const picker = welcome.getByTestId("welcome-start");
const startLinks = await picker.getByTestId("welcome-start-actions").getByRole("button").allInnerTexts();
for (const name of ["Crea un progetto", "Clona da GitHub", "Progetto di esempio"]) {
  if (!startLinks.some((text) => text.startsWith(name))) throw new Error(`Inizia has no ${name}: ${startLinks}`);
}
const openProject = picker.getByTestId("welcome-start-open").getByRole("button", { name: "Apri un progetto" });
if ((await openProject.getAttribute("data-variant")) !== "default" || (await openProject.getAttribute("data-filled")) === "false") throw new Error("Apri un progetto is not the filled action");
const filled = await welcome.locator('button[data-variant="default"]:not([data-filled="false"])').allInnerTexts();
if (filled.length !== 1 || !filled[0].includes("Apri un progetto")) throw new Error(`Without a project the Benvenuto's one filled button is not Apri un progetto: ${filled}`);
await primaryLast(picker.getByTestId("welcome-start-open"), "Inizia");
const startRows = await picker.getByTestId("welcome-start-actions").getByRole("button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
if (startRows.some((height) => height < 32)) throw new Error(`A way to start is under 32 px: ${startRows}`);
if (await picker.locator('[style*="gradient"], [class*="gradient"]').count()) throw new Error("Inizia uses a gradient outside the tokens");
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`picker ${size} ${label}`);
    await shot(`01-picker-${size}-${label}`);
  }
}
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
// B01: Trama's mark sits in the sidebar's brand slot and at the head of the Benvenuto, in the colors of the provider theme,
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
await expectSeam(null);
// Clona da GitHub goes through GitHub CLI (issue #354): without it the GitHub row of Configura unfolds, and says the
// clone starts again by itself once gh is ready; a public repository can still be cloned from there.
await picker.getByRole("button", { name: /^Clona da GitHub/ }).click();
const cloneDialog = page.getByRole("dialog", { name: "Clona da GitHub" });
if ((await welcomeStep("github").getAttribute("data-status")) !== "done") {
  await welcome.getByTestId("welcome-clone-waiting").waitFor();
  await shot("01a-welcome-clone-waiting");
  await welcome.getByTestId("welcome-clone-waiting").getByRole("button", { name: "Clona un repository pubblico" }).click();
}
await cloneDialog.getByRole("textbox").fill("non è un repository");
if (await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).isEnabled()) throw new Error("Clone accepts an invalid repository");
// The dialog's rules: an invalid repository reads in the system red; the actions sit on the right, the primary last and
// not filled; every button is 32 px tall.
if (!(await cloneDialog.getByTestId("clone-hint").evaluate((el) => el.classList.contains("text-destructive")))) throw new Error("The clone error is not in the system red");
await primaryLast(cloneDialog.locator(".cta-row"), "Clona da GitHub");
if ((await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).getAttribute("data-filled")) !== "false") throw new Error("A dialog button is filled");
for (const height of await cloneDialog.locator(".cta-row > button").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))) {
  // The dialog opens with a 98% scale, so a 32 px button measures 31.4 px while it settles.
  if (height < 31) throw new Error(`A dialog button is ${height}px tall`);
}
await cloneDialog.getByRole("textbox").fill("https://github.com/emanueledenaro/trama");
await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).waitFor({ state: "visible" });
if (!(await cloneDialog.getByRole("button", { name: "Scegli la cartella" }).isEnabled())) throw new Error("Clone refuses a GitHub URL");
await shot("01a-picker-clone");
await cloneDialog.getByRole("button", { name: "Annulla" }).click();
await cloneDialog.waitFor({ state: "hidden" });

// Configura keeps the steps' state, as the guide of C12 did: GitHub skipped, the method chosen. Riprendi questo passo
// takes a skipped step back; the Benvenuto never opens a second copy of itself.
await welcome.locator('[data-step="github"][data-status="skipped"]').waitFor();
await welcome.locator('[data-step="aiHero"][data-status="done"]').waitFor();
await shot("01b-guide-after-welcome");
if ((await welcomeStep("github").getByRole("button", { name: "Collega", exact: true }).getAttribute("aria-expanded")) !== "true") {
  await welcomeStep("github").getByRole("button", { name: "Collega", exact: true }).click();
}
await welcomeStep("github").getByRole("button", { name: "Riprendi questo passo" }).click();
await welcome.locator('[data-step="github"]:is([data-status="pending"], [data-status="checking"])').waitFor();
await shot("01c-welcome-resumed");
await welcomeStep("github").getByRole("button", { name: "Rimanda" }).click();
await welcome.locator('[data-step="github"][data-status="skipped"]').waitFor();
if ((await page.getByTestId("welcome").count()) !== 1) throw new Error("More than one Benvenuto");

// Impara: the four exercises on the example project. The first one opens the example with its panel beside the chat,
// and the Benvenuto gives way to the conversation (issue #354, decisions 5 and 9).
const learn = welcome.getByTestId("welcome-learn");
if ((await learn.getByTestId("welcome-exercise").count()) !== 4) throw new Error("Impara does not list the four exercises");
// Design rules: the state of an exercise is its number or check and its button, not a word beside a button that says the
// same; the button starts work, so it has an icon and its text, 32 px high, written as a link (no outline in a row).
const exerciseRows = await learn.getByTestId("welcome-exercise").evaluateAll((nodes) =>
  nodes.map((node) => {
    const button = node.querySelector("button");
    return { text: node.textContent, height: Math.round(button.getBoundingClientRect().height), icon: Boolean(button.querySelector("svg")), variant: button.dataset.variant };
  }),
);
for (const row of exerciseRows) {
  if (/Da fare|In corso|Fatto/.test(row.text)) throw new Error(`An exercise repeats its state beside its button: ${row.text}`);
  if (row.height < 32 || !row.icon || row.variant !== "ghost") throw new Error(`An exercise button is not an icon and text link of 32 px: ${JSON.stringify(row)}`);
}
await learn.getByRole("button", { name: "Inizia: Conosci il progetto" }).click();
await page.getByRole("complementary", { name: "Esercizio" }).waitFor({ timeout: 20_000 });
await welcome.waitFor({ state: "detached" });
// The panel of the exercise: close and tabs are at least 32 px, close is an icon with its name, a step does not repeat
// its state, and every text comes from the catalog (it answers to the language chosen).
{
  const panel = page.getByRole("complementary", { name: "Esercizio" });
  const close = panel.getByRole("button", { name: "Chiudi l'esercizio" });
  if ((await close.innerText()).trim() !== "") throw new Error("The close button of the exercise has a text beside its icon");
  const sizes32 = await panel.locator('button[data-icon-button], [role="tab"]').evaluateAll((nodes) => nodes.map((node) => Math.round(Math.min(node.getBoundingClientRect().width, node.getBoundingClientRect().height))));
  if (sizes32.length < 5 || sizes32.some((size) => size < 32)) throw new Error(`Close or a tab of the exercise is under 32 px: ${sizes32}`);
  if (/Da fare|Fatto/.test(await panel.getByRole("list", { name: "Passi dell'esercizio" }).innerText())) throw new Error("A step of the exercise repeats its state");
  const panelButtons = await panel.getByRole("list", { name: "Passi dell'esercizio" }).locator("button").evaluateAll((nodes) => nodes.filter((node) => node.dataset.variant).map((node) => Math.round(node.getBoundingClientRect().height)));
  if (panelButtons.some((height) => height < 32)) throw new Error(`An action of the exercise is under 32 px: ${panelButtons}`);
}
await shot("01d-picker-example-exercise");
await page.getByRole("complementary", { name: "Esercizio" }).getByRole("button", { name: "Chiudi l'esercizio" }).click();
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 20_000 });
await shot("02-demo-study");
// Design rules: the study's fold control is an icon button with a name and a tooltip, at least 32 px to hit.
{
  const studyToggle = page.locator('[data-anchor="study"]').first().getByRole("button", { name: "Comprimi", exact: true });
  const studyBox = await studyToggle.boundingBox();
  if (!studyBox || studyBox.width < 32 || studyBox.height < 32) throw new Error(`The study's fold control is under 32 px: ${JSON.stringify(studyBox)}`);
  if ((await studyToggle.innerText()).trim() !== "" || (await studyToggle.getAttribute("aria-expanded")) !== "true") throw new Error("The study's fold control is not an icon button that says it is open");
}
// Design rules, chat: the icon-only copy buttons of the timeline have a tooltip as well as a name, and a turn of work
// is 16 px above the next block (16, 24 or 32 between blocks).
{
  const copy = await page.locator('.chat-timeline-scroll button[aria-label^="Copia "]').evaluateAll((buttons) => buttons.map((b) => [b.getAttribute("aria-label"), b.getAttribute("title")]));
  for (const [name, title] of copy) if (title !== name) throw new Error(`The chat button "${name}" has no tooltip: ${title}`);
  const margins = await page.locator('[data-testid="work-line"]').evaluateAll((lines) => lines.map((l) => getComputedStyle(l).marginBottom));
  for (const margin of margins) if (margin !== "16px") throw new Error(`A turn of work is ${margin} above the next block, not 16px`);
}
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
  // Design rules for the title bar: every button and the search are at least 32 px, and the branch is not repeated here
  // (the status bar has it, and it opens the branch).
  {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="title-bar"] button')]
        .map((button) => ({ name: button.getAttribute("aria-label"), box: button.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height < 32)
        .map(({ name, box }) => `${name}: ${Math.round(box.height)}`),
    );
    if (small.length) throw new Error(`The title bar has buttons under 32 px: ${small.join(", ")}`);
    if (await page.locator('[data-testid="title-bar"] .trama-woven-git-branch').count()) throw new Error("The title bar repeats the branch of the status bar");
  }
  const bars = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="title-bar"]').getBoundingClientRect().height,
    activity: document.querySelector('[data-testid="activity-bar"]').getBoundingClientRect().width,
    status: document.querySelector('[data-testid="status-bar"]').getBoundingClientRect().height,
  }));
  if (bars.title !== 46 || bars.activity !== 48 || bars.status !== 24) throw new Error(`The window's bars are not 46, 48 and 24 px: ${JSON.stringify(bars)}`);
  await statusBarRules("at the first launch");
  if (await page.getByTestId("side-bar").count()) throw new Error("The side bar is open at the first launch");
  // One badge in the activity bar, the count of Aspetta te.
  const badges = await activityBar().getByTestId("activity-badge").allInnerTexts();
  if (badges.join() !== "1") throw new Error(`The activity bar's badges: ${badges.join(", ")}`);
  // The Projects icon is stacked folders and the Coordinator's conversation is Trama's mark in one tint, both drawn in
  // the button's own color (currentColor) at the size of the other icons: grey when off, the active color when open.
  {
    const iconOf = (name) =>
      activityBar()
        .getByRole("button", { name, exact: true })
        .evaluate((button) => {
          const svg = button.querySelector("svg");
          const box = svg.getBoundingClientRect();
          const painted = svg.querySelector("path");
          const style = getComputedStyle(painted);
          return {
            icon: svg.dataset.tramaIcon ?? null,
            mark: svg.dataset.tramaMark ?? null,
            size: [Math.round(box.width), Math.round(box.height)],
            paint: painted.getAttribute("fill") === "currentColor" ? style.fill : style.stroke,
            color: getComputedStyle(button).color,
          };
        });
    const projects = await iconOf("Progetti");
    const coordinator = await iconOf("Coordinatore");
    const other = await iconOf("Memoria");
    if (projects.icon !== "projects" || projects.size.join() !== other.size.join()) throw new Error(`The Projects icon is not Trama's stacked folders at the icons' size: ${JSON.stringify(projects)}`);
    if (coordinator.mark !== "mono" || coordinator.size.join() !== other.size.join() || coordinator.paint !== coordinator.color) {
      throw new Error(`The Coordinator's icon is not Trama's mark in the button's color: ${JSON.stringify(coordinator)}`);
    }
    if ((await activityBar().getByRole("button", { name: "Coordinatore", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("The Coordinator's icon is not on with the conversation open");
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await page.waitForTimeout(200);
        await capture({ path: join(out, `30-activity-bar-${provider}-${dark ? "dark" : "light"}.png`), clip: { x: 0, y: 0, width: 240, height: 440 } });
        console.log("saved", `30-activity-bar-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(windowLook.provider, windowLook.dark);
  }
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
// Issue #345: each item of the View menu opens its view of the activity bar. The items are found by their command, the
// same whatever the platform and the language call the menu.
{
  const sideBar = page.getByTestId("side-bar");
  for (const [name, view] of Object.entries(VIEWS)) {
    await clickMenu(`view:${view}`);
    await page.locator(`[data-testid="side-bar"][data-view="${view}"]`).waitFor();
    if ((await activityBar().getByRole("button", { name, exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error(`The View menu's ${name} does not press its icon`);
  }
  // The menu opens a view, it does not close it as its icon does.
  await clickMenu("view:memory");
  await page.waitForTimeout(300);
  if ((await sideBar.getAttribute("data-view")) !== "memory") throw new Error("The View menu closed the view it should open");
  // The conversation with the Coordinator, the first view of the activity bar: its tab and the composer.
  await clickMenu("view:conversation");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Messaggio al Coordinatore");
  // The Activity panel under the editor (issue #337), the side bar and the composer, as Cmd/Ctrl+J, B and L.
  await clickMenu("togglePanel");
  await page.getByTestId("bottom-panel").waitFor();
  await clickMenu("togglePanel");
  await page.getByTestId("bottom-panel").waitFor({ state: "detached" });
  // The side bar stays open on Memoria beside the panel and the conversation: the menu closes it and opens it again.
  await clickMenu("toggleSidebar");
  await sideBar.waitFor({ state: "detached" });
  await clickMenu("toggleSidebar");
  await page.locator('[data-testid="side-bar"][data-view="memory"]').waitFor();
  await clickMenu("toggleSidebar");
  await sideBar.waitFor({ state: "detached" });
  await clickMenu("focusComposer");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Messaggio al Coordinatore");
  // Impostazioni… opens the Settings tab of the editor (issue #336).
  await clickMenu("settings");
  const settingsTab = page.locator('[data-testid="editor-tab"][data-tab="settings"]');
  await settingsTab.waitFor();
  await settingsTab.getByRole("button", { name: /^Chiudi / }).click();
  await settingsTab.waitFor({ state: "detached" });
}
// Issue #292: at the start only the goal the Coordinator proposed waits for the person, in the summary, in the sidebar
// counter and as a reference in the chat.
const startSummary = (await page.getByTestId("waiting-summary").innerText()).replace(/\s+/g, " ");
if (!startSummary.includes("Obiettivo proposto") || !startSummary.includes("1 cosa aspetta te")) throw new Error(`Aspetta te at the start: ${startSummary}`);
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').waitFor();
// A place to fill: the project has no goal yet. Files dragged over the composer take the seam while they are there.
await page.getByTestId("first-goal").scrollIntoViewIfNeeded();
await seamShots("firstGoal", "first-goal");
await expectContrastFallback();
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
// Issue #331: the step answers items of Aspetta te, so the chat shows the reference to the first one, all of it a
// button, and the decision buttons stay in the view.
const nextStep = page.getByTestId("next-step").getByTestId("waiting-reference").filter({ hasText: "Rispondi alle 2 domande" });
await nextStep.waitFor({ timeout: 20_000 });
if (await page.getByTestId("next-step").getByRole("button", { name: "Rispondi alle 2 domande", exact: true }).count()) throw new Error("The next step still repeats the decision as a button");
const stepBox = await nextStep.boundingBox();
const replyBox = await page.getByTestId("next-step").boundingBox();
if (!stepBox || !replyBox || replyBox.x + replyBox.width - (stepBox.x + stepBox.width) > 2) throw new Error("The next step is not on the right");
await shot("03a-next-step");
await nextStep.click();
await page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-open="true"][data-waiting-kind="question"]').waitFor();
await page.waitForTimeout(600);
await shot("03a2-next-step-questions");
// Issue #461: the decision and team screenshots of the README come from this point on, so the fake Codex server
// stops echoing its usual test-only reply until the team is confirmed, further down.
await writeFile(readmeShotsFlag, "");
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-decisione]");
await page.keyboard.press("Enter");
await page.getByRole("main").getByText("Cosa succede a un ordine pagato annullato?").first().waitFor({ timeout: 20_000 });
await shot("03b-decision-card");
let firstDecision = await openWaiting("question", "Cosa succede a un ordine pagato annullato?");
await shot("03b2-decision-waiting");
// Issue #331: the line above the composer hides while Aspetta te is open, where the item's own buttons are.
if (await page.getByTestId("waiting-summary").count()) throw new Error("The line above the composer shows with Aspetta te open");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
// The summary sits above the composer with its button on the right; one click opens the list. Light and dark.
const waitingBar = page.getByTestId("waiting-summary");
await waitingBar.waitFor();
// Issue #331: the line names the first item and the count, and its one button is the filled Decidi.
const waitingButton = waitingBar.getByRole("button", { name: "Decidi" });
if (!(await waitingBar.getByTestId("waiting-summary-count").innerText()).match(/cose aspettano te$/)) throw new Error("The line above the composer does not count the items");
const waitingBarBox = await waitingBar.boundingBox();
const waitingButtonBox = await waitingButton.boundingBox();
if (!waitingBarBox || !waitingButtonBox || waitingBarBox.x + waitingBarBox.width - (waitingButtonBox.x + waitingButtonBox.width) > 12) {
  throw new Error("The Aspetta te summary button is not on the right");
}
// UI wave of 29 September: the line is part of one bar attached to the top of the composer, with the work in focus.
// Issue #392: its blur stays behind it, so the timeline does not read through it; and the chat leaves room for the
// whole dock, so the last message ends above the bar.
const workBar = page.getByTestId("work-bar");
const waitingGlass = await workBar.evaluate((el) => ({ isolation: getComputedStyle(el).isolation, blur: getComputedStyle(el, "::before").backdropFilter }));
if (waitingGlass.isolation !== "isolate" || !waitingGlass.blur.includes("blur")) throw new Error(`The bar above the composer lets the chat through: ${JSON.stringify(waitingGlass)}`);
{
  const layout = await page.evaluate(async () => {
    const bar = document.querySelector('[data-testid="work-bar"]').getBoundingClientRect();
    const composer = document.querySelector(".chat-composer-surface").getBoundingClientRect();
    const scroller = document.querySelector(".chat-timeline-scroll");
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const last = scroller.firstElementChild.lastElementChild.getBoundingClientRect();
    return { gap: composer.top - bar.bottom, inset: bar.left - composer.left, insetEnd: composer.right - bar.right, lastBottom: last.bottom, barTop: bar.top };
  });
  // Square like the composer and as wide as it (2 October 2026): one piece, with no step at either side.
  if (Math.abs(layout.gap) > 2 || Math.abs(layout.inset) > 1 || Math.abs(layout.insetEnd) > 1) throw new Error(`The bar is not attached to the composer: ${JSON.stringify(layout)}`);
  if (layout.lastBottom > layout.barTop + 1) throw new Error(`The bar above the composer covers the last message: ${JSON.stringify(layout)}`);
}
for (const [label, theme] of themes) {
  await setTheme(theme);
  await shot(`03b3-waiting-${label}`);
}
await setTheme("system");
// Issue #331: Aspetta te in the side bar, following the prototype B of issue #314. The questions and the proposed goal
// wait: the first item, which holds the most work, open with its buttons at the top, the others as compact rows. In
// the whole window one filled button: Decidi above the composer, or the open item's primary with the view open.
// Narrow and wide, light and dark.
{
  const look = await lookOf();
  const viewport = page.viewportSize();
  const filledButtons = () =>
    page.locator('button[data-variant="default"]').evaluateAll((buttons) => buttons.filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()));
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const closedFilled = await filledButtons();
    if (closedFilled.join("|") !== "Decidi") throw new Error(`Filled buttons with Aspetta te closed at ${size}: ${closedFilled.join(", ")}`);
    const count = Number((await activityBar().getByTestId("activity-badge").innerText()).trim());
    if (count < 2) throw new Error(`Aspetta te counts ${count} items, the check wants at least two`);
    if ((await waitingBar.getByTestId("waiting-summary-count").innerText()).trim() !== `${count} cose aspettano te`) throw new Error("The line above the composer and the badge count differently");
    await waitingBar.getByRole("button", { name: "Decidi" }).click();
    const view = page.getByTestId("waiting-view");
    await view.waitFor();
    await waitingBar.waitFor({ state: "detached" });
    const items = page.getByTestId("side-bar").getByTestId("waiting-item");
    const states = await items.evaluateAll((list) => list.map((item) => `${item.dataset.waitingKind}:${item.dataset.open}`));
    // One list, one count (issue #292): the badge, the header, the summary and the items say the same number.
    if (states.length !== count || !states[0].endsWith(":true") || states.slice(1).some((state) => !state.endsWith(":false")) || !states.includes("goal:false")) {
      throw new Error(`Aspetta te at ${size}: ${states.join(", ")}`);
    }
    if ((await page.getByTestId("side-bar").getByTestId("side-bar-count").innerText()).trim() !== String(count)) throw new Error("The header of Aspetta te counts differently");
    if (!(await view.getByTestId("waiting-view-summary").innerText()).includes(`${count} cose aspettano te`)) throw new Error("The summary of Aspetta te counts differently");
    const openFilled = await filledButtons();
    if (openFilled.length !== 1) throw new Error(`Filled buttons with Aspetta te open at ${size}: ${openFilled.join(", ")}`);
    if (await page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-open="false"] button[data-variant="default"]').count()) throw new Error("A compact row of Aspetta te has a filled button");
    // The decision buttons of the open item are in view without scrolling, the primary last on the right.
    const decision = items.first().locator(".cta-row").filter({ has: page.locator('button[data-variant="default"]') }).first();
    const inView = await decision.evaluate((row) => {
      const box = row.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="status-bar"]').getBoundingClientRect();
      return box.top >= 0 && box.bottom <= bar.top;
    });
    if (!inView) throw new Error(`The decision buttons of the first item need a scroll at ${size}`);
    await primaryLast(decision, `Aspetta te at ${size}`);
    await noHorizontalScroll(`Aspetta te ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`31-waiting-view-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(look.provider, look.dark);
    // A compact row opens its item; the one open before becomes a row.
    await page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-waiting-kind="goal"]').getByRole("button", { name: /^Apri: / }).click();
    await page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-waiting-kind="goal"][data-open="true"]').waitFor();
    if ((await items.first().getAttribute("data-open")) !== "false") throw new Error("Two items of Aspetta te are open");
    await activityBar().getByRole("button", { name: "Aspetta te", exact: true }).click();
    await page.getByTestId("side-bar").waitFor({ state: "detached" });
    await waitingBar.waitFor();
  }
  await page.setViewportSize(viewport);
  // UI wave of 29 September: one status line at the top, how the view works folded behind "Come funziona"; the open
  // item's card is its one frame, with no second border and no second title. Then the side bar at its widest.
  await waitingBar.getByRole("button", { name: "Decidi" }).click();
  const view = page.getByTestId("waiting-view");
  await view.waitFor();
  const how = view.getByTestId("waiting-view-how");
  if ((await how.getAttribute("aria-expanded")) !== "false") throw new Error("Aspetta te explains itself before the person asks");
  // ADR 0018: "Come funziona" is a secondary action, so an icon button with its name as tooltip and aria-label, and a
  // target of at least 32 px. One question in the summary: how many wait; the order and the way it works stay folded.
  if ((await how.getAttribute("data-icon-button")) === null || (await how.getAttribute("aria-label")) !== "Come funziona" || (await how.innerText()).trim()) {
    throw new Error("Come funziona in Aspetta te is not an icon button with a name");
  }
  const howBox = await how.boundingBox();
  if (!howBox || howBox.width < 32 || howBox.height < 32) throw new Error(`Come funziona in Aspetta te is ${howBox?.width}x${howBox?.height} px, under 32`);
  const summaryText = await view.getByTestId("waiting-view-summary").innerText();
  if (!/cose aspettano te$/.test(summaryText.trim()) || summaryText.includes("In ordine") || summaryText.includes("Mentre aspetti")) throw new Error(`The summary of Aspetta te says more than the count: ${summaryText}`);
  if (await view.getByTestId("waiting-view-write").count()) throw new Error("Aspetta te shows the empty action while things wait");
  if ((await view.getAttribute("data-state")) !== "list") throw new Error(`Aspetta te is not in its list state: ${await view.getAttribute("data-state")}`);
  const openItem = view.locator('[data-testid="waiting-item"][data-open="true"]');
  await openItem.getByTestId("waiting-open-card").waitFor();
  if (await openItem.locator(":scope > div.rounded-xl").count()) throw new Error("The open item of Aspetta te wraps its card in a second frame");
  await page.getByTestId("side-bar-header").getByRole("button", { name: "Allarga la barra laterale" }).click();
  await how.click();
  await view.getByText("Mentre aspetti, il Coordinatore lavora sul resto.", { exact: false }).waitFor();
  await view.getByText("Sono in ordine di quanto lavoro fermano.", { exact: false }).waitFor();
  await themeShots("31e-waiting-view-side-bar-wide");
  await how.click();
  await page.getByTestId("side-bar-header").getByRole("button", { name: "Larghezza normale" }).click();
  await activityBar().getByRole("button", { name: "Aspetta te", exact: true }).click();
  await page.getByTestId("side-bar").waitFor({ state: "detached" });
  await waitingBar.waitFor();
}
// Issue #331: the questions have one home, Aspetta te. Patto keeps one line per question that opens it there, with no
// button to answer; the open project in Progetti carries the same count as the icon of Aspetta te.
{
  const count = Number((await activityBar().getByTestId("activity-badge").innerText()).trim());
  await openView("Progetti");
  const projectCount = page.getByTestId("side-bar").getByTestId("project-waiting-count");
  await projectCount.waitFor();
  if (Number((await projectCount.innerText()).trim()) !== count) throw new Error("Progetti counts what waits differently from the icon of Aspetta te");
  // The count sits in the column of the signs of the project's rows, not further left (person's note, 1 October 2026).
  const rowRight = await page.getByTestId("side-bar").locator('[data-testid="sidebar-agent"], [data-testid="sidebar-goal"]').first().boundingBox().catch(() => null);
  const countBox = await projectCount.boundingBox();
  const createProject = page.getByTestId("side-bar").getByRole("button", { name: "Crea un progetto" });
  if ((await createProject.evaluate((el) => getComputedStyle(el.parentElement).opacity)) !== "1") throw new Error("Creating a project shows only on hover");
  if (rowRight && countBox && Math.abs(rowRight.x + rowRight.width - (countBox.x + countBox.width)) > 12) throw new Error(`The count of the open project is not in the column of the signs: ${countBox.x + countBox.width} vs ${rowRight.x + rowRight.width}`);
  await openView("Regole", "Patto");
  const pactPointer = page.getByTestId("side-bar").getByTestId("waiting-pointer").filter({ hasText: "La domanda aspetta te" }).first();
  await pactPointer.waitFor();
  // The line that stands for a proposal is one click target of at least 32 px, whole row.
  const pointerBox = await pactPointer.boundingBox();
  if (!pointerBox || pointerBox.height < 32) throw new Error(`The pointer to Aspetta te is ${pointerBox?.height} px high, under 32`);
  if (await page.getByTestId("side-bar").getByRole("button", { name: "Registra la decisione" }).count()) throw new Error("Patto still answers the question");
  await themeShots("31c-waiting-pointer-pact");
  await pactPointer.click();
  await page.locator('[data-testid="side-bar"][data-view="waiting"] [data-testid="waiting-item"][data-waiting-kind="question"][data-open="true"]').waitFor();
  await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
}
firstDecision = await openWaiting("question", "Cosa succede a un ordine pagato annullato?");
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
// The turn's technical steps are in Activity, grouped; the chat keeps one line that opens them there, in the bottom
// panel under the conversation (issue #337).
await page.getByTestId("work-line").getByText("Ha lavorato per").first().click();
await page.getByTestId("bottom-panel").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"]').first().waitFor();
await shot("04-work-expanded");
// Issue #337: Activity in the bottom panel, under the editor with a horizontal sash as in VS Code. It never
// covers the status bar, it leaves the conversation at least 380 px at 1280x800 and it follows the provider's theme.
{
  const panel = page.getByTestId("bottom-panel");
  const panelLook = await lookOf();
  const conversationHeight = () =>
    page.evaluate(() => {
      const timeline = document.querySelector(".chat-timeline-scroll").getBoundingClientRect();
      const dock = document.querySelector(".chat-composer-dock").getBoundingClientRect();
      return Math.round(dock.top - timeline.top);
    });
  const edges = () =>
    page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const [panelBox, status, main] = [box('[data-testid="bottom-panel"]'), box('[data-testid="status-bar"]'), box("main")];
      return { top: panelBox.top, bottom: panelBox.bottom, left: panelBox.left, right: panelBox.right, height: panelBox.height, status: status.top, main };
    });
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    const box = await edges();
    // The default height, within the highest the editor leaves: at 1280x800 the 12 px gap above the panel takes 8 px
    // of its 200, so the conversation keeps its 380 px.
    const expected = Math.min(width >= 1500 ? 260 : 200, height - 70 - 526 - 12);
    if (box.height !== expected) throw new Error(`The bottom panel is ${box.height}px high at ${size}, not ${expected}`);
    if (box.bottom > box.status + 0.5) throw new Error(`The bottom panel covers the status bar at ${size}`);
    // The panel is a card of its own under the editor (2 October 2026): 12 px below it, the gap being its sash, as wide.
    const gap = box.top - box.main.bottom;
    if (Math.abs(gap - 12) > 0.5 || Math.abs(box.left - box.main.left) > 0.5 || Math.abs(box.right - box.main.right) > 0.5)
      throw new Error(`The bottom panel is not attached under the editor at ${size}: ${gap}px apart`);
    if (size === "1280x800") {
      const room = await conversationHeight();
      if (room < 380) throw new Error(`The conversation has ${room}px at 1280x800 with the bottom panel open, under 380`);
      console.log(`conversation at 1280x800 with the bottom panel: ${room}px`);
    }
    await noHorizontalScroll(`bottom panel ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`37a-activity-panel-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(panelLook.provider, panelLook.dark);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  // One line per row: time, bot or avatar, text, state; the summary says what runs now and the last thing gone wrong.
  await panel.getByTestId("activity-summary-now").waitFor();
  await panel.getByTestId("activity-summary-problem").waitFor();
  const turnRow = panel.locator('[data-testid="work-turn"]').first();
  const rowHeight = await turnRow.locator("> div").first().evaluate((row) => row.getBoundingClientRect().height);
  if (rowHeight > 32) throw new Error(`An Activity row is ${rowHeight}px high, not one line`);
  if (/\b[ACGRS]-[0-9A-F]{8}\b/.test(await panel.getByTestId("activity-log").innerText())) throw new Error("An id shows in Activity outside the hover");
  // The row's secondary actions are icons with their name.
  const showInChat = turnRow.getByRole("button", { name: "Mostra nella chat", exact: true });
  if ((await showInChat.innerText()).trim()) throw new Error("Mostra nella chat is not an icon");
  // The filter by type keeps the turns of work only; the filter by who keeps the Coordinator's rows.
  await panel.getByRole("button", { name: /^Tipo: / }).click();
  await page.getByRole("option", { name: "Turni di lavoro" }).click();
  await panel.locator('[data-testid="work-turn"]').first().waitFor();
  if (await panel.getByTestId("activity-log").locator('> li:not([data-testid="work-turn"])').count()) throw new Error("The type filter keeps other rows");
  await shot("37b-activity-panel-filter");
  await panel.getByRole("button", { name: /^Tipo: / }).click();
  await page.getByRole("option", { name: "Tutto" }).click();
  await panel.getByRole("button", { name: /^Chi: / }).click();
  await page.getByRole("option", { name: "Coordinatore" }).click();
  await panel.getByRole("button", { name: /^Chi: Coordinatore/ }).waitFor();
  await panel.getByRole("button", { name: /^Chi: / }).click();
  await page.getByRole("option", { name: "Tutti" }).click();
  // "Mostra nella chat" brings the turn's line of the chat into view.
  const turnId = await turnRow.getAttribute("data-work");
  await showInChat.click();
  const chatLine = page.locator(`[data-testid="work-line"][data-work="${turnId}"]`);
  await chatLine.and(page.locator('[data-highlight="true"]')).waitFor({ timeout: 5_000 });
  const lineBox = await chatLine.boundingBox();
  const mainBox = await page.getByRole("main").boundingBox();
  if (!lineBox || !mainBox || lineBox.y < mainBox.y || lineBox.y + lineBox.height > mainBox.y + mainBox.height) throw new Error("Mostra nella chat did not bring the line into view");
  // The horizontal sash: dragged down it lowers the panel, dragged up it raises it as far as the conversation keeps its
  // 380 px, the keys step it, Home resets it.
  const panelSash = page.getByRole("separator", { name: "Altezza del pannello Attività" });
  if ((await panelSash.getAttribute("aria-orientation")) !== "horizontal") throw new Error("The panel's sash is not horizontal");
  const dragSash = async (by, name) => {
    // The panel eases to its new height: the grip is measured once it has settled.
    await page.waitForTimeout(400);
    const sashBox = await panelSash.boundingBox();
    await page.mouse.move(640, sashBox.y + sashBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(640, sashBox.y + sashBox.height / 2 + by, { steps: 6 });
    await page.waitForTimeout(200);
    if (name) await shot(name);
    await page.mouse.up();
    await page.mouse.move(640, 300);
  };
  // The panel starts at its default within the highest the editor leaves (192 px at 1280x800, the 12 px gap included).
  const panelStart = Number(await panelSash.getAttribute("aria-valuenow"));
  await dragSash(40, "37c-activity-panel-sash-drag");
  if (Number(await panelSash.getAttribute("aria-valuenow")) !== panelStart - 40) throw new Error(`Dragging the sash down does not lower the bottom panel to ${panelStart - 40} px`);
  await panelSash.focus();
  await page.keyboard.press("ArrowUp");
  if (Number(await panelSash.getAttribute("aria-valuenow")) !== panelStart - 24) throw new Error("ArrowUp does not raise the bottom panel by 16px");
  await dragSash(-200);
  await page.waitForTimeout(300);
  const highest = Number(await panelSash.getAttribute("aria-valuenow"));
  if (highest !== Number(await panelSash.getAttribute("aria-valuemax"))) throw new Error(`Dragging the sash up stops at ${highest} px, before the panel's highest`);
  if ((await conversationHeight()) < 380) throw new Error("The bottom panel at its highest leaves the conversation under 380 px");
  await panelSash.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction((start) => document.querySelector('[role="separator"][aria-label="Altezza del pannello Attività"]')?.getAttribute("aria-valuenow") === String(start), panelStart);
  // The title bar's toggle closes and opens it; the X closes it; the status bar's icon opens it.
  await page.getByRole("button", { name: "Pannello Attività" }).click();
  await panel.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Pannello Attività" }).click();
  await panel.waitFor();
  if ((await page.getByRole("button", { name: "Pannello Attività" }).getAttribute("aria-pressed")) !== "true") throw new Error("The panel's toggle is not pressed");
  await page.getByRole("button", { name: "Chiudi il pannello" }).click();
  await panel.waitFor({ state: "detached" });
  await page.getByTestId("status-bar").getByRole("button", { name: "Attività", exact: true }).click();
  await panel.waitFor();
  await page.setViewportSize({ width: 1280, height: 820 });
}
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
// Issue #461: this exact turn shows up in the README's team screenshot, so it reads like a person's own request.
await page.getByLabel("Messaggio al Coordinatore").fill("Puoi proporre un team per il modulo Orders?");
await page.keyboard.press("Enter");
const teamItem = await openWaiting("team");
await teamItem.getByRole("button", { name: "Conferma il team" }).waitFor({ timeout: 20_000 });
await shot("04b-team-proposal");
await teamItem.getByRole("button", { name: "Conferma il team" }).click();
await page.getByText("Team confermato").first().waitFor({ timeout: 20_000 });
await changeMandate("Scrivi");
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await shot("04c-mandate-granted");
await closePanels();
await page.getByLabel("Messaggio al Coordinatore").fill("[assegna]");
await page.keyboard.press("Enter");
await page.getByText("Concluso", { exact: true }).first().waitFor({ timeout: 20_000 });
await page.waitForTimeout(500);
await shot("04d-assignment-done");
await openView("Squadre");
// A10: the Squads view replaces Team. After the study the Coordinator formed the squad of Ada's area: its lead, Ada, its
// dedicated QA and the squad's status line; the shared roles sit apart, the squad's QA is not among them. Light and dark.
const teamPanel = page.getByTestId("side-bar");
const firstSquad = teamPanel.getByTestId("squad").first();
await firstSquad.waitFor({ timeout: 20_000 });
await firstSquad.getByTestId("squad-status").getByText(/^Libera/).waitFor();
// UI wave of 29 September: the squad takes the name of Ada's area, Orders, and its header said "Orders Orders". Now
// the name shows once, with the side bar narrow and wide, light and dark.
{
  const headers = await squadHeadersNameOnce("Squadre after the study");
  if (!headers.some((header) => header.area === null)) throw new Error(`No squad named after its area shows its name once: ${JSON.stringify(headers)}`);
  await sideBarEnds("52f-squads-name-once", async (end) => {
    await squadHeadersNameOnce(`Squadre with the side bar ${end}`);
  });
}
await firstSquad.getByRole("button", { name: /^Ada/ }).waitFor();
await firstSquad.locator('[data-testid="team-figure"][data-role="squadLead"]').filter({ hasText: "[Capo]" }).waitFor();
await firstSquad.locator('[data-testid="team-figure"][data-role="qa"]').waitFor();
// Critique of 29 September: the lead is one short row and the duty every squad's lead and QA share stays on hover.
{
  const lead = firstSquad.locator('[data-testid="team-figure"][data-role="squadLead"]');
  if ((await lead.getAttribute("data-short")) !== "true") throw new Error("The squad's lead is not a short row");
  if (await teamPanel.getByText("Divide il lavoro dell'area della sua squadra", { exact: false }).count()) throw new Error("The squad lead's duty is still written in the Squads view");
  if (!/Divide il lavoro dell'area della sua squadra/.test((await lead.getAttribute("title")) ?? "")) throw new Error("The squad lead's duty is not on hover");
  const leadLines = await lead.evaluate((row) => Math.round(row.getBoundingClientRect().height));
  if (leadLines > 40) throw new Error(`The squad's lead takes more than one line: ${leadLines}px`);
}
// Issue #333: who works now is on top, in view at 1280x800 without scrolling. Each person is one row with the bot, the
// name, the role's tag, what it does now and the sign; the ids stay on hover; the shared roles wait closed, with their
// count. The view and the person of the squad, narrow and wide, Codex and Claude, light and dark.
{
  const teamsLook = await lookOf();
  const summary = teamPanel.getByTestId("squads-summary");
  await summary.waitFor();
  await summary.getByText(/squadr[ae] al lavoro|Nessuna squadra al lavoro/).waitFor();
  if (!(await summary.evaluate((el) => el.parentElement.firstElementChild === el))) throw new Error("The summary of the Squads view is not on top");
  const rows = teamPanel.locator('[data-testid="team-developer"], [data-testid="team-figure"]');
  for (const row of await rows.all()) {
    if (!(await row.getByTestId("agent-bot").count())) throw new Error("A person of the squad has no bot");
    // Critique of 29 September: the squad's lead is one short row; it says what it does beside its name only when busy.
    const short = (await row.getAttribute("data-short")) === "true";
    if (!short && !(await row.getByTestId("member-now").count())) throw new Error("A person of the squad does not say what it does now");
    const sign = await row.getByTestId("member-sign").getAttribute("data-sign");
    if (!["working", "waiting", "free", "stopped"].includes(sign)) throw new Error(`A person of the squad has no sign: ${sign}`);
  }
  if (await teamPanel.getByText(/^[A-Z]{1,2}-[0-9A-F]{8}$/).count()) throw new Error("The Squads view shows an id outside the hover");
  const sharedToggle = teamPanel.getByTestId("shared-roles-toggle");
  if ((await sharedToggle.getAttribute("aria-expanded")) !== "false") throw new Error("The shared roles are not closed at first");
  if (!/^Ruoli condivisi\s*\d+/.test((await sharedToggle.innerText()).trim())) throw new Error("The shared roles do not show their count");
  // Design of 30 September, Squads list: the blocks have 16 px above and below (the 8 px grid) and a closed section's row is 32 px.
  const blockPads = await teamPanel.locator('[data-testid="squad"], [data-testid="squads-summary"]').evaluateAll((els) => els.flatMap((el) => [getComputedStyle(el).paddingTop, getComputedStyle(el).paddingBottom]));
  if (!blockPads.length || blockPads.some((pad) => pad !== "16px")) throw new Error(`The blocks of the Squads view are not 16 px apart: ${blockPads}`);
  if ((await sharedToggle.boundingBox()).height < 32) throw new Error("The row of a closed section is under 32 px");
  const person = teamPanel.getByTestId("team-developer").first();
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const top = await summary.evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, scrolled: el.parentElement.scrollTop, height: innerHeight }));
    if (top.scrolled !== 0 || top.bottom > top.height) throw new Error(`Who works now is not in view at ${size}: ${JSON.stringify(top)}`);
    await noHorizontalScroll(`Squads view ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`33a-teams-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(teamsLook.provider, teamsLook.dark);
    await person.click();
    // Issue #336: the person opens in an editor tab; the tab carries the name, the panel keeps the title for screen readers.
    const detail = detailPane().getByTestId("specialist");
    await detail.waitFor();
    if ((await detailPane().getAttribute("aria-label")) !== "Persona della squadra") throw new Error("The detail is not titled Persona della squadra");
    await detail.getByTestId("specialist-now").waitFor();
    // Design of 30 September, agent screen: header, situation (what holds it up, next move, Ask), the work now, one
    // list of assignments; the settings are a gear in the header, not a section of the page.
    await detail.getByTestId("specialist-brief").getByTestId("brief-next").waitFor();
    const order = await detail.evaluate((el) => ["specialist-header", "specialist-brief", "specialist-now", "specialist-assignments"].map((id) => el.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top));
    if (!(order[0] < order[1] && order[1] < order[2] && order[2] < order[3])) throw new Error(`The person's page is not header, situation, work and assignments in this order: ${order}`);
    // "Sta facendo" repeated the title of the Now card: the summary has no such row.
    if ((await detail.getByTestId("brief-doing").count()) || (await detail.getByText("Sta facendo", { exact: true }).count())) throw new Error("The summary still repeats what the Now card says");
    // One list of assignments, the latest result first; no section of its own for it.
    await detail.getByRole("heading", { name: /^Incarichi \(\d+\)$/ }).waitFor();
    if (await detail.getByRole("heading", { name: "Ultimo risultato" }).count()) throw new Error("The last result still has a section of its own");
    // The Ask button is on the right under the summary, with icon and text (it starts work), and it is not filled.
    const askBox = await detail.getByTestId("specialist-ask").evaluate((el) => {
      const ask = el.querySelector("button").getBoundingClientRect();
      const brief = el.parentElement.querySelector('[data-testid="specialist-brief"]').getBoundingClientRect();
      const row = el.getBoundingClientRect();
      return { below: ask.top >= brief.bottom, right: Math.abs(row.right - ask.right) <= 1, text: el.querySelector("button").innerText.trim(), icon: Boolean(el.querySelector("button svg")) };
    });
    if (!askBox.below || !askBox.right || askBox.text !== "Chiedi" || !askBox.icon) throw new Error(`Ask is not right, under the summary, with icon and text: ${JSON.stringify(askBox)}`);
    // The header, Ask and the settings have no filled button: the window's one is the one of Aspetta te.
    if (await detail.locator('[data-testid="specialist-header"] button[data-variant="default"]:not([data-filled="false"]), [data-testid="specialist-ask"] button[data-variant="default"]:not([data-filled="false"])').count()) throw new Error("The person's header or Ask has a filled button");
    // The model is written in a small note in the header, so the settings need not be opened to know it.
    await detail.getByTestId("specialist-header").getByTestId("specialist-model-note").getByText(/^Modello: /).waitFor();
    const idOnHover = await detail.getByTestId("specialist-header").getAttribute("title");
    if (!/^S-[0-9A-F]{8}$/.test(idOnHover ?? "") || (await detail.getByText(/^[A-Z]{1,2}-[0-9A-F]{8}$/).count())) throw new Error(`The person's id is not only on hover: ${idOnHover}`);
    for (const fold of ["Perché è nella squadra", "Quando interviene"]) {
      if ((await detail.getByRole("button", { name: fold }).getAttribute("aria-expanded")) !== "false") throw new Error(`${fold} is not closed at first`);
    }
    // Modello e Aspetto are not in the page: the panel of the gear holds them, closed at first.
    if (await detail.getByRole("button", { name: "Colore", exact: true }).count()) throw new Error("The color still waits in a closed section");
    if (await detail.getByTestId("specialist-settings").count()) throw new Error("The settings are still a section of the page");
    if ((await detail.getByText("Personalizza aspetto").count()) || (await detail.getByTestId("agent-look-open").count())) throw new Error("The look still has its own button in the page");
    if (await detail.getByTestId("agent-settings-panel").count()) throw new Error("The settings panel is open before the person asks");
    // The gear is only an icon, with no box at rest and a color change under the pointer, with tooltip and name.
    const gear = detail.getByTestId("agent-settings-open");
    if ((await gear.getAttribute("aria-label")) !== "Impostazioni dell'agente" || (await gear.innerText()).trim()) throw new Error("The gear is not an icon named 'Impostazioni dell'agente'");
    const gearStyle = () => gear.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, border: c.borderTopWidth, color: c.color, box: el.getBoundingClientRect() }; });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const gearRest = await gearStyle();
    if (gearRest.bg !== "rgba(0, 0, 0, 0)" || gearRest.border !== "0px") throw new Error(`The gear has a container at rest: ${JSON.stringify(gearRest)}`);
    if (gearRest.box.width < 32 || gearRest.box.height < 32) throw new Error(`The gear is under 32 px: ${JSON.stringify(gearRest.box)}`);
    await gear.hover();
    await page.waitForTimeout(250);
    const gearHover = await gearStyle();
    if (gearHover.bg !== "rgba(0, 0, 0, 0)" || gearHover.border !== "0px" || gearHover.color === gearRest.color) throw new Error(`The gear does not only change color under the pointer: ${JSON.stringify([gearRest, gearHover])}`);
    await page.locator(".translucent-popup").getByText("Impostazioni dell'agente", { exact: true }).waitFor();
    await page.mouse.move(0, 0);
    if (await detail.getByRole("button", { name: "Squadre", exact: true }).count()) throw new Error("The person's tab still shows the way back to the Squads view");
    // UI wave of 29 September: at 1280x800 the tab covers the conversation and the work bar is its last row.
    await workBarPlace(`the person's tab at ${size}`, width === 1280 ? "tab" : "composer");
    await noHorizontalScroll(`person of the squad ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`33b-person-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
    await setLookTo(teamsLook.provider, teamsLook.dark);
    // The list stays in the side bar next to the tab (B07): no way back is needed.
    await summary.waitFor();
  }
  // The person's tab stays open after going back to the list (issue #336): close it, as the side bar did.
  await closeDetails();
  await page.setViewportSize({ width: 1280, height: 820 });
}
await openSharedRoles();
const sharedRoles = teamPanel.getByTestId("shared-roles");
await sharedRoles.getByTestId("team-figure").filter({ hasText: "Niente si rompe" }).waitFor();
if (await sharedRoles.locator('[data-role="qa"], [data-role="squadLead"]').count()) throw new Error("A member of the squad is among the shared roles");
if (await teamPanel.getByText("Chiarimento e spec", { exact: true }).count()) throw new Error("The Squads view still lists the team moment by moment");
await themeShots("04e-squads");
// Issue #461: the README screenshots are done; the rest of the run goes back to the usual fake Codex replies.
await rm(readmeShotsFlag, { force: true });
// W16: right after the team is generated, every agent rests with its eyes open; only an agent out of the team sleeps.
// A blink lasts 0.13 s and comes every few seconds, so with a dozen bots one sample often catches one: three samples
// 200 ms apart, and each bot keeps its widest eyes, since no blink covers two of them.
const eyeSamples = [];
for (let i = 0; i < 3; i++) {
  if (i) await page.waitForTimeout(200);
  eyeSamples.push(
    await teamPanel.evaluate((el) =>
      [...el.querySelectorAll('[data-testid="agent-bot"]')].map((bot) => ({
        agent: bot.dataset.agent,
        activity: bot.dataset.activity,
        eyes: Number(bot.querySelector('[data-part="eyes"]')?.getAttribute("opacity") ?? 0),
        open: Math.max(...[...bot.querySelectorAll('[data-part^="eye-"]')].map((eye) => eye.getBBox().height)),
      })),
    ),
  );
}
const teamEyes = eyeSamples[0].map((bot, i) => ({ ...bot, open: Math.max(...eyeSamples.map((sample) => sample[i]?.open ?? 0)) }));
const shut = teamEyes.filter((bot) => bot.activity === "inactive" || bot.eyes < 1 || bot.open < 5);
if (shut.length) throw new Error(`Bots without open eyes right after the team: ${JSON.stringify(shut)}`);
// W15: each agent has an avatar with its initial and a colored tag; the tag comes from the proposal.
await teamPanel.getByTestId("team-developer").getByTestId("agent-tag").filter({ hasText: "[Ordini]" }).waitFor();
if ((await teamPanel.getByTestId("team-figure").getByTestId("agent-tag").count()) < 5) throw new Error("The fixed roles have no tag");
// W13: the person renames the developer from the Team view; the id stays and a fixed role's name is refused.
// Issue #336: the person of the team opens in an editor tab next to the conversation, the list stays in the side bar.
await teamPanel.getByTestId("team-developer").first().click();
const personTab = detailPane();
await personTab.and(page.locator('[data-kind="specialist"]')).waitFor();
// Issue #392: the id is Trama's, so the header keeps it on hover and in the DOM, not as a visible badge.
const developerId = await personTab.getByTestId("specialist-header").locator("h3[data-record-id]").getAttribute("data-record-id");
if (!/^S-[0-9A-F]{8}$/.test(developerId ?? "")) throw new Error(`The specialist's header lost its id: ${developerId}`);
await expectNoRawIds(personTab.getByTestId("specialist-header"), "The specialist's header");
// Issue #333: the whole header carries the id on hover too; Rename and Remove are in the menu of more actions.
if ((await personTab.getByTestId("specialist").getAttribute("data-specialist-id")) !== developerId || (await personTab.getByTestId("specialist-header").getAttribute("title")) !== developerId) throw new Error(`The developer's id is not on hover: ${developerId}`);
const personMenu = await openMenu(personTab.getByRole("button", { name: "Altre azioni", exact: true }));
await personMenu.getByRole("menuitem", { name: "Togli dalla squadra" }).waitFor();
// Design of 30 September: the menu keeps only the destructive actions; Rename moved into the settings panel.
if ((await personMenu.getByRole("menuitem").count()) !== 1 || (await personMenu.getByRole("menuitem", { name: "Rinomina" }).count())) throw new Error("The menu of more actions has more than the destructive action");
// Removing asks for the reason, and the full red is only in that confirm step.
if (await personTab.locator('button[data-variant="destructive"]').count()) throw new Error("A destructive button shows before the confirm step");
await personMenu.getByRole("menuitem", { name: "Togli dalla squadra" }).click();
const removeStep = personTab.getByTestId("remove-specialist");
await removeStep.getByRole("button", { name: /^Togli / }).waitFor();
if (await removeStep.getByRole("button", { name: /^Togli / }).isEnabled()) throw new Error("Removing does not wait for the reason");
if ((await removeStep.getByRole("button", { name: /^Togli / }).getAttribute("data-variant")) !== "destructive") throw new Error("The confirm step is not the destructive one");
await removeStep.getByRole("button", { name: "Annulla" }).click();
await removeStep.waitFor({ state: "detached" });
// The settings panel opens under the header from the gear, and from the avatar too.
const agentPanel = personTab.getByTestId("agent-settings-panel");
await personTab.getByTestId("agent-settings-avatar").click();
await agentPanel.waitFor();
await personTab.getByTestId("agent-settings-avatar").click();
await agentPanel.waitFor({ state: "detached" });
await personTab.getByTestId("agent-settings-open").click();
await agentPanel.waitFor();
if ((await personTab.getByTestId("agent-settings-open").getAttribute("aria-expanded")) !== "true") throw new Error("The gear does not say the panel is open");
if (await agentPanel.evaluate((el) => el.getBoundingClientRect().top < el.closest('[data-testid="specialist"]').querySelector('[data-testid="specialist-header"]').getBoundingClientRect().bottom)) throw new Error("The settings panel is not under the header");
// Two parts, Modello and Aspetto, with a line between them; no Done and no Rename button.
if (await agentPanel.locator('button[data-variant="default"]:not([data-filled="false"])').count()) throw new Error("The settings panel has a filled button");
await agentPanel.getByRole("heading", { name: "Modello", exact: true }).waitFor();
await agentPanel.getByRole("heading", { name: "Aspetto", exact: true }).waitFor();
if ((await agentPanel.locator("hr").count()) !== 1) throw new Error("The panel does not separate the model from the look with a line");
if ((await agentPanel.getByRole("button", { name: "Fatto" }).count()) || (await agentPanel.getByRole("button", { name: "Rinomina" }).count())) throw new Error("The panel has a Done or Rename button: changes save at once");
await agentPanel.getByTestId("agent-look-preview").getByText("Come si vede").waitFor();
await agentPanel.getByTestId("agent-look-preview-chat").waitFor();
await agentPanel.getByTestId("agent-look-preview-list").waitFor();
// W13: the person renames the developer from the name field; a fixed role's name is refused, and the name saves on Enter.
const nameField = agentPanel.getByLabel("Nuovo nome");
await nameField.fill("Ordine del codice");
await agentPanel.getByText("È il nome di un ruolo fisso").waitFor();
await nameField.blur();
await page.waitForTimeout(400);
if (await personTab.getByRole("heading", { name: "Ordine del codice" }).count()) throw new Error("A fixed role's name can be chosen");
await nameField.fill("Giulia");
await shot("04e3-team-rename");
await nameField.press("Enter");
await personTab.getByRole("heading", { name: "Giulia" }).waitFor({ timeout: 20_000 });
await agentPanel.getByTestId("agent-settings-saved").getByText("Salvato").waitFor();
// The id stays the same after the rename.
await personTab.getByTestId("specialist-header").locator(`h3[data-record-id="${developerId}"]`).waitFor();
// The tab takes the new name too.
await page.locator('[data-testid="editor-tab"][data-selected="true"]').getByText("Giulia", { exact: true }).waitFor();
// W15: the person picks another color, as the bot in that color with its name on hover and as its accessible name; only the avatar and the tag take it.
const colorGroup = agentPanel.getByRole("radiogroup");
if ((await colorGroup.getAttribute("aria-labelledby")) === null) throw new Error("The color group has no name");
await shot("04e4a-agent-look-panel");
await agentPanel.getByRole("radio", { name: "Rame" }).click();
await agentPanel.locator('[role="radio"][aria-checked="true"][aria-label="Rame"]').waitFor({ timeout: 20_000 });
// The ring fades in and out with a transition: measure it once it has settled.
await page.waitForTimeout(600);
const chips = await colorGroup.getByRole("radio").evaluateAll((all) => all.map((el) => ({ name: el.getAttribute("aria-label") ?? "", bot: el.children.length > 0, height: el.getBoundingClientRect().height, ring: getComputedStyle(el).boxShadow, checked: el.getAttribute("aria-checked") })));
if (chips.some((chip) => !chip.name || !chip.bot || chip.height < 32)) throw new Error(`A color lacks its bot, its accessible name or 32 px: ${JSON.stringify(chips)}`);
// Only the chosen color has the ring.
const chosenChips = chips.filter((chip) => chip.checked === "true");
if (chosenChips.length !== 1 || chips.filter((chip) => chip.ring !== "none").length !== 1 || chosenChips[0].ring === "none") throw new Error(`Only the chosen color has the ring: ${JSON.stringify(chips)}`);
await agentPanel.getByTestId("agent-settings-saved").getByText("Salvato").waitFor();
await shot("04e4-team-color");
// The panel closes with its X, with Escape and with the gear again, and it opens again on the saved color.
await agentPanel.getByRole("button", { name: "Chiudi le impostazioni" }).click();
await agentPanel.waitFor({ state: "detached" });
await personTab.getByTestId("agent-settings-open").click();
await agentPanel.waitFor();
await agentPanel.locator('[role="radio"][aria-checked="true"][aria-label="Rame"]').waitFor();
await page.keyboard.press("Escape");
await agentPanel.waitFor({ state: "detached" });
await personTab.getByTestId("agent-settings-open").click();
await agentPanel.waitFor();
// Issue #455: the head carries no way back; the squad stays written under the name.
await personTab.getByTestId("specialist-squad").getByText(/^Squadra .+, sviluppatore\.$/).waitFor();
if (await personTab.getByRole("button", { name: "Squadre", exact: true }).count()) throw new Error("The person's tab still shows the way back to the Squads view");
// Issue #455: the person chooses the developer's model with the composer's picker, in the panel; it holds for the next assignments.
const agentModel = agentPanel.getByTestId("specialist-model-picker");
if (!(await agentModel.innerText()).includes("Sceglie il Coordinatore")) throw new Error(`The developer's model does not say the Coordinator chooses: ${await agentModel.innerText()}`);
await personTab.getByTestId("specialist-header").getByTestId("specialist-model-note").getByText("Modello: scelto dal Coordinatore").waitFor();
if ((await agentModel.getAttribute("aria-label")) !== "Provider, modello e sforzo di Giulia") throw new Error(`The developer's model picker is not named for Giulia: ${await agentModel.getAttribute("aria-label")}`);
await agentModel.click();
await page.getByRole("option", { name: /GPT-5\.5 Fast/ }).click();
await agentModel.getByText("GPT-5.5 Fast").waitFor({ timeout: 20_000 });
await agentPanel.getByText("Vale per i prossimi incarichi di Giulia. L'incarico in corso non cambia.").waitFor();
await personTab.getByTestId("specialist-header").getByTestId("specialist-model-note").getByText("Modello: GPT-5.5 Fast").waitFor();
const settingsButtons = await agentPanel.locator("button").allTextContents();
if (!settingsButtons.some((text) => text.trim() === "Lascia scegliere al Coordinatore")) throw new Error(`The developer's model cannot go back to the Coordinator: ${settingsButtons}`);
await agentPanel.scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await shot(`04e5-agent-settings-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await teamPanel.getByTestId("team-developer").filter({ hasText: "Giulia" }).waitFor();
await openSharedRoles();
await sharedRoles.scrollIntoViewIfNeeded();
await themeShots("04e1-squads-shared-roles");
await teamPanel.getByTestId("team-figure").filter({ hasText: "Niente si rompe" }).first().click();
await personTab.getByText("Quando interviene").waitFor();
// Reopening a person brings back their tab: the fixed role takes a tab of its own, Giulia's stays one.
if ((await page.locator('[data-testid="editor-tab"][data-tab^="detail:specialist:"]').count()) !== 2) throw new Error("A person of the team opened in more than one tab");
// Remove is in the menu of more actions (issue #333): a fixed role has no such menu. It still has the gear: its model and
// color can change, and its name field is off with the note that the name does not change.
if (await personTab.getByRole("button", { name: "Altre azioni", exact: true }).count()) throw new Error("A fixed role offers to leave the team");
await personTab.getByTestId("agent-settings-open").click();
const fixedPanel = personTab.getByTestId("agent-settings-panel");
await fixedPanel.waitFor();
if (!(await fixedPanel.getByLabel("Nuovo nome").isDisabled())) throw new Error("A fixed role's name field is on");
await fixedPanel.getByText("È un ruolo fisso del team: il nome non cambia.").waitFor();
await shot("04e2-team-fixed-role");
// W16: at the detail's narrowest width, with a long name, the header keeps the name on one line and the status whole.
// Issue #336: the narrowest is the tab over the conversation at 720 px, next to the side bar.
await page.setViewportSize({ width: 720, height: 820 });
await page.waitForTimeout(300);
const header = await personTab.getByTestId("specialist-header").evaluate((el) => {
  const inspector = el.closest('[data-testid="editor-detail"]').getBoundingClientRect();
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
if (header.inspector > 440) throw new Error(`The detail is not at its narrowest width: ${header.inspector}`);
if (!header.statusInside || !header.statusWhole) throw new Error(`The specialist's status is cut at the minimum width: ${JSON.stringify(header)}`);
if (header.nameLines !== 1) throw new Error(`The specialist's name wraps at the minimum width: ${JSON.stringify(header)}`);
await shot("04e2b-specialist-narrow");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("04e2c-specialist-narrow-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
// Issue #455: at the narrowest width the settings fit the tab: the model picker, the chips and the name stay inside it.
const narrowSettings = personTab.getByTestId("agent-settings-panel");
await narrowSettings.scrollIntoViewIfNeeded();
const settingsFit = await narrowSettings.evaluate((el) => {
  const tab = el.closest('[data-testid="editor-detail"]').getBoundingClientRect();
  const parts = [el.querySelector('[data-testid="specialist-model-picker"]'), ...el.querySelectorAll('[role="radio"]'), el.querySelector("input")].map((part) => part.getBoundingClientRect());
  return { inside: parts.every((box) => box.left >= tab.left - 0.5 && box.right <= tab.right + 0.5), overflow: el.scrollWidth > el.clientWidth + 1 };
});
if (!settingsFit.inside || settingsFit.overflow) throw new Error(`The agent's settings do not fit the narrow tab: ${JSON.stringify(settingsFit)}`);
await shot("04e2d-agent-settings-narrow");
// UI wave of 30 September: in a narrow window the work bar gives up the waiting item's title before it cuts it in "C…".
const narrowBarCut = await page.evaluate(() => [...document.querySelectorAll('[data-testid="waiting-summary"] .truncate')].some((el) => el.scrollWidth > el.clientWidth + 1));
if (narrowBarCut) throw new Error("The work bar cuts the waiting item in a narrow window");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("04e2e-agent-settings-narrow-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.setViewportSize({ width: 1280, height: 820 });
if ((await personTab.getByRole("button", { name: "Altre azioni", exact: true }).count()) || (await page.getByRole("menuitem", { name: "Rinomina" }).count())) throw new Error("A fixed role offers a rename");
await closePanels();
await closeDetails();
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
await openSharedRoles();
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
// Issue #333: the cost at rest is read on the view as the person first sees it, with the shared roles closed.
await teamPanel.getByTestId("shared-roles-toggle").click();
await teamPanel.getByTestId("shared-roles").waitFor({ state: "detached" });
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
// A shared CI runner adds short spikes of CPU that have nothing to do with the bots, and one 3 s reading could land on
// one. The cost is read as five pairs of short samples, animated and with reduced motion, taken one after the other so
// the still reading is the baseline of the same moment; the medians of the two series are compared. A spike moves one
// sample and leaves the medians where they are, while a real cost shows in every animated sample and still fails.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const animatedSamples = [];
const stillSamples = [];
for (let pair = 0; pair < 5; pair++) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(300);
  animatedSamples.push(await cpuOver(1_500));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  stillSamples.push(await cpuOver(1_500));
}
await page.emulateMedia({ reducedMotion: "no-preference" });
const cpuMoving = median(animatedSamples);
const cpuStill = median(stillSamples);
const cpuReadings = `animated ${animatedSamples.map((v) => v.toFixed(1)).join(", ")}; reduced motion ${stillSamples.map((v) => v.toFixed(1)).join(", ")}`;
console.log(`bots CPU samples: ${cpuReadings}`);
if (cpuMoving - cpuStill > 5) throw new Error(`The bots at rest cost ${(cpuMoving - cpuStill).toFixed(1)}% of CPU, over 5%`);
console.log(
  `bots: ${botSizes.length} on screen, ${movingFrames} frames with the cursor moving, ${restFrames} frames in 3 s at rest, ` +
    `renderer+GPU CPU at rest ${cpuMoving.toFixed(1)}% animated, ${cpuStill.toFixed(1)}% with reduced motion (medians of 5)`,
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
await closePanels();
await shot("04e8-bots-chat-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("04e9-bots-chat-light");
// Issue #331: what the person decided today stays closed at the end of Aspetta te; opened, it names the answer. It is
// read after the bots' cost at rest, so its screenshots do not fall in that measure.
{
  await openView("Aspetta te");
  const decided = page.getByTestId("side-bar").getByTestId("waiting-decided");
  await decided.waitFor();
  const toggle = decided.getByRole("button", { name: /^Decise oggi/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "false" || (await decided.getByTestId("waiting-decided-item").count())) throw new Error("Decise oggi is open before the person opens it");
  // One state at a time: a list with its count, or, with nothing waiting, one message and the way back to the conversation.
  const waitingView = page.getByTestId("waiting-view");
  const waitingState = await waitingView.getAttribute("data-state");
  const summary = await waitingView.getByTestId("waiting-view-summary").innerText();
  if (waitingState === "empty") {
    if (!summary.includes("Niente aspetta te") || summary.includes("Nessuna domanda")) throw new Error(`The empty Aspetta te repeats itself: ${summary}`);
    const write = waitingView.getByTestId("waiting-view-write");
    await write.waitFor();
    if ((await write.getAttribute("data-variant")) === "default") throw new Error("The empty Aspetta te has a filled button");
    if (await waitingView.getByTestId("waiting-item").count()) throw new Error("The empty Aspetta te lists items");
  } else if (waitingState === "list") {
    if (await waitingView.getByTestId("waiting-view-write").count()) throw new Error("Aspetta te shows the empty action while things wait");
  } else {
    throw new Error(`Aspetta te is still ${waitingState} with the project open`);
  }
  await toggle.click();
  await decided.getByTestId("waiting-decided-item").filter({ hasText: "Cosa succede a un ordine pagato annullato?" }).filter({ hasText: "Risposta data" }).waitFor();
  await decided.scrollIntoViewIfNeeded();
  await themeShots("31d-waiting-decided-today");
  await toggle.click();
  await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
}

// Learning (ADR 0014): the Coordinator saves a note, then a review the person asks for writes memory and a skill.
await page.getByLabel("Messaggio al Coordinatore").fill("[memoria] ricorda il gestore di pacchetti");
await page.keyboard.press("Enter");
await page.getByText(/^Salvato\./).first().waitFor({ timeout: 20_000 });
await openView("Memoria");
// Issue #335: Memoria is a view of the side bar. "Come impara" sits closed at the bottom: no review takes room until
// the person opens it, and its Rivedi ora is an icon on the closed row.
const memoryView = page.getByTestId("memory-view");
const howItLearns = memoryView.getByTestId("how-it-learns");
if ((await howItLearns.getAttribute("data-open")) !== "false") throw new Error("Come impara is open before the person opens it");
await memoryView.getByRole("button", { name: "Rivedi ora" }).click();
await howItLearns.getByRole("button", { name: /^Come impara/ }).click();
// The last review stays in view; the earlier ones wait in the history, closed until the person opens it.
await howItLearns.getByTestId("review-run").filter({ hasText: "chiesta da te" }).filter({ hasNotText: "In corso" }).first().waitFor({ timeout: 30_000 });
if ((await howItLearns.getByTestId("review-run").count()) !== 1) throw new Error("The review history is open before the person opens it");
await memoryView.getByTestId("review-history-toggle").click();
await memoryView.getByTestId("review-history").waitFor();
await page.getByText("Skill 'release-flow' creata").first().waitFor({ timeout: 30_000 });
await shot("04i-memory");
await memoryView.getByTestId("review-history-toggle").click();
await memoryView.getByTestId("review-history").waitFor({ state: "detached" });
// The memory proposals wait in Aspetta te only: the view keeps one line that points there, without Scarta or Applica.
// A notes file edited by hand past its limit: the next note is refused and Trama proposes to shorten it (issue #305).
const learningDirs = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await learningDirs(path)));
    else if (entry.name === "reviews.json") found.push(dir);
  }
  return found;
};
const [projectLearningDir] = await learningDirs(dataDir);
if (!projectLearningDir) throw new Error("No learning folder for the example project");
await writeFile(
  join(projectLearningDir, "MEMORY.md"),
  [`Nota vecchia: ${"a".repeat(1400)}`, `Nota recente: ${"b".repeat(1000)}`].join("\n§\n"),
);
await memoryView.getByRole("button", { name: "Aggiungi una nota sul progetto" }).click();
await memoryView.getByRole("textbox", { name: "Aggiungi una nota sul progetto" }).fill("Il catalogo si aggiorna di notte");
await memoryView.getByRole("button", { name: "Aggiungi", exact: true }).click();
const memoryWaiting = memoryView.getByTestId("memory-waiting");
await memoryWaiting.filter({ hasText: /^1 proposta aspetta te: / }).waitFor({ timeout: 20_000 });
await memoryView.getByRole("button", { name: "Annulla", exact: true }).click();
await page.getByRole("alert").filter({ hasText: "La memoria del progetto è piena" }).getByRole("button", { name: "Chiudi" }).click();
if (await memoryView.getByTestId("memory-proposal").count()) throw new Error("A memory proposal shows in Memoria too");
if (await memoryView.getByRole("button", { name: /^(Scarta|Applica)$/ }).count()) throw new Error("Memoria offers the proposal's answers");
await themeShots("35-memory-waiting-line");
await memoryWaiting.click();
const memoryProposal = page.getByTestId("side-bar").getByTestId("memory-proposal");
await memoryProposal.waitFor();
const proposalAnswers = await memoryProposal.locator(".cta-row button").allInnerTexts();
if (proposalAnswers.join("|") !== "Scarta|Applica") throw new Error(`The memory proposal's answers: ${proposalAnswers.join(", ")}`);
await memoryProposal.getByRole("button", { name: "Applica" }).click();
await memoryProposal.waitFor({ state: "detached", timeout: 10_000 });
await openView("Memoria");
if (await memoryView.getByTestId("memory-waiting").count()) throw new Error("The proposal still waits after Applica");
// Modifica and Salva rewrite the note that stayed.
const keptNote = memoryView.getByTestId("memory-entry").filter({ hasText: "Nota recente" });
await keptNote.getByRole("button", { name: "Modifica" }).click();
await memoryView.getByRole("textbox", { name: "Modifica" }).fill("Il catalogo si aggiorna di notte: le modifiche ai prezzi arrivano la mattina dopo.");
await memoryView.getByRole("button", { name: "Salva", exact: true }).click();
await memoryView.getByTestId("memory-entry").filter({ hasText: "Il catalogo si aggiorna di notte" }).waitFor({ timeout: 10_000 });
if ((await howItLearns.getAttribute("data-open")) !== "true") await howItLearns.getByRole("button", { name: /^Come impara/ }).click();
// The learning switches live only here, in Come impara, one copy (they left Impostazioni).
const learningSwitches = howItLearns.getByTestId("learning-switches");
if ((await learningSwitches.getByRole("switch").count()) !== 5) throw new Error("Come impara does not hold the five learning switches");
const consolidateSwitch = learningSwitches.getByRole("switch", { name: "Unire con un modello le skill troppo simili" });
const consolidateBefore = await consolidateSwitch.getAttribute("aria-checked");
await consolidateSwitch.click();
await learningSwitches.locator(`[role="switch"][aria-label="Unire con un modello le skill troppo simili"][aria-checked="${consolidateBefore === "true" ? "false" : "true"}"]`).waitFor();
await consolidateSwitch.click();
await learningSwitches.locator(`[role="switch"][aria-label="Unire con un modello le skill troppo simili"][aria-checked="${consolidateBefore}"]`).waitFor();
// Upkeep of the skills: Controlla ora and Anteprima are icons; the result reads in the person's language, never the
// upkeep's technical summary; "Sospendi la manutenzione" takes the place of "Metti in pausa".
const curatorStatus = howItLearns.getByTestId("curator-status");
await howItLearns.getByRole("button", { name: "Controlla ora" }).click();
await curatorStatus.filter({ hasText: /^Ultimo controllo .+: .+\./ }).waitFor({ timeout: 20_000 });
await howItLearns.getByRole("button", { name: /^Anteprima/ }).click();
await curatorStatus.filter({ hasText: /anteprima, / }).waitFor({ timeout: 20_000 });
if (/auto:|llm|deferred|curator|seeded|[–—]/.test(await curatorStatus.innerText())) throw new Error(`The upkeep speaks its technical summary: ${await curatorStatus.innerText()}`);
if (await howItLearns.getByRole("button", { name: "Metti in pausa" }).count()) throw new Error("The upkeep still offers Metti in pausa");
await howItLearns.getByRole("button", { name: "Sospendi la manutenzione" }).click();
await howItLearns.getByRole("button", { name: "Riprendi la manutenzione" }).click();
await howItLearns.getByRole("button", { name: "Sospendi la manutenzione" }).waitFor();
// Notes and profile: Aggiungi and Modifica are icons; the text buttons of the editor sit on the right, Salva last.
await memoryView.getByRole("button", { name: "Aggiungi una nota sul progetto" }).click();
await memoryView.getByRole("textbox", { name: "Aggiungi una nota sul progetto" }).fill("I rilasci partono dal branch main");
await memoryView.getByRole("button", { name: "Aggiungi", exact: true }).click();
const addedNote = memoryView.getByTestId("memory-entry").filter({ hasText: "I rilasci partono dal branch main" });
await addedNote.waitFor({ timeout: 10_000 });
await addedNote.getByRole("button", { name: "Modifica" }).click();
const noteActions = await memoryView.getByTestId("memory-entry").locator(".cta-row button").allInnerTexts();
if (noteActions.join("|") !== "Togli|Annulla|Salva") throw new Error(`The note editor's buttons: ${noteActions.join(", ")}`);
await memoryView.getByTestId("memory-entry").getByRole("button", { name: "Togli" }).click();
await addedNote.waitFor({ state: "detached", timeout: 10_000 });
// Critique of 29 September 2026: a nearly full section says what to do (Riordina, whose changes wait in Aspetta te), and
// a note in another language than the person's says so and stays as it was written. The profile is filled to 94% of
// its limit with the person's own notes, one of them in English, and emptied of them afterwards.
{
  const profileNow = async () => (await page.evaluate(() => window.trama.getState())).learning.user;
  const profileNote = async (action, text) => {
    const result = await page.evaluate(([what, note]) => window.trama.invoke("learning:memory", { target: "user", action: what, content: note, oldText: note }), [action, text]);
    if (!result?.success) throw new Error(`A note of the profile was not ${action === "add" ? "added" : "removed"}: ${result?.error}`);
  };
  const englishNote = "Wants short answers and one step at a time, with the recommended option already marked on the card.";
  await profileNote("add", englishNote);
  const before = await profileNow();
  const room = Math.floor(before.limit * 0.94) - before.chars - 3;
  if (room < 40) throw new Error(`The profile has no room for the test of Riordina: ${before.chars} of ${before.limit}`);
  const filler = "La persona legge le spiegazioni sul telefono tra un cliente e l'altro, quindi preferisce frasi brevi e un passaggio alla volta. ";
  const italianNote = filler.repeat(Math.ceil(room / filler.length)).slice(0, room).trim();
  await profileNote("add", italianNote);
  const tidy = memoryView.locator('[data-testid="memory-tidy"][data-state="full"]');
  const tidyButton = tidy.getByRole("button", { name: "Riordina il tuo profilo" });
  await tidyButton.waitFor({ timeout: 10_000 });
  if ((await tidyButton.innerText()).trim() !== "Riordina") throw new Error("The action of a nearly full profile does not read Riordina");
  const english = memoryView.locator('[data-testid="memory-entry"][data-language="en"]').filter({ hasText: "Wants short answers" });
  await english.getByTestId("memory-entry-language").getByText("In inglese").waitFor();
  if (!(await english.innerText()).includes(englishNote)) throw new Error("A note in another language changed its words");
  if (await memoryView.getByTestId("memory-entry").filter({ hasText: "La persona legge le spiegazioni" }).getByTestId("memory-entry-language").count()) {
    throw new Error("A note in the person's language is marked as in another language");
  }
  await tidy.scrollIntoViewIfNeeded();
  await sideBarEnds("54-memory-profile-full");
  // Riordina starts a review of the profile the person asked for; what it changes becomes a proposal, never a rewrite.
  const reviewsBefore = (await page.evaluate(() => window.trama.getState())).learning.reviews.length;
  await tidyButton.click();
  for (let tries = 0; ; tries++) {
    const learning = (await page.evaluate(() => window.trama.getState())).learning;
    if (learning.reviews.length > reviewsBefore && learning.reviews[0].trigger === "person" && learning.reviews[0].status !== "running") break;
    if (tries > 120) throw new Error("Riordina did not run a review of the profile");
    await page.waitForTimeout(250);
  }
  if (!(await memoryView.getByTestId("memory-entry").filter({ hasText: englishNote }).count())) throw new Error("Riordina rewrote a note without the person's yes");
  // The proposals of this review and the notes of the test leave, so the rest of the run finds Memoria as before.
  for (const id of (await page.evaluate(() => window.trama.getState())).learning.proposals.map((p) => p.id)) {
    await page.evaluate((proposal) => window.trama.invoke("learning:proposal", { id: proposal, approve: false }), id);
  }
  await profileNote("remove", italianNote);
  await profileNote("remove", englishNote);
  await tidy.waitFor({ state: "detached", timeout: 10_000 });
}
// Skills: Apri, Fissa and Archivia are icons with a tooltip and a name; Elimina keeps its text.
const learnedSkill = memoryView.getByTestId("learned-skill").filter({ hasText: "release-flow" });
for (const name of ["Apri", "Fissa", "Archivia"]) await learnedSkill.getByRole("button", { name, exact: true }).waitFor();
// Design rules: a skill is a 32 px row (name, state, icon actions); the description, the counters and Elimina wait in
// the detail, closed until the person opens the row.
if ((await learnedSkill.getAttribute("data-open")) !== "false") throw new Error("A skill's detail is open before the person opens it");
if (await learnedSkill.getByTestId("learned-skill-detail").count()) throw new Error("A closed skill shows its detail");
const skillRow = await learnedSkill.getByRole("button", { name: /^release-flow/ }).boundingBox();
if (!skillRow || skillRow.height < 32) throw new Error(`A skill's row is under 32 px: ${skillRow?.height}`);
for (const name of ["Apri", "Fissa", "Archivia"]) {
  const box = await learnedSkill.getByRole("button", { name, exact: true }).boundingBox();
  if (!box || box.width < 32 || box.height < 32) throw new Error(`${name} is under 32 px: ${box?.width}x${box?.height}`);
}
await learnedSkill.getByRole("button", { name: /^release-flow/ }).click();
await learnedSkill.getByTestId("learned-skill-detail").waitFor();
if (!(await learnedSkill.getByRole("button", { name: "Elimina" }).innerText()).includes("Elimina")) throw new Error("Elimina lost its text");
if (await learnedSkill.locator('button[data-variant="destructive"]').count()) throw new Error("Elimina is red before the confirmation step");
await learnedSkill.getByRole("button", { name: "Elimina" }).click();
if (!(await learnedSkill.locator('button[data-variant="destructive"]').count())) throw new Error("The confirmation step of Elimina is not red");
await learnedSkill.getByRole("button", { name: "Annulla", exact: true }).click();
await learnedSkill.getByRole("button", { name: "Apri", exact: true }).click();
await learnedSkill.getByLabel("Testo della skill release-flow").waitFor();
await learnedSkill.getByRole("button", { name: "Chiudi", exact: true }).first().click();
// Design rules: the head holds one line and a closed explanation, no button of the view is filled, the tidy and review
// actions are icons, and the practices are rows that open on request.
if ((await memoryView.locator("[data-testid=memory-intro]").getAttribute("open")) !== null) throw new Error("The explanation of Memoria is open by default");
if (await memoryView.locator('button[data-variant="default"]').count()) throw new Error("Memoria has a filled button");
for (const name of ["Rivedi ora", "Controlla ora"]) {
  const box = await memoryView.getByRole("button", { name, exact: true }).boundingBox();
  if (!box || box.width < 32 || box.height < 32) throw new Error(`${name} is under 32 px`);
  if ((await memoryView.getByRole("button", { name, exact: true }).innerText()).trim()) throw new Error(`${name} shows text next to its icon`);
}
if (await memoryView.getByTestId("practice").count()) {
  const practice = memoryView.getByTestId("practice").first();
  if ((await practice.getAttribute("data-open")) !== "false") throw new Error("A practice is open before the person opens it");
  await practice.getByRole("button", { expanded: false }).first().click();
  if ((await practice.getAttribute("data-open")) !== "true") throw new Error("A practice does not open");
  await practice.getByRole("button", { expanded: true }).first().click();
}
// Every button of the view has a name, and nothing scrolls sideways.
const unnamed = await memoryView.locator("button").evaluateAll((buttons) => buttons.filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length);
if (unnamed) throw new Error(`${unnamed} buttons of Memoria have no name`);
// Before and after of the slice: the view with Come impara open, narrow and wide, Codex and Claude, light and dark.
const memoryLook = await lookOf();
for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  await noHorizontalScroll(`Memoria ${size}`);
  for (const open of [false, true]) {
    if ((await howItLearns.getAttribute("data-open")) !== String(open)) await howItLearns.getByRole("button", { name: /^Come impara/ }).click();
    if (open) await howItLearns.scrollIntoViewIfNeeded();
    else await memoryView.evaluate((view) => view.closest(".overflow-y-auto")?.scrollTo(0, 0));
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`35-memory-${open ? "how-it-learns-" : ""}${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
  }
}
await setLookTo(memoryLook.provider, memoryLook.dark);
await page.setViewportSize({ width: 1280, height: 820 });
await closePanels();

// Candidate: correct the mandate to allow integration, then declare, verify, review and clear.
await changeMandate("Correggi");
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await closePanels();
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
// Issue #331: the count of the view comes first, as on the icon of the activity bar.
const waitingTitle = page.getByTestId("side-bar-title");
if (!/^Aspetta te\s*(\d+\s*)?Candidato di /.test(await waitingTitle.innerText())) throw new Error(`Aspetta te does not name the candidate: ${await waitingTitle.innerText()}`);
if (!/^C-[0-9A-F]{8}$/.test((await waitingTitle.getAttribute("title")) ?? "")) throw new Error("The candidate's id is not on the title's hover");
if (/(Candidato|incarico) [AC]-[0-9A-F]{8}/.test(await demoCandidate.innerText())) throw new Error(`The candidate card shows raw ids: ${await demoCandidate.innerText()}`);
await page.waitForTimeout(500);
await shot("04f-candidate");
await themeShots("04f2-waiting-candidate");
// Issue #338: in the chat card Apri il diff is an icon, named by its tooltip.
if ((await demoCandidate.getByRole("button", { name: "Apri il diff" }).innerText()).trim()) throw new Error("The chat card's Apri il diff is not an icon");
await demoCandidate.getByRole("button", { name: "Apri il diff" }).click();
// Issue #336: the diff opens in the candidate's tab, open and in view.
await detailPane().locator('[data-testid="candidate-diff"][open]').waitFor();
await shot("04g-candidate-diff");
await page.getByRole("button", { name: "Approva questo candidato" }).first().click();
await page.waitForTimeout(500);
await shot("04h-candidate-approved");
await closePanels();
await closeDetails();
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
const documentationWork = page.locator('.chat-card:not([data-testid="settled-card"] .chat-card), [data-testid="settled-card"]').filter({ hasText: /^Incarico / }).filter({ hasText: "Documenti" });
if (await documentationWork.count()) throw new Error("The documentation role started writing outside the mandate");
await domainCard.scrollIntoViewIfNeeded();
await shot("04j-domain-proposal-waiting");
await changeMandate("Correggi");
await page.getByRole("checkbox", { name: /^Root/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await closePanels();
await domainCard.getByText("Scritta", { exact: true }).waitFor({ timeout: 30_000 });
await domainCard.getByText(/ha scritto la proposta nella copia di lavoro dell'incarico di /).waitFor();
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await domainCard.scrollIntoViewIfNeeded();
await shot("04k-domain-proposal-written");
// #305 and #313: the context meter reads the request that fills the window, the same rule for every provider: no
// provider name and no number past the window. Past the threshold Trama reorders the context at the end of the turn
// (ADR 0019), so the reading is taken under a 95% threshold. Light and dark.
{
  const providerNames = ["ChatGPT", "Codex", "Claude", "Cursor", "Antigravity", "Grok", "Droid", "Devin", "OpenCode", "Pi"];
  const noProviderName = (text, where) => {
    const found = providerNames.find((name) => new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, "u").test(text));
    if (found) throw new Error(`${where} names the provider ${found}: ${text}`);
  };
  await page.evaluate(() => window.trama.invoke("coordinator:setContextThreshold", { percent: 95 }));
  const reordersBefore = await page.getByTestId("context-rollover").count();
  // Design rules, composer: under the threshold there is no meter. The turns so far are far from 85%, the threshold minus 10 points.
  if (await page.getByTestId("context-meter").count()) throw new Error("The composer shows the context meter well under the threshold");
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
await openModules();
await shot("05-map");
// Issue #457: one neutral glass surface for every provider, the provider sets only the accents. The computed background
// of the page and of every section (title bar, activity bar, side bar, editor, bottom panel, status bar) is the same
// with each of the nine providers, white in light and dark in dark; the sections differ slightly from each other; the
// accent, the primary button and the side bar selection change with the provider. Screens for Codex and Claude.
{
  const surfaceLook = await lookOf();
  const panelWasOpen = (await page.getByTestId("bottom-panel").count()) > 0;
  if (!panelWasOpen) await clickMenu("togglePanel");
  await page.getByTestId("bottom-panel").waitFor();
  await page.mouse.move(640, 500);
  const readSurfaces = () =>
    page.evaluate(() => {
      const color = (value) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      const background = (selector) => {
        const node = document.querySelector(selector);
        return node ? getComputedStyle(node).backgroundColor : null;
      };
      return {
        sections: {
          page: getComputedStyle(document.body).backgroundColor,
          titleBar: background('[data-testid="title-bar"]'),
          activityBar: background('[data-testid="activity-bar"]'),
          sideBar: background('[data-testid="side-bar"]'),
          editor: background('[data-testid="editor-area"], [data-testid="editor-main"]'),
          panel: background('[data-testid="bottom-panel"]'),
          statusBar: background('[data-testid="status-bar"]'),
          surface: color("var(--surface)"),
          ink: color("var(--ink)"),
        },
        accents: {
          text: color("var(--color-text-accent)"),
          primary: color("var(--primary)"),
          ring: color("var(--ring)"),
          selection: color("var(--sidebar-selected)"),
          bubble: color("var(--app-user-message-background)"),
          sash: color("var(--app-focus-border)"),
        },
      };
    });
  const providers = ["codex", "claudeAgent", "cursor", "antigravity", "grok", "droid", "devin", "opencode", "pi"];
  for (const mode of ["light", "dark"]) {
    const seen = {};
    for (const provider of providers) {
      await setLookTo(provider, mode === "dark");
      // The provider's light fades in 1.4s; the surfaces must not move at all, so they are read at once and again after.
      const first = await readSurfaces();
      await page.waitForTimeout(provider === "codex" || provider === "claudeAgent" ? 1_500 : 50);
      seen[provider] = await readSurfaces();
      if (JSON.stringify(first.sections) !== JSON.stringify(seen[provider].sections)) throw new Error(`The ${mode} surfaces move when ${provider} is chosen: ${JSON.stringify([first.sections, seen[provider].sections])}`);
      if (provider === "codex" || provider === "claudeAgent") await shot(`22b-surface-${provider === "codex" ? "codex" : "claude"}-${mode}`);
    }
    const codex = seen.codex;
    for (const provider of providers)
      if (JSON.stringify(seen[provider].sections) !== JSON.stringify(codex.sections))
        throw new Error(`The ${mode} background with ${provider} differs from Codex: ${JSON.stringify({ codex: codex.sections, [provider]: seen[provider].sections })}`);
    const expected = mode === "light" ? "rgb(255, 255, 255)" : "rgb(33, 33, 33)";
    if (codex.sections.surface !== expected) throw new Error(`The ${mode} surface is not ${expected}: ${JSON.stringify(codex.sections)}`);
    // The work as a sheet on a frame (1 October 2026): the bars are one frame tint, and the side bar, the editor and the
    // bottom panel each their own, apart from it.
    const tints = ["titleBar", "sideBar", "editor", "panel"].map((key) => codex.sections[key]);
    if (tints.some((tint) => !tint) || new Set(tints).size !== tints.length) throw new Error(`The ${mode} sections do not have their own tint: ${JSON.stringify(codex.sections)}`);
    if (codex.sections.activityBar !== codex.sections.titleBar || codex.sections.statusBar !== codex.sections.titleBar) throw new Error(`The ${mode} bars are not one frame: ${JSON.stringify(codex.sections)}`);
    for (const key of ["text", "ring", "selection", "bubble", "sash"])
      if (codex.accents[key] === seen.claudeAgent.accents[key]) throw new Error(`The ${mode} ${key} accent is the same with Codex and Claude: ${codex.accents[key]}`);
    if (codex.accents.primary === seen.claudeAgent.accents.primary) throw new Error(`The ${mode} primary button is the same with Codex and Claude`);
    console.log(`[surface] ${mode}: ${JSON.stringify(codex.sections)}; accent codex ${codex.accents.text}, claude ${seen.claudeAgent.accents.text}`);
  }
  await setLookTo(surfaceLook.provider, surfaceLook.dark);
  if (!panelWasOpen) {
    await clickMenu("togglePanel");
    await page.getByTestId("bottom-panel").waitFor({ state: "detached" });
  }
}
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
    if (apart(sidebarPanel, chat) < 3) throw new Error(`The side panels do not stand apart from the chat: ${seen}`);
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
  // Issue #457: the lit sash is an accent, the provider's text accent in light and dark (Codex: #0A6FD6 and #5AAEFF,
  // close to VS Code's focusBorder #005FB8 and #0078D4). Two providers light it in two different colors.
  const sashLook = await lookOf();
  const litBy = {};
  for (const provider of ["codex", "claudeAgent"]) {
    for (const mode of ["light", "dark"]) {
      await setLookTo(provider, mode === "dark");
      const reading = await settledLook(sidebarSash);
      const accent = await sidebarSash.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-text-accent)";
        element.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      });
      if (reading.strip !== accent || reading.strip !== reading.accent) throw new Error(`The ${provider} ${mode} hovered sash is ${reading.strip}, not the provider's accent ${accent}`);
      litBy[`${provider}-${mode}`] = reading.strip;
      if (provider === "codex") await shot(`22-sash-hover-${mode}`);
      else await shot(`22-sash-hover-claude-${mode}`);
    }
  }
  for (const mode of ["light", "dark"])
    if (litBy[`codex-${mode}`] === litBy[`claudeAgent-${mode}`]) throw new Error(`The ${mode} sash has the same color with Codex and Claude: ${litBy[`codex-${mode}`]}`);
  if (litBy["codex-light"] !== "rgb(10, 111, 214)" || litBy["codex-dark"] !== "rgb(90, 174, 255)") throw new Error(`The Codex sash is not its accent: ${JSON.stringify(litBy)}`);
  await setLookTo(sashLook.provider, false);
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
// Issue #354: the exercises start from Impara in the Benvenuto, which replaced the Esercizi button of the title bar. The
// Benvenuto opens as a tab of the editor next to the conversation, and the person closes it when they want.
await openWelcomeFromProjectMenu();
await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).waitFor();
{
  const editorTabs = page.getByTestId("editor-tabs");
  await editorTabs.getByRole("tab", { name: "Benvenuto", selected: true }).waitFor();
  if (!(await editorTabs.getByRole("tab", { name: "Conversazione" }).count())) throw new Error("The Benvenuto tab is not next to the conversation");
  await workBarPlace("the Benvenuto", "none");
}
await page.getByTestId("welcome").getByRole("button", { name: /^(Riprendi|Inizia|Rifai): Conosci il progetto$/ }).click();
await page.getByTestId("welcome").waitFor({ state: "detached" });
const exercise = page.getByRole("complementary", { name: "Esercizio" });
await exercise.getByRole("button", { name: "Mostra la scheda di studio" }).click();
await exercise.getByRole("button", { name: "Scegli un modulo nella mappa" }).click();
await shot("07a-exercise-first");
await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
await exercise.getByText("Esercizio completato.").waitFor({ timeout: 10_000 });
await shot("07b-exercise-first-done");
// C14: the conflict exercise compares the candidate with two simulated local changes. The module and the file are
// editor tabs since issue #336: the conversation comes forward to show the changes, the tabs stay.
await showConversation();
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
// Issue #334: Regole has three tabs, Mandato, Patto with its count and Standard. Mandato says in rows where the
// Coordinator acts, what it can do and what never; the proposal, the modules, the changes and the earlier versions are
// one line each. Every tab in light and dark, at 1280x800 and 1680x1050, with the Codex and Claude themes.
{
  const rulesLook = await lookOf();
  const rulesBar = page.getByTestId("side-bar");
  for (const id of ["mandate-where", "mandate-can", "fixed-bans"]) await rulesBar.getByTestId(id).waitFor();
  if (!/Orders/.test(await rulesBar.getByTestId("mandate-where").innerText())) throw new Error("Dove does not name the modules of the mandate");
  // Critique of 29 September 2026: Mai is a short list, one fixed ban per line, not a dense sentence.
  if ((await rulesBar.getByTestId("fixed-bans").getByTestId("fixed-ban").count()) !== 6) throw new Error("Mai does not list the six fixed bans one per line");
  for (const section of ["mandate-modules", "mandate-change", "mandate-history"]) {
    if ((await rulesBar.getByTestId(section).getAttribute("data-open")) !== "false") throw new Error(`${section} is not closed by default`);
  }
  // Design rules (Mandato): no filled button, and the restriction and correction primaries are outlines.
  if (await rulesBar.locator('button[data-variant="default"]:not([data-filled="false"])').count()) throw new Error("Mandato has a filled button");
  if (await rulesBar.locator('button[data-variant="destructive"]').count()) throw new Error("Mandato shows a red button before a confirm step");
  const tabNames = (await rulesBar.getByRole("tab").allInnerTexts()).map((name) => name.replace(/\s+/g, " ").trim());
  if (tabNames.length !== 3 || tabNames[0] !== "Mandato" || !/^Patto\s*\d+$/.test(tabNames[1]) || tabNames[2] !== "Standard") {
    throw new Error(`Regole tabs: ${tabNames.join(", ")}`);
  }
  for (const [width, height] of [
    [1280, 800],
    [1680, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    for (const tab of ["Mandato", "Patto", "Standard"]) {
      await openView("Regole", tab);
      if (tab === "Patto") {
        // Nuova decisione is an icon with its name; each decision shows its version small on the right.
        await rulesBar.getByRole("button", { name: "Nuova decisione" }).waitFor();
        if (!/^v\d+$/.test((await rulesBar.getByTestId("pact-decisions").locator("button").first().locator("span").last().innerText()).trim())) {
          throw new Error("A decision of the Pact does not show its version");
        }
        // Design rules (Patto): the new-decision icon is at least 32 px and has no text, a decision row is at least 32 px,
        // and the view has no filled button. The editor puts the primary last and draws it as an outline.
        const newDecision = rulesBar.getByRole("button", { name: "Nuova decisione" });
        const newBox = await newDecision.boundingBox();
        if (!newBox || newBox.width < 32 || newBox.height < 32) throw new Error("Nuova decisione is smaller than 32 px");
        if ((await newDecision.innerText()).trim()) throw new Error("Nuova decisione has text: it is an icon in the section header");
        const rowBox = await rulesBar.getByTestId("pact-decisions").locator("button").first().boundingBox();
        if (!rowBox || rowBox.height < 32) throw new Error("A decision row of the Patto is shorter than 32 px");
        if (await rulesBar.locator('button[data-variant="default"]:not([data-filled="false"])').count()) throw new Error("The Patto has a filled button");
        await newDecision.click();
        // The primary moves to the right with CSS order, so the order on screen is read from the positions.
        const editorActions = await rulesBar
          .getByTestId("decision-editor")
          .locator(".cta-row button")
          .evaluateAll((els) => els.map((el) => ({ text: el.textContent?.trim(), left: el.getBoundingClientRect().left })).sort((x, y) => x.left - y.left).map((x) => x.text));
        if (editorActions.join("|") !== "Annulla|Registra decisione") throw new Error(`Patto editor actions: ${editorActions.join(", ")}`);
        const editorPadding = await rulesBar.getByTestId("decision-editor").evaluate((el) => getComputedStyle(el).paddingLeft);
        if (editorPadding !== "16px") throw new Error(`The Patto editor padding is ${editorPadding}, not 16px`);
        await rulesBar.getByRole("button", { name: "Annulla", exact: true }).click();
      }
      if (tab === "Standard") await rulesBar.getByTestId("standard-summary").getByText(/regole attive su \d+/).waitFor();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll in Regole ${tab} at ${width}x${height}`);
      for (const provider of ["codex", "claudeAgent"]) {
        for (const dark of [false, true]) {
          await setLookTo(provider, dark);
          await shot(`34-rules-${tab.toLowerCase()}-${width}x${height}-${provider}-${dark ? "dark" : "light"}`);
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  // The three tabs with the side bar at its narrowest and widest (29 September 2026).
  await setLookTo(rulesLook.provider, rulesLook.dark);
  await openView("Regole", "Mandato");
  await sideBarEnds("53a-rules-mandate");
  await openView("Regole", "Patto");
  await sideBarEnds("53b-rules-pact");
  await openView("Regole", "Standard");
  await sideBarEnds("53c-rules-standard");
  // Design rules (Standard): a compact list, a rule at least 32 px with its description on request, no filled button.
  {
    const standardBar = page.getByTestId("clean-code-settings");
    const firstRule = standardBar.getByTestId("standard-rule").first();
    const ruleBox = await firstRule.boundingBox();
    if (!ruleBox || ruleBox.height < 32 || ruleBox.height > 40) throw new Error(`A rule of the Standard is ${ruleBox?.height}px high, not a compact 32 px row`);
    if ((await firstRule.getAttribute("data-open")) !== "false") throw new Error("A rule of the Standard is open by default");
    await firstRule.getByRole("button", { expanded: false }).first().click();
    if ((await firstRule.getAttribute("data-open")) !== "true") throw new Error("A rule of the Standard does not open its description");
    await firstRule.getByRole("button", { expanded: true }).first().click();
    if ((await standardBar.getByTestId("standard-about").getAttribute("data-open")) !== "false") throw new Error("The explanation of the Standard is not closed by default");
    if (await standardBar.locator('button[data-variant="default"]:not([data-filled="false"])').count()) throw new Error("The Standard has a filled button");
  }
  // Cambia il mandato open: each button opens its form, nothing changes until the form is confirmed.
  await openView("Regole", "Mandato");
  await openSection("Cambia il mandato");
  const changeButtons = await rulesBar.getByTestId("mandate-change").locator(".cta-row button").allInnerTexts();
  if (changeButtons.map((b) => b.trim()).join("|") !== "Revoca|Restringi|Correggi") throw new Error(`Cambia il mandato: ${changeButtons.join(", ")}`);
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await shot(`34-rules-mandate-change-${provider}-${dark ? "dark" : "light"}`);
    }
  }
  // Design rules: Revoca is text and not red; red appears only at the confirm step, which ends with the destructive action.
  const revokeButton = rulesBar.getByTestId("mandate-change").getByRole("button", { name: "Revoca", exact: true });
  if ((await revokeButton.getAttribute("data-variant")) === "destructive") throw new Error("Revoca is red before its confirm step");
  await revokeButton.click();
  const revokeActions = await rulesBar.getByTestId("mandate-revoke-confirm").locator(".cta-row button").evaluateAll((els) => els.map((el) => `${el.textContent?.trim()}:${el.getAttribute("data-variant")}`));
  if (revokeActions.join("|") !== "Annulla:ghost|Revoca il mandato:destructive") throw new Error(`Revoca confirm step: ${revokeActions.join(", ")}`);
  await rulesBar.getByTestId("mandate-revoke-confirm").getByRole("button", { name: "Annulla", exact: true }).click();
  // Moduli: the map of today, with the modules of the mandate marked.
  await openSection("Moduli");
  await rulesBar.getByTestId("module-in-mandate").first().waitFor();
  // Design rules (Moduli): the deep examination is an icon with its name, of at least 32 px; a module row is at least 32 px.
  const projectFocus = rulesBar.getByRole("button", { name: "Esame approfondito del progetto" });
  const focusBox = await projectFocus.boundingBox();
  if (!focusBox || focusBox.width < 32 || focusBox.height < 32) throw new Error("The project's deep examination is smaller than 32 px");
  if ((await projectFocus.innerText()).trim()) throw new Error("The project's deep examination has text: it is an icon");
  const moduleBox = await page.getByRole("listbox", { name: "Moduli" }).getByRole("option").first().boundingBox();
  if (!moduleBox || moduleBox.height < 32) throw new Error("A module row is shorter than 32 px");
  await rulesBar.getByTestId("mandate-modules").scrollIntoViewIfNeeded();
  await themeShots("34-rules-mandate-modules");
  // A module shows its files first and keeps the dependencies closed.
  await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
  // Issue #336: the module opens in its editor tab.
  await detailPane().getByTestId("module-files").waitFor();
  if ((await detailPane().getByTestId("module-dependencies").getAttribute("data-open")) !== "false") throw new Error("The module's dependencies are not closed");
  await themeShots("34-rules-module");
  // Design rules (file): the file opens with its own name for "Mostra nella cartella", an icon of at least 32 px.
  await detailPane().getByTestId("module-files").locator("button").first().click();
  const reveal = detailPane().getByRole("button", { name: "Mostra nella cartella" });
  await reveal.waitFor();
  const revealBox = await reveal.boundingBox();
  if (!revealBox || revealBox.width < 32 || revealBox.height < 32) throw new Error("Mostra nella cartella is smaller than 32 px");
  if ((await reveal.innerText()).trim()) throw new Error("Mostra nella cartella has text: it is an icon");
  await setLookTo(rulesLook.provider, rulesLook.dark);
}
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
await closePanels();
await shot("10-dark");
await page.locator(".chat-card", { has: page.getByTestId("domain-proposal") }).last().scrollIntoViewIfNeeded();
await shot("10a-dark-domain-proposal");
// Goals (UX01, UX02, UX07): the project has only the goal the Coordinator proposed, so it offers the first one.
// Issue #292: the proposed goal waits for the person in Aspetta te; the chat keeps its reference.
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first().waitFor();
// Issue #292: what waits for the person while the Coordinator's goal is proposed, with the list open.
if (await page.getByTestId("waiting-summary").count()) await page.getByTestId("waiting-summary").getByRole("button").click();
await themeShots("10b-waiting-proposed-goal");
await closePanels();
await page.getByRole("button", { name: "Formula il primo obiettivo" }).first().click();
await page.getByLabel("Titolo dell'obiettivo").fill("Ordini annullati in revisione");
await page.getByLabel("Risultato atteso").fill("Un ordine pagato e annullato resta in revisione finché una persona non decide.");
await page.getByLabel("Esempio 1").fill("Ordine 42 pagato e annullato: stato review");
await page.getByRole("button", { name: "Crea l'obiettivo" }).click();
await page.getByTestId("dialog-title").filter({ hasText: "Ordini annullati in revisione" }).waitFor();
await page.getByTestId("goal-dialog-header").waitFor();
// The goal is saved before the dialog opens; its detail keeps the stable id used after the restart on hover (issue #270).
const goalTitle = "Ordini annullati in revisione";
// Issue #336: the goal's detail is an editor tab behind the conversation; the id is on the hover of its tab.
const goalId = await page.locator('[data-testid="editor-tab"][data-tab^="detail:goal:"] span[title]').first().getAttribute("title");
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
// Issue #332: the goal filter is the button at the top of Lavoro, with the menu of the goals.
await openView("Lavoro");
await (await openMenu(page.getByTestId("work-summary").getByTestId("chat-filter"))).getByRole("menuitem", { name: goalTitle }).waitFor();
await shot("10g-chat-filter-menu-dark");
await page.keyboard.press("Escape");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "light";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByTestId("chat-goal-tag").filter({ hasText: goalTitle }).last().scrollIntoViewIfNeeded();
await shot("10f-single-chat-light");
await (await openMenu(page.getByTestId("chat-filter"))).getByRole("menuitem", { name: goalTitle }).click();
await page.getByTestId("dialog-title").filter({ hasText: goalTitle }).waitFor();
if (await page.getByText("Ho letto lo studio").count()) throw new Error("The goal filter shows messages outside the goal");
await shot("10h-chat-filtered-light");
// Filtered on the goal, the summary counts its examples tried on a candidate.
await page.getByTestId("work-summary").getByTestId("work-goal-progress").waitFor();
await (await openMenu(page.getByTestId("chat-filter"))).getByRole("menuitem", { name: "Tutta la chat" }).click();
await page.getByText("Ho letto lo studio").first().waitFor();
await page.getByLabel("Messaggio al Coordinatore").fill("");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "dark";
});
await page.evaluate(() => document.documentElement.classList.add("dark"));
// The overview (UX03) lists the project with its open goals. It opens from the Projects view (issue #330).
await openView("Progetti");
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
// Progetti: a compact row per project; the details (goals, checks, source) are closed until the person asks.
const overviewRow = page.getByTestId("overview-project").first();
await overviewRow.getByTestId("overview-details-toggle").waitFor({ timeout: 10_000 });
if (await page.getByTestId("overview-details").count()) throw new Error("A project's details are open before the person asks");
await shot("10e-overview-compact");
await overviewRow.getByTestId("overview-details-toggle").click();
await overviewRow.getByText("Ordini annullati in revisione").waitFor({ timeout: 10_000 });
if ((await overviewRow.getByTestId("overview-details-toggle").getAttribute("aria-expanded")) !== "true") throw new Error("The details button does not say it is open");
await shot("10e-overview");
{
  // Progetti rules: one summary line with the same total as the rows, no filled button, 32 px click areas, icon buttons named.
  const overview = page.getByTestId("overview");
  const summary = (await overview.getByTestId("overview-summary").textContent()).trim();
  const match = /^Progetti: (\d+)\. In Aspetta te: (\d+)\.$/.exec(summary);
  if (!match) throw new Error(`The projects summary reads "${summary}"`);
  const rows = await overview.getByTestId("overview-project").evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.waiting)));
  if (Number(match[1]) !== rows.length || Number(match[2]) !== rows.reduce((a, b) => a + b, 0)) throw new Error(`The summary ${summary} does not match the rows ${rows}`);
  const found = await overview.evaluate((root) => {
    const shown = (node) => node.getBoundingClientRect().width > 0;
    return {
      filled: [...root.querySelectorAll('button[data-variant="default"]')].filter((b) => shown(b) && b.dataset.filled !== "false").length,
      small: [...root.querySelectorAll('[data-icon-button], [data-testid="overview-waiting"], [data-testid="overview-project"] > div button')]
        .filter(shown)
        .filter((b) => b.getBoundingClientRect().height < 31.5)
        .map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()),
      unnamed: [...root.querySelectorAll("[data-icon-button]")].filter((b) => !b.getAttribute("aria-label") || b.textContent.trim()).length,
    };
  });
  if (found.filled) throw new Error("Progetti has a filled button");
  if (found.small.length) throw new Error(`Progetti has click areas under 32 px: ${found.small}`);
  if (found.unnamed) throw new Error("Progetti has an icon button without a name, or with a text");
}
await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
await closePanels();

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
await closePanels();
await page.getByLabel("Messaggio al Coordinatore").fill("[passo:confirmSeams] A che punto è il piano?");
await page.keyboard.press("Enter");
const seamsStep = page.getByTestId("next-step").getByTestId("waiting-reference").filter({ hasText: "Conferma i punti di prova" }).last();
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
// Design rules: what to do comes before the long detail, so the slices and their confirmation sit above the seams of the spec.
const specOrder = await writtenSpec.evaluate((spec) => [spec.querySelector('[data-testid="plan-slices"]'), spec.querySelector('[data-testid="plan-seam"]')].map((el) => el.getBoundingClientRect().top));
if (!(specOrder[0] < specOrder[1])) throw new Error(`The slices of a written spec come after its seams: ${specOrder}`);
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
await closePanels();
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
// Issue #332: Lavoro is one view; its goals section has "Nuovo obiettivo" as an icon.
await openView("Lavoro");
await page.getByTestId("side-bar").getByRole("button", { name: "Nuovo obiettivo" }).click();
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
await openView("Lavoro");
const inspectorPanel = page.getByTestId("side-bar");
// Issue #332: archived goals are folded at the end of the goals of Lavoro, with one state each.
await inspectorPanel.getByTestId("work-goals-archived").getByRole("button", { name: "Archiviati (1)" }).click();
const archivedRow = inspectorPanel.getByTestId("work-goals-archived").getByTestId("work-goal").filter({ hasText: goalTitle });
if ((await archivedRow.getByTestId("goal-state").allTextContents()).join("|") !== "Archiviato") throw new Error("An archived goal shows more than one state");
await shot("14e-goal-archived");
await inspectorPanel.getByRole("button", { name: new RegExp(goalTitle) }).click();
// Issue #336: the goal opens in its editor tab.
// Design rules: editing the expected result is an icon; an archived goal offers Ripristina as text and no Archivia.
await expectIconOnly(detailPane().getByRole("button", { name: "Modifica", exact: true }), "Obiettivo, Modifica");
if (await detailPane().getByRole("button", { name: "Archivia", exact: true }).count()) throw new Error("An archived goal offers Archivia");
await detailPane().getByRole("button", { name: "Ripristina" }).click();
await openView("Progetti");
await page.getByTestId("sidebar-goal").filter({ hasText: goalTitle }).waitFor();
await shot("14f-goal-restored");
await closePanels();

// W12: the main action of every screen does what its label says, with an effect the person sees. Mandato, Memoria,
// candidato, Obiettivi, Panoramica, guida and the chat cards are clicked above; Issue and Gruppo after the restart.
// Header: a rescan that changes nothing still confirms it ran.
await page.getByRole("button", { name: "Aggiorna progetto" }).click();
const refreshed = page.getByRole("status").filter({ hasText: "Progetto riletto" });
await refreshed.waitFor({ timeout: 10_000 });
await refreshed.getByRole("button", { name: "Chiudi" }).click();
// Goal card: "Modifica la proposta" opens the proposal with its editor ready.
await (await openWaiting("goal")).getByTestId("goal-card").getByRole("button", { name: "Modifica la proposta" }).click();
// Issue #336: the goal opens in its editor tab, with the editor ready.
const editor = detailPane().getByTestId("goal-editor");
await editor.waitFor();
await shot("16a-goal-proposal-edit");
await editor.getByRole("button", { name: "Annulla" }).click();
await editor.waitFor({ state: "detached" });
// Mappa: asking about a module puts the question in the composer with the module as the message's context.
await openModules();
await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
// Issue #338: the module's question is "Chiedi" with its icon, inside the pane; the name keeps the whole question.
{
  const askModule = detailPane().getByRole("button", { name: "Chiedi al Coordinatore su questo modulo" });
  if ((await askModule.innerText()).trim() !== "Chiedi") throw new Error("The module's ask button does not read Chiedi");
  const askBox = await askModule.boundingBox();
  const paneBox = await detailPane().boundingBox();
  const textFits = await askModule.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  if (!askBox || !paneBox || !textFits || askBox.x + askBox.width > paneBox.x + paneBox.width + 1) throw new Error("The module's ask button overflows its pane");
}
await detailPane().getByRole("button", { name: "Chiedi al Coordinatore su questo modulo" }).click();
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
// Squadre: asking about a specialist names its latest assignment; the action is the last in the cta-row.
await openView("Squadre");
await page.getByTestId("side-bar").getByTestId("team-developer").first().click();
await detailPane().getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).waitFor();
const developerName = (await detailPane().locator("h3.text-ui-lg").first().textContent()).trim();
// The Ask button reads "Chiedi" and is named in full for screen readers (issue #333).
const specialistActions = await detailPane()
  .locator(".cta-row")
  .first()
  .locator("button")
  .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent));
if (specialistActions.at(-1)?.trim() !== "Chiedi al Coordinatore") throw new Error(`Chiedi al Coordinatore is not the last call to action: ${specialistActions}`);
await detailPane().getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked(`di ${developerName}`, "Squadre, Chiedi al Coordinatore");
if (!(await composer().inputValue()).includes("Aggiornami sul lavoro di ") || /A-[0-9A-F]{8}/.test(await composer().inputValue())) throw new Error(`The question does not name ${developerName}'s assignment`);
await shot("16c-specialist-ask");
await composer().fill("");
// Lavoro: a candidate opens with its diff; the card inside it offers no "Apri il diff" that would do nothing.
await openView("Lavoro");
// Issue #272: Lavoro names the plan as its chat card does, and a finished candidate never reads "In costruzione".
{
  const workPanel = page.getByTestId("side-bar");
  await workPanel.getByText("Fette confermate dal Coordinatore").first().waitFor({ timeout: 10_000 });
  if (await workPanel.getByText("In costruzione", { exact: true }).count()) throw new Error("Lavoro calls a candidate under construction");
  await expectNoRawIds(workPanel, "Lavoro");
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
    await shot(`10h-work-states-${dark ? "dark" : "light"}`);
  }
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), wasDark);
}
// Design rules for the candidate's page (issue #314), from the top: the work in words, the outcome with its actions under it,
// the files and the diff (closed), the screenshots only when the interface changes, the proof, the history. No state badge
// repeats the outcome, no box sits in another box, nothing is filled, clickable things are 32 px, spacing is on the 16 px grid.
const candidatePageRules = async (label, { interfaceChange = false, diffOpen = false } = {}) => {
  const root = detailPane().getByTestId("candidate-detail");
  await root.waitFor();
  if (interfaceChange) await root.locator('[data-testid="candidate-shots"] [data-testid="interface-shot"] img').nth(3).waitFor({ timeout: 30_000 });
  const facts = await root.evaluate((node) => {
    const top = (selector) => node.querySelector(selector)?.getBoundingClientRect().top ?? null;
    const toMerge = node.querySelector('[data-testid="candidate-to-merge"]');
    const row = toMerge?.querySelector(".cta-row");
    const buttons = row ? [...row.querySelectorAll("button")] : [];
    const summary = node.querySelector('[data-testid="candidate-diff"] summary');
    const padding = (id) => {
      const style = getComputedStyle(node.querySelector(`[data-testid="${id}"]`));
      return `${style.paddingLeft} ${style.paddingTop}`;
    };
    return {
      order: ["h2", '[data-testid="candidate-to-merge"]', '[data-testid="candidate-diff"]', '[data-testid="candidate-proof"]', '[data-testid="candidate-history"]'].map(top),
      outcome: node.querySelector('[data-testid="candidate-outcome"]')?.textContent.trim() ?? null,
      dataOutcome: toMerge?.getAttribute("data-outcome") ?? null,
      header: node.querySelector('[data-testid="candidate-header"]')?.textContent ?? "",
      filled: node.querySelectorAll('button[data-variant="default"]:not([data-filled="false"])').length,
      // The actions, the diff line, the pull request link and the examination's actions; the inline references of the chat card's components keep their own size.
      short: [...node.querySelectorAll('[data-testid="candidate-actions"] button, [data-testid="candidate-diff"] summary, [data-testid="candidate-pull-request"], [data-testid="focus-audit"] .cta-row button')].map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h < 32),
      boxes: node.querySelectorAll(".chat-card").length,
      radius: toMerge ? getComputedStyle(toMerge).borderRadius : null,
      padding: [padding("candidate-proof"), padding("candidate-history")],
      diffOpen: node.querySelector('[data-testid="candidate-diff"]').hasAttribute("open"),
      diffRow: summary ? Math.round(summary.getBoundingClientRect().height) : 0,
      diffText: summary?.textContent.trim() ?? "",
      passedRows: node.querySelectorAll('[data-testid="candidate-proof"] [data-testid="candidate-evidence"][data-result="pass"]').length,
      reviews: node.querySelectorAll('[data-testid="technical-review"], [data-testid="candidate-reviewers-none"]').length,
      shots: node.querySelectorAll('[data-testid="candidate-shots"]').length,
      historyLabels: [...node.querySelectorAll('[data-testid="candidate-history"] .w-32')].map((n) => n.textContent.trim()),
      actions: row ? { right: Math.round(row.getBoundingClientRect().right - buttons.at(-1).getBoundingClientRect().right), labels: buttons.map((b) => b.textContent.trim()) } : null,
      prose: `${toMerge?.textContent ?? ""} ${node.querySelector('[data-testid="candidate-history"]')?.textContent ?? ""}`,
    };
  });
  const fail = (what) => {
    throw new Error(`Candidate page (${label}): ${what}: ${JSON.stringify(facts)}`);
  };
  if (facts.order.some((y) => y === null) || facts.order.some((y, i) => i && y <= facts.order[i - 1])) fail("the parts are not in the order title, outcome, diff, proof, history");
  if (!/^(Non è ancora pronto: (manca 1 cosa|mancano \d+ cose)|Pronto|Unito|Superato)$/.test(facts.outcome ?? "")) fail("the outcome is not one line of the vocabulary");
  const outcomeOf = { Pronto: "ready", Unito: "merged", Superato: "superseded" };
  if (facts.dataOutcome !== (outcomeOf[facts.outcome] ?? "missing")) fail("the outcome and its state disagree");
  if (/Pronto|Unito|Superato|Non è ancora pronto/.test(facts.header)) fail("a state repeats the outcome in the header");
  if (facts.filled) fail("a button is filled");
  if (facts.short.length) fail("a clickable part is under 32 px");
  if (facts.boxes || facts.radius !== "0px") fail("a box sits inside another");
  if (facts.padding.some((value) => value !== "16px 16px")) fail("the blocks are not on the 16 px grid");
  if (facts.diffOpen !== diffOpen) fail(diffOpen ? "the diff is closed" : "the diff is not closed");
  if (facts.diffRow < 32 || !/^Diff catturato da Trama, \d+ file$/.test(facts.diffText)) fail("the files row is not the diff's 32 px line");
  if (facts.passedRows) fail("a passed check shows as a row, not in the one line");
  if (facts.reviews !== 1) fail("the reviewers are neither an opinion nor one line");
  if (facts.shots !== (interfaceChange ? 1 : 0)) fail("the screenshots do not follow the interface change");
  if (!facts.historyLabels.includes("Versione") || !facts.historyLabels.includes("Incarico")) fail("the history lacks the version or the assignment");
  if (facts.actions && facts.actions.right > 4) fail("the actions are not on the right");
  if (interfaceChange && (facts.actions?.labels.at(-1) !== "Approva e unisci" || !facts.actions.labels.includes("Rifiuta") || facts.actions.labels.includes("Approva questo candidato"))) fail("an interface candidate does not end with Approva e unisci");
  if (/[–—]/.test(facts.prose)) fail("a dash in the outcome or the history");
};
await page.getByTestId("side-bar").locator('button[data-record-id^="C-"]').first().click();
// Issue #336: the candidate opens in its editor tab: what is missing to merge it on top, the diff closed below.
await detailPane().getByText(/^Diff catturato da Trama/).waitFor();
await detailPane().getByTestId("candidate-to-merge").waitFor();
if (await detailPane().getByRole("button", { name: "Apri il diff" }).count()) throw new Error("The candidate view offers a diff it already shows");
await candidatePageRules("verified candidate");
await shot("04i-candidate-page");
// Opening the same candidate again brings back its tab.
await page.getByTestId("side-bar").locator('button[data-record-id^="C-"]').first().click();
if ((await page.locator('[data-testid="editor-tab"][data-tab^="detail:candidate:"]').count()) !== 1) throw new Error("The same candidate opened a second tab");
await closePanels();
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
// Issue #301, the chat in English: the cards, the composer and the status line change at once, and the longer or
// shorter texts keep the layout: nothing scrolls sideways, no button cuts its label, the actions stay on the right.
await page.evaluate(() => window.trama.invoke("settings:update", { language: "en" }));
await page.getByRole("textbox", { name: "Message to the Coordinator" }).waitFor({ timeout: 20_000 });
await statusLine.getByRole("button", { name: "Activity", exact: true }).waitFor();
if ((await page.evaluate(() => document.documentElement.lang)) !== "en") throw new Error("The chat's page language did not follow the choice");
const chatEnglishLayout = async (where) => {
  await noHorizontalScroll(where);
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="status-line"] button, .chat-card button, .chat-composer-shell button, [data-testid="next-step"] button')]
      .filter((button) => button.offsetParent !== null && button.textContent.trim() && button.scrollWidth > button.clientWidth + 1)
      .map((button) => button.textContent.trim()),
  );
  if (cut.length) throw new Error(`English labels cut in the chat (${where}): ${cut.join(", ")}`);
  const outside = await page.evaluate(() =>
    [...document.querySelectorAll('.chat-card .cta-row, [data-testid="next-step"]')]
      .filter((row) => row.offsetParent !== null)
      .flatMap((row) => {
        const box = row.getBoundingClientRect();
        return [...row.children].filter((child) => child.getBoundingClientRect().right > box.right + 1).map((child) => child.textContent.trim());
      }),
  );
  if (outside.length) throw new Error(`English actions past their row in the chat (${where}): ${outside.join(", ")}`);
};
await chatEnglishLayout("wide");
await themeShots("chat-en");
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(300);
await chatEnglishLayout("narrow");
await page.setViewportSize({ width: 1280, height: 820 });
await page.evaluate(() => window.trama.invoke("settings:update", { language: "it" }));
await page.getByRole("textbox", { name: "Messaggio al Coordinatore" }).waitFor({ timeout: 20_000 });
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
// A10: the squads the Coordinator formed after the study are in Activity too.
await activity.getByTestId("activity-step").filter({ hasText: "Squadre formate dal Coordinatore" }).first().waitFor({ timeout: 20_000 });
await themeShots("15b-activity");
// Correggi opens the person's words for the step, with Invia la correzione as the primary on the right.
await understandingStep.getByRole("button", { name: "Correggi" }).click();
await understandingStep.getByLabel("Correzione del passo").fill("Anche il cliente vede che l'ordine è in revisione.");
const correctActions = await understandingStep.locator(".cta-row").last().locator("button").allTextContents();
if (correctActions.join("|") !== "Annulla|Invia la correzione") throw new Error(`Correction buttons out of order: ${correctActions.join(", ")}`);
await themeShots("15b1-activity-step-correct");
await understandingStep.getByRole("button", { name: "Annulla" }).click();
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
// A05: the Pause of continuous work is always on the status line. In pause the line says so, Riprendi takes the place
// of Pausa as the primary on the right, and nothing automatic starts; Riprendi brings the line back.
await statusLine.getByRole("button", { name: "Pausa del Coordinatore", exact: true }).click();
const pausedLine = page.locator('[data-testid="status-line"][data-paused="true"]');
await pausedLine.waitFor({ timeout: 20_000 });
await pausedLine.getByTestId("status-line-text").getByText(/Coordinatore in pausa: i turni in corso finiscono/).waitFor();
const resumeButton = pausedLine.getByRole("button", { name: "Riprendi il Coordinatore" });
await resumeButton.waitFor();
// Issue #338: Riprendi starts the work again, icon and text; Pausa is an icon only.
if ((await resumeButton.innerText()).trim() !== "Riprendi") throw new Error("Riprendi in the status bar is not icon and text");
// The last action sits on the right: Riprendi, unless the person has a move of their own, which stays last. Issue #330:
// in the status bar Riprendi is an icon with its text (issue #338) and the person's move is text, so the window keeps one filled button.
const lastButton = pausedLine.getByRole("button").last();
const lastBox = await lastButton.boundingBox();
const pausedBox = await pausedLine.boundingBox();
if (!lastBox || !pausedBox || pausedBox.x + pausedBox.width - (lastBox.x + lastBox.width) > 2) throw new Error("The primary of the paused line is not on the right");
if ((await lastButton.getAttribute("aria-label")) !== "Riprendi il Coordinatore" && !(await pausedLine.locator("button:not([aria-label])").count())) {
  throw new Error("The last button of the paused line is not the primary");
}
await themeShots("15c-status-line-paused");
// Issue #338: the button rule on the parts no view owns, the chat with its composer and the status bar in pause, at
// 1280x800 and 1680x1050 with the Codex and Claude themes, light and dark.
{
  const pausedLook = await lookOf();
  for (const [width, height] of [
    [1280, 800],
    [1680, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`38-button-rule-${width}x${height}-${provider}-${dark ? "dark" : "light"}`);
        // Design rules, chat: no filled button in the timeline or in the composer, the window's one is Aspetta te's.
        const chatFilled = await page
          .locator('.chat-timeline-scroll button[data-variant="default"], form.chat-composer-surface button[data-variant="default"]')
          .evaluateAll((buttons) => buttons.filter((b) => b.dataset.filled !== "false" && b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()));
        if (chatFilled.length) throw new Error(`The chat has a filled button at ${width}x${height}: ${chatFilled.join(", ")}`);
      }
    }
  }
  await setLookTo(pausedLook.provider, pausedLook.dark);
  await page.setViewportSize({ width: 1280, height: 820 });
}
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
  // Issue #338: the whole line of the need opens it in Aspetta te, from its left edge to its right edge.
  const openBox = await recapNeeds.first().getByRole("button", { name: /^Apri in Aspetta te/ }).boundingBox();
  if (!needBox || !openBox || needBox.x + needBox.width - (openBox.x + openBox.width) > 2 || openBox.x - needBox.x > 2) {
    throw new Error("The recap's Apri in Aspetta te is not on the right");
  }
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
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
const settings = page.getByTestId("settings");
await settings.waitFor();
// Issue #335: the learning switches left Impostazioni for Memoria, Come impara: one copy. Apprendimento keeps a way
// there, which opens Memoria with Come impara open on the switches.
await settings.getByRole("button", { name: /^Apprendimento/ }).first().click();
await settings.getByText(/stanno in Memoria, in Come impara/).waitFor();
if (await settings.getByRole("switch").count()) throw new Error("A learning switch is still in Impostazioni");
await themeShots("12c-learning-settings-link");
await settings.getByTestId("learning-open-memory").click();
const learningFromSettings = page.locator('[data-testid="side-bar"][data-view="memory"] [data-testid="how-it-learns"][data-open="true"]');
await learningFromSettings.getByTestId("learning-switches").getByRole("switch", { name: "Revisione dell'esperienza dopo il lavoro" }).waitFor();
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
if (!(await settings.isVisible())) await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await settings.waitFor();
await settings.getByRole("button", { name: /^Collegamenti/ }).first().click();
await shot("11-connections");
await settingsRules("Collegamenti");
// Summary first: how many connections are ready, in one line above the groups.
const summaryLine = (await settings.getByTestId("connections-summary").textContent()).trim();
if (!/^Pronti: \d+ su \d+$/.test(summaryLine)) throw new Error(`The connections summary reads "${summaryLine}"`);
if (!(await settings.evaluate((el) => el.querySelector('[data-testid="connections-summary"]').compareDocumentPosition(el.querySelector("section")) & Node.DOCUMENT_POSITION_FOLLOWING))) {
  throw new Error("The connections summary is not above the groups");
}
// Secondary actions are icons with a tooltip name and an aria-label: Capacità and Verifica, one of each per row.
const iconButtons = await settings.locator("[data-icon-button]").evaluateAll((nodes) => nodes.map((n) => ({ name: n.getAttribute("aria-label"), text: n.textContent.trim() })));
if (!iconButtons.length || iconButtons.some((b) => !b.name || b.text)) throw new Error(`Icon buttons without a name, or with a text: ${JSON.stringify(iconButtons)}`);
// Issue #71: every provider, ChatGPT included, shows its capabilities in the same panel.
const capabilityToggles = settings.getByRole("button", { name: /^Capacità/ });
await capabilityToggles.first().click();
await themeShots("11b-connections-capabilities");
await capabilityToggles.first().click();
await settings.getByRole("button", { name: /^Generale/ }).first().click();
// Issue #301: the language sits in Generale and changes the page at once.
await settings.getByTestId("language-choice").getByRole("radio", { name: "Italiano", checked: true }).waitFor();
await shot("12-settings");
await settingsRules("Generale");
// The guide opens from a button with an icon and its name (the table of principi.md), not a bare text.
if (!(await settings.getByRole("button", { name: "Apri il Benvenuto" }).locator("svg").count())) throw new Error("Apri il Benvenuto has no icon");
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
// Issue #345: on Windows and Linux the menu's Informazioni su Trama brings the settings' About into view.
if (process.platform !== "darwin") {
  await settings.getByTestId("language-choice").scrollIntoViewIfNeeded();
  await clickMenu("about");
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-testid="about-trama"]')?.getBoundingClientRect();
    return Boolean(box) && box.top >= 0 && box.bottom <= window.innerHeight;
  });
}
// W12, Impostazioni: the theme follows the choice at once.
await page.getByRole("radio", { name: "Scuro" }).click();
await page.getByRole("radio", { name: "Scuro", checked: true }).waitFor();
if (!(await page.evaluate(() => document.documentElement.classList.contains("dark")))) throw new Error("Tema Scuro did not darken the window");
await page.getByRole("radio", { name: "Sistema" }).click();
await page.getByRole("radio", { name: "Sistema", checked: true }).waitFor();
// Impostazioni opens the Benvenuto in its editor tab, next to the settings; closing the tab goes back to the conversation.
await page.getByRole("button", { name: "Apri il Benvenuto" }).click();
await page.getByTestId("welcome").locator('[data-step="github"]').waitFor();
await shot("12a-guide-resume-dark");
await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).click();
await page.getByTestId("welcome").waitFor({ state: "hidden" });
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await page.getByTestId("settings").waitFor();
// Impostazioni again closes the settings page and returns to the dialog.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });

// W14: a new mandate request supersedes the pending one. The old card turns grey, names the new one and loses
// its buttons; it stays in the history. Only the new card can be accepted.
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-mandato:Prima proposta di mandato]");
await page.keyboard.press("Enter");
await page.getByText("Prima proposta di mandato").first().waitFor({ timeout: 20_000 });
await page.getByLabel("Messaggio al Coordinatore").fill("[chiedi-mandato:Seconda proposta di mandato]");
await page.keyboard.press("Enter");
// Issue #271: the superseded request is one line; the line opens its card.
const supersededLine = page.getByTestId("settled-card").filter({ hasText: "Sostituita" }).filter({ hasText: "Prima proposta di mandato" });
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
// Issue #331: in Aspetta te the proposal opens with its decision first: the reason, then Rifiuta la proposta, Correggi
// and Concedi, in view without scrolling at 1280x800; what changes from the mandate in force follows, and the full
// proposal stays closed below. With the view open the window's one filled button is Concedi.
{
  const viewport = page.viewportSize();
  const look = await lookOf();
  await page.setViewportSize({ width: 1280, height: 800 });
  await pendingCard.scrollIntoViewIfNeeded();
  await page.getByTestId("side-bar").evaluate((bar) => bar.querySelector(".overflow-y-auto")?.scrollTo(0, 0));
  const grant = pendingCard.getByRole("button", { name: "Concedi", exact: true });
  const grantInView = await grant.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= document.querySelector('[data-testid="status-bar"]').getBoundingClientRect().top;
  });
  if (!grantInView) throw new Error("Concedi needs a scroll in Aspetta te at 1280x800");
  const filled = await page.locator('button[data-variant="default"]').evaluateAll((buttons) => buttons.filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()));
  if (filled.join("|") !== "Concedi") throw new Error(`Filled buttons with the mandate proposal open: ${filled.join(", ")}`);
  const order = await pendingCard.evaluate((item) => {
    const at = (node) => (node ? node.getBoundingClientRect().top : -1);
    return [at(item.querySelector(".cta-row")), at(item.querySelector('[data-testid="mandate-diff"]')), at(item.querySelector('[data-testid="mandate-full-toggle"]'))];
  });
  if (!(order[0] >= 0 && order[0] < order[1] && order[1] < order[2])) throw new Error(`The proposal in Aspetta te is not in the order buttons, changes, full proposal: ${order.join(", ")}`);
  if (await pendingCard.getByTestId("mandate-full").count()) throw new Error("The full proposal is open in Aspetta te before the person opens it");
  // One copy of Concedi: neither the status bar nor the chat repeats it.
  if (await page.getByTestId("status-bar").getByRole("button", { name: /Concedi/ }).count()) throw new Error("The status bar repeats Concedi");
  if (await page.getByRole("main").getByRole("button", { name: /^Concedi/ }).count()) throw new Error("The chat repeats Concedi");
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await shot(`31b-waiting-mandate-1280x800-${provider}-${dark ? "dark" : "light"}`);
    }
  }
  await setLookTo(look.provider, look.dark);
  await pendingCard.getByTestId("mandate-full-toggle").click();
  await pendingCard.getByTestId("mandate-full").getByTestId("fixed-bans").waitFor();
  await pendingCard.getByTestId("mandate-full-toggle").click();
  await page.setViewportSize(viewport);
}

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
// Issue #334: the proposal is not twice. Mandato shows one line that leads to its card in Aspetta te.
const proposalReference = mandateInspector.getByTestId("mandate-proposal-reference");
await proposalReference.waitFor();
if (await mandateInspector.getByTestId("mandate-diff").count()) throw new Error("Mandato shows the proposal's card a second time");
// Issue #331: no button answers it in Mandato.
if (await mandateInspector.getByRole("button", { name: "Concedi", exact: true }).count()) throw new Error("Mandato still answers the proposal");
const mandateState = async () => (await mandateInspector.getByText(/^Mandato (v\d+|revocato)/).first().textContent()).trim();
const stateBefore = await mandateState();
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await proposalReference.scrollIntoViewIfNeeded();
  await shot(`15m2-mandate-proposal-view-${theme}`);
}
await proposalReference.click();
await page.locator('[data-testid="side-bar"][data-view="waiting"]').getByTestId("mandate-diff").waitFor();
await changeMandate("Revoca");
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
await closePanels();
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
await closePanels();
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
// Issue #330: the bar left the top of the chat. UI wave of 29 September: the bar above the composer names the work in
// focus next to what waits for the person, and unfolds the panel inside it; the status bar no longer repeats it.
await openFocusPanel();
const focusBar = page.getByTestId("focus-bar");
if (!(await page.getByTestId("work-bar").getByTestId("focus-bar").count())) throw new Error("The focus panel does not unfold inside the bar above the composer");
if (await page.getByTestId("status-focus").count()) throw new Error("The status bar repeats the work in focus while the conversation shows");
// The bar names the work in focus; the panel it unfolds shows what to do with it and never repeats the title (1 October 2026).
const focusTitle = async () => (await page.getByTestId("work-bar-focus-title").textContent()).trim();
if (await focusBar.getByTestId("focus-title").count()) throw new Error("The focus panel repeats the title of the work bar");
const firstFocus = await focusTitle();
// Issue #241: the bar is titled with the goal, never with the first message of a dialog.
if (/^\[/.test(firstFocus)) throw new Error(`The focus bar is titled with a message: ${firstFocus}`);
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
// Design rules for the bar above the composer and its panel: a 32 px row whose work-in-focus button is 32 px high, the
// blocks of the panel spaced on 8 px steps, and the divider drawn with the token.
{
  const rules = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="work-bar"]');
    const row = bar.querySelector('[data-testid="work-bar-line"]');
    const focus = bar.querySelector('[data-testid="work-bar-focus"]').getBoundingClientRect();
    const panel = getComputedStyle(bar.querySelector('[data-testid="focus-bar"]'));
    const divider = bar.querySelector('[data-testid="work-bar-divider"]');
    return {
      row: row ? Math.round(row.getBoundingClientRect().height) : null,
      focus: Math.round(focus.height),
      padding: [panel.paddingTop, panel.paddingLeft],
      gap: panel.rowGap,
      divider: divider ? getComputedStyle(divider).backgroundColor : null,
    };
  });
  if (rules.row !== 32 || rules.focus < 32) throw new Error(`The bar above the composer is not 32 px: ${JSON.stringify(rules)}`);
  if (rules.padding.join() !== "16px,16px" || rules.gap !== "8px") throw new Error(`The focus panel is not on the 8 px steps: ${JSON.stringify(rules)}`);
  if (rules.divider === "rgb(0, 0, 0)") throw new Error("The divider of the bar is not drawn with the token");
}
await shot("17-focus-bar-queue");
await pause.click();
const focusIs = (title, equal) =>
  page.waitForFunction(([text, same]) => (document.querySelector('[data-testid="work-bar-focus-title"]')?.textContent?.trim() === text) === same, [title, equal], {
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
// The work in focus is a full thread, not the seam: the stitch says "to do" in Trama's visual language (1 October 2026).
await expectSeam(null);
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
// The panel unfolds inside the bar above the composer (UI wave of 29 September); Escape folds it again.
await page.keyboard.press("Escape");
await focusBar.waitFor({ state: "detached" });
await page.setViewportSize({ width: 1280, height: 820 });

// T19: the window sizes the layout is checked at, from the minimum (720x640) to full HD.
// Issue #330: the side bar is attached and narrows before the chat, which keeps at least 420 px beside it.
for (const [width, height] of [[720, 640], [1040, 700], [1280, 800], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await closePanels();
  const composer = await page.getByLabel("Messaggio al Coordinatore").boundingBox();
  if (!composer || composer.width < 300) throw new Error(`Composer squeezed at ${width}x${height}: ${JSON.stringify(composer)}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll at ${width}x${height}`);
  await openModules();
  await page.getByRole("listbox", { name: "Moduli" }).getByRole("option", { name: /Orders/ }).click();
  const chatWidth = await page.getByRole("main").evaluate((main) => main.getBoundingClientRect().width);
  if (chatWidth < 419.5) throw new Error(`The chat is ${chatWidth}px wide next to the side bar at ${width}x${height}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal page scroll with the side bar at ${width}x${height}`);
  await shot(`13-size-${width}x${height}-module`);
  // Escape inside the inspector closes it, at every size.
  await page.getByTestId("side-bar").getByRole("button", { name: "Chiudi la barra laterale" }).focus();
  await page.keyboard.press("Escape");
  await page.getByTestId("side-bar").waitFor({ state: "detached" });
  // The module is an editor tab since issue #336: closing it shows the conversation.
  await closeDetails();
  await shot(`13-size-${width}x${height}-chat`);
}

// A12 (issue #252): discussions between agents. The Coordinator opens one in the first squad: each participant speaks on
// the discussion model and the squad lead closes it with a decision. A second one reaches a product choice: it waits in
// Aspetta te, the person writes in it through the Coordinator and the answer closes it. The Squads view lists both with
// their state; the discussion shows reason, participants, chair, time box, the model of each turn and the outcome. Narrow
// and wide, Codex and Claude, light and dark.
{
  const look = await lookOf();
  const squadPanel = page.getByTestId("side-bar");
  await composer().fill("[discussione]");
  await page.keyboard.press("Enter");
  await page.getByText("Ho aperto la discussione nella squadra.").first().waitFor({ timeout: 20_000 });
  await composer().fill("[discussione-prodotto]");
  await page.keyboard.press("Enter");
  await page.getByText("Ho aperto la discussione nella squadra.").nth(1).waitFor({ timeout: 20_000 });
  await openView("Squadre");
  const decidedRow = squadPanel.locator('[data-testid="discussion-row"][data-state="decided"]').filter({ hasText: "Stimare e dividere" });
  const waitingRow = squadPanel.locator('[data-testid="discussion-row"][data-state="waitingPerson"]').filter({ hasText: "carrello" });
  await decidedRow.waitFor({ timeout: 20_000 });
  await waitingRow.waitFor({ timeout: 20_000 });
  if (!(await squadPanel.getByTestId("squad").first().getByTestId("squad-discussions").count())) throw new Error("The discussions are not in their squad");
  if (await squadPanel.getByTestId("discussions-across").count()) throw new Error("A discussion inside one squad is listed between squads");
  // Issue #336 (B07): the discussion opens in a tab of the editor next to the conversation; its rows stay in Squadre.
  const thread = detailPane().getByTestId("agent-thread");
  const discussionShots = async (name) => {
    for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      // The discussion's header on top of its tab, or the squads' summary on top of the side bar.
      const top = (await thread.count()) ? thread : squadPanel.getByTestId("squads-summary");
      await top.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await noHorizontalScroll(`${name} ${size}`);
      for (const provider of ["codex", "claudeAgent"]) {
        for (const dark of [false, true]) {
          await setLookTo(provider, dark);
          await shot(`41${name}-${size}-${provider}-${dark ? "dark" : "light"}`);
        }
      }
    }
    await setLookTo(look.provider, look.dark);
    await page.setViewportSize({ width: 1280, height: 820 });
  };
  await squadPanel.getByTestId("squad-discussions").first().scrollIntoViewIfNeeded();
  await discussionShots("a-discussions-squads");

  // The discussion that waits for the person: its lead chairs it, every agent's turn names its model, and the card is in
  // Aspetta te with the way back to the discussion.
  await waitingRow.click();
  await thread.waitFor();
  // The tab of a discussion is named by its motive, so two open discussions tell each other apart.
  await page.locator('[data-testid="editor-tab"][data-selected="true"]').getByText("Un ordine annullato torna nel carrello?").waitFor();
  const header = thread.getByTestId("discussion-header");
  if ((await header.getAttribute("data-state")) !== "waitingPerson") throw new Error("The product discussion does not wait for the person");
  await header.getByText("Conflitto").waitFor();
  await header.getByText(/^Tempo massimo 20 min, fino alle/).waitFor();
  if ((await thread.getByTestId("discussion-participants").locator("li").count()) !== 3) throw new Error("The discussion does not list its lead among the participants");
  await thread.getByTestId("discussion-participants").getByText("chiude", { exact: true }).waitFor();
  const agentMessages = thread.locator('[data-testid="agent-thread-message"][data-author="specialist"]');
  if ((await agentMessages.count()) < 3) throw new Error(`The discussion has ${await agentMessages.count()} messages of agents, not one per participant and the chair's`);
  for (const message of await agentMessages.all()) {
    if (!/^con \S+/.test((await message.getByTestId("message-model").innerText()).trim())) throw new Error("A turn of the discussion does not say its model");
  }
  await thread.locator('[data-testid="agent-thread-message"][data-event="toPerson"]').getByText(/l'ho messa in Aspetta te/).waitFor();
  // The person writes in the discussion: the Coordinator passes it on and the message is recorded as theirs.
  const write = thread.getByTestId("discussion-composer");
  await write.getByRole("textbox", { name: "Scrivi nella discussione" }).fill("Preferisco che il cliente non perda il carrello.");
  const writeButtons = await write.locator(".cta-row button").allTextContents();
  if (writeButtons.at(-1)?.trim() !== "Invia") throw new Error(`Invia is not the last call to action: ${writeButtons}`);
  await write.getByRole("button", { name: "Invia" }).click();
  await thread.locator('[data-testid="agent-thread-message"][data-event="forwarded"]').getByText("Tu, tramite il Coordinatore").waitFor({ timeout: 20_000 });
  await expectNoRawIds(thread.getByTestId("discussion-header"), "The discussion's header");
  await discussionShots("b-discussion-waiting");
  // Design of 30 September: opening the question is a way to another view, so it is an icon with its tooltip and a name,
  // and each participant's row is at least 32 px tall.
  const openQuestion = header.getByTestId("discussion-open-question");
  if ((await openQuestion.innerText()).trim() || (await openQuestion.getAttribute("aria-label")) !== "Apri la domanda") throw new Error("Opening the question is not an icon named 'Apri la domanda'");
  const openBox = await openQuestion.boundingBox();
  if (!openBox || openBox.width < 32 || openBox.height < 32) throw new Error(`Opening the question is under 32 px: ${JSON.stringify(openBox)}`);
  await openQuestion.hover();
  await page.locator(".translucent-popup").getByText("Apri la domanda", { exact: true }).waitFor();
  await page.mouse.move(0, 0);
  const participantHeights = await thread.getByTestId("discussion-participants").locator("li").evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  if (participantHeights.some((height) => height < 32)) throw new Error(`A participant's row is under 32 px: ${participantHeights}`);
  // The box that says the discussion waits is 16 px below what comes before it.
  const waitingGap = await thread.getByTestId("discussion-waiting").evaluate((box) => Math.round(box.getBoundingClientRect().top - box.previousElementSibling.getBoundingClientRect().bottom));
  if (waitingGap < 16) throw new Error(`The waiting box is ${waitingGap} px from what comes before it, not 16`);
  await openQuestion.click();
  const question = squadPanel.locator('[data-testid="waiting-item"]').filter({ hasText: "Un ordine annullato torna nel carrello?" });
  await question.waitFor({ timeout: 20_000 });
  await question.getByTestId("decision-from-discussion").getByText(/^Dalla discussione tra agenti/).waitFor();
  await question.getByText("Discussione tra agenti").first().waitFor();
  await themeShots("41c-discussion-question");
  await question.getByRole("button", { name: /Il carrello resta vuoto/ }).click();
  await question.getByRole("button", { name: "Registra la decisione" }).click();
  await openView("Squadre");
  await squadPanel.locator('[data-testid="discussion-row"][data-state="decided"]').filter({ hasText: "carrello" }).click();
  await thread.locator('[data-testid="discussion-outcome"][data-how="person"]').getByText("Il carrello resta vuoto").waitFor({ timeout: 20_000 });
  await thread.getByTestId("discussion-closed").waitFor();
  if (await thread.getByTestId("discussion-composer").count()) throw new Error("A closed discussion still takes messages");
  await themeShots("41d-discussion-person-decided");

  // The discussion the lead closed: the proposals of the participants and the lead's decision.
  await openView("Squadre");
  await decidedRow.click();
  await page.locator('[data-testid="editor-tab"][data-selected="true"]').getByText("Stimare e dividere la documentazione dell'annullamento").waitFor();
  await thread.locator('[data-testid="discussion-outcome"][data-how="agreed"]').getByText(/Decisa da Capo /).waitFor();
  if ((await thread.getByTestId("discussion-proposal").count()) < 2) throw new Error("The participants' proposals are not in the discussion");
  await header.getByText("Stima e divisione del lavoro").waitFor();
  await discussionShots("e-discussion-decided");
  // Q17: the discussions run on the provider's lightest model; the person picks the role's model in the settings.
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  const discussionSettings = page.getByTestId("settings");
  await discussionSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
  // Metodo: the rules of the settings hold, Prepara is the last action of its row, not filled, and the limits are 32 px.
  await settingsRules("Metodo di lavoro");
  const prepareRow = discussionSettings.locator(".cta-row").filter({ has: page.getByRole("button", { name: "Prepara", exact: true }) });
  if ((await prepareRow.locator(":scope > button").last().textContent()).trim() !== "Prepara") throw new Error("Prepara is not the last action of its row");
  if ((await prepareRow.getByRole("button", { name: "Prepara", exact: true }).getAttribute("data-filled")) === "true") throw new Error("Prepara is drawn filled");
  for (const id of ["shared-developers", "parallel-developers", "squad-limit-developersPerSquad", "squad-limit-activeSquads", "work-place"]) {
    const heights = await discussionSettings.getByTestId(id).getByRole("radio").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    if (heights.some((h) => h < 31.5)) throw new Error(`The choices of ${id} are under 32 px: ${heights}`);
  }
  const discussionModel = discussionSettings.getByTestId("discussion-model");
  await discussionModel.getByRole("radio", { name: "Il più leggero", checked: true }).waitFor();
  await discussionModel.getByRole("radio", { name: "Del ruolo" }).click();
  await discussionModel.getByRole("radio", { name: "Del ruolo", checked: true }).waitFor();
  await discussionSettings.getByText("Il modello scelto per ogni ruolo: costa di più, per discussioni difficili.").waitFor();
  await discussionModel.scrollIntoViewIfNeeded();
  await themeShots("41f-discussion-model-setting");
  await discussionModel.getByRole("radio", { name: "Il più leggero" }).click();
  await discussionModel.getByRole("radio", { name: "Il più leggero", checked: true }).waitFor();
  await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
  await page.getByTestId("settings").waitFor({ state: "hidden" });
  await openView("Squadre");
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
// FAKE_CODEX_SECRET_FIX_HOLD keeps the developer's fix of the secret at work until the check has read the blocked candidate (issue #388).
const secretFixHold = join(await mkdtemp(join(tmpdir(), "trama-ui-hold-")), "secret-fix");
({ app, page } = await launch({
  PATH: `${ghBin}:${process.env.PATH}`,
  FAKE_GH_TEAM: "1",
  TRAMA_PROVIDER_RETRY_MS: "4000",
  FAKE_CODEX_RATE_LIMITS: "2",
  FAKE_CODEX_LIGHT_MODEL: "gpt-5.5-mini",
  FAKE_CODEX_SECRET_FIX_HOLD: secretFixHold,
}));
// Issue #330: the goals are the first tab of Lavoro, opened from its icon in the activity bar.
const goalsRow = page.getByRole("navigation", { name: "Viste" }).getByRole("button", { name: "Lavoro", exact: true });
await goalsRow.waitFor({ timeout: 30_000 });
// B02, issue #354: after the first launch, with a provider connected, the Benvenuto never opens by itself, whatever the
// optional steps say. Trama decides once the state is read and the providers are checked, so the check waits for that.
for (let tries = 0; ; tries++) {
  const read = await page.evaluate(async () => {
    const state = await window.trama.getState();
    return state.started && state.providers.codex.account?.kind === "chatgpt" && !state.providers.codex.checking;
  });
  if (read) break;
  if (tries > 120) throw new Error("The providers were not checked after the restart");
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
if (await page.getByTestId("welcome").count()) throw new Error("The welcome showed again after the first launch");
// Reopened from the project's menu, it opens beside the conversation with its way back. With a project of the person
// open, Inizia offers the first goal too; with every step done it says "Tutto pronto".
{
  await openWelcomeFromProjectMenu();
  const reopened = page.getByTestId("welcome");
  const openDemo = await page.evaluate(async () => (await window.trama.getState()).project?.isDemo ?? null);
  if ((await reopened.getByRole("button", { name: /^Formula il primo obiettivo/ }).count()) !== (openDemo === false ? 1 : 0)) {
    throw new Error("Inizia offers the first goal only with a project of the person open");
  }
  await reopened.locator('[data-step="github"][data-status="done"]').waitFor({ timeout: 20_000 });
  if ((await reopened.getAttribute("data-all-set")) === "true") {
    await reopened.getByTestId("welcome-all-set").getByText("Tutto pronto.").waitFor();
    if (await reopened.getByTestId("welcome-setup").getByText(/su \d+ fatti/).count()) throw new Error("Configura counts the steps done beside Tutto pronto");
  }
  const reopenedLook = await lookOf();
  for (const [width, height] of [
    [1280, 800],
    [1680, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await noHorizontalScroll(`welcome with a project ${width} ${provider} ${dark ? "dark" : "light"}`);
        await shot(`00f-welcome-project-${width}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
  }
  await setLookTo(reopenedLook.provider, reopenedLook.dark);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).click();
  await reopened.waitFor({ state: "detached" });
}
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
await detailPane().getByRole("heading", { name: goalTitle }).waitFor();
await shot("13a-goal-reopened");
console.log("reopened goal", goalId);

// W12, Issue: "Chiedi al Coordinatore" cites the issue in the composer, ready to edit or send. The folder chooser is
// native, so the project opens through the same action as a recent project in the sidebar.
await page.evaluate((path) => window.trama.invoke("project:open", { path }), githubProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-negozio" }).waitFor({ timeout: 30_000 });
await openView("Lavoro");
const issuesPanel = page.getByTestId("side-bar");
// Issue #332: the issues are a section of Lavoro, each with what Trama does with it.
await issuesPanel.getByTestId("work-issue").filter({ hasText: "Il pulsante Annulla non fa niente" }).getByText("nessun lavoro").waitFor({ timeout: 30_000 });
await issuesPanel.getByRole("button", { name: /Il pulsante Annulla non fa niente/ }).click({ timeout: 30_000 });
// Issue #336: the issue opens in its editor tab.
{
  // Design rules: Apri su GitHub is an icon, Chiedi has icon and text, and the primary of the row stays last.
  const issueActions = detailPane().and(page.locator('[data-kind="issue"]')).locator(".cta-row");
  await expectIconOnly(issueActions.getByRole("button", { name: "Apri su GitHub" }), "Issue, Apri su GitHub");
  await expectIconAndText(issueActions.getByRole("button", { name: "Chiedi al Coordinatore", exact: true }), "Issue, Chiedi");
  await primaryLast(issueActions, "Issue");
}
await detailPane().and(page.locator('[data-kind="issue"]')).getByRole("button", { name: "Chiedi al Coordinatore", exact: true }).click();
await expectAsked("@issue:7 «Il pulsante Annulla non fa niente»", "Issue, Chiedi al Coordinatore");
if (await page.getByRole("button", { name: "Invia al Coordinatore" }).isDisabled()) throw new Error("The question about the issue cannot be sent");
await shot("15a-issue-ask");
await composer().fill("");
// W12, Gruppo dissolved (issue #332): following the repository in the background is in Impostazioni, Monitor, and
// Lavoro then says it is followed; who works on what is in Squadre; the impact question is in Lavoro.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await page.getByTestId("settings").getByRole("button", { name: /^Monitor/ }).first().click();
await page.getByTestId("settings").getByRole("button", { name: "Osserva", exact: true }).click();
await page.getByTestId("settings").getByRole("button", { name: "Togli", exact: true }).waitFor({ timeout: 10_000 });
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await openView("Lavoro");
const groupPanel = page.getByTestId("side-bar");
await groupPanel.getByTestId("work-github").getByText("seguito in background").waitFor({ timeout: 10_000 });
if (await groupPanel.getByRole("button", { name: "Segui in background" }).count()) throw new Error("Lavoro still offers Segui in background, which is in Impostazioni, Monitor");
// The GitHub part of Gruppo: the colleague's pull request is in Lavoro, with its details and Apri su GitHub as an icon.
const colleaguePull = groupPanel.getByTestId("work-pull").filter({ hasText: "#12 Annullo degli ordini dal riepilogo" });
await colleaguePull.waitFor({ timeout: 20_000 });
await colleaguePull.getByText(/collega/).waitFor();
await colleaguePull.getByRole("button", { name: "Apri su GitHub" }).waitFor();
// G02, decision 9a: a colleague who does not use Trama appears in Squadre with what GitHub shows, their pull request
// and branch; a branch nobody explains stays apart.
await openView("Squadre");
const boardPanel = page.getByTestId("side-bar");
const githubOnly = boardPanel.locator('[data-testid="group-row"][data-kind="github"]').filter({ hasText: "collega" });
await githubOnly.getByText("#12 Annullo degli ordini dal riepilogo").waitFor({ timeout: 20_000 });
if (!((await githubOnly.getByTestId("group-branches").getAttribute("title")) ?? "").includes("feature/annullo-ordini")) throw new Error("The colleague's branch is not on the hover of their row");
await githubOnly.getByText(/^su GitHub/).waitFor();
// The branches nobody explains are one line with their number; their names stay on hover (critique of 29 September).
const otherBranches = boardPanel.getByTestId("group-other-branches");
await otherBranches.getByText(/branch su GitHub, senza pull request né presenza$/).waitFor();
if (!((await otherBranches.getAttribute("title")) ?? "").includes("spike/vecchio-checkout")) throw new Error("The other branches are not on the hover of their line");
await boardPanel.locator('[data-testid="group-row"][data-self="true"]').getByText("trama-ui (tu)").waitFor({ timeout: 20_000 });
await shot("15b-group-follow");
await openView("Lavoro");
await page.setViewportSize({ width: 720, height: 640 });
await groupPanel.getByRole("button", { name: "Chiedi al Coordinatore l'impatto" }).click();
await expectAsked("Valuta l'impatto delle ultime novità dei colleghi", "Lavoro, Chiedi al Coordinatore l'impatto");
// Issue #330: the side bar is attached and no longer floats over the chat, so it stays open and leaves the question
// in view beside it.
{
  const question = await composer().boundingBox();
  const side = await groupPanel.boundingBox();
  if (!question || !side || question.x < side.x + side.width || question.x + question.width > 720) throw new Error("The question is not in view beside Lavoro at 720x640");
}
await shot("15c-group-ask-narrow");
await composer().fill("");
await closePanels();

// V04 and V05 on a fresh copy of the example project. The person stops a developer's work and resumes it; a check fails
// on a candidate and the card opens its original output; the correction is a new candidate that gets the green light,
// and new evidence withdraws it.
await page.setViewportSize({ width: 1280, height: 820 });
// The person drives each step here, so Trama's automatic moves (W04, checked above) stay off.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
const candidateProject = await mkdtemp(join(tmpdir(), "Negozio-ordini-"));
await cp(resolve("resources/DemoProject"), candidateProject, { recursive: true });
const gitIn = (...args) => execFileSync("git", ["-C", candidateProject, ...args], { stdio: "ignore" });
gitIn("init", "-q", "-b", "main");
gitIn("add", ".");
gitIn("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
await page.evaluate((path) => window.trama.invoke("project:open", { path }), candidateProject);
await page.getByTestId("dialog-title").filter({ hasText: "Negozio-ordini" }).waitFor({ timeout: 30_000 });
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
// Issue #244: the project mandate waits at the opening. Here the person writes a narrower mandate of their own.
const declinedMandate = await openWaiting("mandate");
await declinedMandate.getByRole("button", { name: "Rifiuta la proposta" }).click();
await declinedMandate.getByLabel("Motivo del rifiuto").fill("Scrivo io un mandato più stretto");
await declinedMandate.getByRole("button", { name: "Rifiuta la proposta" }).click();
await declinedMandate.waitFor({ state: "detached", timeout: 20_000 });
await closePanels();
// Issue #292: after the study only the goal the Coordinator proposed waits. Discarded, it leaves Aspetta te, and with
// nothing waiting for the person the summary above the composer does not show (issue #240).
const proposedGoal = page.locator('[data-testid="waiting-reference"][data-waiting-kind="goal"]').first();
await proposedGoal.waitFor({ timeout: 30_000 });
const proposedGoalId = (await proposedGoal.getAttribute("data-waiting-key")).replace(/^goal:/, "");
await page.evaluate((id) => window.trama.invoke("goal:update", { id, status: "abandoned" }), proposedGoalId);
await page.getByTestId("waiting-summary").waitFor({ state: "detached", timeout: 10_000 });
if (await page.locator('[data-testid="waiting-reference"]').count()) throw new Error("A reference to Aspetta te stays with nothing waiting");
// ADR 0019: past the threshold Trama reorders the context at the end of the turn. The chat keeps one line that opens
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
if (await page.getByTestId("work-bar").count()) covers.push(await page.getByTestId("work-bar").boundingBox());
for (const box of covers) if (cardBottom > box.y + 1) throw new Error(`The open context summary is covered at ${Math.round(box.y)} (card ends at ${Math.round(cardBottom)})`);
await themeShots("29b-context-rollover-summary");
await rolloverLine.getByRole("button", { name: "Chiudi: Contesto riordinato" }).click();
const meter = page.getByTestId("context-meter");
// The reordered context is small: the meter is hidden far from the threshold, so the check lowers it to see the meter.
if (await meter.count()) throw new Error("The meter shows right after the reorder, far from the threshold");
await page.evaluate(() => window.trama.invoke("coordinator:setContextThreshold", { percent: 5 }));
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
await page.evaluate(() => window.trama.invoke("coordinator:setContextThreshold", { percent: 80 }));
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
await changeMandate("Scrivi");
await page.getByRole("textbox", { name: "Obiettivi" }).fill("Documentare l'annullamento degli ordini");
await page.getByRole("checkbox", { name: /Orders/ }).check();
await page.getByRole("checkbox", { name: /worktree/ }).check();
await page.getByRole("checkbox", { name: /Integrare candidati/ }).check();
await page.getByRole("button", { name: "Concedi mandato" }).click();
await page.getByText(/Mandato v1/).first().waitFor({ timeout: 20_000 });
await closePanels();
// Issue #271: finished work is one settled line, with the same title, developer and outcome as its card.
const assignmentCards = page.locator('.chat-card:not([data-testid="settled-card"] .chat-card), [data-testid="settled-card"]').filter({ hasText: /^Incarico / }).filter({ hasText: "Ada" });
const cardAssignment = (card) => recordId(card, "A");

// V04: the stop is first requested, then confirmed; the work and its turn stay, and it resumes in the same worktree.
// "[con-decisioni]" gives the work the Pact decision just recorded, so the person's page lists it (29 September 2026).
await send("[assegna] [lento] [con-decisioni]");
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
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
// Critique of 29 September 2026: a stopped person is on top of Squadre, above the squads, and their page opens on a
// summary (what it does, what holds it up, the next move), then the settings, then the work with its details folded
// and its Pact decisions one per line.
{
  await openView("Squadre");
  const attention = page.getByTestId("side-bar").getByTestId("squads-attention");
  const stoppedAda = attention.locator('[data-testid="attention-person"][data-sign="stopped"]').filter({ hasText: "Ada" });
  await stoppedAda.waitFor({ timeout: 20_000 });
  // Above the squads and the lists of people, right under the summary's first lines.
  const firstGroupTop = await page
    .getByTestId("side-bar")
    .locator('[data-testid="squad"], [data-testid="team-developer"], [data-testid="team-figure"]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().top);
  if ((await attention.evaluate((el) => el.getBoundingClientRect().bottom)) > firstGroupTop) throw new Error("Who is stopped is not above the squads");
  await sideBarEnds("52a-squads-attention");
  await stoppedAda.click();
  const adaPage = detailPane().getByTestId("specialist");
  const brief = adaPage.getByTestId("specialist-brief");
  await brief.waitFor();
  if ((await brief.getAttribute("data-sign")) !== "stopped") throw new Error("The summary of a stopped person does not say it is stopped");
  // What it does is the Now card; the summary does not repeat it.
  await adaPage.getByTestId("specialist-now").getByTestId("assignment-detail-toggle").waitFor();
  if (await brief.getByTestId("brief-doing").count()) throw new Error("The summary repeats what the Now card says");
  await brief.getByTestId("brief-blocker").getByText("Fermato dalla persona").waitFor();
  await brief.getByTestId("brief-next").getByText("Riprendilo dalla scheda qui sotto, o chiedi al Coordinatore.").waitFor();
  const tops = await adaPage.evaluate((el) => ["specialist-brief", "specialist-now", "specialist-assignments"].map((id) => el.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top));
  if (!(tops[0] < tops[1] && tops[1] < tops[2])) throw new Error(`The person's page is not summary, work and assignments in this order: ${tops}`);
  const adaNow = adaPage.getByTestId("specialist-now");
  const detailToggle = adaNow.getByTestId("assignment-detail-toggle");
  if ((await detailToggle.getAttribute("aria-expanded")) !== "false") throw new Error("The assignment's details are open before the person opens them");
  if (await adaNow.getByTestId("assignment-contract").count()) throw new Error("The assignment's contract shows before the person opens its details");
  await adaNow.getByRole("button", { name: "Riprendi" }).waitFor();
  // Design rules: Riprendi starts work, so it shows an icon with its text; and it sits above the closed details, on the right.
  const resumeAda = adaNow.getByRole("button", { name: "Riprendi", exact: true });
  if (!(await resumeAda.locator("svg").count()) || (await resumeAda.innerText()).trim() !== "Riprendi") throw new Error("Riprendi on the assignment card is not icon and text");
  const resumeTop = await resumeAda.evaluate((el) => el.getBoundingClientRect().top);
  const toggleTop = await detailToggle.evaluate((el) => el.getBoundingClientRect().top);
  if (!(resumeTop < toggleTop)) throw new Error("The assignment card puts its actions below the details toggle");
  if ((await resumeAda.evaluate((el) => el.parentElement.lastElementChild === el)) !== true) throw new Error("Riprendi is not the last action of the assignment card");
  await themeShots("52b-person-stopped");
  await detailToggle.click();
  const reliedOn = adaNow.getByTestId("contract-decisions");
  await reliedOn.getByTestId("contract-decision").first().waitFor();
  // One decision per line: each row starts at the list's left edge.
  const decisionLefts = await reliedOn.getByTestId("contract-decision").evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().left)));
  if (new Set(decisionLefts).size !== 1) throw new Error(`The Pact decisions of the work are not one per line: ${decisionLefts}`);
  await reliedOn.scrollIntoViewIfNeeded();
  await themeShots("52c-person-stopped-detail");
  await page.setViewportSize({ width: 720, height: 820 });
  await page.waitForTimeout(300);
  await noHorizontalScroll("person stopped at 720 px");
  await adaPage.getByTestId("specialist-brief").scrollIntoViewIfNeeded();
  await themeShots("52d-person-stopped-narrow");
  await page.setViewportSize({ width: 1280, height: 820 });
  await closePanels();
}
await slowCard.getByRole("button", { name: "Riprendi" }).click();
await slowCard.getByText("Concluso", { exact: true }).waitFor({ timeout: 20_000 });

// Issue #204: the work ends, Trama starts the checks by itself and the Coordinator verifies the assignment instead of a
// candidate, as in the live run. The move comes back under the reply with Trama's reason and its button on the right.
// Turned back on, continuous work runs a round at once: the work Ada resumed ended without a candidate, so Trama
// starts its checks by itself. The fake Codex keeps an automatic move running until it is stopped (W04). The person
// writes while it runs: the move gives way and the message leaves at once, without a stop (ADR 0023).
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));
await page.getByTestId("status-line").getByRole("button", { name: "Ferma: Esegui le verifiche" }).waitFor({ timeout: 20_000 });
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
// ADR 0023: the checks the person's message set aside have their row, set aside and not stopped.
await page.getByTestId("activity-log").locator('[data-testid="activity-entry"][data-outcome="setAside"]').first().getByText("Messa da parte", { exact: true }).waitFor();
// Issue #337: the row is one line; its detail, with the tools that failed, opens on click.
const stalledEntry = page.getByTestId("activity-log").locator('[data-testid="activity-entry"][data-outcome="stalled"]').first();
await stalledEntry.getByTestId("activity-row-toggle").click();
const toolErrors = stalledEntry.getByTestId("activity-tool-errors");
await toolErrors.locator("summary").click();
await toolErrors.getByText(/is an assignment, not a candidate/).first().waitFor();
// The activity's labels, details and steps name the records (issue #392); the tool's own error text stays as written.
{
  const activityLog = page.getByTestId("activity-log");
  const toolErrorIds = await rawIds(activityLog.getByTestId("activity-tool-errors").first());
  const shown = (await rawIds(activityLog)).filter((id) => !toolErrorIds.includes(id));
  if (shown.length) throw new Error(`Attività shows raw ids: ${[...new Set(shown)].join(", ")}`);
}
for (const dark of [false, true]) {
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await shot(`18a4-activity-tool-errors-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
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
// UI wave of 30 September: what a candidate is missing comes before its checks, right after who did the work.
const missingFirst = await failedCard.evaluate((card) => {
  const missing = card.querySelector('[data-testid="candidate-blockers"]');
  const checks = card.querySelector('[data-testid="candidate-evidence"]');
  return Boolean(missing && checks && missing.compareDocumentPosition(checks) & Node.DOCUMENT_POSITION_FOLLOWING);
});
if (!missingFirst) throw new Error("What a candidate is missing does not come before its checks");
// Design rules: the card opens with a verdict line and the person's actions come right after it, before the checks.
await failedCard.getByTestId("candidate-verdict").getByText(/^Non è ancora pronto: /).waitFor();
const actionsBeforeChecks = await failedCard.evaluate((card) => {
  const verdict = card.querySelector('[data-testid="candidate-verdict"]');
  const actions = card.querySelector(".cta-row");
  const checks = card.querySelector('[data-testid="candidate-evidence"]');
  const after = (a, b) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after(verdict, actions) && after(actions, checks);
});
if (!actionsBeforeChecks) throw new Error("The card's actions do not sit between its verdict and its checks");
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
// Issue #389: the correction replaced the failed candidate, so its card settles as one "Sostituito" line (issue #332:
// "Superato" became "Sostituito" for replaced work); the line opens it.
const supersededLines = page.getByTestId("settled-card").filter({ hasText: "Sostituito" });
await supersededLines.first().waitFor({ timeout: 20_000 });
for (const line of await supersededLines.all()) {
  if (await failedCard.isVisible().catch(() => false)) break;
  await openSettled(line);
  if (!(await failedCard.isVisible().catch(() => false))) await line.getByRole("button", { name: /^Chiudi: / }).first().click();
}
await failedCard.getByTestId("candidate-superseded").waitFor();
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
// Issue #331: the candidate's card opens in Aspetta te, in the side bar. At its narrowest the reviewers' rows stay
// readable: name, tag and badge never overlap, a few letters of the name always show, the badge stays whole and
// inside the row (under the name when there is no room beside it). 1280x800, light and dark.
{
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  await openView("Aspetta te");
  const gate = page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-waiting-kind="candidate"][data-open="true"] [data-testid="candidate-gate"]');
  await gate.waitFor();
  const sash = page.getByRole("separator", { name: /Larghezza della barra laterale/ });
  const sashBox = await sash.boundingBox();
  await page.mouse.move(sashBox.x + sashBox.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(sashBox.x + sashBox.width / 2 - 400, 400, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(900, 500);
  await page.waitForTimeout(400);
  const narrowest = Number(await sash.getAttribute("aria-valuenow"));
  if (narrowest !== Number(await sash.getAttribute("aria-valuemin"))) throw new Error(`The side bar is not at its narrowest: ${narrowest}px`);
  const rowProblems = () =>
    gate.getByTestId("gate-review").evaluateAll((rows) => {
      const problems = [];
      const overlap = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const row of rows) {
        const role = row.dataset.role;
        const head = row.querySelector('[data-testid="gate-review-head"]').getBoundingClientRect();
        const name = row.querySelector('[data-testid="agent-name"]');
        const tag = row.querySelector('[data-testid="agent-tag"]');
        const badge = row.querySelector('[data-testid="gate-review-outcome"] > :last-child');
        const boxes = { name: name?.getBoundingClientRect(), tag: tag?.getBoundingClientRect(), badge: badge.getBoundingClientRect() };
        if (name && boxes.name.width < 16) problems.push(`${role}: the name shows ${Math.round(boxes.name.width)}px`);
        if (overlap(boxes.name, boxes.tag)) problems.push(`${role}: name and tag overlap`);
        if (overlap(boxes.name, boxes.badge)) problems.push(`${role}: name and badge overlap`);
        if (overlap(boxes.tag, boxes.badge)) problems.push(`${role}: tag and badge overlap`);
        if (tag && boxes.tag.right > head.right + 0.5) problems.push(`${role}: the tag leaves the row`);
        if (boxes.badge.left < head.left - 0.5 || boxes.badge.right > head.right + 0.5) problems.push(`${role}: the badge leaves the row`);
        if (badge.scrollWidth > badge.clientWidth + 1) problems.push(`${role}: the badge is cut`);
      }
      return problems;
    });
  await gate.evaluate((node) => node.scrollIntoView({ block: "center" }));
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
    const problems = await rowProblems();
    if (problems.length) throw new Error(`Reviewer rows in a narrow side bar (${dark ? "dark" : "light"}): ${problems.join("; ")}`);
    await shot(`18e3-candidate-gate-narrow-${dark ? "dark" : "light"}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await sash.dblclick();
  await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
  await page.setViewportSize(viewport);
}
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
// Ada is fixing the secret: the blocked candidate is still the work of now.
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
// Issue #388: once Ada's fix ends, Trama declares the new candidate from her worktree. The blocked one is replaced and
// keeps its gate; the new one has no key in its diff and waits for its own checks.
const blockedId = await secretCandidate.locator("[data-record-id]").first().getAttribute("data-record-id");
if (!blockedId) throw new Error("The blocked candidate's card does not name the candidate");
await writeFile(secretFixHold, "");
await secretWork.getByText("Concluso", { exact: true }).waitFor({ timeout: 30_000 });
const secretCards = candidateCards.filter({ has: page.locator(`[data-reference-id="${await cardAssignment(secretWork)}"]`) });
const fixedCandidate = secretCards.filter({ hasNot: page.getByTestId("candidate-gate") }).last();
await fixedCandidate.waitFor({ timeout: 20_000 });
if ((await fixedCandidate.locator("[data-record-id]").first().getAttribute("data-record-id")) === blockedId) throw new Error("Trama did not declare the candidate of Ada's fix");
const secretReplacedLine = page.getByTestId("settled-card").filter({ has: page.getByRole("button", { name: `Apri: Candidato ${blockedId}` }) });
await secretReplacedLine.waitFor({ timeout: 20_000 });
await openSettled(secretReplacedLine);
const replacedCard = page.locator(".chat-card").filter({ has: page.locator(`[data-record-id="${blockedId}"]`) });
await replacedCard.getByTestId("candidate-superseded").waitFor();
await replacedCard.locator('[data-testid="candidate-gate"][data-status="blocked"]').waitFor();
await page.getByRole("button", { name: `Chiudi: Candidato ${blockedId}` }).click();
await fixedCandidate.scrollIntoViewIfNeeded();
await shot("24a1-candidate-after-the-fix");
// Security's message is in Ada's work, with the turn she resumed with it: the person reads what the agents said.
await page.getByRole("button", { name: /ha lavorato per/ }).last().click();
await page.getByText("Candidato nuovo sulla copia di lavoro").last().waitFor({ timeout: 10_000 });
// The step names the candidate, not its id (issue #392).
const toDeveloper = page.getByRole("button", { name: /^Sicurezza a Ada: 1 rilievo bloccante sul candidato di Ada/ });
await toDeveloper.waitFor({ timeout: 10_000 });
await toDeveloper.click();
await page.getByText(/Segreto nel diff: chiave API in NOTE\.md/).last().waitFor();
await toDeveloper.evaluate((item) => item.scrollIntoView({ block: "center" }));
await shot("24c-gate-finding-to-developer");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await shot("24d-gate-finding-to-developer-dark");
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await page.getByRole("button", { name: "Chiudi il pannello" }).click();

// Q03: the technical review checks the diff against Trama's Clean Code standard. The card shows Trama's measures as
// evidence and the reviewer's findings, with file and line, as judgement; in the light and the dark theme.
await showWaiting();
const review = correctedCard.getByTestId("technical-review");
await review.getByTestId("review-measures").getByText(/Misure di Trama, standard v1/).waitFor();
const suggestion = review.locator('[data-testid="review-finding"][data-severity="suggestion"]');
await suggestion.getByText("NOTE.md:1").waitFor();
// Issue #392: Clean Code's finding is listed once on the card, in the technical review, not again in its gate row.
if (await correctedCard.locator('[data-testid="gate-review"][data-role="cleanCode"] [data-testid="gate-finding"]').filter({ hasText: "NOTE.md:1" }).count()) {
  throw new Error("A Clean Code finding shows twice on the candidate card");
}
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
await changeMandate("Correggi");
await page.getByRole("checkbox", { name: /Aprire pull request/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v2/).first().waitFor({ timeout: 20_000 });
await closePanels();
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
// The project's switches: Standard del codice lists the rules; one turns off for this project. Issue #334: the rules
// live in Regole, in the Standard tab; Impostazioni keeps a way there.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
const standardSettings = page.getByTestId("settings");
await standardSettings.getByRole("button", { name: /^Standard del codice/ }).first().click();
await standardSettings.getByText(/ora sta in Regole|stanno in Regole/).waitFor();
await themeShots("18d5-standard-settings-link");
await standardSettings.getByTestId("standard-open-rules").click();
await page.locator('[data-testid="side-bar"][data-view="rules"]').getByRole("tab", { name: "Standard", selected: true }).waitFor();
const rules = page.getByTestId("side-bar").getByTestId("clean-code-settings");
// The long explanation is a closed section (design rules): it opens on request.
if ((await rules.getByTestId("standard-about").getAttribute("data-open")) !== "false") throw new Error("Su questo standard is not closed by default");
await rules.getByRole("button", { name: "Su questo standard" }).click();
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
// "Apri in Regole" leaves Impostazioni for the conversation, with the Standard tab beside it.
await standardSettings.waitFor({ state: "hidden" });
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
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
// Issue #336: the reference opens the candidate in its editor tab, over the conversation in a narrow window.
const referenceInspector = detailPane();
await referenceInspector.and(page.locator('[aria-label="Candidato"]')).waitFor({ timeout: 10_000 });
// Issue #270: the tab names the candidate; its id is on the title's hover and on the card's title.
await page.locator(`[data-testid="editor-detail-title"][title="${citedCandidate}"]`).waitFor();
await referenceInspector.locator(`[data-record-id="${citedCandidate}"]`).first().waitFor();
await shot("23c-reference-opened-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("23d-reference-opened-light");
const citedDecision = await decisionLink.getAttribute("data-reference-id");
await showConversation();
await decisionLink.click();
await referenceInspector.and(page.locator('[aria-label="Decisione"]')).waitFor({ timeout: 10_000 });
await page.locator(`[data-testid="editor-detail-title"][title="${citedDecision}"]`).waitFor();
await closePanels();

// M06: the developer of a slice runs implement and tdd with their original text and reports the seams it tested.
// The candidate shows that report apart from Trama's evidence; the build and the tests wait for Trama's own run.
await changeMandate("Correggi");
await page.getByRole("checkbox", { name: /Preparare piani/ }).check();
await page.getByRole("button", { name: "Salva correzione" }).click();
await page.getByText(/Mandato v3/).first().waitFor({ timeout: 20_000 });
await closePanels();
await send("[piano]");
// Continuous work is off here, so the seams and the slices stay the person's, as without a mandate (A06).
await (await openWaiting("seams")).getByRole("button", { name: "Conferma i punti di prova" }).click({ timeout: 20_000 });
await (await openWaiting("slices")).getByTestId("plan-slices").getByRole("button", { name: "Conferma le fette" }).click({ timeout: 20_000 });
await closePanels();
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
// Issue #338: Esame approfondito is an icon in the chat card; its name is the aria-label.
const focusActions = await sliceCandidate.locator(".cta-row button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") || node.textContent));
if (!focusActions.some((label) => label.includes("Esame approfondito"))) throw new Error(`No Esame approfondito on the candidate: ${focusActions}`);
await sliceCandidate.getByRole("button", { name: "Esame approfondito" }).click();
await focusAudit.waitFor({ timeout: 20_000 });
await auditDone();
// Issue #336: the examination is a section of the candidate's tab, with the verdict in one line on top and the
// technical side (commands, skills, models, the raw report) closed. The check opens it to read the report.
await detailPane().and(page.locator('[data-kind="candidate"]')).waitFor();
const auditBlocks = await focusAudit.evaluate((el) => [...el.querySelectorAll('[data-testid="focus-audit-verdict"], h5')].map((node) => node.getAttribute("data-testid") ?? node.textContent.trim()));
if (auditBlocks[0] !== "focus-audit-verdict") throw new Error(`The verdict is not on top of the examination: ${auditBlocks}`);
const openVisible = await focusAudit.evaluate((el) => [...el.querySelectorAll("details")].filter((d) => d.open).length);
if (openVisible) throw new Error("The technical detail of the examination is open by default");
const auditVisibleText = await focusAudit.innerText();
if (/Skill ricevute|git diff [0-9a-f]{7}|gpt-5\.5/.test(auditVisibleText)) throw new Error(`The examination shows technical lines to the person: ${auditVisibleText}`);
const againButton = focusAudit.getByRole("button", { name: "Esamina di nuovo" });
if (!(await againButton.locator("svg").count())) throw new Error("Esamina di nuovo has no icon");
// Design rules: the examination has no filled button (the window's one is in Aspetta te), its blocks sit on the 16 px
// step, and its findings read "Prova:" from the catalog.
if (await focusAudit.locator('button[data-variant="default"]').count()) throw new Error("The examination has a filled button");
const auditPadding = await focusAudit.evaluate((el) => getComputedStyle(el).paddingTop);
if (auditPadding !== "16px") throw new Error(`The examination's blocks are not on the 16 px step: ${auditPadding}`);
await focusAudit.evaluate((el) => el.querySelectorAll("details").forEach((d) => (d.open = true)));
for (const check of ["swift_build", "swift_test"]) {
  await focusAudit.locator(`[data-testid="candidate-evidence"][data-check="${check}"]:not([data-result="missing"])`).waitFor();
}
await focusAudit.locator('[data-testid="audit-axis"][data-axis="standards"][data-status="done"]').getByText(/Mysterious Name/).first().waitFor();
// Issue #277: the report names the slice it read, as a link with the slice's title.
const specAxis = focusAudit.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="done"]');
await specAxis.getByText(/Fonte: Fetta/).waitFor();
await specAxis.locator('a[data-reference="slice"][data-reference-id="S1"]').filter({ hasText: /^1, / }).waitFor();
// The sections of the examination, in order: the verdict's summary names the axes too, so the headings count.
const [checksAt, standardsAt, specAt] = ["Verifiche reali", "Standards", "Spec"].map((heading) => auditBlocks.findIndex((block) => block.startsWith(heading)));
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
// F05: Trama's three lenses follow the axes, marked as Trama's additions, and their findings go through the same
// verification: Trama reread the security line, the stronger model confirmed the test finding, the documents one has no proof.
const auditLens = (lens) => focusAudit.locator(`[data-testid="audit-lens"][data-lens="${lens}"][data-status="done"]`);
const lensNote = focusAudit.getByTestId("focus-audit-lenses-note");
await lensNote.getByText(/controlli in più di Trama: non vengono dal metodo AI Hero/).waitFor();
if ((await focusAudit.getByText("Aggiunta di Trama", { exact: true }).count()) !== 3) throw new Error("Focus mode: each lens is not marked as Trama's addition");
await auditLens("security").locator('[data-testid="audit-finding"][data-status="verified"][data-severity="serious"]').getByText("Verificato da Trama").waitFor();
await auditLens("tests").locator('[data-testid="audit-finding"][data-status="confirmed"]').getByText(/Confermato da gpt-5\.5:/).waitFor();
if ((await auditLens("docs").locator('[data-testid="audit-finding"][data-status="hypothesis"] [data-testid="audit-finding-evidence"]').innerText()) !== "Prova: Nessuna prova") {
  throw new Error("Focus mode: the documents lens finding without a proof is not a hypothesis");
}
// Issue #336: the verdict with both summaries is on top; the lenses follow the Spec axis.
const lensHeadings = await focusAudit.evaluate((el) => [...el.querySelectorAll('h5, [data-testid="focus-audit-lenses-note"]')].map((node) => node.textContent.trim()));
const specAt2 = lensHeadings.findIndex((text) => text.startsWith("Spec"));
const lensesAt = lensHeadings.findIndex((text) => text.startsWith("Lenti di Trama"));
if (!(specAt2 >= 0 && specAt2 < lensesAt && lensesAt < lensHeadings.length - 1)) throw new Error("Focus mode: the lenses do not follow the axes");
await focusAudit.getByTestId("focus-audit-lens-summary").getByText(/^Lenti di Trama: Sicurezza: 1 rilievo.*Qualità dei test: 1 rilievo.*Documenti e codice: 1 rilievo/).waitFor();
await focusAudit.getByTestId("focus-audit-tally").getByText("Stato dei rilievi: 2 verificati da Trama, 2 confermati da un secondo modello, 2 ipotesi.").waitFor();
// The shots show the examination as the person finds it, with the technical side closed.
await focusAudit.evaluate((el) => el.querySelectorAll("details").forEach((d) => (d.open = false)));
await focusAudit.scrollIntoViewIfNeeded();
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
await lensNote.evaluate((node) => node.scrollIntoView({ block: "start" }));
await shot("20h-focus-audit-lenses-dark");
await app.evaluate(({ nativeTheme }) => {
  nativeTheme.themeSource = "system";
});
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await shot("20g-focus-audit-lenses");
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
// Issue #337: the backlog left Activity; the finding's link opens it in Lavoro, Issue, on the "Nel backlog" filter.
await verifiedFinding.locator('[data-testid="audit-finding-followups"] [data-kind="ticket"]').getByRole("button", { name: "backlog di Trama" }).click();
await page.locator('[data-testid="side-bar"][data-view="work"]').getByTestId("problem-backlog").getByTestId("problem-backlog-item").first().waitFor({ timeout: 10_000 });
// The correction is Ada's new assignment in the work's dialog; it ends before the next step gives her work. The
// candidate's tab covers the conversation since issue #336: the conversation comes forward.
await showConversation();
const correctionWork = assignmentCards.nth(6);
await waitInCard(correctionWork, (card) => card.getByText(/Correggere il rilievo: Possibile Mysterious Name/), "finding correction");
await waitInCard(correctionWork, (card) => card.getByText("Concluso", { exact: true }), "finding correction ended", 30_000);
await closePanels();
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
await closePanels();
await showWaiting();
await correctedCard.getByRole("button", { name: "Esame approfondito" }).click();
await page.locator('[data-testid="focus-audit"][data-status="done"]').waitFor({ timeout: 10_000 });
await closePanels();

// Issue #336: the details are tabs of the editor, as in VS Code. The conversation is the first tab and never closes;
// the tab bar shows only with more than one tab. At 1280x800 a detail covers the conversation, and the row above the
// composer and the status bar stay in view; at 1680x1050 the person of the team sits beside the conversation. The
// same shots in the Codex and Claude themes, light and dark, then the candidate with its examination, Progetti and
// Impostazioni.
{
  const editorLook = await lookOf();
  const editorShots = async (name) => {
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        const mode = dark ? "dark" : "light";
        await shot(`${name}-${provider}-${mode}`);
      }
    }
    await setLookTo(editorLook.provider, editorLook.dark);
  };
  const editorArea = page.getByTestId("editor-area");
  // Tabs the steps above left open (Impostazioni after "Apri in Regole") close first: then the conversation is alone.
  for (let tab = page.locator('[data-testid="editor-tab"]:not([data-tab="conversation"])').first(); await tab.count(); ) {
    await tab.getByRole("button", { name: /^Chiudi / }).click();
  }
  if (await page.getByTestId("editor-tabs").count()) throw new Error("The tab bar shows with the conversation alone");
  for (const [width, height] of [[1280, 800], [1680, 1050]]) {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await openView("Squadre");
    await page.getByTestId("side-bar").getByTestId("team-developer").first().click();
    await detailPane().and(page.locator('[data-kind="specialist"]')).waitFor();
    await page.getByTestId("editor-tabs").first().waitFor();
    if (width === 1280) {
      await page.locator('[data-testid="editor-area"][data-split="false"][data-covered="true"]').waitFor();
      if (await composer().isVisible()) throw new Error("The composer shows over the person's tab at 1280x800");
      if (!(await page.getByTestId("status-bar").isVisible())) throw new Error("The status bar is hidden by the person's tab");
      if ((await page.getByTestId("activity-badge").count()) && !(await page.getByTestId("waiting-summary").isVisible())) {
        throw new Error("The row above the composer is hidden by the person's tab");
      }
      // UI wave of 29 September: the bar was a pill floating over the bottom of the person's tab and hid its
      // assignments. Now it is the tab's last row: scrolled to the end, the last assignment ends above the bar.
      await workBarPlace("the person's tab at 1280x800", "tab");
      await detailPane().evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await workBarPlace("the person's tab scrolled to the end", "tab");
      await sideBarEnds("41f-editor-person-work-bar", (end) => workBarPlace(`the person's tab with the side bar ${end}`, "tab"));
      await detailPane().evaluate((el) => el.scrollTo(0, 0));
    } else {
      await page.locator('[data-testid="editor-area"][data-split="true"]').waitFor();
      const chatBox = await page.getByTestId("editor-main").boundingBox();
      const sideBox = await page.getByTestId("editor-side").boundingBox();
      if (!chatBox || !sideBox || chatBox.width < 420 || sideBox.x < chatBox.x + chatBox.width - 1) throw new Error(`The person and the conversation are not side by side at ${size}`);
      if (!(await composer().isVisible())) throw new Error("The composer is hidden beside the person's tab");
      await page.getByTestId("editor-side").getByRole("separator").waitFor({ state: "attached" });
      // Beside the conversation the tab has no bar of its own: the bar stays on the composer.
      await workBarPlace(`the conversation beside the person's tab at ${size}`, "composer");
    }
    await noHorizontalScroll(`the person's tab at ${size}`);
    await editorShots(`41a-editor-person-${size}`);
    // The candidate with its examination as a section, the verdict on top.
    await showWaiting();
    await correctedCard.getByRole("button", { name: "Esame approfondito" }).click();
    await detailPane().getByTestId("focus-audit-verdict").waitFor();
    // Opened on the examination, the tab brings it into view; the first shot shows the top of the tab.
    await detailPane().evaluate((el) => el.scrollTo(0, 0));
    if (!(await detailPane().getByTestId("candidate-to-merge").isVisible())) throw new Error(`What is missing to merge the candidate is not on top at ${size}`);
    await workBarPlace(`the candidate's tab at ${size}`, width === 1280 ? "tab" : "composer");
    await editorShots(`41b-editor-candidate-${size}`);
    await detailPane().getByTestId("focus-audit").scrollIntoViewIfNeeded();
    await editorShots(`41c-editor-candidate-audit-${size}`);
    // Progetti: one row per project, with the same count as Aspetta te.
    await openView("Progetti");
    await page.getByRole("button", { name: "Panoramica dei progetti" }).click();
    // The open project's row counts what its Aspetta te counts.
    const row = page.locator('[data-testid="overview-project"][data-selected="true"]');
    await row.getByTestId("overview-coordinator").waitFor({ timeout: 10_000 });
    const badge = (await page.getByTestId("activity-badge").count()) ? Number(await page.getByTestId("activity-badge").innerText()) : 0;
    for (const end = Date.now() + 10_000; Number(await row.getAttribute("data-waiting")) !== badge && Date.now() < end; ) await page.waitForTimeout(250);
    if (Number(await row.getAttribute("data-waiting")) !== badge) throw new Error(`Progetti counts ${await row.getAttribute("data-waiting")} things for the person, Aspetta te ${badge}`);
    if (badge && Number(await row.getByTestId("overview-waiting-count").innerText()) !== badge) throw new Error("The project's row shows another count than Aspetta te");
    await closePanels();
    await workBarPlace(`Progetti at ${size}`, "none");
    await editorShots(`41d-editor-projects-${size}`);
    // Impostazioni: the app's sections apart from the project's, Collegamenti with one row per provider.
    await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
    const settingsTab = page.getByTestId("settings");
    await settingsTab.getByRole("group", { name: "App" }).getByRole("button", { name: /^Collegamenti/ }).click();
    await settingsTab.getByRole("group", { name: /^Progetto/ }).getByRole("button", { name: /^Presenza/ }).waitFor();
    await settingsTab.getByRole("button", { name: /^Capacità/ }).first().waitFor();
    await workBarPlace(`Impostazioni at ${size}`, "none");
    await editorShots(`41e-editor-settings-${size}`);
    await page.locator('[data-testid="editor-tab"][data-tab="settings"]').getByRole("button", { name: /^Chiudi / }).click();
    await page.locator('[data-testid="editor-tab"][data-tab="projects"]').getByRole("button", { name: /^Chiudi / }).click();
    await closePanels();
  }
  // The switch of the title bar lays the details over the conversation in a wide window too.
  await page.setViewportSize({ width: 1680, height: 1050 });
  await openView("Squadre");
  await page.getByTestId("side-bar").getByTestId("team-developer").first().click();
  await page.locator('[data-testid="editor-area"][data-split="true"]').waitFor();
  await page.getByTestId("split-editor-toggle").click();
  await page.locator('[data-testid="editor-area"][data-split="false"][data-covered="true"]').waitFor();
  await page.getByTestId("split-editor-toggle").click();
  await page.locator('[data-testid="editor-area"][data-split="true"]').waitFor();
  // Issue #345: the View menu's item does the same as the title bar's switch.
  await clickMenu("toggleSplitEditor");
  await page.locator('[data-testid="editor-area"][data-split="false"][data-covered="true"]').waitFor();
  await clickMenu("toggleSplitEditor");
  await page.locator('[data-testid="editor-area"][data-split="true"]').waitFor();
  await closePanels();
  await page.setViewportSize({ width: 1280, height: 820 });
  await editorArea.and(page.locator('[data-covered="false"]')).waitFor();
}

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
// The title names the slice as the other cards do (issue #392): "fetta S1" reads "fetta 1, <its title>".
const threadLink = questionWork.getByTestId("assignment-threads").getByRole("button", { name: /Domanda al Coordinatore, fetta 1, / });
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
const specialistThreads = page.getByTestId("specialist-threads").getByRole("button", { name: /Domanda al Coordinatore, fetta 1, / });
await specialistThreads.waitFor();
await expectNoRawIds(page.getByTestId("side-bar"), "The specialist's page");
await specialistThreads.scrollIntoViewIfNeeded();
await shot("19m-specialist-threads");
await specialistThreads.click();
await agentThread.waitFor();
await closePanels();
// W08: independent movement, after the work of #204 and W06 (two more assignment cards). The person sets the squads'
// limits in the settings (A10: developers per squad and squads at work together); a verified slice unblocks the ones that depended on it, and with continuous work on
// the free developer takes the next ready one in its modules by itself, without a Coordinator turn.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
const parallelSettings = page.getByTestId("settings");
await parallelSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
// A10 with #346: one group holds the four limits, each with one control: all projects, this project (three per
// squad formed, here one squad), developers per squad and squads together.
const parallelPicker = parallelSettings.getByTestId("squad-limit-developersPerSquad");
await parallelPicker.getByRole("radio", { name: "3", checked: true }).waitFor();
await parallelSettings.getByTestId("parallel-developers").getByRole("radio", { name: "3", checked: true }).waitFor();
await parallelSettings.getByTestId("shared-developers").getByRole("radio", { name: "6", checked: true }).waitFor();
for (const id of ["shared-developers", "parallel-developers", "squad-limit-developersPerSquad", "squad-limit-activeSquads"]) {
  if ((await parallelSettings.getByTestId(id).count()) !== 1) throw new Error(`The limit ${id} has not exactly one control`);
}
await parallelSettings.getByTestId("squad-limit-activeSquads").getByRole("radio", { name: "3", checked: true }).waitFor();
await parallelPicker.getByRole("radio", { name: "2" }).click();
await parallelPicker.getByRole("radio", { name: "2", checked: true }).waitFor();
await parallelSettings.getByTestId("squad-limit-activeSquads").scrollIntoViewIfNeeded();
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
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
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
// A13: the squad's backlog in the Squads view. S2 and S3 wait there in the Coordinator's order, each with its reason;
// the person moves S3 up and their place wins, with the sign of the person's place. Narrow and wide, light and dark.
// Given back to the Coordinator's order, S2 is on top again, so the free developer takes S2 below.
{
  await openView("Squadre");
  // The window was opened again since the Squads view was first checked: the side bar of this one.
  const squadsBar = page.getByTestId("side-bar");
  await squadsBar.getByTestId("squad-backlog").filter({ hasText: /in cima S2 / }).waitFor({ timeout: 20_000 });
  // Fixed by position: once open, the toggle no longer names the top item.
  const backlogIndex = (await squadsBar.getByTestId("squad-backlog").allInnerTexts()).findIndex((text) => /in cima S2 /.test(text));
  const backlog = squadsBar.getByTestId("squad-backlog").nth(backlogIndex);
  await backlog.getByTestId("squad-backlog-toggle").getByText("Backlog, 2 voci").waitFor();
  await backlog.getByTestId("squad-backlog-toggle").click();
  // Moving an item is an icon: it has its tooltip, as well as its name.
  {
    const moveDown = backlog.getByTestId("backlog-item").first().getByRole("button", { name: /^Sposta giù / });
    await moveDown.hover();
    await page.locator(".translucent-popup").getByText(/^Sposta giù /).waitFor();
    await page.mouse.move(0, 0);
  }
  const backlogKeys = () => backlog.getByTestId("backlog-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-key")?.split(":").at(-1)));
  if ((await backlogKeys()).join() !== "S2,S3") throw new Error(`The backlog is not in the Coordinator's order: ${await backlogKeys()}`);
  for (const item of await backlog.getByTestId("backlog-item").all()) {
    if (!(await item.getByTestId("backlog-reason").innerText()).trim()) throw new Error("A backlog item has no reason");
  }
  await backlog.getByRole("button", { name: /^Sposta su S3 / }).click();
  await backlog.locator('[data-testid="backlog-item"][data-placed="person"]').first().waitFor();
  if ((await backlogKeys()).join() !== "S3,S2") throw new Error(`The person's move did not win: ${await backlogKeys()}`);
  const placed = backlog.locator('[data-testid="backlog-item"]').first();
  await placed.getByTestId("backlog-reason").getByText(/^Posizione scelta da te/).waitFor();
  const moveDown = await placed.getByRole("button", { name: /^Sposta giù S3 / }).boundingBox();
  const release = await placed.getByTestId("backlog-release").boundingBox();
  const row = await placed.boundingBox();
  if (!moveDown || !release || !row || release.x > moveDown.x || row.x + row.width - (moveDown.x + moveDown.width) > 60) throw new Error("The backlog's buttons are not on the right of the row");
  const backlogSize = page.viewportSize();
  for (const [width, height] of [
    [1280, 800],
    [1680, 1050],
  ]) {
    await page.setViewportSize({ width, height });
    await backlog.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await noHorizontalScroll(`squad backlog ${width}x${height}`);
    await themeShots(`22c1-squad-backlog-${width}x${height}`);
  }
  await page.setViewportSize(backlogSize);
  // The same backlog in English: the title, the Coordinator's reasons and the person's place come from the catalog.
  await page.evaluate(() => window.trama.invoke("settings:update", { language: "en" }));
  await backlog.getByTestId("squad-backlog-toggle").getByText("Backlog, 2 items").waitFor();
  await placed.getByTestId("backlog-reason").getByText("Place chosen by you", { exact: true }).waitFor();
  await backlog.getByTestId("backlog-item").nth(1).getByTestId("backlog-reason").getByText("Ready, in the order of the breakdown").waitFor();
  await backlog.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await shot("22c1-squad-backlog-english");
  await page.evaluate(() => window.trama.invoke("settings:update", { language: "it" }));
  await backlog.getByTestId("squad-backlog-toggle").getByText("Backlog, 2 voci").waitFor();
  await placed.getByTestId("backlog-release").click();
  await backlog.locator('[data-testid="backlog-item"][data-placed="person"]').waitFor({ state: "detached" });
  if ((await backlogKeys()).join() !== "S2,S3") throw new Error(`The item did not go back to the Coordinator's order: ${await backlogKeys()}`);
  await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
}
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
// Issue #338: Ask Trama is the skill's name, not a button's; the button says what the person gets.
if (await page.getByRole("button", { name: "Ask Trama", exact: true }).count()) throw new Error("A button is still named after the Ask Trama skill");
await page.getByRole("button", { name: "Chiedi un percorso al Coordinatore", exact: true }).click();
await expectAsked("/ask-trama ", "Chiedi un percorso al Coordinatore");
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
// Design rules: the answer sits under the situation, above the steps it may run; Avvia il percorso starts work, so it has an icon.
const routeFirstStep = await routeCard.locator("ol li").first().boundingBox();
if (!routeFirstStep || !startRoute || startRoute.y > routeFirstStep.y) throw new Error("Ask Trama route: the answer is below the steps");
if (!(await routeCard.getByRole("button", { name: "Avvia il percorso" }).locator("svg").count())) throw new Error("Ask Trama route: Avvia il percorso has no icon");
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
// In a narrow window the side bar takes room from the chat: closed, the messages are what the shot shows.
await closePanels();
await page.setViewportSize({ width: 720, height: 640 });
await typeMessage.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const narrowProblems = await typographyOverflow();
if (narrowProblems.length) throw new Error(`Typography at 720x640: ${narrowProblems.join("; ")}`);
await shot("16d2-typography-narrow");
await page.setViewportSize({ width: 1280, height: 820 });
// G02: who works on what, in Squadre since Gruppo dissolved (issue #332). One row per person and per agent, with
// identity, active branch, "anche su", the request, the files and the freshness; the person's own switch is in
// Impostazioni, Presenza, on the right.
await openView("Squadre");
const presencePanel = page.getByTestId("group-board");
const rows = presencePanel.locator('[data-testid="group-row"]');
const adaRow = rows.filter({ hasText: "Ada (tu)" });
// Critique of 29 September: what a person works on comes first; the branches and the files are one line each, a single
// branch by its name and several by their number, with every name on hover.
const hoverOf = async (row, id) => (await row.getByTestId(id).getAttribute("title", { timeout: 10_000 })) ?? "";
if (!(await hoverOf(adaRow, "group-branches")).includes("feature/carrello")) throw new Error("Ada's branch is not on her row");
const beaRow = rows.filter({ hasText: "Bea" }).and(page.locator('[data-kind="person"]'));
await beaRow.getByTestId("group-branches").getByText("2 branch", { exact: true }).waitFor({ timeout: 10_000 });
const beaBranches = await hoverOf(beaRow, "group-branches");
if (!beaBranches.startsWith("feature/rimborsi (attivo)") || !beaBranches.includes("fix/iva-rimborsi")) throw new Error(`Bea's branches on hover: ${beaBranches}`);
await beaRow.getByTestId("group-task").getByText("Rimborsi parziali").waitFor();
await beaRow.getByTestId("group-files").getByText("1 file toccato", { exact: true }).waitFor();
if ((await hoverOf(beaRow, "group-files")) !== "src/payments.js") throw new Error("Bea's files are not on the hover of their line");
if (await presencePanel.locator(".font-mono").evaluateAll((nodes) => nodes.some((node) => node.getBoundingClientRect().height > 24))) throw new Error("A branch name wraps over more than one line in Chi lavora su cosa");
await beaRow.getByText("attivo ora").waitFor();
const liaRow = rows.and(page.locator('[data-kind="agent"]')).filter({ hasText: "Lia" });
await liaRow.getByTestId("agent-tag").getByText("[Interfaccia]").waitFor();
await liaRow.getByText("trama/lia-rimborsi").waitFor();
await liaRow.getByText("Schermata dei rimborsi").waitFor();
await liaRow.getByText(/^inattivo da 1[2-9] min$/).waitFor();
if (await page.getByTestId("side-bar").getByRole("switch", { name: "Condividi la presenza" }).count()) throw new Error("Squadre repeats the sharing switch of Impostazioni, Presenza");
await page.getByTestId("side-bar").getByTestId("group-presence-line").waitFor();
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
{
  const ownSwitch = page.getByTestId("settings").getByRole("switch", { name: "Condividi la presenza", checked: true });
  await page.getByTestId("settings").getByRole("button", { name: /^Presenza/ }).first().click();
  await ownSwitch.waitFor();
  const settingsBox = await page.getByTestId("settings").boundingBox();
  const switchBox = await ownSwitch.boundingBox();
  if (!settingsBox || !switchBox || switchBox.x < settingsBox.x + settingsBox.width / 2) throw new Error("Presenza: the sharing switch is not on the right");
}
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await openView("Squadre");
// W16: the agent of a colleague who is idle sleeps: same body and color, eyes closed, and Z's rising above it.
const liaBot = liaRow.getByTestId("agent-bot");
if ((await liaBot.getAttribute("data-move")) !== "sleep") throw new Error("An idle colleague's agent does not sleep");
// The Z's move only on a bot in view (data-live, set by an observer after the view opens) and without reduced motion.
// One reading right after the view opens can come before the animations start: the check reads the bot every 250 ms
// for up to 5 s and passes when one reading shows the three Z's rising.
await page.emulateMedia({ reducedMotion: "no-preference" });
await liaRow.locator('[data-testid="agent-bot"][data-live]').waitFor({ timeout: 5_000 }).catch(() => {});
const sleepingNow = () =>
  liaBot.evaluate((bot) => ({
    shape: bot.dataset.shape,
    zzz: getComputedStyle(bot.querySelector('[data-part="zzz"]')).display,
    risingZ: bot.querySelectorAll(".bot-z").length,
    moving: bot.getAnimations({ subtree: true }).filter((a) => a.effect?.target?.classList?.contains("bot-z")).length,
  }));
const risesNow = (reading) => Boolean(reading.shape) && reading.zzz !== "none" && reading.risingZ === 3 && reading.moving === 3;
let sleeping = await sleepingNow();
for (const end = Date.now() + 5_000; !risesNow(sleeping) && Date.now() < end; sleeping = await sleepingNow()) await page.waitForTimeout(250);
if (!risesNow(sleeping)) throw new Error(`The sleeping bot has no rising Z's: ${JSON.stringify(sleeping)}`);
await shot("16a-presence-group");
const groupLook = await page.evaluate(() => ({ provider: document.documentElement.dataset.provider ?? null, dark: document.documentElement.classList.contains("dark") }));
for (const provider of ["codex", "claudeAgent"]) {
  for (const dark of [false, true]) {
    await setLookTo(provider, dark);
    await shot(`16b-presence-group-${provider}-${dark ? "dark" : "light"}`);
  }
}
await setLookTo(groupLook.provider, groupLook.dark);
// Critique of 29 September 2026: at the side bar's narrowest, every branch name stays on one line.
await presencePanel.scrollIntoViewIfNeeded();
await sideBarEnds("52e-squads-who-works", async (end) => {
  const wrapped = await presencePanel.locator('[data-testid="group-branches"], [data-testid="group-files"], [data-testid="group-task"]').evaluateAll((lines) => lines.filter((line) => line.getBoundingClientRect().height > 20).length);
  if (wrapped) throw new Error(`${wrapped} lines of Chi lavora su cosa wrap with the side bar ${end}`);
});
// A wide inspector puts the details beside each name; a narrow window floats it over the chat without a horizontal scroll.
await page.getByTestId("side-bar").getByRole("button", { name: "Allarga la barra laterale" }).click();
await page.waitForTimeout(400);
await shot("16d-presence-group-wide");
await page.getByTestId("side-bar").getByRole("button", { name: "Larghezza normale" }).click();
await page.setViewportSize({ width: 720, height: 640 });
await page.waitForTimeout(400);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal page scroll in Squadre at 720x640");
if (await page.getByTestId("side-bar").evaluate((node) => node.scrollWidth > node.clientWidth + 1)) throw new Error("Who works on what overflows the side bar at 720x640");
await shot("16e-presence-group-narrow");
await page.setViewportSize({ width: 1280, height: 820 });
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
await page.getByTestId("settings").getByRole("button", { name: /^Presenza/ }).first().click();
await page.getByTestId("settings").getByRole("switch", { name: "Condividi la presenza", checked: true }).waitFor();
await settingsRules("Presenza");
// The pause is an icon and its name, at the 32 px of a button; the title of the page is the name in the navigation.
if (!(await page.getByTestId("settings").getByRole("button", { name: "Sospendi la presenza" }).locator("svg").count())) throw new Error("Sospendi la presenza has no icon");
await page.getByTestId("settings").getByRole("heading", { name: "Presenza", exact: true }).waitFor();
// Issue #338: the pause of the presence says what it pauses, "Sospendi la presenza", and its way back "Riprendi la presenza".
if (await page.getByTestId("settings").getByRole("button", { name: "Metti in pausa", exact: true }).count()) throw new Error("Presence still offers Metti in pausa");
await page.getByTestId("settings").getByRole("button", { name: "Sospendi la presenza" }).click();
await page.getByTestId("settings").getByRole("button", { name: "Riprendi la presenza" }).waitFor();
await shot("16c-presence-settings");
await page.getByTestId("settings").getByRole("button", { name: "Riprendi la presenza" }).click();
// Issue #272: the Monitor never says "no repository" above the repository it then offers.
await page.getByTestId("settings").getByRole("button", { name: /^Monitor/ }).first().click();
await page.getByTestId("settings").getByText("Repository osservati").waitFor();
{
  const text = await page.getByTestId("settings").innerText();
  if (/Nessun repository/.test(text) && /Repository del progetto aperto/.test(text)) throw new Error("The Monitor says no repository above the project's one");
}
await shot("16f-monitor-settings");
await settingsRules("Monitor");
// The page is named like its navigation entry and opens on one line: is the monitor on, and how many repositories.
await page.getByTestId("settings").getByRole("heading", { name: "Monitor", exact: true }).waitFor();
const monitorSummary = (await page.getByTestId("settings").getByTestId("monitor-summary").textContent()).trim();
if (!/^Monitor (attivo: \d+ repository osservat[io]|spento)$/.test(monitorSummary)) throw new Error(`The monitor summary reads "${monitorSummary}"`);

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
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
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
// Issue #330: the work in focus carries the overlap's badge and opens the panel with the warning; since the UI wave of
// 29 September it is in the bar above the composer.
await page.locator('[data-testid="work-bar-focus"][data-overlap="conflict"]').waitFor({ timeout: 10_000 });
await openFocusPanel();
await focusOverlap.waitFor({ timeout: 10_000 });
// Issue #338: the details of the overlaps are a chevron with their number.
if (!/^\d+$/.test((await focusOverlap.getByRole("button", { name: /^Dettagli/ }).innerText()).trim())) throw new Error("The overlaps' details are not an icon with their number");
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
await openModules();
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
// The module is an editor tab over the conversation since issue #336: the conversation comes forward.
await showConversation();
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

// B02, issue #354: with no project open the Benvenuto's Recenti lists the last five projects with their path, last work,
// state and colleagues, and "Tutti i progetti" opens the Progetti view. Switching projects never replays the intro.
if (await page.getByTestId("launch-intro").count()) throw new Error("The launch intro played on a project switch");
await page.evaluate(() => window.trama.invoke("project:close", undefined));
const recentPicker = page.getByTestId("welcome").getByTestId("welcome-recent");
await recentPicker.waitFor();
// Design rules, order by importance: who comes back finds Recenti above Inizia, in the same column, wide and narrow.
{
  const above = () =>
    page.evaluate(() => {
      const top = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? null;
      return { recent: top("welcome-recent"), start: top("welcome-start") };
    });
  for (const [size, width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const order = await above();
    if (order.recent === null || order.start === null || order.recent >= order.start) throw new Error(`With recents, Recenti is not above Inizia ${size}: ${JSON.stringify(order)}`);
  }
  await page.setViewportSize({ width: 1280, height: 820 });
}
await recentPicker.getByTestId("recent-project").filter({ hasText: /collega attivo|colleghi attivi/ }).first().waitFor({ timeout: 20_000 });
if (await page.getByTestId("launch-intro").count()) throw new Error("The launch intro played again without a first launch");
if ((await recentPicker.getByTestId("recent-project").count()) > 5) throw new Error("Recenti lists more than five projects");
// Tutti i progetti is navigation: an icon with its tooltip and name, at least 32 px. Forgetting a project too, and a
// long path is cut, whole in the tooltip.
const allProjects = recentPicker.getByRole("button", { name: "Tutti i progetti" });
if ((await allProjects.innerText()).trim() !== "") throw new Error("Tutti i progetti has a text beside its icon");
const recentSizes = await recentPicker.locator("[data-icon-button]").evaluateAll((nodes) => nodes.map((node) => Math.min(node.getBoundingClientRect().width, node.getBoundingClientRect().height)));
if (recentSizes.length < 2 || recentSizes.some((size) => size < 32)) throw new Error(`An icon button of Recenti is under 32 px: ${recentSizes}`);
const recentPath = recentPicker.getByTestId("recent-project").first().locator(".truncate.font-mono");
if ((await recentPath.evaluate((node) => getComputedStyle(node).textOverflow)) !== "ellipsis") throw new Error("A recent path is not truncated");
await recentPath.hover();
await page.locator(".translucent-popup").filter({ hasText: (await recentPath.innerText()).trim() }).waitFor();
await page.mouse.move(0, 0);
await allProjects.click();
await page.locator('[data-testid="side-bar"][data-view="projects"]').waitFor();
await activityBar().getByRole("button", { name: "Progetti", exact: true }).click();
await page.getByTestId("side-bar").waitFor({ state: "detached" });
for (const [size, width, height] of sizes) {
  await page.setViewportSize({ width, height });
  if ((await page.getByTestId("welcome").locator('button[data-variant="default"]').count()) > 1) throw new Error(`The Benvenuto with recents has more than one primary action ${size}`);
  for (const [label, theme] of themes) {
    await setTheme(theme);
    await noHorizontalScroll(`picker with recents ${size} ${label}`);
    await shot(`01e-picker-recents-${size}-${label}`);
  }
}
await setTheme("system");
await page.setViewportSize({ width: 1280, height: 820 });
await app.close();

// Issue #354, decisions 4 and 7: with a project open and no provider connected, the Benvenuto opens by itself beside
// the conversation, on the provider step. Closed, the project can be explored: the composer offers "Collega un
// provider" instead of sending, and the status bar keeps the warning with its action. Only node on the PATH and an
// empty HOME, so no provider of the machine counts, and the fake Codex has no account.
{
  const nodeOnly = await mkdtemp(join(tmpdir(), "trama-ui-node-"));
  await symlink(process.execPath, join(nodeOnly, "node"));
  ({ app, page } = await launch({
    PATH: `${nodeOnly}:/usr/bin:/bin`,
    HOME: await mkdtemp(join(tmpdir(), "trama-ui-home-")),
    // Pi counts cloud keys in the environment as a login: none here.
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    FAKE_CODEX_ACCOUNT: "none",
  }));
  await page.getByTestId("welcome").waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.trama.invoke("project:openDemo", undefined));
  const beside = page.getByTestId("welcome");
  await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).waitFor({ timeout: 30_000 });
  await beside.locator('[data-step="provider"]:is([data-status="pending"], [data-status="skipped"])').waitFor();
  if ((await beside.locator('[data-step="provider"]').getByRole("button", { name: "Collega", exact: true }).getAttribute("aria-expanded")) !== "true") {
    throw new Error("The Benvenuto did not open on the provider step");
  }
  await beside.locator('[data-provider-row="codex"]').waitFor();
  // With a project open Apri un progetto is an outline: the window's filled button belongs to the work.
  const openBeside = await beside.getByTestId("welcome-start-open").getByRole("button", { name: "Apri un progetto" }).getAttribute("data-variant");
  if (openBeside === "default") throw new Error("Apri un progetto is a main action while a project is open");
  if ((await beside.locator('button[data-variant="default"]:not([data-filled="false"])').count()) > 1) throw new Error("The Benvenuto beside the conversation has more than one filled button");
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await shot(`00g-welcome-no-provider-${provider}-${dark ? "dark" : "light"}`);
    }
  }
  await setLookTo(null, false);
  await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).click();
  await beside.waitFor({ state: "detached" });
  const connect = page.getByTestId("composer-connect-provider");
  await connect.waitFor();
  // Design rules, chat: the composer's Collega is a primary drawn as an outline, the window has no filled button here.
  if ((await connect.getAttribute("data-filled")) !== "false") throw new Error("The composer's Collega a provider is a filled button");
  if (await page.getByRole("button", { name: "Invia al Coordinatore" }).count()) throw new Error("The composer sends without a provider");
  const warning = page.getByTestId("status-setup");
  await warning.waitFor();
  if ((await warning.getAttribute("data-step")) !== "provider") throw new Error("The status bar does not warn about the provider");
  await statusBarRules("with the provider warning");
  await shot("00g-composer-no-provider");
  // The Benvenuto does not reopen by itself on the same project; the warning and the composer reopen it on the step.
  await page.waitForTimeout(500);
  if (await page.getByTestId("welcome").count()) throw new Error("The Benvenuto reopened by itself");
  await warning.click();
  await page.getByTestId("welcome").locator('[data-provider-row="codex"]').waitFor();
  await page.getByRole("button", { name: "Chiudi Benvenuto", exact: true }).click();
  await connect.click();
  await page.getByTestId("welcome").locator('[data-provider-row="codex"]').waitFor();
  await page.evaluate(() => window.trama.invoke("project:close", undefined));
  await app.close();
}

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
await closePanels();
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
// Design of 30 September: Avvia starts work, so it is an icon with its text, at least 32 px tall, and not filled.
if (startBox.height < 32) throw new Error(`Avvia is under 32 px: ${startBox.height}`);
if ((await startReview.innerText()).trim() !== "Avvia" || !(await startReview.locator("svg").count())) throw new Error("Avvia is not an icon with its text");
if ((await startReview.evaluate((el) => getComputedStyle(el).backgroundColor)) !== "rgba(0, 0, 0, 0)") throw new Error("Avvia is filled: the window has only the one of Aspetta te");
if ((await reviewWork.evaluate((el) => getComputedStyle(el).paddingTop)) !== "8px") throw new Error("A row of the automatic work is not on the 8 px grid");
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
const reviewLine = page.getByRole("main").getByTestId("settled-card").filter({ hasText: "Ordine del codice" }).filter({ hasText: "Concluso" }).last();
await onRequest.or(reviewLine).first().waitFor({ timeout: 30_000 });
if (!(await onRequest.isVisible())) {
  await reviewLine.getByRole("button", { name: /^Apri: / }).click();
  await onRequest.waitFor();
}
// The Pact card waits in Aspetta te: the chat shows its reference (issue #240).
await page.locator('[data-testid="waiting-reference"][data-waiting-kind="question"]').first().waitFor({ timeout: 60_000 });
await reviewWork.getByText(/aspetta ancora la tua risposta/).waitFor({ timeout: 20_000 });
await openSharedRoles();
await dutyPanel.getByTestId("team-figure").filter({ hasText: "Ordine del codice" }).first().click();
// Issue #336: the role opens in its editor tab.
const roleWork = detailPane().locator('[data-testid="automatic-work"][data-work="architectureReview"]');
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
  await detailPane().getByText("Revisione dell'architettura: hai scelto «Unire i pagamenti»").first().waitFor({ timeout: 20_000 });
  if (/proposte da decidere/.test(await page.locator("body").innerText())) throw new Error("The review still asks to decide after the answer");
  const answeredWork = detailPane().getByText("Revisione dell'architettura: hai scelto «Unire i pagamenti»").first();
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
await statusBarRules("with a conflict");
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
const supersededConflict = settledLines.filter({ hasText: "Due incarichi del team" }).filter({ hasText: "Sostituito" });
if ((await supersededConflict.count()) !== 1) throw new Error("Divergence: the conflict with the replaced candidate is not superseded");
const replacedLine = settledLines.filter({ hasText: /^Candidato / }).filter({ hasText: "Sostituito" });
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
// Issue #332: the files in conflict are one click away from the status bar: the notice opens with them shown.
await divergenceNotice.getByTestId("branch-divergence-files").getByText("vercel.json").waitFor();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`25b-branch-divergence-files-${dark ? "dark" : "light"}`);
}
await divergenceNotice.getByRole("button", { name: /^Mostra i 18 file/ }).click();
await divergenceNotice.getByTestId("branch-divergence-files").waitFor({ state: "detached" });
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`25a-branch-divergence-${dark ? "dark" : "light"}`);
}
await divergenceNotice.getByRole("button", { name: "Chiedi al Coordinatore come riallineare" }).click();
await expectAsked("Come li riallineiamo?", "Divergence notice, Chiedi al Coordinatore come riallineare");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #421: on the shop project Marco's newest candidate was stopped by two older versions of the same work, verified
// and never merged, taken as other work on the same files. The person asks the Coordinator to close them; it supersedes
// each one by itself: the chat shows one "Superato" line with the reason that opens the card, Activity keeps the use,
// and the old candidate's item leaves Aspetta te. The newest is no longer stopped. Both themes.
const shopProject = await mkdtemp(join(tmpdir(), "trama-ui-superati-"));
await cp(resolve("resources/DemoProject"), shopProject, { recursive: true });
const shopGit = (...args) => execFileSync("git", ["-C", shopProject, ...args], { encoding: "utf8" });
shopGit("init", "-q", "-b", "main");
shopGit("add", ".");
shopGit("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
const shopHead = shopGit("rev-parse", "HEAD").trim();
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), shopProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
let shopPath = null;
for (const file of await readdir(join(dataDir, "Projects"))) {
  if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-superati-")) shopPath = join(dataDir, "Projects", file);
}
if (!shopPath) throw new Error("Superseded: the project's state was not saved");
const [oldestId, olderId, newestId] = ["C-5E0A0003", "C-5E0A0008", "C-5E0A0013"];
{
  const document = JSON.parse(await readFile(shopPath, "utf8"));
  const at = (hour) => `2026-09-29T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const work = (id, hour) => ({
    id,
    specialistId: "S-MARCO",
    requestId: null,
    kind: "agreedTicket",
    objective: "Catalogo con i soli prodotti disponibili",
    issueNumber: null,
    exercise: null,
    moduleIds: ["src/app"],
    dependencies: [],
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    requiredChecks: ["git_status"],
    instructions: "",
    mandateVersion: 1,
    createdAt: at(hour),
    status: "completed",
    workspace: { sourceRoot: shopProject, worktreeRoot: join(shopProject, "..", `wt-${id}`), branch: `feature/${id.toLowerCase()}`, baseSHA: shopHead },
    threadId: null,
    turns: [],
    stops: [],
    result: "Fatto.",
    failure: null,
    updatedAt: at(hour),
    lastUpdate: "",
    reportedStatus: "completed",
  });
  const versions = [work("A-5E0A0003", 9), work("A-5E0A0008", 10), work("A-5E0A0013", 11)];
  document.team.specialists.push({
    id: "S-MARCO",
    name: "Marco",
    competence: "Next.js",
    reason: "",
    moduleIds: ["src/app"],
    role: "developer",
    origin: "teamProposal",
    color: "green",
    tag: "Catalogo",
    createdAt: at(8),
    status: "available",
    model: "gpt-6-luna",
    tools: ["commands", "edits"],
    updatedAt: at(11),
    lastUpdate: "",
    removal: null,
    assignments: versions,
  });
  const candidate = (id, assignment, snapshotId, hour) => ({
    id,
    assignmentId: assignment.id,
    specialistId: "S-MARCO",
    snapshotId,
    baseSHA: shopHead,
    diff: "",
    changedFiles: ["src/app/prodotti/page.tsx"],
    touchedModules: ["src/app"],
    requiredDecisionIds: [],
    decisionVersions: {},
    requiredChecks: ["git_status"],
    unresolvedChoices: [],
    externalEffects: [],
    declaredAt: at(hour),
    updatedAt: at(hour),
    evidence: { git_status: { check: "git_status", result: "pass", command: "git status", output: "", snapshotId, decisionVersions: {}, recordedAt: at(hour) } },
    technicalReview: { id: `R-${id.slice(2)}`, reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Bene", at: at(hour) },
    clearance: null,
    humanApproval: null,
    pullRequest: null,
  });
  const [oldest, older, newest] = [candidate(oldestId, versions[0], "snap-3", 9), candidate(olderId, versions[1], "snap-8", 10), candidate(newestId, versions[2], "snap-13", 11)];
  document.candidates.push(oldest, older, newest);
  const collision = (other) => ({
    id: `snap-13:worktree:${other.snapshotId}`,
    candidateId: newest.id,
    snapshotId: newest.snapshotId,
    classification: "conflict",
    detail: "La fusione temporanea produce conflitti testuali.",
    checkedAt: at(12),
    remoteSHA: "",
    references: [`${other.id} di Marco (feature/${other.assignmentId.toLowerCase()})`],
    otherCandidateId: other.id,
    otherSnapshotId: other.snapshotId,
    conflictingFiles: ["src/app/prodotti/page.tsx"],
  });
  document.conflicts = [collision(oldest), collision(older)];
  let sequence = Math.max(0, ...document.events.map((e) => e.sequence));
  const card = (kind, referenceId) => ({ id: `E-sup-${++sequence}`, sequence, origin: "trama", requestId: null, createdAt: at(12), content: { type: "card", kind, title: kind, detail: null, referenceId } });
  document.events.push(...[oldest, older, newest].map((c) => card("candidate", c.id)), ...document.conflicts.map((a) => card("conflict", a.id)));
  await writeFile(shopPath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), shopProject);
const shopState = () => page.evaluate(async () => (await window.trama.getState()).project);
const waitingKeys = async () => (await shopState()).waiting.map((item) => item.key);
await page.getByTestId("waiting-summary").waitFor({ timeout: 30_000 });
{
  const before = await shopState();
  if (before.candidateReports[newestId].state !== "building") throw new Error("Superseded: the newest candidate is not stopped by the older versions");
  if (before.candidateReports[newestId].blockers.filter((b) => b.code === "WORKTREE_CONFLICT").length !== 2) throw new Error("Superseded: the newest candidate does not collide with both older versions");
  const keys = before.waiting.map((item) => item.key);
  if (!keys.includes(`candidate:${oldestId}`) || !keys.includes(`candidate:${olderId}`)) throw new Error(`Superseded: the older versions do not wait in Aspetta te: ${keys}`);
}
await send(`Chiudi le versioni vecchie. [superato:${oldestId}:${newestId}]`);
await page.getByText(/^Ho chiuso il candidato /).last().waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
await send(`[superato:${olderId}:${newestId}]`);
for (let tries = 0; (await waitingKeys()).includes(`candidate:${olderId}`); tries++) {
  if (tries > 60) throw new Error("Superseded: the second older version still waits in Aspetta te");
  await page.waitForTimeout(500);
}
await page.getByRole("button", { name: "Interrompi" }).waitFor({ state: "hidden", timeout: 20_000 });
{
  const after = await shopState();
  for (const id of [oldestId, olderId]) {
    if (after.candidateReports[id].state !== "superseded") throw new Error(`Superseded: ${id} is not superseded`);
    if (after.waiting.some((item) => item.targetId === id)) throw new Error(`Superseded: ${id} still waits in Aspetta te`);
  }
  if (after.candidateReports[newestId].state !== "verified") throw new Error(`Superseded: the newest candidate is still stopped: ${after.candidateReports[newestId].blockers.map((b) => b.code)}`);
  if (after.document.candidates.length < 3) throw new Error("Superseded: a superseded candidate left the history");
}
// The chat: each use is one "Superato" line with the reason, and the line opens the candidate's card.
const declaredLine = page.getByTestId("settled-card").filter({ has: page.getByRole("button", { name: `Apri: Candidato ${oldestId}` }) }).filter({ hasText: "Superato" });
await declaredLine.last().waitFor({ timeout: 20_000 });
if (!(await declaredLine.last().innerText()).includes("È una versione vecchia dello stesso lavoro")) throw new Error("Superseded: the line does not say why");
await declaredLine.last().scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`18f1-candidate-superseded-line-${dark ? "dark" : "light"}`);
}
await declaredLine.last().getByRole("button", { name: `Apri: Candidato ${oldestId}` }).click();
const supersededNoteCard = page.locator('[data-testid="candidate-superseded"][data-declared="coordinator"]').last();
await supersededNoteCard.waitFor({ timeout: 10_000 });
if (!(await supersededNoteCard.innerText()).includes("Superato dal candidato")) throw new Error("Superseded: the card does not name the newer candidate");
const supersededOpenCard = page.locator(".chat-card", { has: supersededNoteCard });
if (await supersededOpenCard.getByRole("button", { name: "Approva questo candidato" }).count()) throw new Error("Superseded: the superseded candidate can still be approved");
await supersededNoteCard.evaluate((note) => note.scrollIntoView({ block: "center" }));
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`18f2-candidate-superseded-card-${dark ? "dark" : "light"}`);
}
await page.getByRole("button", { name: `Chiudi: Candidato ${oldestId}` }).first().click();
// Activity keeps each use, with the reason and the item that left Aspetta te.
await page.getByTestId("status-bar").getByRole("button", { name: "Attività", exact: true }).click();
const supersedeRows = page.getByTestId("bottom-panel").getByTestId("activity-supersede");
await supersedeRows.first().waitFor({ timeout: 10_000 });
if ((await supersedeRows.count()) !== 2) throw new Error(`Superseded: ${await supersedeRows.count()} rows in Activity instead of 2`);
const supersedeRow = supersedeRows.filter({ hasText: "Candidato superato dal Coordinatore" }).last();
await supersedeRow.getByTestId("activity-row-toggle").click();
const supersedeDetail = await supersedeRow.getByTestId("activity-row-detail").innerText();
if (!supersedeDetail.includes("Tolto da Aspetta te: Candidato da guardare")) throw new Error(`Superseded: Activity does not say which item left Aspetta te: ${supersedeDetail}`);
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`18f3-candidate-superseded-activity-${dark ? "dark" : "light"}`);
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #332: Lavoro is one view in the side bar. At the top the goal filter and how many of the goal's examples were
// tried; then goals with one state each, the slices of the sprint with who works on them (their animated avatars), the
// candidates and plans, the project's branch with its conflict against main and the files one click away, the pull
// requests with their CI and Apri su GitHub as an icon, and the issues with what Trama does with each. A copy of the
// example project with a GitHub remote read by the fake GitHub CLI, and the records of scripts/work-view-fixture.mjs.
const workProject = await mkdtemp(join(tmpdir(), "trama-ui-lavoro-"));
await cp(resolve("resources/DemoProject"), workProject, { recursive: true });
const workGit = (...args) => execFileSync("git", ["-C", workProject, ...args], { encoding: "utf8" });
workGit("init", "-q", "-b", "main");
workGit("add", ".");
workGit("-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio");
workGit("checkout", "-q", "-b", "chore/pre-apertura");
workGit("remote", "add", "origin", "https://github.com/trama-ui/negozio.git");
const workHead = workGit("rev-parse", "HEAD").trim();
const workEnv = { PATH: `${ghBin}:${process.env.PATH}`, FAKE_GH_TEAM: "1", FAKE_GH_WORK: "1" };
({ app, page } = await launch(workEnv));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), workProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
{
  let workPath = null;
  for (const file of await readdir(join(dataDir, "Projects"))) {
    if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-lavoro-")) workPath = join(dataDir, "Projects", file);
  }
  if (!workPath) throw new Error("Lavoro: the project's state was not saved");
  const document = addWorkView(JSON.parse(await readFile(workPath, "utf8")), workProject, workHead);
  const conflictFiles = Array.from({ length: 18 }, (_, index) => `app/checkout/${["carrello", "spedizioni", "pagamenti"][index % 3]}-${index + 1}.ts`);
  document.branchDivergence = { branch: "chore/pre-apertura", defaultBranch: "main", headSHA: workHead, remoteSHA: "4df3c14a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e", ahead: 13, behind: 7, conflictingFiles: conflictFiles, checkedAt: "2026-09-28T12:00:00.000Z" };
  await writeFile(workPath, JSON.stringify(document));
}
({ app, page } = await launch(workEnv));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), workProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.setViewportSize({ width: 1280, height: 800 });
await openView("Lavoro");
const workView = page.getByTestId("side-bar").getByTestId("work-overview");
await workView.waitFor();
if ((await page.getByTestId("side-bar").getByRole("tab").count()) !== 0) throw new Error("Lavoro still splits its sections into tabs");
// Summary: the goal of the work, with its examples tried on a candidate.
await workView.getByTestId("work-goal-progress").filter({ hasText: "2 di 4 esempi di «Spedizioni e pagamenti» provati" }).waitFor({ timeout: 20_000 });
await workView.getByTestId("work-summary").getByTestId("chat-filter").waitFor();
// Goals: one state each, never "Aperto" and "Archiviato" together; archived goals are folded at the end.
for (const row of await workView.getByTestId("work-goal").all()) {
  if ((await row.getByTestId("goal-state").count()) !== 1) throw new Error(`Lavoro: a goal has more than one state: ${await row.innerText()}`);
}
await workView.getByTestId("work-goal").filter({ hasText: "Spedizioni e pagamenti" }).getByText("Attivo", { exact: true }).waitFor();
await workView.getByTestId("work-goals-archived").getByRole("button", { name: "Archiviati (1)" }).waitFor();
await workView.getByTestId("work-section-goals").getByRole("button", { name: "Nuovo obiettivo" }).waitFor();
// UI wave of 29 September: the status at the top says how far the sprint is and the next move; what holds the work is
// one click away (Aspetta te, the conflict with main).
await workView.getByTestId("work-slice-progress").getByText("1 di 4 fette fatte").waitFor();
await workView.getByTestId("work-next").waitFor();
await workView.getByTestId("work-held").getByRole("button", { name: "18 file in conflitto" }).waitFor();
// Slices, grouped by where they stand: in progress with their state, then the waiting ones with what they wait for,
// and the done ones folded at the end. A developer is its animated avatar, never a letter in a circle.
const workSlices = workView.getByTestId("work-slice");
if ((await workSlices.count()) !== 3) throw new Error(`Lavoro: ${await workSlices.count()} slices open instead of 3, the done one folded`);
const elenaSlice = workView.getByTestId("work-slices-active").getByTestId("work-slice").filter({ hasText: "S2 Spese di spedizione per zona" });
await elenaSlice.getByTestId("agent-bot").waitFor();
await elenaSlice.getByText("In verifica", { exact: true }).waitFor();
await workView.getByTestId("work-slices-waiting").getByTestId("work-slice").filter({ hasText: "S4 Pagina di stato dell'ordine" }).getByText("aspetta S2").waitFor();
const doneSlices = workView.getByTestId("work-slices-done");
if ((await doneSlices.getAttribute("data-open")) !== "false") throw new Error("Lavoro: the done slices are open before the click");
await doneSlices.getByRole("button", { name: "Fatte (1)" }).click();
await doneSlices.locator('[data-testid="work-slice"][data-state="done"]').filter({ hasText: "S1 Soglie di spedizione gratuita" }).waitFor();
if ((await workSlices.count()) !== 4) throw new Error(`Lavoro: ${await workSlices.count()} slices instead of 4`);
await doneSlices.getByRole("button", { name: "Fatte (1)" }).click();
// Candidates: the replaced ones fold at the end with their count, since they only tell the history.
const replaced = workView.getByTestId("work-candidates-superseded");
await replaced.getByRole("button", { name: "Sostituiti (2)" }).waitFor();
if (await replaced.getByTestId("work-candidate").count()) throw new Error("Lavoro: the replaced candidates are open before the click");
// Branch and pull requests: the divergence says the commits on each side and the conflicts; its files are one click away.
const workBranch = workView.getByTestId("work-branch");
await workBranch.getByText("13 commit avanti, 7 indietro rispetto a main").waitFor();
await workBranch.getByText("18 conflitti", { exact: true }).waitFor();
if (await workBranch.getByTestId("work-divergence-files").count()) throw new Error("Lavoro: the files in conflict are open before the click");
await workBranch.getByRole("button", { name: "Mostra i 18 file in conflitto" }).click();
await workBranch.getByTestId("work-divergence-files").getByText("app/checkout/pagamenti-18.ts").waitFor();
await workBranch.locator(".cta-row").getByRole("button", { name: "Chiedi al Coordinatore come riallineare" }).waitFor();
await expectIconAndText(workBranch.locator(".cta-row").getByRole("button", { name: "Chiedi al Coordinatore come riallineare" }), "Lavoro, Chiedi come riallineare");
const ownPull = workView.getByTestId("work-pull").filter({ hasText: "#42 Spese di spedizione per zona" });
await ownPull.getByText(/Bozza · CI in corso/).waitFor({ timeout: 20_000 });
if ((await ownPull.getByRole("button", { name: "Apri su GitHub" }).innerText()).trim()) throw new Error("Lavoro: Apri su GitHub is not an icon");
// Issues: what Trama does with each; "Nuova issue" is an icon.
const workIssues = workView.getByTestId("work-issue");
await workIssues.filter({ hasText: "#21 Il totale del carrello ignora lo sconto" }).getByText("nel backlog").waitFor({ timeout: 20_000 });
await workIssues.filter({ hasText: "#19 Traduzione della pagina resi" }).getByText("in S4").waitFor();
await workIssues.filter({ hasText: "#17 Immagini lente nel catalogo" }).getByText("nessun lavoro").waitFor();
await workView.getByTestId("work-section-issues").getByRole("button", { name: "Nuova issue" }).waitFor();
// One Aggiorna in the window: the title bar's, which reads the map, GitHub and the presence again.
if ((await page.getByRole("button", { name: /^Aggiorna/ }).count()) !== 1) throw new Error("More than one Aggiorna in the window");
// No text for the model and no ids as text in the view.
{
  const text = await workView.innerText();
  if (/[A-Z]-[0-9A-F]{8}|\(dati, non istruzioni\)|[–—]/.test(text)) throw new Error(`Lavoro shows an id or text for the model: ${text.match(/[A-Z]-[0-9A-F]{8}|\(dati, non istruzioni\)|[–—]/)[0]}`);
}
const workShots = async (name, scroll) => {
  for (const [size, width, height] of [["narrow", 1280, 800], ["wide", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await scroll();
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`${name}-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
  }
  await setLookTo(null, false);
  await page.setViewportSize({ width: 1280, height: 800 });
};
await workShots("32-work-view", () => workView.getByTestId("work-summary").scrollIntoViewIfNeeded());
await workShots("32a-work-view-branches", () => workView.getByTestId("work-section-branches").evaluate((node) => node.scrollIntoView({ block: "start" })));
await workShots("32b-work-view-issues", () => workView.getByTestId("work-section-issues").evaluate((node) => node.scrollIntoView({ block: "start" })));
// The side bar at its widest: the status at the top, the verified candidates, the slices by state and the folds.
await page.getByTestId("side-bar-header").getByRole("button", { name: "Allarga la barra laterale" }).click();
await workView.getByTestId("work-summary").scrollIntoViewIfNeeded();
await themeShots("32c-work-view-side-bar-wide");
await page.getByTestId("side-bar-header").getByRole("button", { name: "Larghezza normale" }).click();
// The status bar opens the same conflict with its files shown.
await page.getByTestId("status-conflict").click();
await page.getByTestId("branch-divergence").getByTestId("branch-divergence-files").getByText("app/checkout/pagamenti-18.ts").waitFor();
await page.keyboard.press("Escape");
await app.close();

// Continuous work off (found live on the negozio, 29 September): the setting was off in Impostazioni, so the
// Coordinator never started anything by itself, while the status bar said "Il prossimo passo è mio: verifico il
// lavoro." as if it were about to. With the mandate granted, the team confirmed and a ready slice, the Coordinator's own
// next move is "assegno S5": the status bar says it waits for a message and offers to turn continuous work back on,
// and Lavoro says the same at its top. The button turns it on and the line goes back to the Coordinator's move.
{
  let workPath = null;
  for (const file of await readdir(join(dataDir, "Projects"))) {
    if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-lavoro-")) workPath = join(dataDir, "Projects", file);
  }
  if (!workPath) throw new Error("Continuous work off: the project's state was not saved");
  await writeFile(workPath, JSON.stringify(addCoordinatorMove(JSON.parse(await readFile(workPath, "utf8")))));
}
({ app, page } = await launch(workEnv));
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), workProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await page.setViewportSize({ width: 1280, height: 800 });
{
  const offLine = page.locator('[data-testid="status-line"][data-state="waiting"]');
  await offLine.getByTestId("status-line-text").getByText("Lavoro continuo spento: il Coordinatore aspetta un tuo messaggio.").waitFor({ timeout: 20_000 });
  await offLine.getByTestId("status-line-reason").getByText("Acceso, il prossimo passo sarebbe mio: assegno S5.").waitFor();
  if (await page.getByTestId("status-line-text").getByText(/prossimo passo è mio/).count()) throw new Error("With continuous work off the status bar still says the next step is the Coordinator's");
  const turnOn = offLine.getByTestId("status-continuous-on");
  if ((await turnOn.innerText()).trim() !== "Riaccendi il lavoro continuo") throw new Error("The status bar does not offer to turn continuous work back on");
  await openView("Lavoro");
  const offWork = page.getByTestId("side-bar").getByTestId("work-overview");
  await offWork.getByTestId("work-next").getByText("Lavoro continuo spento", { exact: false }).waitFor();
  await offWork.getByTestId("work-held").getByTestId("work-continuous-on").waitFor();
  await offWork.getByTestId("work-slices-ready").getByTestId("work-slice").filter({ hasText: "S5 Ricevuta dell'ordine via email" }).waitFor();
  await themeShots("15d-status-line-continuous-off");
  await turnOn.click();
  await page.getByTestId("status-continuous-on").waitFor({ state: "detached", timeout: 20_000 });
  if (await page.getByTestId("status-line-text").getByText(/^Lavoro continuo spento/).count()) throw new Error("The status bar still says continuous work is off after turning it on");
  await offWork.getByTestId("work-continuous-on").waitFor({ state: "detached" });
  // The next launches start with continuous work off, as the rest of the check expects.
  await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false }));
}
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
const focusedTurn = page.getByTestId("bottom-panel").locator('[data-testid="work-turn"][data-focused]');
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
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
await workLines.filter({ hasNotText: "Luca" }).last().getByRole("button").click();
await page.getByTestId("bottom-panel").locator('[data-testid="work-turn"][data-focused] [data-testid="technical-step"][data-count="7"]').filter({ hasText: "read_issues" }).waitFor();
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
// TRAMA_RETURN_AFTER_MS=0: coming back to the window counts as a return at once, for the recap of the night (issue #423).
// The automatic moves run here (FAKE_CODEX_AUTOMATIC=run): the delegation makes the Coordinator decide by itself.
({ app, page } = await launch({ TRAMA_RETURN_AFTER_MS: "0", FAKE_CODEX_AUTOMATIC: "run" }));
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
await changeMandate("Restringi");
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
await openSection("Cambia il mandato");
await page.getByTestId("mandate-change").getByRole("button", { name: "Correggi", exact: true }).click();
if (await page.getByTestId("side-bar").getByRole("checkbox", { name: "Integrare candidati verificati" }).isChecked()) {
  throw new Error("The correction form brings back an action the restriction removed");
}
await page.getByTestId("side-bar").getByRole("button", { name: "Annulla", exact: true }).click();
await closePanels();

// A force push is refused whatever the mandate: the turn stops and the action waits in Aspetta te with its reason.
await page.getByLabel("Messaggio al Coordinatore").fill("[vietato:git push --force origin main]");
await page.keyboard.press("Enter");
// The refusal is not a card of the chat: the summary above the composer opens it in Aspetta te.
await page.getByTestId("waiting-summary").getByText("Azione vietata").waitFor({ timeout: 20_000 });
await page.getByTestId("waiting-summary").getByRole("button", { name: "Decidi" }).click();
const bannedItem = page.getByTestId("side-bar").locator('[data-testid="waiting-item"][data-waiting-kind="fixedBan"]');
await bannedItem.waitFor();
const bannedCard = bannedItem.getByTestId("fixed-ban-card");
await bannedCard.getByText("git push --force origin main").waitFor();
await bannedCard.getByText("Force push", { exact: true }).waitFor();
await primaryLast(bannedCard.locator(".cta-row"), "Fixed ban");
await lookShots("26d-fixed-ban");
await bannedCard.getByRole("button", { name: "Ho visto" }).click();
await bannedItem.waitFor({ state: "detached", timeout: 20_000 });

// Issue #422: the person's written request unlocks a banned action. Trama runs it and the chat says so with the
// person's words; the action stays in Activity with the link to the message. A deletion waits for a confirmation in
// Aspetta te first: the button runs it, "Non farlo" never does.
const requestRemote = await mkdtemp(join(tmpdir(), "trama-ui-remoto-"));
execFileSync("git", ["-C", requestRemote, "init", "-q", "--bare", "-b", "main"]);
execFileSync("git", ["-C", mandateProject, "remote", "add", "origin", requestRemote]);
execFileSync("git", ["-C", mandateProject, "push", "-q", "origin", "main:main", "main:feature/vecchio", "main:feature/prova"], { stdio: "ignore" });
const remoteBranches = () => execFileSync("git", ["-C", requestRemote, "branch", "--format=%(refname:short)"], { encoding: "utf8" }).trim().split("\n");
await page.getByLabel("Messaggio al Coordinatore").fill("[richiesta:git tag v0.1.0|metti il tag v0.1.0 sul commit attuale|Creo il tag v0.1.0 sul commit attuale] Sistema tu, metti il tag v0.1.0 sul commit attuale");
await page.keyboard.press("Enter");
const tagLine = page.locator('[data-testid="requested-action"][data-status="done"]').last();
await tagLine.getByText("Faccio un tag o un rilascio perché me l'hai chiesto: «metti il tag v0.1.0 sul commit attuale»").waitFor({ timeout: 20_000 });
if (execFileSync("git", ["-C", mandateProject, "tag", "-l"], { encoding: "utf8" }).trim() !== "v0.1.0") throw new Error("Trama did not create the tag the person asked for");
if (/[–—]/.test(await tagLine.innerText())) throw new Error("The requested action line has a dash");
await tagLine.getByRole("button").first().click();
await tagLine.getByTestId("requested-action-detail").getByText("git tag v0.1.0").waitFor();
await lookShots("26e-requested-action");
await tagLine.getByRole("button").first().click();
// In Activity, the row "Su tua richiesta" goes back to the person's message.
await page.getByTestId("status-bar").getByRole("button", { name: "Attività", exact: true }).click();
const requestedRow = page.getByTestId("activity-log").locator('[data-testid="activity-requested"][data-outcome="done"]').first();
await requestedRow.getByText("Su tua richiesta: un tag o un rilascio").waitFor({ timeout: 20_000 });
await requestedRow.getByRole("button", { name: "Vai al tuo messaggio" }).click();
await page.locator('[data-testid="person-message"][data-highlight="true"]').getByText(/metti il tag v0\.1\.0 sul commit attuale/).waitFor({ timeout: 5_000 });
await page.getByTestId("bottom-panel").getByRole("button", { name: "Chiudi il pannello" }).click();

await page.getByLabel("Messaggio al Coordinatore").fill("[richiesta:git push origin --delete feature/vecchio|cancella il branch remoto feature/vecchio|Cancello il branch feature/vecchio su GitHub] Cancella il branch remoto feature/vecchio");
await page.keyboard.press("Enter");
const confirmation = await openWaiting("confirmation", "Cancello il branch feature/vecchio");
const confirmationCard = confirmation.getByTestId("requested-action-card");
await confirmationCard.getByText("git push origin --delete feature/vecchio").waitFor();
await confirmationCard.getByText("Un branch o un tag cancellato sul remoto sparisce anche per gli altri.").waitFor();
await primaryLast(confirmationCard.locator(".cta-row"), "Deletion confirmation");
if (!remoteBranches().includes("feature/vecchio")) throw new Error("A deletion ran before the person's confirmation");
await lookShots("26f-deletion-confirmation");
await confirmationCard.getByRole("button", { name: "Conferma", exact: true }).click();
await confirmation.waitFor({ state: "detached", timeout: 20_000 });
await page.locator('[data-testid="requested-action"][data-status="done"]').getByText(/^Faccio la cancellazione di un branch o di un tag remoto/).waitFor({ timeout: 20_000 });
if (remoteBranches().includes("feature/vecchio")) throw new Error("The confirmed deletion did not run");

await page.getByLabel("Messaggio al Coordinatore").fill("[richiesta:git push origin --delete feature/prova|cancella anche il branch feature/prova|Cancello il branch feature/prova su GitHub] Cancella anche il branch feature/prova");
await page.keyboard.press("Enter");
const declined = await openWaiting("confirmation", "Cancello il branch feature/prova");
await declined.getByRole("button", { name: "Non farlo" }).click();
await declined.waitFor({ state: "detached", timeout: 20_000 });
await page.locator('[data-testid="requested-action"][data-status="declined"]').getByText(/^Non faccio la cancellazione di un branch o di un tag remoto: non l'hai confermato/).waitFor({ timeout: 20_000 });
if (!remoteBranches().includes("feature/prova")) throw new Error("A declined deletion ran");

// Issue #423: with "fai tutto tu" the Coordinator works on its own. The chat quotes the person, the mandate covers the
// whole project, a product question is decided with the delegation, and when the person comes back the recap says
// what it decided, with its doubt. The Mandate view shows the delegation and withdraws it.
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: true }));
await page.getByLabel("Messaggio al Coordinatore").fill("[delega:fai tutto tu in automatico] Vado a dormire, fai tutto tu in automatico");
await page.keyboard.press("Enter");
const grantLine = page.locator('[data-testid="delegation-line"][data-phase="granted"]').last();
await grantLine.getByText("Da ora faccio tutto io, anche di notte, perché me l'hai chiesto: «fai tutto tu in automatico». Ti chiedo solo le conferme di cancellazione.").waitFor({ timeout: 20_000 });
if (/[–—]/.test(await grantLine.innerText())) throw new Error("The delegation line has a dash");
await lookShots("26g-full-delegation");
await page.getByLabel("Messaggio al Coordinatore").fill("[grilling:1] Gli ordini pagati annullati vanno in revisione");
await page.keyboard.press("Enter");
for (let tries = 0; ; tries++) {
  const state = await page.evaluate(() => window.trama.getState());
  if ((state.project?.document.delegatedChoices ?? []).some((c) => c.kind === "decision")) break;
  if (tries > 240) throw new Error("The Coordinator did not decide the question with the delegation");
  await page.waitForTimeout(250);
}
await page.evaluate(() => window.trama.invoke("coordinator:pause", { paused: true }));
// Issue #460: the person comes back only once the Coordinator's turn has ended, so no choice or recap lands after the
// return. The return goes to Trama's one window, and the recap is waited for in the document, not only on screen: if
// it does not come, the error says what the document holds instead of a bare timeout on the card.
const delegationState = async () => {
  const project = (await page.evaluate(() => window.trama.getState())).project;
  const document = project?.document;
  return {
    running: project?.runningRequestId ?? null,
    choices: (document?.delegatedChoices ?? []).map((c) => `${c.kind} ${c.at}`),
    recaps: (document?.recap?.recaps ?? []).map((r) => `${r.reason} ${r.at} (${(r.delegated ?? []).length} choices)`),
  };
};
for (let tries = 0; (await delegationState()).running !== null; tries++) {
  if (tries > 240) throw new Error("The Coordinator's turn did not end after the pause");
  await page.waitForTimeout(250);
}
const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
if (windows !== 1) throw new Error(`Trama has ${windows} windows: the return would not reach the main one`);
// The person comes back to the window: the recap of the night, with the choice and its doubt.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("blur"));
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("focus"));
for (let tries = 0; !(await delegationState()).recaps.some((r) => r.startsWith("return ")); tries++) {
  if (tries > 80) throw new Error(`No return recap after the person came back: ${JSON.stringify(await delegationState())}`);
  await page.waitForTimeout(250);
}
const nightRecap = page.locator('[data-testid="recap-card"][data-reason="return"]').last();
await nightRecap.waitFor({ timeout: 20_000 }).catch(async (error) => {
  throw new Error(`The return recap is in the document but its card does not show: ${JSON.stringify(await delegationState())}`, { cause: error });
});
await nightRecap.getByText("Cosa ho deciso con la tua delega").waitFor();
// The goal the study proposed opened with the delegation too, as a choice of its own: the decision is found by its doubt.
const decidedChoice = nightRecap.getByTestId("recap-delegated-choice").filter({ hasText: "Dubbio: Non so se vale anche per gli ordini pagati con un buono" }).first();
await decidedChoice.waitFor();
await primaryLast(decidedChoice, "Delegated choice");
await nightRecap.scrollIntoViewIfNeeded();
await lookShots("26h-morning-recap");
await decidedChoice.getByRole("button", { name: "Ho visto" }).click();
await decidedChoice.getByText("Vista", { exact: true }).waitFor();
await openView("Regole", "Mandato");
const delegationSection = page.getByTestId("side-bar").getByTestId("delegation-section");
await page.getByTestId("side-bar").locator('[data-testid="delegation-section"][data-active="true"]').waitFor({ timeout: 20_000 });
await delegationSection.getByText("Dalla tua frase: «fai tutto tu in automatico»").waitFor();
await primaryLast(delegationSection.locator(".cta-row"), "Full delegation");
await lookShots("26i-delegation-view");
await delegationSection.getByRole("button", { name: "Ritira la delega" }).click();
await page.getByTestId("side-bar").locator('[data-testid="delegation-section"][data-active="false"]').waitFor({ timeout: 20_000 });
await page.locator('[data-testid="delegation-line"][data-phase="revoked"]').getByText("Hai ritirato la delega piena dalla vista Mandato. Da ora le scelte tornano a te.").waitFor({ timeout: 20_000 });
await lookShots("26j-delegation-revoked");
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await page.evaluate(() => window.trama.invoke("coordinator:pause", { paused: false }));
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
const readProblemCalls = async () => (await readFile(problemsGhLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const labelled = (calls) => calls.some((call) => call.includes("POST") && call.some((arg) => /\/issues\/21\/labels$/.test(arg)));
// The triage shows in Activity first; Trama writes its labels at the next look at the problems, a moment later.
let problemCalls = await readProblemCalls();
for (const end = Date.now() + 60_000; !labelled(problemCalls) && Date.now() < end; problemCalls = await readProblemCalls()) await page.waitForTimeout(500);
const openedIssues = problemCalls.filter((call) => call.includes("POST") && call.some((arg) => /\/issues$/.test(arg)));
if (openedIssues.length !== 1) throw new Error(`Expected one issue for the red check, got ${openedIssues.length}`);
if (!openedIssues[0].includes("labels[]=needs-triage")) throw new Error("The issue of the problem does not carry the needs-triage label");
if (!labelled(problemCalls)) throw new Error("Trama did not apply the triage labels");
if (/[–—]/.test(await problemLog.innerText())) throw new Error("A dash in the steps of the found problem");
await lookShots("27a-found-problem-issue");
// The recap cites the issue the Coordinator opened, with its number.
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
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
await page.getByTestId("activity-log").locator('[data-testid="activity-problem"]').filter({ hasText: "Nel backlog di Trama" }).waitFor({ timeout: 90_000 });
// Issue #337: the backlog of the found problems left Activity; it is the "Nel backlog" filter of the issues, in Lavoro.
if (await page.getByTestId("bottom-panel").getByTestId("problem-backlog").count()) throw new Error("The backlog is still in Activity");
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
// Issue #332: Lavoro is one view; the backlog is the "Nel backlog" filter of its Issue section.
await openView("Lavoro");
await page.getByTestId("work-section-issues").getByRole("radio", { name: /^Nel backlog/ }).click();
const localBacklog = page.getByTestId("side-bar").getByTestId("problem-backlog");
await localBacklog.getByTestId("problem-backlog-item").filter({ hasText: "Solo in Trama" }).waitFor({ timeout: 30_000 });
if (await page.getByTestId("activity-log").count()) throw new Error("Activity is still open under the backlog");
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
  const steps = page.getByTestId("bottom-panel").getByTestId("technical-step").filter({ hasText: /^Issue #42 «Annullo degli ordini dal riepilogo»/ });
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
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();
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
await closePanels();
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
const reopenedRow = page.getByTestId("bottom-panel").getByText("Turno ripreso alla riapertura", { exact: true }).last();
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
// In Squadre a cloud takes the place of the dot of whom works in a cloud session: Ada yes, Bruno (back on the Mac) and Carla no.
await page.getByRole("button", { name: /^Squadre/ }).first().click();
const cloudRow = (name) => page.locator('[data-testid="team-developer"]').filter({ hasText: name }).first();
await cloudRow("Ada").locator('[data-place="cloud"]').waitFor();
for (const name of ["Bruno", "Carla"]) if (await cloudRow(name).locator('[data-place="cloud"]').count()) throw new Error(`Cloud sessions: ${name} shows the cloud without a session at work`);
// Whoever works on this computer shows a computer instead, never with a cloud session.
if (await cloudRow("Ada").locator('[data-place="local"]').count()) throw new Error("Cloud sessions: Ada in the cloud shows the computer");
await cloudRow("Ada").scrollIntoViewIfNeeded();
for (const dark of [false, true]) {
  await page.evaluate((theme) => window.trama.invoke("settings:update", { theme }), dark ? "dark" : "light");
  await page.waitForFunction((wanted) => document.documentElement.classList.contains("dark") === wanted, dark);
  await shot(`31e-cloud-agents-squads-${dark ? "dark" : "light"}`);
}
// Design rules: a repeated check is secondary, so it is an icon with the name as tooltip and no visible text.
if ((await cloudCard("Ada").getByRole("button", { name: "Controlla la sessione" }).innerText()).trim() !== "") throw new Error("Cloud sessions: the check of the session shows text, not only an icon");
if (!(await cloudCard("Carla").getByRole("button", { name: "Sposta in cloud" }).isVisible())) throw new Error("Cloud sessions: stopped local work cannot move to the cloud");
const cloudState = await page.evaluate(async () => (await window.trama.getState()).project.document.team.specialists.find((s) => s.name === "Ada").assignments[0]);
if (cloudState.status !== "running" || cloudState.cloud.status !== "working") throw new Error(`Cloud sessions: reopening stopped the cloud work: ${cloudState.status}`);
// The person moves Carla's work to the cloud for its next resume: the card says so.
await cloudCard("Carla").getByRole("button", { name: "Sposta in cloud" }).click();
await cloudCard("Carla").getByText("Alla prossima ripresa lavora in cloud, come hai scelto.").waitFor();
await cloudCard("Carla").getByRole("button", { name: "Sposta in locale" }).waitFor();
// The project's setting: three values, the person's choice kept.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
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

// F03 #127: focus mode on a module or on the whole project, from a fixed point the person chooses. A point that does
// not exist or an empty diff is a clear error in the dialog; the examination then takes the whole window, with the
// progress on the left, the findings in the middle and the proof on the right, the exit on the right of the header
// and the notifications paused. Several window sizes, both themes.
{
  const focusProject = await mkdtemp(join(tmpdir(), "trama-ui-esame-"));
  await cp(resolve("resources/DemoProject"), focusProject, { recursive: true });
  // Only git's checks: a machine with Swift would build and test the package before the axes open.
  await rm(join(focusProject, "Package.swift"));
  const focusGit = (...args) => execFileSync("git", ["-C", focusProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", ...args], { stdio: "ignore" });
  focusGit("init", "-q", "-b", "main");
  focusGit("add", ".");
  focusGit("commit", "-q", "-m", "Negozio");
  focusGit("tag", "v1");
  const focusOrder = join(focusProject, "Sources/Orders/Order.swift");
  await writeFile(focusOrder, `${await readFile(focusOrder, "utf8")}\n// Paid orders go to review.\n`);
  focusGit("add", ".");
  focusGit("commit", "-q", "-m", "feat: send paid orders to review");
  ({ app, page } = await launch());
  await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
  await page.evaluate((path) => window.trama.invoke("project:open", { path }), focusProject);
  await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-esame" }).waitFor({ timeout: 30_000 });
  await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
  // The primary action of a row is the last one, on the right.
  const lastAction = async (row, label) => {
    // Issue #338: a button's name is its aria-label when it has one ("Chiedi" is named by the whole question).
    const labels = (await row.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") || node.textContent))).map((text) => text.trim());
    if (labels.at(-1) !== label) throw new Error(`"${label}" is not the last action: ${labels}`);
    const [button, box] = [await row.getByRole("button", { name: label }).boundingBox(), await row.boundingBox()];
    if (!button || !box || box.x + box.width - (button.x + button.width) > 4) throw new Error(`"${label}" is not on the right`);
  };
  await openModules();
  const inspectorPane = page.getByTestId("side-bar");
  await inspectorPane.getByRole("button", { name: "Esame approfondito del progetto" }).waitFor();
  await themeShots("31a-focus-map");
  // The module opens in its editor tab (issue #336), with its actions on top.
  await inspectorPane.getByRole("option", { name: /Orders/ }).click();
  const moduleActions = detailPane().locator(".cta-row").first();
  await lastAction(moduleActions, "Chiedi al Coordinatore su questo modulo");
  await themeShots("31b-focus-module");

  // The dialog starts on the module. A fixed point that does not exist, then a module with no change, fail there.
  await moduleActions.getByRole("button", { name: "Esame approfondito" }).click();
  const focusStart = page.getByRole("dialog", { name: "Esame approfondito" });
  await focusStart.getByRole("radio", { name: /Il modulo Orders/ }).and(page.locator('[aria-checked="true"]')).waitFor();
  await focusStart.getByRole("button", { name: "v1", exact: true }).waitFor();
  await focusStart.getByRole("button", { name: "HEAD~1", exact: true }).waitFor();
  // Design rules: the dialog's clickable parts are at least 32 px high, and its primary is the last button on the right.
  // The height is the layout one: the dialog opens from scale 0.98, so the box on screen reads 31 px while it animates.
  {
    const parts = await focusStart.evaluate((dialog) => {
      const buttons = [...dialog.querySelectorAll("button")].filter(
        (node) => node.closest('[data-testid="focus-start"]') || ["Annulla", "Avvia l'esame"].some((name) => node.textContent.includes(name)),
      );
      const submit = buttons.find((node) => node.textContent.includes("Avvia l'esame"));
      return { heights: buttons.map((node) => node.offsetHeight), submitVariant: submit?.getAttribute("data-variant") };
    });
    if (parts.heights.some((h) => h < 32)) throw new Error(`A focus start button is under 32 px: ${parts.heights}`);
    if (parts.submitVariant !== "default") throw new Error(`Avvia l'esame is not the primary action: ${JSON.stringify(parts)}`);
    const [cancel, submit] = [await focusStart.getByRole("button", { name: "Annulla" }).boundingBox(), await focusStart.getByRole("button", { name: "Avvia l'esame" }).boundingBox()];
    if (!cancel || !submit || submit.x < cancel.x) throw new Error("The primary of the focus start dialog is not last on the right");
  }
  await focusStart.getByLabel("Punto fisso").fill("release-9");
  await focusStart.getByRole("button", { name: "Avvia l'esame" }).click();
  await focusStart.getByTestId("focus-start-error").getByText('Il punto fisso "release-9" non esiste in questo repository: scrivi un commit, un branch o un tag che esiste.').waitFor();
  await themeShots("31c-focus-start-missing-point");
  await focusStart.getByRole("radio", { name: /Il modulo Payments/ }).click();
  await focusStart.getByRole("button", { name: "v1", exact: true }).click();
  await focusStart.getByRole("button", { name: "Avvia l'esame" }).click();
  await focusStart.getByTestId("focus-start-error").getByText(/Nessun cambiamento nel modulo Payments tra il punto fisso "v1"/).waitFor();
  await themeShots("31d-focus-start-empty-diff");
  if (await page.locator("[data-focus-mode]").count()) throw new Error("Focus mode opened on a failed fixed point");

  // The module from v1: full screen, three columns, the exit last on the right, notifications paused.
  await focusStart.getByRole("radio", { name: /Il modulo Orders/ }).click();
  await focusStart.getByRole("button", { name: "Avvia l'esame" }).click();
  const focusView = page.locator("[data-focus-mode]");
  await focusView.waitFor({ timeout: 20_000 });
  await page.locator('[data-focus-mode][data-status="done"]').waitFor({ timeout: 60_000 });
  await focusView.getByTestId("focus-mode-title").getByText("Esame approfondito del modulo Orders").waitFor();
  await focusView.getByTestId("focus-mode-notifications").getByText("Notifiche in pausa").waitFor();
  await lastAction(focusView.locator("header .cta-row"), "Esci dall'esame");
  // Design rules for focus mode: the verdict is one block between the header and the columns, the exit is an icon with its
  // name, nothing is filled, the actions are 32 px high, and no box sits inside another box.
  {
    const verdict = focusView.getByTestId("focus-audit-verdict");
    await verdict.getByTestId("focus-audit-status").getByText("Esame concluso").waitFor();
    const [header, verdictBox, columns] = [await focusView.locator("header").boundingBox(), await verdict.boundingBox(), await focusView.getByTestId("focus-columns").boundingBox()];
    if (!header || !verdictBox || !columns || verdictBox.y < header.y + header.height - 1 || verdictBox.y + verdictBox.height > columns.y + 1) throw new Error("The verdict is not between the header and the columns");
    if (verdictBox.height > 96) throw new Error(`The verdict is ${verdictBox.height} px high, not a line and its summary`);
    const facts = await focusView.evaluate((root) => {
      const exit = root.querySelector('header [aria-label="Esci dall\'esame"]');
      const headerButtons = [...root.querySelectorAll("header button")];
      return {
        exitText: exit?.textContent.trim() ?? null,
        exitLabel: exit?.getAttribute("aria-label") ?? null,
        filled: [...root.querySelectorAll('button[data-variant="default"]')].filter((node) => node.getAttribute("data-filled") !== "false").length,
        short: headerButtons.map((node) => Math.round(node.getBoundingClientRect().height)).filter((h) => h < 32),
        boxes: root.querySelectorAll(".chat-card").length,
        padding: ["header", '[data-testid="focus-audit-verdict"]'].map((selector) => getComputedStyle(root.querySelector(selector)).paddingLeft),
      };
    });
    if (facts.exitLabel !== "Esci dall'esame" || facts.exitText !== "") throw new Error(`The exit is not an icon with its name: ${JSON.stringify(facts)}`);
    if (facts.filled) throw new Error(`Focus mode has ${facts.filled} filled buttons`);
    if (facts.short.length) throw new Error(`A focus mode action is under 32 px: ${facts.short}`);
    if (facts.boxes) throw new Error(`Focus mode has ${facts.boxes} boxes inside its own frame`);
    if (facts.padding.some((value) => value !== "16px")) throw new Error(`The header and the verdict are not on the 16 px grid: ${facts.padding}`);
    // The state of the selected finding is in its row, not repeated in the proof.
    if (await focusView.getByTestId("focus-proof").getByText("Verificato da Trama", { exact: true }).count()) throw new Error("The proof repeats the state of the finding");
    if (/[–—]/.test(await verdict.innerText())) throw new Error("A dash in the verdict");
  }
  // The examination takes the editor area with its tabs; the window's activity bar and status bar stay (issue #330).
  if (await page.getByTestId("editor-area").count()) throw new Error("Focus mode leaves the editor tabs in view");
  for (const bar of ["activity-bar", "status-bar"]) {
    if (!(await page.getByTestId(bar).isVisible())) throw new Error(`Focus mode hides the ${bar}`);
  }
  await focusView.getByTestId("focus-progress").getByText("v1, ", { exact: false }).waitFor();
  await focusView.locator('[data-testid="audit-axis"][data-axis="spec"][data-status="skipped"]').getByText("Nessun piano da confrontare").waitFor();
  const moduleFinding = focusView.locator('[data-testid="audit-axis"][data-axis="standards"] [data-testid="audit-finding"][data-status="verified"]');
  await moduleFinding.getByText(/Mysterious Name in Sources\/Orders\/Order\.swift/).waitFor();
  await focusView.getByTestId("focus-proof").getByText("Trama ha letto Sources/Orders/Order.swift:1 e la riga contiene il testo citato.").waitFor();
  // Each column stays inside the window at every size, with no horizontal scroll.
  const columnsFit = async (size) => {
    const layout = await page.evaluate(() => {
      const box = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? null;
      return {
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        columns: ["focus-progress", "focus-findings", "focus-proof-column"].map((id) => {
          const b = box(id);
          return b && { left: b.left, right: b.right, width: b.width, height: b.height };
        }),
      };
    });
    if (layout.scroll > layout.width) throw new Error(`Focus mode scrolls sideways at ${size}: ${JSON.stringify(layout)}`);
    for (const column of layout.columns) {
      if (!column || column.width < 150 || column.height < 120 || column.left < 0 || column.right > layout.width + 1) throw new Error(`A focus mode column does not fit at ${size}: ${JSON.stringify(layout)}`);
    }
  };
  for (const [width, height] of [[1280, 820], [1600, 1000], [1024, 700], [720, 640]]) {
    await page.setViewportSize({ width, height });
    await columnsFit(`${width}x${height}`);
    await themeShots(`31e-focus-module-${width}x${height}`);
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  // The bottom panel (issue #383) opens under the examination: both stay in the editor area and the columns still fit.
  const focusPanel = page.getByTestId("bottom-panel");
  if (!(await focusPanel.count())) await page.getByRole("button", { name: "Pannello Attività" }).click();
  await focusPanel.waitFor();
  if (!(await focusView.isVisible())) throw new Error("The bottom panel hides focus mode");
  const [focusBox, panelBox] = [await focusView.boundingBox(), await focusPanel.boundingBox()];
  if (!focusBox || !panelBox || focusBox.y + focusBox.height > panelBox.y + 1) throw new Error("Focus mode runs under the bottom panel");
  await columnsFit("1280x820 with the bottom panel");
  await themeShots("31g-focus-module-activity-panel");
  await page.getByRole("button", { name: "Chiudi il pannello" }).click();
  await focusPanel.waitFor({ state: "detached" });
  // Esc leaves too; the module's tab is still where the person left it.
  await page.keyboard.press("Escape");
  await focusView.waitFor({ state: "detached" });
  await detailPane().getByText("Sources/Orders").first().waitFor();

  // The whole project from HEAD~1, left with the exit button.
  await openModules();
  await page.getByTestId("side-bar").getByRole("button", { name: "Esame approfondito del progetto" }).click();
  await focusStart.getByRole("radio", { name: "L'intero progetto" }).and(page.locator('[aria-checked="true"]')).waitFor();
  await focusStart.getByRole("button", { name: "HEAD~1", exact: true }).click();
  await focusStart.getByRole("button", { name: "Avvia l'esame" }).click();
  await page.locator('[data-focus-mode][data-status="done"]').waitFor({ timeout: 60_000 });
  await focusView.getByTestId("focus-mode-title").getByText("Esame approfondito dell'intero progetto").waitFor();
  await themeShots("31f-focus-project");
  await focusView.getByRole("button", { name: "Esci dall'esame" }).click();
  await focusView.waitFor({ state: "detached" });
  await app.close();
}

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
await closePanels();
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
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();

// An interface change waits for the person with the screenshots before and after, in light and dark.
await send("[assegna] [interfaccia]");
const styledWork = await workDone(plainWork);
await send(`[candidato:${styledWork}:${vetrinaDecision}]`);
const styledItem = await openWaiting("candidate", undefined, 60_000);
// UI wave of 29 September: the open item of Aspetta te has no title of its own, its card is its one frame. The item keeps
// its label as its name, and the card says the candidate changes the interface.
if ((await styledItem.getAttribute("aria-label")) !== "Interfaccia da guardare" || !(await styledItem.innerText()).includes("Cambia l'interfaccia")) {
  throw new Error("The interface candidate does not say it changes the interface");
}
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
// Its own page: the screenshots come from the interface change, and the person decides right under the outcome.
await styledItem.getByRole("button", { name: "Apri il diff" }).click();
await candidatePageRules("interface candidate", { interfaceChange: true, diffOpen: true });
await themeShots("30b3-interface-candidate-page");
await closeDetails();

// The person refuses it with a reason: it leaves Aspetta te and the reason reaches the developer.
await styledItem.getByRole("button", { name: "Rifiuta", exact: true }).click();
await styledItem.getByLabel("Motivo del rifiuto del candidato").fill("Il rosso del pulsante Paga è troppo acceso in scuro");
await primaryLast(styledItem.locator(".cta-row").filter({ has: page.getByRole("button", { name: "Rifiuta il candidato" }) }), "Refusal");
await themeShots("30c-interface-candidate-refusing");
await styledItem.getByRole("button", { name: "Rifiuta il candidato" }).click();
await styledItem.waitFor({ state: "detached", timeout: 20_000 });
await stateUntil((document) => (adaWork(document)?.gateReturn?.findings ?? []).some((f) => f.includes("troppo acceso in scuro")), "Refusal back to the developer");
await workDone(null);
await closePanels();
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
await closePanels();
await page.getByTestId("status-line").getByRole("button", { name: "Attività" }).click();
await page.getByTestId("activity-log").locator('[data-testid="activity-merge"]').filter({ hasText: "Candidato unito con il tuo ok" }).waitFor({ timeout: 20_000 });
await themeShots("30e-merge-activity-person");
// Issue #301, the shared texts: in English the moves of Activity, their outcomes, the states of the cards and the
// pause of the status line read in English at once, without a restart, and fit the layout; back in Italian they read
// as before. The screenshots of the pull request are docs/images/issue-301/shared-en-light.png and -dark.png.
await page.evaluate(() => window.trama.invoke("settings:update", { language: "en" }));
await page.waitForFunction(() => document.documentElement.lang === "en");
const sharedActivity = page.getByTestId("activity-log");
await sharedActivity.locator('[data-testid="activity-merge"][data-outcome="done"]').filter({ hasText: "Candidate merged with your OK" }).first().waitFor({ timeout: 20_000 });
await sharedActivity.locator('[data-testid="activity-merge"][data-outcome="done"]').filter({ hasText: "Candidate merged with the Coordinator's green light" }).first().waitFor();
if (await sharedActivity.getByText(/Candidato unito|Fatta$|Non riuscita$/).count()) throw new Error("Activity keeps Italian texts in English");
await page.getByTestId("status-line").getByRole("button", { name: /^(Pause the Coordinator|Resume the Coordinator)$/ }).first().waitFor();
await noHorizontalScroll("shared texts in English");
// No English label of Activity spills out of its row.
const spilled = await sharedActivity.evaluate((log) =>
  [...log.querySelectorAll("li")].filter((row) => row.scrollWidth > row.clientWidth + 1).map((row) => row.textContent?.slice(0, 80)),
);
if (spilled.length) throw new Error(`Activity rows spill out in English: ${spilled.join(" | ")}`);
await themeShots("301-shared-en");
await page.evaluate(() => window.trama.invoke("settings:update", { language: "it" }));
await page.waitForFunction(() => document.documentElement.lang === "it");
await sharedActivity.locator('[data-testid="activity-merge"]').filter({ hasText: "Candidato unito con il tuo ok" }).first().waitFor();
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
await closePanels();

// Issue #41: a candidate that deletes a file is a serious destructive change. The Coordinator does not merge it on its
// green light: it waits in Aspetta te with the reasons, the consequences and the alternatives, and "Unisci comunque"
// merges it as the person's act. The merge on the green light names the mandate version it ran under.
await send("[assegna] [cancella]");
const deletingWork = await workDone(correctedWork);
await send(`[candidato:${deletingWork}:${vetrinaDecision}]`);
await stateUntil((document) => candidateOfWork(document, deletingWork)?.merge?.stop, "Destructive merge stopped");
const stoppedItem = await openWaiting("candidate", undefined, 60_000);
if ((await stoppedItem.getAttribute("data-waiting-key")) !== `merge:${await stateUntil((document) => candidateOfWork(document, deletingWork)?.id, "Stopped candidate")}`) {
  throw new Error("The stopped merge is not its own item in Aspetta te");
}
const stopField = stoppedItem.getByTestId("candidate-merge-stop");
await stopField.getByText("Il Coordinatore non unisce questo candidato da solo: la scelta è tua.", { exact: false }).waitFor();
await stopField.getByText("Conseguenze", { exact: true }).waitFor();
await stopField.getByText("Cosa puoi fare", { exact: true }).waitFor();
await stopField.getByText(/README\.md/).waitFor();
if (/[–—]/.test(await stoppedItem.innerText())) throw new Error("A dash in the stopped merge");
await primaryLast(stoppedItem.locator(".cta-row").filter({ has: page.getByRole("button", { name: "Unisci comunque" }) }), "Stopped merge");
if ((await readFile(vetrinaGhLog, "utf8")).split("\n").filter((line) => line.includes('"PUT"')).length !== 2) throw new Error("The destructive candidate was merged without the person");
await stopField.evaluate((node) => node.scrollIntoView({ block: "center" }));
await themeShots("30f-merge-stopped-destructive");
await stoppedItem.getByRole("button", { name: "Unisci comunque" }).click();
await stateUntil((document) => candidateOfWork(document, deletingWork)?.pullRequest?.mergedBy === "person", "Destructive merge on the person's ok");
await stoppedItem.waitFor({ state: "detached", timeout: 20_000 });
await closePanels();
// The first candidate, merged on the green light, names the mandate it ran under: its reference opens it.
const plainCandidate = await stateUntil((document) => candidateOfWork(document, plainWork)?.id, "Merged candidate");
await page.locator(`[data-reference="candidate"][data-reference-id="${plainCandidate}"]`).first().click();
// Issue #336: the candidate opens in its editor tab.
const plainMerged = detailPane();
await plainMerged.getByTestId("candidate-merge-mandate").filter({ hasText: "Mandato versione 1." }).waitFor({ timeout: 20_000 });
await plainMerged.getByTestId("candidate-merge").evaluate((node) => node.scrollIntoView({ block: "center" }));
await themeShots("30g-merge-mandate-version");
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();

// Issue #39: the projects share the developers. The overview says how many work in all projects and keeps the
// Product Owner's order of the projects: the arrows move a project, opening another one leaves the order as it is.
({ app, page } = await launch());
await page.getByTestId("dialog-title").first().waitFor({ timeout: 30_000 });
await (await overviewButton()).click();
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
await (await overviewButton()).click();
await priority.waitFor();
let reopened39 = await priorityNames();
for (const end = Date.now() + 10_000; reopened39.join("|") !== moved39.join("|") && Date.now() < end; reopened39 = await priorityNames()) await page.waitForTimeout(250);
if (reopened39.join("|") !== moved39.join("|")) throw new Error(`Opening a project changed the order of the projects: ${moved39.join(", ")} became ${reopened39.join(", ")}`);
await (await overviewButton()).click();
// The shared limit sits next to the project's own limit in the settings.
await page.getByRole("button", { name: "Impostazioni", exact: true }).click();
const sharedSettings = page.getByTestId("settings");
await sharedSettings.getByRole("button", { name: /^Metodo di lavoro/ }).first().click();
const sharedPicker = sharedSettings.getByTestId("shared-developers");
await sharedPicker.getByRole("radio", { name: "6", checked: true }).waitFor();
await sharedPicker.getByRole("radio", { name: "4" }).click();
await sharedPicker.getByRole("radio", { name: "4", checked: true }).waitFor();
await sharedPicker.scrollIntoViewIfNeeded();
await noHorizontalScroll("shared developers");
await themeShots("39b-shared-developers");

// Issue #301: the texts the main process writes follow the person's language at once, without a restart: the status
// line, the Activity rows and the notices of the Coordinator in English, in light and dark, with the actions in their
// place on the right and no text running out of its line.
await page.evaluate(() => window.trama.invoke("settings:update", { language: "en" }));
await page.waitForFunction(() => document.documentElement.lang === "en");
await page.getByRole("button", { name: /^(Impostazioni|Settings)$/ }).click();
await page.getByTestId("settings").waitFor({ state: "hidden" });
const englishLine = page.getByTestId("status-line");
if (await page.locator('[data-testid="status-line"][data-paused="true"]').count()) {
  await page.evaluate(() => window.trama.invoke("coordinator:pause", { paused: false }));
  await page.locator('[data-testid="status-line"][data-paused="false"]').waitFor({ timeout: 20_000 });
}
await page.evaluate(() => window.trama.invoke("coordinator:pause", { paused: true }));
await page.locator('[data-testid="status-line"][data-paused="true"]').waitFor({ timeout: 20_000 });
await englishLine.getByRole("button", { name: /^(Attività|Activity)$/ }).click();
const englishActivity = page.getByTestId("activity-log");
await englishActivity.waitFor();
await themeShots("41-main-en");
await englishLine.getByTestId("status-line-text").getByText(/^Coordinator paused: running turns finish/).waitFor({ timeout: 10_000 });
// The rows already in Activity keep the language they were written in; what the main process writes now is English.
const italianWords = /[àèìòù]|\b(?:il|la|non|che|della|nel|Coordinatore|Concedi|Rivedi|Conferma|Lavoro del progetto)\b/;
const englishTexts = [
  await englishLine.getByTestId("status-line-text").innerText(),
  // Issue #330: in the status bar the person's move is a text button and the Coordinator's actions are icons.
  ...(await englishLine.locator("button:not([aria-label])").allInnerTexts()),
  ...(await page.getByTestId("work-bar-focus-title").allInnerTexts()),
];
const stillItalian = englishTexts.filter((text) => italianWords.test(text));
if (stillItalian.length) throw new Error(`Main texts still in Italian after the switch: ${stillItalian.join(" | ")}`);
await noHorizontalScroll("main texts in English");
const englishLayout = await englishLine.evaluate((line) => {
  const box = line.getBoundingClientRect();
  const text = line.querySelector('[data-testid="status-line-text"]');
  return {
    buttonsOutside: [...line.querySelectorAll("button")].filter((button) => {
      const b = button.getBoundingClientRect();
      return b.width > 0 && (b.left < box.left - 1 || b.right > box.right + 1 || button.scrollWidth > button.clientWidth + 1);
    }).length,
    textOutside: text ? text.getBoundingClientRect().right > box.right + 1 : false,
  };
});
if (englishLayout.buttonsOutside) throw new Error(`${englishLayout.buttonsOutside} status line actions do not fit in English`);
if (englishLayout.textOutside) throw new Error("The English status line text runs out of the line");
// The last action sits on the right, as in Italian.
const englishLast = await englishLine.getByRole("button").last().boundingBox();
const englishBox = await englishLine.boundingBox();
if (!englishLast || !englishBox || englishBox.x + englishBox.width - (englishLast.x + englishLast.width) > 2) throw new Error("The last action of the English status line is not on the right");
await page.evaluate(() => window.trama.invoke("coordinator:pause", { paused: false }));
await page.evaluate(() => window.trama.invoke("settings:update", { language: "it" }));
await page.waitForFunction(() => document.documentElement.lang === "it");
await app.close();

// A11 (issue #251): the person renames, merges and splits the squads from the Squads view, or asks the Coordinator.
// Rename keeps the squad's id; a merge beyond three developers shows who the Coordinator proposes to keep; a split
// moves the chosen areas and developers to a new squad with its own lead and QA. Each change is in Activity and is
// undone there; a change that cannot be made says why. Narrow and wide, Codex and Claude, light and dark.
const squadsProject = await mkdtemp(join(tmpdir(), "trama-ui-squadre-"));
await cp(resolve("resources/DemoProject"), squadsProject, { recursive: true });
execFileSync("git", ["-C", squadsProject, "init", "-q", "-b", "main"]);
execFileSync("git", ["-C", squadsProject, "add", "."]);
execFileSync("git", ["-C", squadsProject, "-c", "user.name=Trama UI", "-c", "user.email=ui@trama.local", "commit", "-q", "-m", "Negozio"]);
({ app, page } = await launch());
await page.evaluate(() => window.trama.invoke("settings:update", { continuousWork: false, theme: "light" }));
await page.evaluate((path) => window.trama.invoke("project:open", { path }), squadsProject);
await page.getByText("Ho letto lo studio").first().waitFor({ timeout: 30_000 });
await app.close();
{
  let squadsPath = null;
  for (const file of await readdir(join(dataDir, "Projects"))) {
    if ((await readFile(join(dataDir, "Projects", file), "utf8")).includes("trama-ui-squadre-")) squadsPath = join(dataDir, "Projects", file);
  }
  if (!squadsPath) throw new Error("Squads: the project's state was not saved");
  const document = JSON.parse(await readFile(squadsPath, "utf8"));
  const at = "2026-09-28T09:00:00.000Z";
  const member = (id, name, role, moduleIds, tag) => ({
    id,
    name,
    competence: "Swift",
    reason: "Negozio",
    moduleIds,
    role,
    origin: role === "developer" ? "teamProposal" : "fixedRole",
    color: null,
    tag,
    createdAt: at,
    status: "available",
    model: null,
    tools: ["commands"],
    updatedAt: at,
    lastUpdate: "",
    assignments: [],
    removal: null,
  });
  // The fixed roles Trama created stay; the squads' own people are the example's.
  document.team.specialists = document.team.specialists.filter((s) => s.role !== "qa" && s.role !== "squadLead" && s.role !== "developer");
  document.team.specialists.push(
    member("S-A1100001", "Capo Ordini", "squadLead", ["Sources/Orders", "Sources/Payments"], "Capo"),
    member("S-A1100002", "QA Ordini", "qa", ["Sources/Orders", "Sources/Payments"], "QA"),
    member("S-A1100003", "Luca", "developer", ["Sources/Orders"], "Ordini"),
    member("S-A1100004", "Marta", "developer", ["Sources/Payments"], "Pagamenti"),
    member("S-A1100005", "Capo Catalogo", "squadLead", ["Sources/Catalog"], "Capo"),
    member("S-A1100006", "QA Catalogo", "qa", ["Sources/Catalog"], "QA"),
    member("S-A1100007", "Nora", "developer", ["Sources/Catalog"], "Catalogo"),
    member("S-A1100008", "Piero", "developer", ["Sources/Catalog"], "Catalogo"),
  );
  document.team.proposals = [];
  document.team.confirmedAt = at;
  document.team.squads = [
    { id: "SQ-A1100001", name: "Ordini", moduleIds: ["Sources/Orders", "Sources/Payments"], leadId: "S-A1100001", qaId: "S-A1100002", developerIds: ["S-A1100003", "S-A1100004"], createdAt: at },
    { id: "SQ-A1100002", name: "Catalogo", moduleIds: ["Sources/Catalog"], leadId: "S-A1100005", qaId: "S-A1100006", developerIds: ["S-A1100007", "S-A1100008"], createdAt: at },
  ];
  await writeFile(squadsPath, JSON.stringify(document));
}
({ app, page } = await launch());
await page.evaluate((path) => window.trama.invoke("project:open", { path }), squadsProject);
await page.getByTestId("dialog-title").filter({ hasText: "trama-ui-squadre" }).waitFor({ timeout: 30_000 });
await openView("Squadre");
const squadsSide = page.getByTestId("side-bar");
const squadNamed = (name) => squadsSide.locator(`[data-testid="squad"][data-squad="${name}"]`);
await squadNamed("Ordini").waitFor({ timeout: 20_000 });
await squadNamed("Catalogo").waitFor();
// Named apart from their areas, these squads still name them in their header (UI wave of 29 September).
{
  const headers = await squadHeadersNameOnce("the squads project");
  const areaOf = (name) => headers.find((header) => header.name === name)?.area;
  if (areaOf("Ordini") !== "Orders, Payments" || areaOf("Catalogo") !== "Catalog") throw new Error(`A squad's header lost its areas: ${JSON.stringify(headers)}`);
}
const squadMenu = async (name, item) => {
  const menu = await openMenu(squadNamed(name).getByTestId("squad-menu"));
  if (item) await menu.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
};
// Each squad has its menu of changes, with the reason beside an action that cannot be made.
{
  const look = await lookOf();
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await noHorizontalScroll(`Squads with their menus ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`51a-squads-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
  }
  await setLookTo(look.provider, look.dark);
  await page.setViewportSize({ width: 1280, height: 820 });
}
await squadMenu("Catalogo");
const splitItem = openMenus().getByRole("menuitem", { name: /^Dividi per aree/ });
if ((await splitItem.getAttribute("aria-disabled")) !== "true") throw new Error("A squad with one area offers to split");
await splitItem.getByText("La squadra Catalogo ha una sola area: non si divide.").waitFor();
await themeShots("51b-squad-menu");
await page.keyboard.press("Escape");
// Rename: the id stays, the name is checked before the person confirms, Rinomina is the last call to action.
const ordersId = await squadNamed("Ordini").getAttribute("data-squad-id");
await squadMenu("Ordini", "Rinomina");
const renameSquadForm = squadsSide.getByTestId("rename-squad");
await renameSquadForm.getByLabel("Nome della squadra").fill("catalogo");
await renameSquadForm.getByText("C'è già una squadra che si chiama catalogo.").waitFor();
if (await renameSquadForm.getByRole("button", { name: "Rinomina" }).isEnabled()) throw new Error("A squad can take another squad's name");
await renameSquadForm.getByLabel("Nome della squadra").fill("Ordini e pagamenti");
await expectGaps("Rename a squad", renameSquadForm);
const renameSquadButtons = await renameSquadForm.locator(".cta-row button").allTextContents();
if (renameSquadButtons.at(-1)?.trim() !== "Rinomina") throw new Error(`Rename is not the last call to action: ${renameSquadButtons}`);
await themeShots("51c-squad-rename");
await renameSquadForm.getByRole("button", { name: "Rinomina" }).click();
await squadNamed("Ordini e pagamenti").waitFor({ timeout: 20_000 });
if ((await squadNamed("Ordini e pagamenti").getAttribute("data-squad-id")) !== ordersId) throw new Error("The rename changed the squad's id");
// Merge beyond three developers: the Coordinator's proposal of who stays, which the person may change.
await squadMenu("Ordini e pagamenti", "Unisci a un'altra squadra");
const mergeForm = squadsSide.getByTestId("merge-squad");
await mergeForm.getByText("Insieme sono 4 sviluppatori e una squadra ne ha al massimo 3.", { exact: false }).waitFor();
const kept = await mergeForm.getByTestId("squad-keep").locator("input:checked").count();
if (kept !== 3) throw new Error(`The proposal keeps ${kept} developers, not 3`);
await expectGaps("Merge squads", mergeForm);
await expectRowsTall("Merge squads", mergeForm.getByTestId("squad-keep").locator("label"));
await mergeForm.scrollIntoViewIfNeeded();
{
  const look = await lookOf();
  for (const provider of ["codex", "claudeAgent"]) {
    for (const dark of [false, true]) {
      await setLookTo(provider, dark);
      await shot(`51d-squad-merge-${provider}-${dark ? "dark" : "light"}`);
    }
  }
  await setLookTo(look.provider, look.dark);
}
await mergeForm.getByRole("button", { name: "Unisci", exact: true }).click();
await squadNamed("Catalogo").waitFor({ state: "detached", timeout: 20_000 });
await squadsSide.getByText("Sviluppatori fuori dalle squadre").waitFor();
if ((await squadNamed("Ordini e pagamenti").getByTestId("team-developer").count()) !== 3) throw new Error("The merged squad does not have three developers");
await themeShots("51e-squads-merged");
// Activity tells both changes; the merge is undone there and the two squads come back as they were.
if (!(await page.getByTestId("bottom-panel").count())) await page.getByTestId("status-bar").getByRole("button", { name: "Attività", exact: true }).click();
const squadRows = page.getByTestId("bottom-panel").getByTestId("activity-squad");
await squadRows.filter({ hasText: "Squadre unite" }).waitFor({ timeout: 20_000 });
await squadRows.filter({ hasText: "Squadra rinominata" }).waitFor();
// The rename is older than the merge of the same squad: it is undone only after the merge.
if (await squadRows.filter({ hasText: "Squadra rinominata" }).getByTestId("squad-undo").isEnabled()) throw new Error("An older change undoes before the newer one");
await squadRows.filter({ hasText: "Squadre unite" }).getByTestId("activity-row-toggle").click();
await squadRows.filter({ hasText: "Squadre unite" }).getByTestId("activity-row-detail").getByText("Dalla vista Squadre").waitFor();
await themeShots("51f-activity-squads");
await squadRows.filter({ hasText: "Squadre unite" }).getByTestId("squad-undo").click();
await page.getByTestId("bottom-panel").locator('[data-testid="activity-squad"][data-outcome="undone"]').filter({ hasText: "Squadre unite" }).waitFor({ timeout: 20_000 });
await squadNamed("Catalogo").waitFor({ timeout: 20_000 });
if ((await squadNamed("Catalogo").getByTestId("team-developer").count()) !== 2) throw new Error("The undone merge did not bring Catalogo back with its developers");
if (await squadsSide.getByText("Sviluppatori fuori dalle squadre").count()) throw new Error("The undone merge left a developer outside squads");
await squadRows.filter({ hasText: "Squadra rinominata" }).getByTestId("squad-undo").waitFor();
if (!(await squadRows.filter({ hasText: "Squadra rinominata" }).getByTestId("squad-undo").isEnabled())) throw new Error("The rename cannot be undone after the merge was");
await themeShots("51g-activity-squad-undone");
await page.getByRole("button", { name: "Chiudi il pannello" }).click();
// Through the Coordinator: a merge of more than three developers waits for the person in the Squads view, who sets
// it aside here.
await page.getByRole("button", { name: "Chiudi la barra laterale" }).click();
await composer().click();
await composer().pressSequentially("[unisci-squadre:Catalogo:Ordini e pagamenti]");
await page.keyboard.press("Enter");
await page.getByText("scegli chi resta nella vista Squadre").first().waitFor({ timeout: 20_000 });
await openView("Squadre");
const mergeProposalCard = squadsSide.getByTestId("squad-merge-proposal");
await mergeProposalCard.getByText("Hai chiesto al Coordinatore di unire Catalogo a Ordini e pagamenti.", { exact: false }).waitFor({ timeout: 20_000 });
const squadProposalButtons = await mergeProposalCard.locator(".cta-row button").allTextContents();
if (squadProposalButtons.at(-1)?.trim() !== "Unisci") throw new Error(`Merge is not the last call to action: ${squadProposalButtons}`);
await expectGaps("The merge proposal", mergeProposalCard);
await themeShots("51j-squad-merge-proposal");
await mergeProposalCard.getByRole("button", { name: "Lascia com'è" }).click();
await mergeProposalCard.waitFor({ state: "detached", timeout: 20_000 });
await squadNamed("Catalogo").waitFor();
// Split by areas: Payments goes to a new squad with Marta, who knows it; the new squad has its own lead and QA.
await squadMenu("Ordini e pagamenti", "Dividi per aree");
const splitForm = squadsSide.getByTestId("split-squad");
await splitForm.getByTestId("split-areas").getByRole("checkbox", { name: "Payments" }).check();
if (!(await splitForm.getByTestId("split-developers").getByRole("checkbox", { name: "Marta" }).isChecked())) throw new Error("The split does not propose the developer who knows the area");
await splitForm.getByLabel("Nome della squadra nuova").fill("Pagamenti");
await expectGaps("Split a squad", splitForm);
await expectRowsTall("Split a squad", splitForm.locator('[data-testid="split-areas"] label, [data-testid="split-developers"] label'));
const splitButtons = await splitForm.locator(".cta-row button").allTextContents();
if (splitButtons.at(-1)?.trim() !== "Dividi") throw new Error(`Split is not the last call to action: ${splitButtons}`);
await splitForm.scrollIntoViewIfNeeded();
{
  const look = await lookOf();
  for (const [size, width, height] of [["1280x800", 1280, 800], ["1680x1050", 1680, 1050]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await noHorizontalScroll(`Split of a squad ${size}`);
    for (const provider of ["codex", "claudeAgent"]) {
      for (const dark of [false, true]) {
        await setLookTo(provider, dark);
        await shot(`51h-squad-split-${size}-${provider}-${dark ? "dark" : "light"}`);
      }
    }
  }
  await setLookTo(look.provider, look.dark);
  await page.setViewportSize({ width: 1280, height: 820 });
}
await splitForm.getByRole("button", { name: "Dividi", exact: true }).click();
const paymentsSquad = squadNamed("Pagamenti");
await paymentsSquad.waitFor({ timeout: 20_000 });
await paymentsSquad.getByRole("button", { name: /^Marta/ }).waitFor();
await paymentsSquad.locator('[data-testid="team-figure"][data-role="squadLead"]').waitFor();
await paymentsSquad.locator('[data-testid="team-figure"][data-role="qa"]').waitFor();
await expectNoRawIds(squadsSide.getByTestId("squad").first(), "The squads after the split");
await themeShots("51i-squads-split");
// Size rules: at the narrowest window and at 1280x800 zoomed to 120% no box of the views, the chat, Impostazioni and
// Progetti overflows sideways, with a project full of work.
{
  const closeEditorTab = async (tab) => {
    const button = page.locator(`[data-testid="editor-tab"][data-tab="${tab}"]`);
    if (await button.count()) {
      await button.getByRole("button", { name: /^Chiudi / }).click();
      await button.waitFor({ state: "detached" });
    }
  };
  for (const [width, height] of [
    [720, 640],
    [1066, 666],
  ]) {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await closePanels();
    await page.waitForTimeout(400);
    await noContainerOverflow(`the chat at ${size}`);
    // Lower than 716 px the bottom panel stays under the editor at its lowest, and the composer stays in view.
    await clickMenu("togglePanel");
    const docked = page.locator('[data-testid="bottom-panel"]:not([data-overlay])');
    await docked.waitFor();
    await page.waitForTimeout(400);
    const composerVisible = await page.locator(".chat-composer-surface").first().isVisible();
    const panelTop = await docked.evaluate((el) => el.getBoundingClientRect().top);
    const composerBottom = await page.locator(".chat-composer-surface").first().evaluate((el) => el.getBoundingClientRect().bottom);
    if (!composerVisible || composerBottom > panelTop + 0.5) throw new Error(`The bottom panel hides the composer at ${size}`);
    await noContainerOverflow(`the bottom panel at ${size}`);
    await clickMenu("togglePanel");
    await docked.waitFor({ state: "detached" });
    for (const view of ["Lavoro", "Squadre", "Aspetta te", "Memoria", "Regole", "Progetti"]) {
      await openView(view);
      // The side bar eases to its width: the boxes are measured once it has settled.
      await page.waitForTimeout(400);
      await noContainerOverflow(`${view} at ${size}`);
    }
    await closePanels();
    await clickMenu("settings");
    await page.getByTestId("settings").waitFor();
    await noContainerOverflow(`Impostazioni at ${size}`);
    await closeEditorTab("settings");
    await (await overviewButton()).click();
    await page.getByTestId("overview").waitFor();
    await page.waitForTimeout(400);
    await noContainerOverflow(`the projects overview at ${size}`);
    await closeEditorTab("projects");
    await closePanels();
  }
  await page.setViewportSize({ width: 1280, height: 820 });
}
await page.evaluate(() => window.trama.invoke("settings:update", { theme: "system" }));
await app.close();
