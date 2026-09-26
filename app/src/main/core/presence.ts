import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, watch } from "node:fs";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  type BranchActivity,
  chooseActiveBranch,
  closedRecord,
  isShareablePath,
  MAXIMUM_PRESENCE_AGENTS,
  MAXIMUM_PRESENCE_BRANCHES,
  MAXIMUM_PRESENCE_BYTES,
  MAXIMUM_PRESENCE_FILES,
  parsePresenceRecord,
  PRESENCE_INTERVAL_MS,
  PRESENCE_REF_PREFIX,
  type PresenceAgent,
  type PresenceConsent,
  presenceEntries,
  presenceFreshness,
  presenceMode,
  presenceRef,
  type PresenceRecord,
  type PresenceTask,
  presenceUser,
  type PresenceView,
} from "@shared/presence";
import { type RemoteSource, remoteTransport } from "./conflicts";
import { parseGitHubRemote } from "./github";
import { gitEnvironment, runProcess } from "./process";

/**
 * Presence via git (G01, ADR 0015). The record travels as a one-file commit (`presence.json`) force-pushed to
 * `refs/trama/presence/<user>` on the project's remote, from a bare cache in Trama's folder: the project's own
 * repository gets no new refs or objects. Only names, branches and paths are read and written, never file contents.
 */

const PRESENCE_FILE = "presence.json";
const LOCAL_SAFE_OPTIONS = ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0"];

/** Runs git on the project's checkout, read only. */
async function localGit(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  const result = await runProcess("git", ["-c", "credential.helper=", ...LOCAL_SAFE_OPTIONS, ...args], { cwd, env: gitEnvironment(true), timeoutMs: 15_000 });
  return { ok: result.exitCode === 0, stdout: result.stdout };
}

function remoteEnvironment(source: RemoteSource): NodeJS.ProcessEnv {
  if (source.kind !== "url") return { ...gitEnvironment(false), GIT_TERMINAL_PROMPT: "0" };
  // Any remote: the person's own git configuration, system included, keeps its credential helpers; nothing prompts.
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
  };
}

/** Runs git in the presence cache, reaching the remote through `source`. */
async function cacheGit(source: RemoteSource, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const { options } = remoteTransport(source);
  return runProcess("git", [...LOCAL_SAFE_OPTIONS, ...options, ...args], { cwd, env: { ...remoteEnvironment(source), ...env }, timeoutMs: 60_000 });
}

/** The project's `origin` as a presence remote; null without one, so the picture stays local. */
export async function resolvePresenceRemote(root: string): Promise<RemoteSource | null> {
  const result = await localGit(["remote", "get-url", "origin"], root);
  const url = result.stdout.trim();
  if (!result.ok || !url) return null;
  const repository = parseGitHubRemote(url);
  if (repository) return { kind: "github", repository };
  if (url.startsWith("file://")) return { kind: "local", path: decodeURIComponent(url.slice("file://".length)) };
  if (isAbsolute(url)) return { kind: "local", path: url };
  return { kind: "url", url };
}

/** The bare repository where Trama builds and fetches presence records for one project and remote. */
export async function presenceCache(cacheRoot: string, projectRoot: string, source: RemoteSource): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const root = await realpath(cacheRoot);
  const { url } = remoteTransport(source);
  const cache = join(root, `${createHash("sha256").update(`${url}\0${projectRoot}`).digest("hex").slice(0, 32)}.git`);
  if (!existsSync(join(cache, "HEAD"))) {
    const init = await runProcess("git", [...LOCAL_SAFE_OPTIONS, "init", "--quiet", "--bare", cache], { cwd: root, env: gitEnvironment(false) });
    if (init.exitCode !== 0) throw new Error(`Cache della presenza non creata: ${init.stderr.trim()}`);
  }
  return cache;
}

/** Writes the record as a commit with one file and returns its id. */
async function writeRecordCommit(cache: string, record: PresenceRecord): Promise<string> {
  const body = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(body) > MAXIMUM_PRESENCE_BYTES) throw new Error("Il record della presenza supera il limite.");
  const file = join(cache, "presence-record.json");
  const index = join(cache, "presence-index");
  await writeFile(file, body);
  await rm(index, { force: true });
  const env = { ...gitEnvironment(false), GIT_INDEX_FILE: index };
  const run = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const result = await runProcess("git", [...LOCAL_SAFE_OPTIONS, ...args], { cwd: cache, env: { ...env, ...extra } });
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
    return result.stdout.trim();
  };
  const blob = await run(["hash-object", "-w", "--", file]);
  await run(["update-index", "--add", "--cacheinfo", `100644,${blob},${PRESENCE_FILE}`]);
  const tree = await run(["write-tree"]);
  const stamp = record.updatedAt;
  return run(["-c", "user.name=Trama", "-c", "user.email=presence@trama.local", "commit-tree", tree, "-m", `Trama presence of ${record.user}`], {
    GIT_AUTHOR_DATE: stamp,
    GIT_COMMITTER_DATE: stamp,
  });
}

