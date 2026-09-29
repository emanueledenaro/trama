// The application menu (issue #345, ADR 0018): on macOS as the native apps and VS Code lay it out, on Windows and
// Linux with their own section names and order. The View menu leads to the views of the activity bar. The labels
// come from the language catalogs, so the menu follows the language the person chose.
import type { MenuItemConstructorOptions } from "electron";
import { type Language, type MessageKey, translator } from "@shared/i18n";

export type MenuPlatform = "darwin" | "win32" | "linux";

/** The views of the activity bar the View menu opens, in the bar's order: the conversation with the Coordinator, then
 * the views of the side bar (see `SideBarView` in the renderer). Their items carry the command as id, so a check can
 * find them whatever the language. */
export const MENU_VIEWS = ["conversation", "waiting", "work", "teams", "rules", "memory"] as const;

/** What a menu item asks the window to do; the renderer handles each command in `App.tsx`. */
export type MenuCommand =
  | "settings"
  | "about"
  | "createProject"
  | "refreshProject"
  | "focusComposer"
  | "toggleSidebar"
  | "togglePanel"
  | "toggleSplitEditor"
  | "welcome"
  | "exercises"
  | `view:${(typeof MENU_VIEWS)[number] | "projects"}`;

export const MENU_COMMANDS: MenuCommand[] = [
  "settings",
  "about",
  "createProject",
  "refreshProject",
  "focusComposer",
  "toggleSidebar",
  "togglePanel",
  "toggleSplitEditor",
  "welcome",
  "exercises",
  "view:projects",
  ...MENU_VIEWS.map((view) => `view:${view}` as const),
];

export const DOCUMENTATION_URL = "https://github.com/emanueledenaro/trama#readme";
export const REPORT_ISSUE_URL = "https://github.com/emanueledenaro/trama/issues/new/choose";

export interface MenuActions {
  /** Sends a command to the window. */
  send(command: MenuCommand): void;
  openProject(): void;
  openDemo(): void;
  openExternal(url: string): void;
  /** Opens the third-party notices shipped with Trama. */
  openNotices(): void;
}

export interface MenuOptions {
  platform: MenuPlatform;
  language: Language;
  /** A packaged app has no developer tools in the menu. */
  packaged: boolean;
  actions: MenuActions;
}

const VIEW_KEYS: Record<(typeof MENU_VIEWS)[number], MessageKey> = {
  conversation: "workbench.view.conversation",
  waiting: "workbench.view.waiting",
  work: "workbench.view.work",
  teams: "workbench.view.teams",
  rules: "workbench.view.rules",
  memory: "workbench.view.memory",
};

const separator: MenuItemConstructorOptions = { type: "separator" };

