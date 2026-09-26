/**
 * Presence (G01, #174): who works on what in the team. Each person using Trama publishes, with consent, one small
 * record on the project's remote in `refs/trama/presence/<user>` (ADR 0015): active branch, local branches, the paths
 * of the files touched (never their content), the request in focus, since when, and the Trama agents at work.
 * These are the record's shape, its validation and the freshness rules, shared by the main process and the renderer.
 */

export const PRESENCE_REF_PREFIX = "refs/trama/presence/";
/** Decision 7: an update every 30-60 seconds; Trama uses 45. */
export const PRESENCE_INTERVAL_MS = 45_000;
/** Decision 7: "inattivo da N min" after 10 minutes without changes. */
export const PRESENCE_IDLE_MS = 10 * 60_000;
/** Without a heartbeat for this long, a record whose app did not close cleanly counts as closed. */
export const PRESENCE_STALE_MS = 3 * PRESENCE_INTERVAL_MS;
/** Decision 7: after 7 days the presence disappears; GitHub's branches stay. */
export const PRESENCE_EXPIRY_MS = 7 * 24 * 60 * 60_000;

export const MAXIMUM_PRESENCE_FILES = 200;
export const MAXIMUM_PRESENCE_BRANCHES = 50;
export const MAXIMUM_PRESENCE_AGENTS = 20;
export const MAXIMUM_PRESENCE_BYTES = 256 * 1024;
const MAXIMUM_TEXT = 200;

/** What a person, or one of their agents, is working on. */
export interface PresenceTask {
  kind: "goal" | "work" | "assignment";
  title: string;
}

/** A Trama agent of the person, in the same picture as people (decision 2). */
export interface PresenceAgent {
  id: string;
  name: string;
  /** The agent's color from the identity palette (W15). */
  color: string;
  tag: string;
  branch: string | null;
  files: string[];
  task: PresenceTask | null;
  since: string;
  lastActivityAt: string;
}

/** The record one person publishes; everything in it is safe to share: names, branches and paths only. */
export interface PresenceRecord {
  version: 1;
  /** The ref's last component: GitHub login, or a slug of the git e-mail on other remotes. */
  user: string;
  name: string;
  /** Decision 8: the branch of the request in focus in Trama, otherwise the one changed last. */
  activeBranch: string | null;
  /** The other branches changed in the last days: "anche su". */
  alsoOn: string[];
  localBranches: string[];
  /** Paths touched on the active branch, relative to the repository root. Never contents. */
  files: string[];
  task: PresenceTask | null;
  /** Since when the person is on this branch and task. */
  since: string;
  /** The last change the person made: a file, a commit, a branch switch. */
  lastActivityAt: string;
  /** The heartbeat, rewritten at every publication. */
  updatedAt: string;
  /** Set when Trama closes or the person pauses: "visto l'ultima volta". */
  closedAt: string | null;
  agents: PresenceAgent[];
}

export type PresenceStatus = "active" | "idle" | "offline" | "expired";

export interface PresenceFreshness {
  status: PresenceStatus;
  /** Minutes without changes, when idle. */
  idleMinutes: number | null;
  /** When the person was last seen, when offline. */
  lastSeenAt: string | null;
}

/** A person in the picture, with the freshness computed when Trama read it. */
export interface PresenceEntry extends PresenceFreshness {
  record: PresenceRecord;
  /** This is the person using Trama here. */
  self: boolean;
}

/** The person's answer for this project (decision 6). Absent until Trama first proposes it. */
export interface PresenceConsent {
  /** null while no answer was given. */
  choice: "shared" | "declined" | null;
  paused: boolean;
  /** The proposal waiting for an answer in the chat. */
  pending: PresenceProposal | null;
  proposedAt: string | null;
  /** The one second proposal, after a conflict the presence would have shown earlier. */
  reproposedAt: string | null;
  decidedAt: string | null;
  /** The answer given to each proposal, shown on its card. */
  answers: Partial<Record<PresenceProposal, "shared" | "declined">>;
}

export type PresenceProposal = "initial" | "conflict";

/** How the project's presence travels. */
export type PresenceMode =
  /** No remote: only the person and their agents. */
  | "local"
  /** The person shares and reads. */
  | "shared"
  /** The person reads the others without sharing: no consent, paused, or no push permission. */
  | "readOnly";