export type PublishResult = { status: "published" } | { status: "rejected"; detail: string } | { status: "failed"; detail: string };

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

/**
 * Pushes the record to `refs/trama/presence/<user>`, replacing the previous one. A refusal from the remote (read
 * access only, protected or hidden refs) is told apart from a network failure.
 */
export async function publishPresence(cache: string, source: RemoteSource, record: PresenceRecord): Promise<PublishResult> {
  const commit = await writeRecordCommit(cache, record);
  const { url } = remoteTransport(source);
  const push = await cacheGit(source, ["push", "--quiet", "--force", "--no-verify", "--porcelain", url, `${commit}:${presenceRef(record.user)}`], cache);
  if (push.exitCode === 0) return { status: "published" };
  const detail = `${push.stdout}\n${push.stderr}`;
  if (/\[rejected\]|\[remote rejected\]|denied|forbidden|403|read-only|not allowed|hidden ref|protected/i.test(detail)) {
    return { status: "rejected", detail: lastLine(push.stderr || push.stdout) };
  }
  return { status: "failed", detail: lastLine(push.stderr || push.stdout) };
}

/** Removes the person's record from the remote, when they stop sharing. */
export async function withdrawPresence(cache: string, source: RemoteSource, user: string): Promise<boolean> {
  const { url } = remoteTransport(source);
  const push = await cacheGit(source, ["push", "--quiet", "--no-verify", url, `:${presenceRef(user)}`], cache);
  return push.exitCode === 0;
}

/** Fetches every presence record of the remote and reads the valid ones; unreadable records are skipped. */
export async function readRemotePresence(cache: string, source: RemoteSource): Promise<PresenceRecord[]> {
  const { url } = remoteTransport(source);
  const fetch = await cacheGit(source, ["fetch", "--quiet", "--no-tags", "--prune", "--force", url, `+${PRESENCE_REF_PREFIX}*:${PRESENCE_REF_PREFIX}*`], cache);
  if (fetch.exitCode !== 0) throw new Error(lastLine(fetch.stderr) || "Il remoto non risponde.");
  const refs = await runProcess("git", [...LOCAL_SAFE_OPTIONS, "for-each-ref", "--format=%(refname)", PRESENCE_REF_PREFIX], { cwd: cache, env: gitEnvironment(true) });
  const records: PresenceRecord[] = [];
  for (const ref of refs.stdout.split("\n").filter(Boolean).slice(0, 100)) {
    const user = ref.slice(PRESENCE_REF_PREFIX.length);
    if (presenceUser(user) !== user) continue;
    const size = await runProcess("git", [...LOCAL_SAFE_OPTIONS, "cat-file", "-s", `${ref}:${PRESENCE_FILE}`], { cwd: cache, env: gitEnvironment(true) });
    if (size.exitCode !== 0 || Number(size.stdout.trim()) > MAXIMUM_PRESENCE_BYTES) continue;
    const blob = await runProcess("git", [...LOCAL_SAFE_OPTIONS, "cat-file", "blob", `${ref}:${PRESENCE_FILE}`], { cwd: cache, env: gitEnvironment(true) });
    if (blob.exitCode !== 0) continue;
    try {
      const record = parsePresenceRecord(JSON.parse(blob.stdout), user);
      if (record) records.push(record);
    } catch {
      // A record that is not JSON is left out.
    }
  }
  return records;
}

/** The branches on the remote and their heads, read with `git ls-remote` through the presence transport (G03). */
export async function remoteHeads(cache: string, source: RemoteSource): Promise<Map<string, string>> {
  const { url } = remoteTransport(source);
  const result = await cacheGit(source, ["ls-remote", "--heads", url], cache);
  if (result.exitCode !== 0) throw new Error(lastLine(result.stderr) || "Il remoto non risponde.");
  const heads = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref?.startsWith("refs/heads/")) heads.set(ref.slice("refs/heads/".length), sha.toLowerCase());
  }
  return heads;
}

/** Paths in `git status -z` output; a rename or copy carries the old path after the new one. */
export function statusPaths(output: string): string[] {
  const entries = output.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return paths;
}

