import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { CATALOGS, type Language, LANGUAGES } from "@shared/i18n";
import { SIDE_BAR_VIEWS } from "@/lib/workbench";
import { DOCUMENTATION_URL, MENU_COMMANDS, type MenuCommand, type MenuPlatform, menuTemplate, REPORT_ISSUE_URL } from "./menu";

const PLATFORMS: MenuPlatform[] = ["darwin", "win32", "linux"];

function build(platform: MenuPlatform, language: Language, packaged = true) {
  const calls: string[] = [];
  const template = menuTemplate({
    platform,
    language,
    packaged,
    actions: {
      send: (command) => calls.push(`send:${command}`),
      openProject: () => calls.push("openProject"),
      openDemo: () => calls.push("openDemo"),
      openExternal: (url) => calls.push(`open:${url}`),
      openNotices: () => calls.push("openNotices"),
    },
  });
  return { template, calls };
}

const submenu = (item: MenuItemConstructorOptions) => (Array.isArray(item.submenu) ? item.submenu : []) as MenuItemConstructorOptions[];

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...items(submenu(item))]);
}

/** What a click does, recorded through the fake actions. */
function clickOf(item: MenuItemConstructorOptions, calls: string[]): string | null {
  if (!item.click) return null;
  calls.length = 0;
  (item.click as () => void)();
  return calls[0] ?? null;
}

/** The template as text, one line per item: what the PR prints for Windows and Linux. */
function outline(template: MenuItemConstructorOptions[], calls: string[], depth = 0): string[] {
  return template.flatMap((item) => {
    const pad = "  ".repeat(depth);
    if (item.type === "separator") return [`${pad}---`];
    const parts = [item.label ?? `(${item.role})`];
    if (item.role) parts.push(`role=${item.role}`);
    if (item.accelerator) parts.push(`[${String(item.accelerator)}]`);
    const click = clickOf(item, calls);
    if (click) parts.push(`-> ${click}`);
    return [`${pad}${parts.join(" ")}`, ...outline(submenu(item), calls, depth + 1)];
  });
}

