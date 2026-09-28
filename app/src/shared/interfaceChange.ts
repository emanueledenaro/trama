/**
 * Candidates that change the interface (issue #247, Q9): Trama recognizes them from the files they touch, with its own
 * rules and never with a model's judgement. Such a candidate does not merge by itself with the Coordinator's green
 * light: it waits for the person in "Aspetta te" with the screenshots before and after, in light and dark. Pure.
 */

/** Extensions of files that draw the interface: components, markup, styles, templates. */
const INTERFACE_EXTENSIONS = [
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".xib",
  ".storyboard",
];

/** Folders whose files are the interface whatever their extension: views, components, screens, styles, UI assets. */
const INTERFACE_FOLDERS = ["components", "views", "view", "screens", "pages", "layouts", "styles", "ui", "renderer", "public", "assets", "theme", "themes"];

/** Image and font files the interface shows. */
const INTERFACE_ASSETS = [".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf"];

/** Configuration files of the interface's look: design tokens and style tools. */
const INTERFACE_CONFIG = /^(tailwind|postcss|uno|windi)\.config\.[cm]?[jt]s$/;

/** Tests, stories of tests and snapshots describe the interface without changing it. */
const TEST_FILE = /(^|\/)(__tests__|__snapshots__|tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.snap$/;

/** Swift sources the interface is made of: SwiftUI views by name or by folder. */
const SWIFT_VIEW = /(View|Screen|Sheet|Cell)\.swift$/;

/** Whether one path draws the interface. */
export function isInterfaceFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || TEST_FILE.test(normalized)) return false;
  const parts = normalized.split("/");
  const name = parts.at(-1)!.toLowerCase();
  if (INTERFACE_CONFIG.test(name)) return true;
  if (INTERFACE_EXTENSIONS.some((extension) => name.endsWith(extension))) return true;
  if (SWIFT_VIEW.test(parts.at(-1)!)) return true;
  const folders = parts.slice(0, -1).map((p) => p.toLowerCase());
  const inInterfaceFolder = folders.some((folder) => INTERFACE_FOLDERS.includes(folder));
  // Documentation and data under a folder named like the interface are not drawn.
  if (inInterfaceFolder && !/\.(md|mdx|txt|json|ya?ml)$/.test(name)) return true;
  return INTERFACE_ASSETS.some((extension) => name.endsWith(extension)) && !folders.includes("docs");
}

/** The files of a candidate that change the interface, in their order. */
export const interfaceFiles = (changedFiles: string[]): string[] => changedFiles.filter(isInterfaceFile);

/** Whether a candidate changes the interface: at least one of its files draws it. */
export const touchesInterface = (changedFiles: string[]): boolean => changedFiles.some(isInterfaceFile);
