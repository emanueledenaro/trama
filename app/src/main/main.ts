import { release } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, shell, type MenuItemConstructorOptions } from "electron";
import type { AppSettings } from "@shared/domain";
import type { ActionMap, ActionName } from "@shared/ipc";
import { TramaController } from "./controller";

app.setName("Trama");
if (!app.requestSingleInstanceLock()) app.exit(0);
const isMac = process.platform === "darwin";
// Windows 11 paints Acrylic glass behind a transparent window; older Windows and Linux stay opaque.
const isGlassWindows = process.platform === "win32" && Number(release().split(".")[2] ?? 0) >= 22000;
const rendererUrl = process.env.TRAMA_RENDERER_URL;
let window: BrowserWindow | null = null;

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111111" : "#ffffff";
}

// The desktop app keeps its state in Trama/Desktop; the SwiftUI app's files in Trama are only read.
const legacyRoot = process.env.TRAMA_DATA_DIR ? (process.env.TRAMA_LEGACY_DIR ?? null) : join(app.getPath("appData"), "Trama");
const controller = new TramaController(process.env.TRAMA_DATA_DIR ?? join(app.getPath("appData"), "Trama", "Desktop"), {
  publish: (state) => window?.webContents.send("trama:state", state),
  openExternal: (url) => shell.openExternal(url),
  applyTheme: (theme: AppSettings["theme"]) => {
    nativeTheme.themeSource = theme;
    if (!isMac && !isGlassWindows) window?.setBackgroundColor(surfaceColor());
  },
  notify: (title, body, sound) => {
    if (window?.isFocused() || !Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: !sound });
    notification.on("click", () => {
      if (!window) createWindow();
      window?.show();
      window?.focus();
    });
    notification.show();
  },
  setOpenAtLogin: (enabled) => {
    if (process.platform === "linux") return;
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  },
  aiHeroResourceDirectory: app.isPackaged ? join(process.resourcesPath, "AIHero") : join(app.getAppPath(), "resources", "AIHero"),
  demoResourceDirectory: app.isPackaged
    ? join(process.resourcesPath, "DemoProject")
    : join(app.getAppPath(), "resources", "DemoProject"),
  codexExecutable: process.env.TRAMA_CODEX_PATH ?? null,
}, legacyRoot);

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 640,
    show: false,
    title: "Trama",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
          vibrancy: "under-window" as const,
          visualEffectState: "active" as const,
          backgroundColor: "#00000000",
        }
      : isGlassWindows
        ? { backgroundMaterial: "acrylic" as const, backgroundColor: "#00000000", autoHideMenuBar: true }
        : { backgroundColor: surfaceColor(), autoHideMenuBar: true }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });
  window.on("focus", () => void controller.refreshCodex());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
}

