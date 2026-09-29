import { release } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, powerSaveBlocker, shell } from "electron";
import type { AppSettings } from "@shared/domain";
import type { Language } from "@shared/i18n";
import type { ActionMap, ActionName } from "@shared/ipc";
import { TramaController } from "./controller";
import { t } from "./core/personLanguage";
import { type MenuCommand, menuTemplate } from "./menu";

app.setName("Trama");
if (!app.requestSingleInstanceLock()) app.exit(0);
const isMac = process.platform === "darwin";
// Windows 11 paints Acrylic glass behind a transparent window; older Windows and Linux stay opaque.
const isGlassWindows = process.platform === "win32" && Number(release().split(".")[2] ?? 0) >= 22000;
const rendererUrl = process.env.TRAMA_RENDERER_URL;
let window: BrowserWindow | null = null;

// The Trama logo is the app's icon on every platform, also when Trama runs unpackaged (npm start, dev), where macOS
// would show Electron's icon in the Dock and Windows and Linux would show none on the window and in the taskbar.
const iconDirectory = app.isPackaged ? join(process.resourcesPath, "icons") : join(app.getAppPath(), "resources", "icons");
const windowIcon = process.platform === "win32" ? join(iconDirectory, "icon.ico") : join(iconDirectory, "png", "512x512.png");
// The third-party notices ship next to the app (electron-builder extraResources); unpackaged they are at the repository's root.
const noticesPath = app.isPackaged ? join(process.resourcesPath, "THIRD_PARTY_NOTICES.md") : join(app.getAppPath(), "..", "THIRD_PARTY_NOTICES.md");

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111111" : "#ffffff";
}

// The desktop app keeps its state in Trama/Desktop; the SwiftUI app's files in Trama are only read.
const legacyRoot = process.env.TRAMA_DATA_DIR ? (process.env.TRAMA_LEGACY_DIR ?? null) : join(app.getPath("appData"), "Trama");
/** The power save blocker the full delegation holds (issue #423), or null. */
let keepAwakeId: number | null = null;
/** How long the person stays away before Trama tells them what it did with the delegation; TRAMA_RETURN_AFTER_MS for checks. */
const RETURN_AFTER_MS = Number(process.env.TRAMA_RETURN_AFTER_MS ?? 30 * 60_000);