/** The menu template for a platform and a language. */
export function menuTemplate({ platform, language, packaged, actions }: MenuOptions): MenuItemConstructorOptions[] {
  const t = translator(language);
  const isMac = platform === "darwin";
  // Windows and Linux underline a letter of each section for Alt; macOS has no such keys.
  const section = (mac: MessageKey, other: MessageKey) => t(isMac ? mac : other);
  const send = (command: MenuCommand) => () => actions.send(command);
  const settings: MenuItemConstructorOptions = { id: "settings", label: t("menu.settings"), accelerator: "CmdOrCtrl+,", click: send("settings") };
  // macOS shows its own About panel; Windows and Linux have none, so there it opens the About of the settings.
  const about: MenuItemConstructorOptions = isMac
    ? { id: "about", role: "about", label: t("menu.about") }
    : { id: "about", label: t("menu.about"), click: send("about") };

  const appMenu: MenuItemConstructorOptions = {
    label: "Trama",
    submenu: [
      about,
      separator,
      settings,
      separator,
      { role: "services", label: t("menu.services") },
      separator,
      { role: "hide", label: t("menu.hide") },
      { role: "hideOthers", label: t("menu.hideOthers") },
      { role: "unhide", label: t("menu.showAll") },
      separator,
      { role: "quit", label: t("menu.quit") },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: section("menu.file", "menu.file.mnemonic"),
    submenu: [
      { label: t("menu.openProject"), accelerator: "CmdOrCtrl+O", click: () => actions.openProject() },
      { label: t("menu.openDemo"), click: () => actions.openDemo() },
      { label: t("menu.createProject"), click: send("createProject") },
      separator,
      // Through the window, so the menu item confirms the rescan like the title bar's button does (W12).
      { label: t("menu.refreshProject"), accelerator: "CmdOrCtrl+R", click: send("refreshProject") },
      ...(isMac
        ? [separator, { role: "close", label: t("menu.closeWindow") } satisfies MenuItemConstructorOptions]
        : [
            separator,
            { label: t("menu.preferences"), submenu: [settings] } satisfies MenuItemConstructorOptions,
            separator,
            { role: "quit", label: t("menu.exit") } satisfies MenuItemConstructorOptions,
          ]),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: section("menu.edit", "menu.edit.mnemonic"),
    submenu: [
      { role: "undo", label: t("menu.undo") },
      { role: "redo", label: t("menu.redo") },
      separator,
      { role: "cut", label: t("menu.cut") },
      { role: "copy", label: t("menu.copy") },
      { role: "paste", label: t("menu.paste") },
      ...(isMac ? [{ role: "pasteAndMatchStyle", label: t("menu.pasteAndMatchStyle") } satisfies MenuItemConstructorOptions] : []),
      { role: "delete", label: t("menu.delete") },
      separator,
      { role: "selectAll", label: t("menu.selectAll") },
      // macOS adds Emoji & Symbols and Start Dictation to this menu by itself.
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: section("menu.view", "menu.view.mnemonic"),
    submenu: [
      ...MENU_VIEWS.map(
        (view, index): MenuItemConstructorOptions => ({
          id: `view:${view}`,
          label: t(VIEW_KEYS[view]),
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: send(`view:${view}`),
        }),
      ),
      { id: "view:projects", label: t("workbench.view.projects"), click: send("view:projects") },
      separator,
      { id: "toggleSidebar", label: t("menu.toggleSidebar"), accelerator: "CmdOrCtrl+B", click: send("toggleSidebar") },
      { id: "togglePanel", label: t("menu.togglePanel"), accelerator: "CmdOrCtrl+J", click: send("togglePanel") },
      { id: "toggleSplitEditor", label: t("menu.toggleSplitEditor"), accelerator: "CmdOrCtrl+\\", click: send("toggleSplitEditor") },
      { id: "focusComposer", label: t("menu.focusComposer"), accelerator: "CmdOrCtrl+L", click: send("focusComposer") },
      separator,
      { role: "resetZoom", label: t("menu.resetZoom") },
      { role: "zoomIn", label: t("menu.zoomIn") },
      { role: "zoomOut", label: t("menu.zoomOut") },
      separator,
      { role: "togglefullscreen", label: t("menu.fullScreen") },
      ...(packaged ? [] : [{ role: "toggleDevTools", label: t("menu.devTools") } satisfies MenuItemConstructorOptions]),
    ],
  };

  // On macOS the "window" role makes it the system's Window menu, which lists the open windows.
  const windowMenu: MenuItemConstructorOptions = isMac
    ? {
        role: "window",
        label: t("menu.window"),
        submenu: [{ role: "minimize", label: t("menu.minimize") }, { role: "zoom", label: t("menu.zoom") }, separator, { role: "front", label: t("menu.front") }],
      }
    : {
        label: t("menu.window.mnemonic"),
        submenu: [{ role: "minimize", label: t("menu.minimize.other") }, { role: "close", label: t("menu.closeWindow") }],
      };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    label: section("menu.help", "menu.help.mnemonic"),
    submenu: [
      // One way into the Benvenuto tab, with its setup steps, recent projects and exercises (issue #354).
      { label: t("menu.welcome"), click: send("welcome") },
      { label: t("menu.exercises"), click: send("exercises") },
      separator,
      { label: t("menu.documentation"), click: () => actions.openExternal(DOCUMENTATION_URL) },
      { label: t("menu.reportIssue"), click: () => actions.openExternal(REPORT_ISSUE_URL) },
      { label: t("menu.notices"), click: () => actions.openNotices() },
      // Windows and Linux keep About at the end of Help; macOS has it in the app menu.
      ...(isMac ? [] : [separator, about]),
    ],
  };

  return [...(isMac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
}