/** The files a checkout changed against `base` (committed) and in the working tree, and the last change time. */
async function changedFiles(root: string, base: string | null): Promise<{ files: string[]; lastChange: number }> {
  const files = new Set<string>();
  const status = await localGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
  const working = status.ok ? statusPaths(status.stdout) : [];
  for (const path of working) files.add(path);
  if (base) {
    const diff = await localGit(["diff", "--name-only", "-z", "--no-renames", `${base}...HEAD`, "--"], root);
    if (diff.ok) for (const path of diff.stdout.split("\0").filter(Boolean)) files.add(path);
  }
  let lastChange = 0;
  for (const path of working.slice(0, MAXIMUM_PRESENCE_FILES)) {
    const info = await lstat(join(root, path)).catch(() => null);
    if (info) lastChange = Math.max(lastChange, info.mtimeMs);
  }
  return { files: [...files].filter(isShareablePath).sort().slice(0, MAXIMUM_PRESENCE_FILES), lastChange };
}

/** The branch the work starts from: origin's default branch, else a local main or master. */
export async function defaultBase(root: string): Promise<string | null> {
  const head = await localGit(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], root);
  const candidates = [head.ok ? head.stdout.trim() : "", "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
  for (const ref of candidates.filter(Boolean)) {
    if ((await localGit(["rev-parse", "--verify", "-q", ref], root)).ok) return ref;
  }
  return null;
}

export interface LocalActivity {
  current: string | null;
  branches: BranchActivity[];
  files: string[];
  lastChange: number;
}

/** What the checkout says: the current branch, the local branches with their last change, the files touched. */
export async function readLocalActivity(root: string): Promise<LocalActivity> {
  const head = await localGit(["symbolic-ref", "--short", "-q", "HEAD"], root);
  const current = head.ok ? head.stdout.trim() || null : null;
  const refs = await localGit(["for-each-ref", "--sort=-committerdate", `--count=${MAXIMUM_PRESENCE_BRANCHES}`, "--format=%(refname:short)%09%(committerdate:iso-strict)", "refs/heads"], root);
  const branches: BranchActivity[] = [];
  for (const line of refs.stdout.split("\n").filter(Boolean)) {
    const [name, date] = line.split("\t");
    if (name && date && !Number.isNaN(Date.parse(date))) branches.push({ name, lastChangeAt: new Date(date).toISOString() });
  }
  let base = await defaultBase(root);
  if (base && current && (base === `refs/heads/${current}` || base.endsWith(`/${current}`))) {
    // On the default branch itself, what counts is what is not pushed yet.
    const upstream = await localGit(["rev-parse", "--verify", "-q", "@{upstream}"], root);
    base = upstream.ok ? upstream.stdout.trim() : null;
  }
  const changes = await changedFiles(root, base);
  if (current) {
    const entry = branches.find((b) => b.name === current);
    const changedAt = changes.lastChange ? new Date(changes.lastChange).toISOString() : null;
    if (!entry) branches.unshift({ name: current, lastChangeAt: changedAt ?? new Date().toISOString() });
    else if (changedAt && changedAt > entry.lastChangeAt) entry.lastChangeAt = changedAt;
  }
  return { current, branches, files: changes.files, lastChange: changes.lastChange };
}

/** One agent at work in its own worktree, as the controller sees it. */
export interface AgentWork {
  id: string;
  name: string;
  color: string;
  tag: string;
  worktreeRoot: string | null;
  branch: string | null;
  baseSHA: string | null;
  task: PresenceTask | null;
  since: string;
  updatedAt: string;
}

async function agentPresence(agent: AgentWork): Promise<PresenceAgent> {
  const changes = agent.worktreeRoot && existsSync(agent.worktreeRoot) ? await changedFiles(agent.worktreeRoot, agent.baseSHA) : { files: [], lastChange: 0 };
  const updated = Date.parse(agent.updatedAt) || 0;
  return {
    id: agent.id,
    name: agent.name,
    color: agent.color,
    tag: agent.tag,
    branch: agent.branch,
    files: changes.files,
    task: agent.task,
    since: agent.since,
    lastActivityAt: new Date(Math.max(updated, changes.lastChange, Date.parse(agent.since) || 0)).toISOString(),
  };
}

/** Other people committed to the project: authors other than the person, in the recent history of every branch. */
export async function hasOtherAuthors(root: string): Promise<boolean> {
  const email = (await localGit(["config", "user.email"], root)).stdout.trim().toLowerCase();
  const log = await localGit(["log", "--all", "--since=180.days", "-n", "500", "--format=%ae"], root);
  return log.stdout
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .some((author) => author && author !== email && !author.endsWith("@trama.local"));
}