const controller = new TramaController(process.env.TRAMA_DATA_DIR ?? join(app.getPath("appData"), "Trama", "Desktop"), {
  publish: (state) => {
    window?.webContents.send("trama:state", state);
    // The menu speaks the language Trama speaks, and is built again when the person changes it (issue #345).
    if (app.isReady() && state.language !== menuLanguage) buildMenu(state.language);
  },
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
  // TRAMA_SYSTEM_LANGUAGE stands in for the system's language, so a check can start Trama in a known language.
  systemLanguages: () => {
    const override = process.env.TRAMA_SYSTEM_LANGUAGE;
    return override ? [override] : [...app.getPreferredSystemLanguages(), app.getLocale()];
  },
  // The full delegation keeps the computer awake while there is open work (issue #423); without it, the usual sleep.
  setKeepAwake: (awake) => {
    if (awake && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start("prevent-app-suspension");
    if (!awake && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
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
    ...(isMac ? {} : { icon: windowIcon }),
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
  // ready-to-show waits for the renderer's first paint, which a renderer without a GPU (xvfb in CI, issue #460) can
  // report late or never: the window would stay hidden. The page's finished load shows it too, whichever comes first.
  const reveal = () => {
    if (window && !window.isVisible()) window.show();
  };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", reveal);
  window.on("closed", () => {
    window = null;
  });
  window.on("focus", () => {
    void controller.refreshCodex();
    controller.personReturned(RETURN_AFTER_MS);
  });
  window.on("blur", () => controller.personAway());
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
    const path = await chooseFolder(t("main.dialog.openProject"));
    if (path) await controller.openProject(path);
  },
  "project:open": ({ path }) => controller.openProject(path),
  "project:openDemo": () => controller.openDemo(),
  "project:create": async ({ name, idea }) => {
    const parent = await chooseFolder(t("main.dialog.chooseFolder"));
    if (parent) await controller.createProject(parent, name, idea);
  },
  "project:clone": async ({ repository }) => {
    const parent = await chooseFolder(t("main.dialog.chooseCloneFolder"));
    if (parent) await controller.cloneProject(parent, repository);
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
  "coordinator:pause": ({ paused }) => controller.pauseContinuousWork(paused),
  "coordinator:recap": ({ goalId }) => controller.recap(null, goalId ?? null),
  "coordinator:retry": () => controller.startCoordinator(),
  "coordinator:retryRequest": ({ requestId }) => controller.retryRequest(requestId),
  "coordinator:stopRetry": () => controller.stopProviderRetry(),
  "coordinator:selectModel": ({ model, effort, provider }) => controller.selectModel(model, effort, provider ?? null),
  "coordinator:setFastMode": ({ enabled }) => controller.setFastMode(enabled),
  "coordinator:selectProvider": ({ provider }) => controller.selectProvider(provider),
  "coordinator:saveDraft": ({ text, projectId }) => controller.saveDraft(text, projectId ?? null),
  "coordinator:deleteQueued": async ({ id }) => controller.deleteQueuedMessage(id),
  "goal:create": (input) => controller.createGoal(input),
  "goal:update": ({ id, ...change }) => controller.updateGoal(id, change),
  "goal:archive": ({ id, archived }) => controller.archiveGoal(id, archived),
  "goal:delete": ({ id }) => controller.deleteGoal(id),
  "focus:change": ({ action, taskId }) => controller.changeFocus(action, taskId),
  "candidate:observeExample": (input) => controller.observeExample(input),
  "overview:read": () => controller.projectsOverview(),
  "overview:prioritize": ({ projectId, direction }) => controller.prioritizeProject(projectId, direction),
  "coordinator:setContextThreshold": ({ percent }) => controller.setContextThreshold(percent),
  "coordinator:reorderContext": () => controller.reorderContext(),
  "pact:decide": (input) => controller.recordDecision(input),
  "decision:answer": ({ requestId, alternativeIndex, freeText }) => controller.answerDecision(requestId, alternativeIndex, freeText),
  "decision:withdraw": ({ requestId, reason }) => controller.withdrawDecision(requestId, reason),
  "discussion:write": ({ threadId, text }) => controller.writeInDiscussion(threadId, text),
  "mandate:grant": (input) => controller.grantMandate(input),
  "mandate:revoke": ({ reason }) => controller.revokeMandate(reason),
  "mandate:restrict": (input) => controller.restrictMandate(input),
  "fixedBan:acknowledge": ({ id }) => controller.acknowledgeFixedBan(id),
  "requestedAction:confirm": ({ id }) => controller.confirmRequestedAction(id),
  "requestedAction:decline": ({ id }) => controller.declineRequestedAction(id),
  "delegation:revoke": () => controller.revokeDelegation(),
  "delegation:seen": ({ id }) => controller.markDelegatedChoiceSeen(id),
  "mandate:reject": ({ requestId, reason }) => controller.rejectMandateRequest(requestId, reason),
  "autonomousStep:correct": ({ stepId, note }) => controller.correctAutonomousStep(stepId, note),
  "team:answer": ({ proposalId, keeping, note }) => controller.answerTeamProposal(proposalId, keeping, note),
  "assignment:stop": ({ assignmentId }) => controller.stopSpecialistWork(assignmentId),
  "assignment:resume": ({ assignmentId }) => controller.resumeSpecialistWork(assignmentId),
  "assignment:place": ({ assignmentId, where }) => controller.moveAssignmentPlace(assignmentId, where),
  "assignment:cloudCheck": ({ assignmentId }) => controller.checkCloudSession(assignmentId),
  "assignment:changeProvider": ({ assignmentId, provider, model }) => controller.changeAssignmentProvider(assignmentId, provider, model),
  "specialist:remove": ({ specialistId, reason }) => controller.removeSpecialistByPerson(specialistId, reason),
  "squad:rename": ({ squadId, name }) => controller.renameSquadByPerson(squadId, name),
  "squad:merge": ({ intoId, fromId, keepIds }) => controller.mergeSquadsByPerson(intoId, fromId, keepIds),
  "squad:split": ({ squadId, moduleIds, developerIds, name }) => controller.splitSquadByPerson(squadId, moduleIds, developerIds, name),
  "squad:undo": ({ changeId }) => controller.undoSquadChangeByPerson(changeId),
  "squad:confirmMerge": ({ proposalId, keepIds }) => controller.confirmSquadMergeByPerson(proposalId, keepIds),
  "squad:dismissMerge": ({ proposalId }) => controller.dismissSquadMergeByPerson(proposalId),
  "specialist:rename": ({ specialistId, name }) => controller.renameSpecialistByPerson(specialistId, name),
  "backlog:move": ({ squadId, key, to }) => controller.moveBacklogItemByPerson(squadId, key, to),
  "backlog:release": ({ squadId, key }) => controller.releaseBacklogItemByPerson(squadId, key),
  "specialist:setColor": ({ specialistId, color }) => controller.setSpecialistColorByPerson(specialistId, color),
  "specialist:setModel": ({ specialistId, choice }) => controller.setSpecialistModelByPerson(specialistId, choice),
  "automaticWork:start": (request) => controller.startAutomaticWork(request),
  "pactDemo:run": () => controller.runPactDemo(),
  "pactDemo:approve": () => controller.approvePactDemo(),
  "candidate:approve": ({ candidateId }) => controller.approveCandidateByPerson(candidateId),
  "candidate:reject": ({ candidateId, note }) => controller.rejectCandidateByPerson(candidateId, note),
  "candidate:declineMerge": ({ candidateId }) => controller.declineMergeByPerson(candidateId),
  "candidate:shot": ({ candidateId, index }) => controller.interfaceShot(candidateId, index),
  "candidate:focusAudit": async ({ candidateId }) => controller.startFocusAudit(candidateId),
  "focusMode:open": ({ target, fixedPoint }) => controller.startScopedFocusAudit(target, fixedPoint),
  "focusMode:fixedPoints": () => controller.focusFixedPoints(),
  "focusMode:enter": async ({ auditId }) => controller.enterFocusMode(auditId),
  "focusMode:exit": async () => controller.exitFocusMode(),
  "finding:followUp": ({ auditId, findingId, kind }) => controller.followUpFinding(auditId, findingId, kind),
  "audit:publish": ({ auditId }) => controller.publishAuditReport(auditId),
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
  "candidate:previewPullRequest": ({ candidateId }) => controller.previewPullRequest(candidateId),
  "providers:refresh": ({ provider }) => (provider ? controller.refreshProvider(provider) : controller.refreshProviders()),
  "provider:login": ({ provider }) => controller.loginProvider(provider),
  "github:refresh": () => controller.refreshGitHub(),
  "github:createIssue": ({ title, body }) => controller.createGitHubIssue(title, body),
  "presence:consent": ({ share, proposal }) => controller.setPresenceConsent(share, proposal ?? null),
  "route:answer": ({ routeId, start }) => controller.answerRoute(routeId, start),
  "presence:pause": ({ paused }) => controller.pausePresence(paused),
  "presence:refresh": () => controller.refreshPresence(),
  "presence:commentPullRequest": ({ number, body }) => controller.commentColleaguePullRequest(number, body),
  "project:cleanCode": (change) => controller.updateCleanCode(change),
  "settings:update": (update) => controller.updateSettings(update),
  "project:settings": (update) => controller.updateProjectSettings(update),
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

function sendMenu(command: MenuCommand): void {
  window?.webContents.send("trama:menu", command);
}

let menuLanguage: Language | null = null;

function buildMenu(language: Language): void {
  menuLanguage = language;
  const template = menuTemplate({
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    language,
    packaged: app.isPackaged,
    actions: {
      send: sendMenu,
      openProject: () => void Promise.resolve(handlers["project:openDialog"]()).catch(() => undefined),
      openDemo: () => void controller.openDemo().catch(() => undefined),
      openExternal: (url) => void shell.openExternal(url),
      openNotices: () => void shell.openPath(noticesPath),
    },
  });
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
  // A packaged app takes its Dock icon from the bundle; unpackaged, Electron's own icon would show.
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(iconDirectory, "png", "1024x1024.png"));
  // macOS shows its own panel for Informazioni su Trama: the version, and the build's commit in brackets.
  app.setAboutPanelOptions({
    applicationName: "Trama",
    applicationVersion: app.getVersion(),
    ...(__TRAMA_COMMIT__ ? { version: __TRAMA_COMMIT__ } : {}),
  });
  buildMenu(menuLanguage ?? controller.snapshot.language);
  if (!startedHidden) createWindow();
  await controller.start();
  // After sleep the monitor's timer and the providers' state are stale: check again at once.
  powerMonitor.on("resume", () => {
    void controller.pollMonitor().catch(() => undefined);
    void controller.refreshCodex();
    void controller.refreshProviders();
    controller.resumeAfterSleep();
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
