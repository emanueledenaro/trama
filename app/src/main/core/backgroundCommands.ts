/**
 * The commands the Operator leaves running (issue #595), such as the preview server of a site. Trama keeps each as its own
 * process, in its own process group, and stops it when it is no longer needed: when the Operator asks, after a time
 * limit, when computer access goes off, when the project closes and when Trama quits. Nothing is left behind.
 */

export const MAXIMUM_BACKGROUND = 3;
/** A server nobody stopped goes off after this long. */
export const BACKGROUND_LIFETIME_MS = 30 * 60_000;
/** How long the start waits for the first output or an early exit. */
const SETTLE_MS = 1_500;

export interface BackgroundHandle {
  /** Ends the process and every process it started. Never throws. */
  stop(): void;
  /** What it printed so far. */
  output(): string;
  /** The exit code once it is over, a promise that resolves then. */
  exited: Promise<number | null>;
}

/** Starts a shell line in the background. Injected, so the tests never start a process. */
export type BackgroundStarter = (command: string, options: { cwd: string }) => BackgroundHandle;

export interface BackgroundEntry {
  id: string;
  command: string;
  projectRoot: string;
  handle: BackgroundHandle;
}

export class BackgroundCommands {
  private readonly entries = new Map<string, BackgroundEntry & { timer: NodeJS.Timeout }>();
  constructor(private readonly onEnd: (entry: BackgroundEntry) => void = () => undefined) {}

  get count(): number {
    return this.entries.size;
  }

  list(): { id: string; command: string }[] {
    return [...this.entries.values()].map(({ id, command }) => ({ id, command }));
  }

  /** Keeps a process that runs. False when the limit is reached. */
  add(entry: BackgroundEntry): boolean {
    if (this.entries.size >= MAXIMUM_BACKGROUND) return false;
    const timer = setTimeout(() => this.stop(entry.id), BACKGROUND_LIFETIME_MS);
    timer.unref();
    this.entries.set(entry.id, { ...entry, timer });
    // A process that ends by itself leaves the list.
    void entry.handle.exited.then(() => this.forget(entry.id));
    return true;
  }

  private forget(id: string): BackgroundEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    return entry;
  }

  /** Stops one process. False when there is none with this id. */
  stop(id: string): boolean {
    const entry = this.forget(id);
    if (!entry) return false;
    entry.handle.stop();
    this.onEnd(entry);
    return true;
  }

  /** Stops the processes of a project, or every one without a root. */
  stopAll(projectRoot?: string): number {
    const ids = [...this.entries.values()].filter((entry) => projectRoot === undefined || entry.projectRoot === projectRoot).map((entry) => entry.id);
    for (const id of ids) this.stop(id);
    return ids.length;
  }

  /** Waits for the first output or an early exit, so the Operator learns whether it started. */
  static async settle(handle: BackgroundHandle, ms = SETTLE_MS): Promise<{ exited: boolean; code: number | null; output: string }> {
    const result = await Promise.race([handle.exited.then((code) => ({ exited: true, code })), new Promise<{ exited: false; code: null }>((resolve) => setTimeout(() => resolve({ exited: false, code: null }), ms))]);
    return { ...result, output: handle.output() };
  }
}