/** Who the person is on this remote: the GitHub login on GitHub, the git e-mail elsewhere. */
export async function personIdentity(root: string, source: RemoteSource | null, githubLogin: string | null): Promise<{ user: string | null; name: string }> {
  const name = (await localGit(["config", "user.name"], root)).stdout.trim();
  if (source?.kind === "github") return { user: githubLogin ? presenceUser(githubLogin) : null, name: githubLogin ?? name };
  const email = (await localGit(["config", "user.email"], root)).stdout.trim();
  return { user: presenceUser(email || name), name: name || email };
}

/** What the controller knows at each tick: the project, the consent and the work in Trama. */
export interface PresenceContext {
  root: string;
  consent: PresenceConsent | null;
  /** GitHub's push permission for the person; null when unknown or not on GitHub. */
  canPush: boolean | null;
  githubLogin: string | null;
  /** Decision 8: the branch of the work in focus, when it has one. */
  focusBranch: string | null;
  task: PresenceTask | null;
  agents: AgentWork[];
}

export interface PresenceServiceOptions {
  cacheRoot: string;
  /** Null once the project is gone: the service stops publishing. */
  context: () => PresenceContext | null;
  onView: (view: PresenceView & { hasCollaborators: boolean }) => void;
  now?: () => Date;
  intervalMs?: number;
}

/**
 * Keeps one project's presence fresh (decision 7): a tick every 45 seconds and right after a branch switch. Each tick
 * reads the checkout, fetches the others' records, publishes the person's own when they share, and withdraws it when
 * they stopped. A pause or a close leaves only a closed record: "visto l'ultima volta".
 */