/** The presence of the open project, computed by the main process. */
export interface PresenceView {
  mode: PresenceMode;
  consent: PresenceConsent | null;
  /** The remote accepts this person's record; false with read access only. Null when unknown. */
  canShare: boolean | null;
  /** Why sharing or reading does not work now, in words for the person. */
  message: string | null;
  /** The person and their agents, from local data; never null once read. */
  self: PresenceEntry | null;
  /** The colleagues, fresh ones first; expired records are left out. */
  others: PresenceEntry[];
  refreshedAt: string | null;
  /** When Trama last published this person's record. */
  publishedAt: string | null;
}

export function emptyConsent(): PresenceConsent {
  return { choice: null, paused: false, pending: null, proposedAt: null, reproposedAt: null, decidedAt: null, answers: {} };
}

/** A valid last component for `refs/trama/presence/<user>`: lowercase letters, digits, dots, dashes, underscores. */
export function presenceUser(identity: string): string | null {
  const slug = identity
    .trim()
    .toLowerCase()
    .replace(/@/g, "-at-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.lock$/, "")
    .slice(0, 80);
  return slug ? slug : null;
}

export function presenceRef(user: string): string {
  return `${PRESENCE_REF_PREFIX}${user}`;
}

/** Decision 7: active while changes are recent, idle after 10 minutes, offline once closed, gone after 7 days. */
export function presenceFreshness(record: PresenceRecord, now: Date): PresenceFreshness {
  const time = now.getTime();
  const updated = Date.parse(record.updatedAt);
  const closed = record.closedAt ? Date.parse(record.closedAt) : null;
  const lastSeen = closed ?? updated;
  if (time - lastSeen > PRESENCE_EXPIRY_MS) return { status: "expired", idleMinutes: null, lastSeenAt: new Date(lastSeen).toISOString() };
  if (closed !== null || time - updated > PRESENCE_STALE_MS) return { status: "offline", idleMinutes: null, lastSeenAt: new Date(lastSeen).toISOString() };
  const quiet = time - Date.parse(record.lastActivityAt);
  if (quiet >= PRESENCE_IDLE_MS) return { status: "idle", idleMinutes: Math.floor(quiet / 60_000), lastSeenAt: null };
  return { status: "active", idleMinutes: null, lastSeenAt: null };
}

/** The freshness in words, as the Gruppo view shows it. */
export function freshnessLabel(entry: PresenceFreshness, now: Date): string {
  if (entry.status === "idle") return `inattivo da ${entry.idleMinutes} min`;
  if (entry.status === "offline" || entry.status === "expired") return `visto l'ultima volta ${relativeAgo(entry.lastSeenAt, now)}`;
  return "attivo ora";
}

function relativeAgo(iso: string | null, now: Date): string {
  if (!iso) return "tempo fa";
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "un'ora fa" : `${hours} ore fa`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ieri" : `${days} giorni fa`;
}

export interface BranchActivity {
  name: string;
  /** The last change on the branch: its last commit, or a file changed in the checkout. */
  lastChangeAt: string;
}

/**
 * Decision 8: the active branch is the branch of the request in focus in Trama; otherwise the branch changed last.
 * The other branches changed within the presence's lifetime are "anche su".
 */
export function chooseActiveBranch(input: { focusBranch: string | null; branches: BranchActivity[]; now: Date }): { active: string | null; alsoOn: string[] } {
  const recent = [...input.branches]
    .filter((b) => input.now.getTime() - Date.parse(b.lastChangeAt) <= PRESENCE_EXPIRY_MS)
    .sort((a, b) => Date.parse(b.lastChangeAt) - Date.parse(a.lastChangeAt) || a.name.localeCompare(b.name));
  const focus = input.focusBranch && input.branches.some((b) => b.name === input.focusBranch) ? input.focusBranch : null;
  const active = focus ?? recent[0]?.name ?? input.branches[0]?.name ?? null;
  return { active, alsoOn: recent.map((b) => b.name).filter((name) => name !== active).slice(0, 10) };
}

/** Paths that may name a secret are never shared, not even as a path. */
export function isShareablePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\0")) return false;
  const components = path.split("/");
  if (components.some((c) => c === "" || c === "." || c === "..")) return false;
  return !components.some((component) => {
    const lower = component.toLowerCase();
    if (lower.includes("secret") || lower.includes("credential") || lower.startsWith(".env")) return true;
    return lower.endsWith(".pem") || lower.endsWith(".key") || lower.endsWith(".p12");
  });
}