async function chooseFolder(title: string): Promise<string | null> {
  const options = { title, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

type Handler<K extends ActionName> = (payload: ActionMap[K][0]) => Promise<ActionMap[K][1]> | ActionMap[K][1];
const handlers: { [K in ActionName]: Handler<K> } = {
  "project:openDialog": async () => {
    const path = await chooseFolder("Apri progetto");
    if (path) await controller.openProject(path);
  },
  "project:open": ({ path }) => controller.openProject(path),
  "project:openDemo": () => controller.openDemo(),
  "project:create": async ({ name, idea }) => {
    const parent = await chooseFolder("Scegli la cartella");
    if (parent) await controller.createProject(parent, name, idea);
  },
  "project:close": () => controller.closeProject(),
  "project:refresh": () => controller.refreshProject(),
  "project:forgetRecent": ({ id }) => controller.forgetRecent(id),
  "project:revealInFolder": ({ relativePath }) => {
    const project = controller.snapshot.project;
    if (!project) return;
    if (relativePath && (relativePath.startsWith("/") || relativePath.split("/").includes(".."))) return;
    const target = relativePath ? join(project.rootPath, relativePath) : project.rootPath;
    if (relativePath) shell.showItemInFolder(target);
    else void shell.openPath(target);
  },
  "project:readFile": ({ relativePath }) => controller.readFile(relativePath),
  "coordinator:send": ({ text, moduleId, model, effort, images, provider, goalId }) =>
    controller.send(text, moduleId, model, effort, images ?? [], provider ?? null, goalId ?? null),
  "coordinator:takeStep": ({ requestId }) => controller.takeStep(requestId),
  "coordinator:interrupt": () => controller.interrupt(),
  "coordinator:retry": () => controller.startCoordinator(),
  "coordinator:selectModel": ({ model, effort, provider, goalId }) => controller.selectModel(model, effort, provider ?? null, goalId ?? null),
  "coordinator:setFastMode": ({ enabled, goalId }) => controller.setFastMode(enabled, goalId ?? null),
  "coordinator:selectProvider": ({ provider, goalId }) => controller.selectProvider(provider, goalId ?? null),
  "coordinator:saveDraft": ({ text, goalId }) => controller.saveDraft(text, goalId ?? null),
  "coordinator:deleteQueued": async ({ id }) => controller.deleteQueuedMessage(id),
  "goal:create": (input) => controller.createGoal(input),
  "goal:update": ({ id, ...change }) => controller.updateGoal(id, change),
  "goal:archive": ({ id, archived }) => controller.archiveGoal(id, archived),
  "goal:delete": ({ id }) => controller.deleteGoal(id),
  "focus:change": ({ action, taskId }) => controller.changeFocus(action, taskId),
  "candidate:observeExample": (input) => controller.observeExample(input),
  "overview:read": () => controller.projectsOverview(),
  "coordinator:setContextThreshold": ({ percent }) => controller.setContextThreshold(percent),
  "pact:decide": (input) => controller.recordDecision(input),
  "decision:answer": ({ requestId, alternativeIndex, freeText }) => controller.answerDecision(requestId, alternativeIndex, freeText),
  "decision:withdraw": ({ requestId, reason }) => controller.withdrawDecision(requestId, reason),
  "mandate:grant": (input) => controller.grantMandate(input),
  "mandate:revoke": ({ reason, requestId }) => controller.revokeMandate(reason, requestId),
  "team:answer": ({ proposalId, keeping, note }) => controller.answerTeamProposal(proposalId, keeping, note),
  "assignment:stop": ({ assignmentId }) => controller.stopSpecialistWork(assignmentId),
  "assignment:resume": ({ assignmentId }) => controller.resumeSpecialistWork(assignmentId),
  "assignment:changeProvider": ({ assignmentId, provider, model }) => controller.changeAssignmentProvider(assignmentId, provider, model),
  "specialist:remove": ({ specialistId, reason }) => controller.removeSpecialistByPerson(specialistId, reason),
  "specialist:rename": ({ specialistId, name }) => controller.renameSpecialistByPerson(specialistId, name),
  "specialist:setColor": ({ specialistId, color }) => controller.setSpecialistColorByPerson(specialistId, color),
  "pactDemo:run": () => controller.runPactDemo(),
  "pactDemo:approve": () => controller.approvePactDemo(),
  "candidate:approve": ({ candidateId }) => controller.approveCandidateByPerson(candidateId),
  "candidate:focusAudit": async ({ candidateId }) => controller.startFocusAudit(candidateId),
  "candidate:publish": ({ candidateId }) => controller.publishCandidateByPerson(candidateId),
  "codex:refresh": () => controller.refreshCodex(),
  "codex:login": () => controller.login(),
  "skills:rollback": () => controller.rollbackSkills(),
  "practice:change": ({ action, id, reason }) => controller.changePractice(action, id, reason ?? ""),
  "learning:memory": async (input) => controller.editLearnedMemory(input),
  "learning:proposal": async ({ id, approve }) => controller.resolveLearningProposal(id, approve),
  "learning:skill": async (input) => controller.changeLearnedSkill(input),
  "learning:skillContent": ({ name }) => controller.learnedSkillContent(name),
  "learning:review": ({ focus }) => controller.reviewLearningNow(focus),
  "learning:curator": ({ action, backupId }) => controller.curatorAction(action, backupId ?? null),
  "assignment:removeWorktree": ({ assignmentId }) => controller.removeAssignmentWorktree(assignmentId),
  "plan:cancel": async ({ planId }) => controller.cancelPlan(planId),
  "plan:edit": async (input) => controller.editPlan(input),
  "plan:answerSeams": async (input) => controller.answerSeams(input),
  "plan:answerSlices": (input) => controller.answerSlices(input),
  "plan:slice": async ({ planId }) => controller.slicePlan(planId),
  "plan:publishSlices": ({ planId }) => controller.publishPlanSlices(planId),
  "plan:publish": ({ planId }) => controller.publishPlanSpec(planId),
  "candidate:previewPullRequest": async ({ candidateId }) => controller.previewPullRequest(candidateId),
  "providers:refresh": ({ provider }) => (provider ? controller.refreshProvider(provider) : controller.refreshProviders()),
  "provider:login": ({ provider }) => controller.loginProvider(provider),
  "github:refresh": () => controller.refreshGitHub(),
  "github:createIssue": ({ title, body }) => controller.createGitHubIssue(title, body),
  "presence:consent": ({ share, proposal }) => controller.setPresenceConsent(share, proposal ?? null),
  "route:answer": ({ routeId, start }) => controller.answerRoute(routeId, start),
  "presence:pause": ({ paused }) => controller.pausePresence(paused),
  "presence:refresh": () => controller.refreshPresence(),
  "presence:commentPullRequest": ({ number, body }) => controller.commentColleaguePullRequest(number, body),
  "settings:update": (update) => controller.updateSettings(update),
  "monitor:update": (update) => controller.updateMonitor(update),
  "monitor:poll": () => controller.pollMonitor(),
  "skills:prepare": () => controller.prepareSkills(),
  "app:dismissError": () => controller.dismissError(),
  "onboarding:update": (update) => controller.updateOnboarding(update),
  "onboarding:checkGitHub": () => controller.checkGitHubCli(),
  "exercise:start": ({ exercise }) => controller.startExercise(exercise),
  "exercise:observe": ({ step }) => controller.observeExercise(step),
  "exercise:simulateRemoteChanges": () => controller.simulateRemoteChanges(),
  "shell:openExternal": async ({ url }) => {
    if (/^https:\/\//.test(url)) await shell.openExternal(url);
  },
};

ipcMain.handle("trama:state", () => controller.snapshot);
ipcMain.handle("trama:action", async (_event, action: ActionName, payload: unknown) => {
  const handler = handlers[action] as Handler<ActionName> | undefined;
  if (!handler) throw new Error(`Unknown action ${action}`);
  return handler(payload as never);
});

function sendMenu(command: string): void {
  window?.webContents.send("trama:menu", command);
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Trama",
            submenu: [
              { role: "about" as const, label: "Informazioni su Trama" },
              { type: "separator" as const },
              { label: "Impostazioni…", accelerator: "CmdOrCtrl+,", click: () => sendMenu("settings") },
              { type: "separator" as const },
              { role: "hide" as const, label: "Nascondi Trama" },
              { role: "hideOthers" as const, label: "Nascondi altre" },
              { role: "unhide" as const, label: "Mostra tutte" },
              { type: "separator" as const },
              { role: "quit" as const, label: "Esci da Trama" },
            ],
          },
        ]
      : []),
    {
      label: "Archivio",
      submenu: [
        { label: "Apri progetto…", accelerator: "CmdOrCtrl+O", click: () => void handlers["project:openDialog"]() },
        { label: "Apri progetto di esempio", click: () => void controller.openDemo().catch(() => undefined) },
        { label: "Crea un progetto…", click: () => sendMenu("createProject") },
        { type: "separator" },
        // Through the window, so the menu item confirms the rescan like the header button does (W12).
        { label: "Aggiorna progetto", accelerator: "CmdOrCtrl+R", click: () => sendMenu("refreshProject") },
        ...(isMac ? [] : [{ type: "separator" as const }, { label: "Impostazioni…", accelerator: "CmdOrCtrl+,", click: () => sendMenu("settings") }]),
        ...(isMac ? [{ role: "close" as const, label: "Chiudi finestra" }] : [{ role: "quit" as const, label: "Esci" }]),
      ],
    },
    {
      label: "Composizione",
      submenu: [
        { role: "undo", label: "Annulla" },
        { role: "redo", label: "Ripeti" },
        { type: "separator" },
        { role: "cut", label: "Taglia" },
        { role: "copy", label: "Copia" },
        { role: "paste", label: "Incolla" },
        { role: "selectAll", label: "Seleziona tutto" },
      ],
    },
    {
      label: "Vista",
      submenu: [
        { label: "Scrivi al Coordinatore", accelerator: "CmdOrCtrl+L", click: () => sendMenu("focusComposer") },
        { label: "Mostra o nascondi la barra laterale", accelerator: "CmdOrCtrl+B", click: () => sendMenu("toggleSidebar") },
        { label: "Mostra dettagli", accelerator: "Alt+CmdOrCtrl+I", click: () => sendMenu("toggleInspector") },
        { type: "separator" },
        { label: "Mappa", accelerator: "CmdOrCtrl+1", click: () => sendMenu("inspector:map") },
        { label: "Patto", accelerator: "CmdOrCtrl+2", click: () => sendMenu("inspector:pact") },
        { label: "Mandato", accelerator: "CmdOrCtrl+3", click: () => sendMenu("inspector:mandate") },
        { label: "Issue", accelerator: "CmdOrCtrl+4", click: () => sendMenu("inspector:issues") },
        { label: "Team", accelerator: "CmdOrCtrl+5", click: () => sendMenu("inspector:team") },
        { label: "Lavoro", accelerator: "CmdOrCtrl+6", click: () => sendMenu("inspector:work") },
        { label: "Gruppo", accelerator: "CmdOrCtrl+7", click: () => sendMenu("inspector:group") },
        { label: "Memoria", accelerator: "CmdOrCtrl+8", click: () => sendMenu("inspector:memory") },
        { type: "separator" },
        { role: "resetZoom", label: "Dimensione reale" },
        { role: "zoomIn", label: "Ingrandisci" },
        { role: "zoomOut", label: "Riduci" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Schermo intero" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const, label: "Strumenti per sviluppatori" }]),
      ],
    },
    { role: "windowMenu", label: "Finestra" },
    {
      role: "help",
      label: "Aiuto",
      submenu: [
        { label: "Guida introduttiva", click: () => sendMenu("guide") },
        { label: "Esercizi sul progetto di esempio", click: () => sendMenu("exercises") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Started by the login item: stay in the background with the monitor until the person opens the window.
const startedHidden = process.argv.includes("--hidden") || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);

app.on("second-instance", () => {
  if (!window) createWindow();
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

app.whenReady().then(async () => {
  buildMenu();
  if (!startedHidden) createWindow();
  await controller.start();
  // After sleep the monitor's timer and the providers' state are stale: check again at once.
  powerMonitor.on("resume", () => {
    void controller.pollMonitor().catch(() => undefined);
    void controller.refreshCodex();
    void controller.refreshProviders();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

nativeTheme.on("updated", () => {
  if (!isMac && !isGlassWindows) window?.setBackgroundColor(surfaceColor());
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void controller.stop().finally(() => app.quit());
});
