import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_LIFETIME_MS, BackgroundCommands, type BackgroundHandle, MAXIMUM_BACKGROUND } from "./backgroundCommands";

function fakeHandle(): BackgroundHandle & { stopped: number; end: (code: number | null) => void } {
  let end: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => (end = resolve));
  const handle = {
    stopped: 0,
    end: (code: number | null) => end(code),
    stop: () => {
      handle.stopped += 1;
      end(null);
    },
    output: () => "ready",
    exited,
  };
  return handle;
}

afterEach(() => vi.useRealTimers());

describe("the commands left running (issue #595)", () => {
  it("stops one, all of a project and everything, and keeps nothing after", async () => {
    const registry = new BackgroundCommands();
    const [a, b, c] = [fakeHandle(), fakeHandle(), fakeHandle()];
    registry.add({ id: "a", command: "npm run preview", projectRoot: "/p1", handle: a });
    registry.add({ id: "b", command: "npm run dev", projectRoot: "/p2", handle: b });
    registry.add({ id: "c", command: "npm run docs", projectRoot: "/p2", handle: c });
    expect(registry.stop("a")).toBe(true);
    expect(registry.stop("a")).toBe(false);
    expect(registry.stopAll("/p2")).toBe(2);
    await Promise.resolve();
    expect([a.stopped, b.stopped, c.stopped]).toEqual([1, 1, 1]);
    expect(registry.count).toBe(0);
  });

  it("stops all on quit, forgets a process that ended by itself and refuses more than the limit", async () => {
    const registry = new BackgroundCommands();
    const handles = Array.from({ length: MAXIMUM_BACKGROUND }, () => fakeHandle());
    handles.forEach((handle, index) => expect(registry.add({ id: `${index}`, command: "x", projectRoot: "/p", handle })).toBe(true));
    expect(registry.add({ id: "extra", command: "x", projectRoot: "/p", handle: fakeHandle() })).toBe(false);
    handles[0]!.end(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.count).toBe(MAXIMUM_BACKGROUND - 1);
    expect(registry.stopAll()).toBe(MAXIMUM_BACKGROUND - 1);
    expect(handles.slice(1).every((handle) => handle.stopped === 1)).toBe(true);
  });

  it("stops a server nobody stopped after its lifetime", () => {
    vi.useFakeTimers();
    const registry = new BackgroundCommands();
    const handle = fakeHandle();
    registry.add({ id: "a", command: "npm run preview", projectRoot: "/p", handle });
    vi.advanceTimersByTime(BACKGROUND_LIFETIME_MS - 1);
    expect(handle.stopped).toBe(0);
    vi.advanceTimersByTime(2);
    expect(handle.stopped).toBe(1);
    expect(registry.count).toBe(0);
  });

  it("settles on the first wait or on an early exit", async () => {
    const running = fakeHandle();
    expect(await BackgroundCommands.settle(running, 10)).toEqual({ exited: false, code: null, output: "ready" });
    const early = fakeHandle();
    early.end(1);
    expect(await BackgroundCommands.settle(early, 1_000)).toEqual({ exited: true, code: 1, output: "ready" });
  });
});
