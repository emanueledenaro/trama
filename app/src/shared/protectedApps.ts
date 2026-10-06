/**
 * The apps the Operator never controls on the screen (issue #597): Trama itself, the windows that grant permissions to
 * apps, and the password managers. No consent is asked and none is recorded for them, a consent saved before is
 * ignored, and no click, key, text or reading goes to them. The list lives here and nowhere else. Pure.
 */

/** What is known about an app: its name, and when the driver can tell it, its bundle id and the process behind it. */
export interface AppIdentity {
  name: string;
  bundleId?: string | null;
  pid?: number | null;
}

/** Trama's own process, as the main process knows it: the Electron executable has other names in development. */
export interface SelfIdentity {
  /** The pid of the app and of the processes that descend from it (helpers, renderers). */
  pids: readonly number[];
  /** Extra names the app answers to, besides the fixed ones. */
  names?: readonly string[];
}

export type ProtectedKind = "trama" | "system" | "passwords";

const key = (value: string): string => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The names Trama answers to: its own, and Electron, which is what a development run is called. */
const TRAMA_NAMES = ["trama", "electron"];
const TRAMA_BUNDLES = ["dev.trama.app", "com.github.electron"];

/** Settings, authorization windows and the keychain: the places where a permission is given. */
const SYSTEM_NAMES = [
  "system settings",
  "system preferences",
  "impostazioni di sistema",
  "preferenze di sistema",
  "securityagent",
  "security agent",
  "usernotificationcenter",
  "coreservicesuiagent",
  "universalaccessauthwarn",
  "keychain access",
  "accesso keychain",
  "accesso portachiavi",
];
const SYSTEM_BUNDLES = ["com.apple.systempreferences", "com.apple.securityagent", "com.apple.usernotificationcenter", "com.apple.coreservices.uiagent", "com.apple.universalaccessauthwarn", "com.apple.keychainaccess"];

const PASSWORD_NAMES = ["1password", "bitwarden", "lastpass", "dashlane", "keepass", "enpass", "nordpass", "keeper", "proton pass", "roboform", "strongbox", "passwords", "password", "secrets"];
const PASSWORD_BUNDLE_PARTS = ["1password", "agilebits", "bitwarden", "lastpass", "dashlane", "keepass", "enpass", "nordpass", "keepersecurity", "proton.pass", "roboform", "strongbox", "com.apple.passwords"];

/** Trama's own names include the helpers Electron starts ("Trama Helper (Renderer)", "Electron Helper"). */
function tramaName(name: string, extra: readonly string[]): boolean {
  const names = [...TRAMA_NAMES, ...extra.map(key)];
  return names.some((own) => name === own || name.startsWith(`${own} helper`) || name.startsWith(`${own} `));
}

/** Why an app is off limits, or null when it is not. Pure. */
export function protectedAppKind(app: AppIdentity, self?: SelfIdentity): ProtectedKind | null {
  const name = key(app.name ?? "");
  const bundle = (app.bundleId ?? "").trim().toLowerCase();
  if (app.pid != null && self?.pids.includes(app.pid)) return "trama";
  if (TRAMA_BUNDLES.includes(bundle) || bundle.startsWith("dev.trama.") || bundle.startsWith("com.github.electron.")) return "trama";
  if (name && tramaName(name, self?.names ?? [])) return "trama";
  if (SYSTEM_BUNDLES.includes(bundle) || (name && SYSTEM_NAMES.some((own) => name === own || name.startsWith(`${own} `)))) return "system";
  if (PASSWORD_BUNDLE_PARTS.some((part) => bundle.includes(part)) || (name && PASSWORD_NAMES.some((own) => name === own || name.startsWith(`${own} `) || (own.length > 6 && name.includes(own))))) return "passwords";
  return null;
}

/** The same check for a bare name, as a consent or a request carries it. */
export const protectedAppName = (name: string): ProtectedKind | null => protectedAppKind({ name });

/** The pids that descend from `root`, itself included, from the rows (pid, parent pid) of the process table. Pure. */
export function descendantPids(root: number, rows: readonly { pid: number; ppid: number }[]): number[] {
  const found = new Set<number>([root]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of rows) {
      if (found.has(row.ppid) && !found.has(row.pid)) {
        found.add(row.pid);
        changed = true;
      }
    }
  }
  return [...found];
}