export class PresenceService {
  private timer: NodeJS.Timeout | null = null;
  private headWatcher: FSWatcher | null = null;
  private headTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private source: RemoteSource | null | undefined = undefined;
  private cache: string | null = null;
  private canShare: boolean | null = null;
  private lastBranch: string | null = null;
  private lastTask: string | null = null;
  private since: string | null = null;
  private lastActivity = 0;
  private publishedAt: string | null = null;
  private lastRecord: PresenceRecord | null = null;
  private others: PresenceRecord[] = [];
  private collaborators: boolean | null = null;
  private message: string | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: PresenceServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(root: string): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? PRESENCE_INTERVAL_MS);
    this.timer.unref?.();
    void this.watchHead(root);
    void this.tick();
  }

  /** The remote and the bare cache in use, once the first tick resolved them; null without a remote. */
  remote(): { source: RemoteSource; cache: string } | null {
    return this.source && this.cache ? { source: this.source, cache: this.cache } : null;
  }

  /** Runs a tick now, or once more after the one in progress. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run()
      .catch((error) => {
        this.message = `La presenza non è aggiornata: ${(error as Error).message}`;
      })
      .finally(() => {
        this.running = null;
        if (this.again && !this.stopped) {
          this.again = false;
          void this.tick();
        }
      });
    return this.running;
  }

  /** Stops the ticks; when the person shared, the record on the remote becomes a closed one. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.headWatcher?.close();
    this.headWatcher = null;
    if (this.headTimer) clearTimeout(this.headTimer);
    this.headTimer = null;
    await this.running?.catch(() => undefined);
    const record = this.lastRecord;
    if (record && !record.closedAt && this.source && this.cache && this.publishedAt) {
      await publishPresence(this.cache, this.source, closedRecord(record, this.now())).catch(() => undefined);
    }
  }

  /** Decision 7: a branch switch updates the presence at once, without waiting for the next tick. */
  private async watchHead(root: string): Promise<void> {
    const gitDir = await localGit(["rev-parse", "--absolute-git-dir"], root);
    if (!gitDir.ok || this.stopped) return;
    try {
      this.headWatcher = watch(gitDir.stdout.trim(), (_event, name) => {
        if (String(name ?? "") !== "HEAD") return;
        if (this.headTimer) clearTimeout(this.headTimer);
        this.headTimer = setTimeout(() => void this.tick(), 300);
      });
      this.headWatcher.on("error", () => {
        this.headWatcher?.close();
        this.headWatcher = null;
      });
    } catch {
      // Without a watcher the switch shows at the next tick.
      this.headWatcher = null;
    }
  }

  private async run(): Promise<void> {
    const context = this.options.context();
    if (!context) return;
    const now = this.now();
    if (this.source === undefined) this.source = await resolvePresenceRemote(context.root);
    const source = this.source;
    if (source && !this.cache) this.cache = await presenceCache(this.options.cacheRoot, context.root, source);
    const identity = await personIdentity(context.root, source, context.githubLogin);
    const local = await readLocalActivity(context.root);

    const choice = chooseActiveBranch({ focusBranch: context.focusBranch, branches: local.branches, now });
    const taskKey = context.task ? `${context.task.kind}:${context.task.title}` : null;
    if (choice.active !== this.lastBranch || taskKey !== this.lastTask || !this.since) {
      this.since = now.toISOString();
      if (this.lastBranch !== null || this.lastTask !== null) this.lastActivity = Math.max(this.lastActivity, now.getTime());
      this.lastBranch = choice.active;
      this.lastTask = taskKey;
    }
    const agents = await Promise.all(context.agents.slice(0, MAXIMUM_PRESENCE_AGENTS).map(agentPresence));
    const commitTime = Date.parse(local.branches.find((b) => b.name === local.current)?.lastChangeAt ?? "") || 0;
    const agentTime = Math.max(0, ...agents.map((a) => Date.parse(a.lastActivityAt) || 0));
    this.lastActivity = Math.max(this.lastActivity, local.lastChange, commitTime, agentTime) || now.getTime();

    const record: PresenceRecord = {
      version: 1,
      user: identity.user ?? "",
      name: identity.name || "Tu",
      activeBranch: choice.active,
      alsoOn: choice.alsoOn,
      localBranches: local.branches.map((b) => b.name),
      // The files of the active branch; when the focus is on another branch, its agent's files say what is touched there.
      files: choice.active === local.current ? local.files : (agents.find((a) => a.branch === choice.active)?.files ?? []),
      task: context.task,
      since: this.since,
      lastActivityAt: new Date(Math.min(this.lastActivity, now.getTime())).toISOString(),
      updatedAt: now.toISOString(),
      closedAt: null,
      agents,
    };

    this.message = null;
    if (source && this.cache) {
      try {
        this.others = await readRemotePresence(this.cache, source);
      } catch (error) {
        this.message = `Il remoto non ha risposto: ${(error as Error).message}`;
      }
      await this.share(context, source, this.cache, identity.user, record, now);
    }
    if (this.collaborators !== true) {
      this.collaborators = this.others.some((r) => r.user !== identity.user) || (await hasOtherAuthors(context.root));
    }
    const consent = context.consent;
    const mode = presenceMode({ hasRemote: Boolean(source), consent, canShare: this.canShare });
    this.options.onView({
      mode,
      consent,
      canShare: this.canShare,
      message: this.message ?? (source ? null : "Il progetto non ha un remoto: la presenza resta su questo computer."),
      self: { record, self: true, ...presenceFreshness(record, now) },
      others: presenceEntries(this.others, identity.user, now),
      refreshedAt: now.toISOString(),
      publishedAt: this.publishedAt,
      hasCollaborators: this.collaborators,
    });
  }

  /** Publishes, closes or withdraws the person's record according to the consent. Never without consent. */
  private async share(context: PresenceContext, source: RemoteSource, cache: string, user: string | null, record: PresenceRecord, now: Date): Promise<void> {
    if (context.canPush === false) this.canShare = false;
    if (!user) {
      if (context.consent?.choice === "shared") this.message = "Trama non conosce ancora il tuo account: la presenza parte appena lo legge.";
      return;
    }
    const remote = this.others.find((r) => r.user === user) ?? null;
    const consent = context.consent;
    if (consent?.choice !== "shared") {
      // Sharing stopped: the record leaves the remote.
      if (remote && (await withdrawPresence(cache, source, user))) {
        this.others = this.others.filter((r) => r.user !== user);
        this.publishedAt = null;
        this.lastRecord = null;
      }
      return;
    }
    if (this.canShare === false) {
      this.message = "Hai solo la lettura su questo remoto: vedi la presenza dei colleghi senza condividere la tua.";
      return;
    }
    const outgoing = consent.paused ? closedRecord(record, now) : record;
    if (consent.paused && remote?.closedAt) return;
    const result = await publishPresence(cache, source, outgoing);
    if (result.status === "published") {
      this.canShare = true;
      this.publishedAt = now.toISOString();
      this.lastRecord = outgoing;
      this.others = [...this.others.filter((r) => r.user !== user), outgoing];
    } else if (result.status === "rejected") {
      this.canShare = false;
      this.message = `Il remoto non accetta la tua presenza (${result.detail}): vedi quella dei colleghi senza condividere la tua.`;
    } else {
      this.message = `La presenza non è stata pubblicata: ${result.detail}`;
    }
  }
}