const text = (value: unknown, limit = MAXIMUM_TEXT): string | null => (typeof value === "string" ? value.slice(0, limit) : null);
const time = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);
const strings = (value: unknown, limit: number, keep: (s: string) => boolean = () => true): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 400 && keep(v)).slice(0, limit) : [];
const isBranchName = (name: string) => name.length > 0 && name.length <= 250 && !/[\0\s~^:?*[\\]/.test(name) && !name.includes("..");

function parseTask(value: unknown): PresenceTask | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title);
  if (!title || !["goal", "work", "assignment"].includes(raw.kind as string)) return null;
  return { kind: raw.kind as PresenceTask["kind"], title };
}

/**
 * Reads a colleague's record, which is untrusted data: wrong shapes are refused, texts and lists are cut to their
 * limits, and paths that are not plain relative paths are dropped.
 */
export function parsePresenceRecord(value: unknown, expectedUser: string): PresenceRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const updatedAt = time(raw.updatedAt);
  if (raw.version !== 1 || raw.user !== expectedUser || !updatedAt) return null;
  const agents: PresenceAgent[] = [];
  for (const entry of Array.isArray(raw.agents) ? raw.agents.slice(0, MAXIMUM_PRESENCE_AGENTS) : []) {
    if (!entry || typeof entry !== "object") continue;
    const agent = entry as Record<string, unknown>;
    const id = text(agent.id, 80);
    const name = text(agent.name, 80);
    const since = time(agent.since);
    if (!id || !name || !since) continue;
    const branch = text(agent.branch, 250);
    agents.push({
      id,
      name,
      color: text(agent.color, 20) ?? "blue",
      tag: text(agent.tag, 40) ?? "",
      branch: branch && isBranchName(branch) ? branch : null,
      files: strings(agent.files, MAXIMUM_PRESENCE_FILES, isShareablePath),
      task: parseTask(agent.task),
      since,
      lastActivityAt: time(agent.lastActivityAt) ?? since,
    });
  }
  const activeBranch = text(raw.activeBranch, 250);
  return {
    version: 1,
    user: expectedUser,
    name: text(raw.name, 80) || expectedUser,
    activeBranch: activeBranch && isBranchName(activeBranch) ? activeBranch : null,
    alsoOn: strings(raw.alsoOn, MAXIMUM_PRESENCE_BRANCHES, isBranchName),
    localBranches: strings(raw.localBranches, MAXIMUM_PRESENCE_BRANCHES, isBranchName),
    files: strings(raw.files, MAXIMUM_PRESENCE_FILES, isShareablePath),
    task: parseTask(raw.task),
    since: time(raw.since) ?? updatedAt,
    lastActivityAt: time(raw.lastActivityAt) ?? updatedAt,
    updatedAt,
    closedAt: time(raw.closedAt),
    agents,
  };
}

/**
 * A paused or closed record keeps only who and when: no branch, file or task stays on the remote while the person
 * is away or has paused.
 */
export function closedRecord(record: PresenceRecord, now: Date): PresenceRecord {
  return { ...record, activeBranch: null, alsoOn: [], localBranches: [], files: [], task: null, agents: [], updatedAt: now.toISOString(), closedAt: now.toISOString() };
}

/** The picture of the others: fresh ones first, expired ones left out. */
export function presenceEntries(records: PresenceRecord[], selfUser: string | null, now: Date): PresenceEntry[] {
  const order: Record<PresenceStatus, number> = { active: 0, idle: 1, offline: 2, expired: 3 };
  return records
    .filter((r) => r.user !== selfUser)
    .map((record) => ({ record, self: false, ...presenceFreshness(record, now) }))
    .filter((entry) => entry.status !== "expired")
    .sort((a, b) => order[a.status] - order[b.status] || Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt));
}

/** Decision 6: Trama proposes once, when the project has other collaborators and the person never answered. */
export function shouldProposeConsent(consent: PresenceConsent | null | undefined, hasCollaborators: boolean): boolean {
  return hasCollaborators && !consent?.proposedAt;
}

/** Decision 6: after a "Non ora", one more proposal only, at the first conflict sharing would have avoided. */
export function shouldReproposeConsent(consent: PresenceConsent | null | undefined, classification: "conflict" | "overlap" | "clean" | "unknown"): boolean {
  if (classification !== "conflict" && classification !== "overlap") return false;
  return consent?.choice === "declined" && !consent.reproposedAt && !consent.pending;
}

/** The mode follows from the remote, the consent and the push permission. */
export function presenceMode(input: { hasRemote: boolean; consent: PresenceConsent | null | undefined; canShare: boolean | null }): PresenceMode {
  if (!input.hasRemote) return "local";
  if (input.consent?.choice === "shared" && !input.consent.paused && input.canShare !== false) return "shared";
  return "readOnly";
}