describe("application menu (issue #345)", () => {
  it.each([
    ["darwin", "it", ["Trama", "Archivio", "Composizione", "Vista", "Finestra", "Aiuto"]],
    ["darwin", "en", ["Trama", "File", "Edit", "View", "Window", "Help"]],
    ["win32", "it", ["&File", "&Modifica", "&Visualizza", "F&inestra", "&Guida"]],
    ["win32", "en", ["&File", "&Edit", "&View", "&Window", "&Help"]],
    ["linux", "it", ["&File", "&Modifica", "&Visualizza", "F&inestra", "&Guida"]],
    ["linux", "en", ["&File", "&Edit", "&View", "&Window", "&Help"]],
  ] as const)("names the sections as %s expects in %s", (platform, language, sections) => {
    expect(build(platform, language).template.map((item) => item.label)).toEqual(sections);
  });

  it.each(PLATFORMS.flatMap((platform) => LANGUAGES.map((language) => [platform, language] as const)))(
    "takes every label on %s in %s from the catalog",
    (platform, language) => {
      const catalog = new Set(Object.values(CATALOGS[language]));
      for (const item of items(build(platform, language, false).template)) {
        if (item.type === "separator") continue;
        expect(item.label, JSON.stringify(item.role)).toBeTruthy();
        if (item.label !== "Trama") expect(catalog.has(item.label!), item.label).toBe(true);
      }
    },
  );

  it("builds the macOS app menu with the native roles and Settings", () => {
    const { template, calls } = build("darwin", "it");
    const appMenu = submenu(template[0]!);
    expect(appMenu.filter((item) => item.role).map((item) => item.role)).toEqual(["about", "services", "hide", "hideOthers", "unhide", "quit"]);
    const settings = appMenu.find((item) => item.label === "Impostazioni…")!;
    expect(settings.accelerator).toBe("CmdOrCtrl+,");
    expect(clickOf(settings, calls)).toBe("send:settings");
    expect(appMenu.map((item) => item.label).filter(Boolean)).toEqual([
      "Informazioni su Trama",
      "Impostazioni…",
      "Servizi",
      "Nascondi Trama",
      "Nascondi altre",
      "Mostra tutte",
      "Esci da Trama",
    ]);
  });

  it("gives the Edit menu the standard roles, with Paste and Match Style only on macOS", () => {
    const roles = (platform: MenuPlatform) =>
      submenu(build(platform, "en").template.find((item) => item.label === (platform === "darwin" ? "Edit" : "&Edit"))!)
        .filter((item) => item.role)
        .map((item) => item.role);
    expect(roles("darwin")).toEqual(["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"]);
    expect(roles("win32")).toEqual(["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"]);
    expect(roles("linux")).toEqual(roles("win32"));
  });

  it("puts Settings under File > Preferences on Windows and Linux, and Exit last", () => {
    for (const platform of ["win32", "linux"] as const) {
      const { template, calls } = build(platform, "it");
      const file = submenu(template[0]!);
      const preferences = file.find((item) => item.label === "Preferenze")!;
      const settings = submenu(preferences)[0]!;
      expect(settings.label).toBe("Impostazioni…");
      expect(settings.accelerator).toBe("CmdOrCtrl+,");
      expect(clickOf(settings, calls)).toBe("send:settings");
      expect(file.at(-1)).toMatchObject({ role: "quit", label: "Esci" });
      expect(template.some((item) => item.label === "Trama")).toBe(false);
    }
  });

  it("keeps About at the end of Help on Windows and Linux, and in the app menu on macOS", () => {
    for (const platform of ["win32", "linux"] as const) {
      const help = submenu(build(platform, "en").template.at(-1)!);
      expect(help.at(-1)).toMatchObject({ role: "about", label: "About Trama" });
    }
    const macHelp = submenu(build("darwin", "en").template.at(-1)!);
    expect(macHelp.some((item) => item.role === "about")).toBe(false);
  });

  it("leads the View menu to the views of the activity bar, with Cmd/Ctrl+1-5", () => {
    for (const platform of PLATFORMS) {
      const { template, calls } = build(platform, "it");
      const view = submenu(template.find((item) => item.label === "Vista" || item.label === "&Visualizza")!);
      const views = view.slice(0, 6).map((item) => [item.label, item.accelerator ?? null, clickOf(item, calls)]);
      expect(views).toEqual([
        ["Aspetta te", "CmdOrCtrl+1", "send:view:waiting"],
        ["Lavoro", "CmdOrCtrl+2", "send:view:work"],
        ["Squadre", "CmdOrCtrl+3", "send:view:teams"],
        ["Regole", "CmdOrCtrl+4", "send:view:rules"],
        ["Memoria", "CmdOrCtrl+5", "send:view:memory"],
        ["Progetti", null, "send:view:projects"],
      ]);
      const byLabel = (label: string) => view.find((item) => item.label === label)!;
      expect([byLabel("Mostra o nascondi la barra laterale").accelerator, clickOf(byLabel("Mostra o nascondi la barra laterale"), calls)]).toEqual(["CmdOrCtrl+B", "send:toggleSidebar"]);
      expect([byLabel("Mostra o nascondi il pannello Attività").accelerator, clickOf(byLabel("Mostra o nascondi il pannello Attività"), calls)]).toEqual(["CmdOrCtrl+J", "send:togglePanel"]);
      expect([byLabel("Scrivi al Coordinatore").accelerator, clickOf(byLabel("Scrivi al Coordinatore"), calls)]).toEqual(["CmdOrCtrl+L", "send:focusComposer"]);
      expect(view.filter((item) => item.role).map((item) => item.role)).toEqual(["resetZoom", "zoomIn", "zoomOut", "togglefullscreen"]);
    }
  });

  it("offers the developer tools only without a package", () => {
    const devTools = (packaged: boolean) => items(build("darwin", "en", packaged).template).some((item) => item.role === "toggleDevTools");
    expect(devTools(true)).toBe(false);
    expect(devTools(false)).toBe(true);
  });

  it("has no item for the views that the window no longer has", () => {
    const old = ["Mappa", "Patto", "Mandato", "Issue", "Team", "Gruppo", "Mostra dettagli", "Map", "Pact", "Mandate", "Issues", "Group", "Show details"];
    for (const platform of PLATFORMS) {
      for (const language of LANGUAGES) {
        const { template, calls } = build(platform, language, false);
        for (const item of items(template)) {
          expect(old).not.toContain(item.label);
          const click = clickOf(item, calls);
          if (click?.startsWith("send:")) expect(MENU_COMMANDS).toContain(click.slice("send:".length) as MenuCommand);
        }
      }
    }
    // Every view command is a view of the activity bar.
    for (const command of MENU_COMMANDS.filter((command) => command.startsWith("view:"))) {
      expect(SIDE_BAR_VIEWS).toContain(command.slice("view:".length));
    }
  });

  it("uses each shortcut once and leaves Cmd/Ctrl+K to the search", () => {
    for (const platform of PLATFORMS) {
      const accelerators = items(build(platform, "en", false).template)
        .map((item) => item.accelerator)
        .filter(Boolean);
      expect(new Set(accelerators).size).toBe(accelerators.length);
      expect(accelerators).not.toContain("CmdOrCtrl+K");
      // Cmd/Ctrl+0 belongs to the zoom role, and the page keeps Cmd/Ctrl+W, Q, H, M to the system.
      for (const reserved of ["CmdOrCtrl+0", "CmdOrCtrl+W", "CmdOrCtrl+Q", "CmdOrCtrl+H", "CmdOrCtrl+M"]) expect(accelerators).not.toContain(reserved);
    }
  });

  it("opens the documentation, the issue form and the third-party notices from Help", () => {
    const { template, calls } = build("win32", "en");
    const help = submenu(template.at(-1)!);
    const click = (label: string) => clickOf(help.find((item) => item.label === label)!, calls);
    expect(click("Documentation")).toBe(`open:${DOCUMENTATION_URL}`);
    expect(click("Report an Issue on GitHub")).toBe(`open:${REPORT_ISSUE_URL}`);
    expect(click("Third-Party Notices")).toBe("openNotices");
    expect(click("Welcome to Trama")).toBe("send:welcome");
    expect(click("Getting Started")).toBe("send:guide");
    expect(click("Exercises on the Example Project")).toBe("send:exercises");
  });

  it("makes the macOS Window menu the system's one", () => {
    const window = build("darwin", "it").template.find((item) => item.label === "Finestra")!;
    expect(window.role).toBe("window");
    expect(submenu(window).filter((item) => item.role).map((item) => item.role)).toEqual(["minimize", "zoom", "front"]);
    expect(build("darwin", "it").template.find((item) => item.label === "Aiuto")!.role).toBe("help");
  });

  it.each(PLATFORMS.flatMap((platform) => LANGUAGES.map((language) => [platform, language] as const)))("prints the template on %s in %s", (platform, language) => {
    const { template, calls } = build(platform, language);
    expect(outline(template, calls).join("\n")).toMatchSnapshot();
  });
});
