import { describe, expect, it } from "vitest";
import { fromTramaPage, GESTURE_WINDOW_MS, GestureClock, needsPersonGesture } from "./personGesture";

describe("a yes counts only after the person's gesture in Trama's window (issue #597)", () => {
  it("asks a gesture for every action that gives a yes, and not for the ones that take power away", () => {
    for (const action of ["coordinator:send", "mandate:grant", "pact:decide", "decision:answer", "commandApproval:confirm", "siteConsent:confirm", "appConsent:confirm", "requestedAction:confirm", "candidate:approve", "candidate:publish"]) {
      expect(needsPersonGesture(action, { id: "x" }), action).toBe(true);
    }
    expect(needsPersonGesture("access:set", { on: true })).toBe(true);
    expect(needsPersonGesture("access:set", { on: false })).toBe(false);
    expect(needsPersonGesture("settings:update", { computerAccess: true })).toBe(true);
    expect(needsPersonGesture("settings:update", { theme: "dark" })).toBe(false);
    expect(needsPersonGesture("learning:proposal", { id: "p", approve: true })).toBe(true);
    expect(needsPersonGesture("learning:proposal", { id: "p", approve: false })).toBe(false);
    expect(needsPersonGesture("presence:consent", { share: true })).toBe(true);
    for (const action of ["commandApproval:decline", "siteConsent:decline", "appConsent:withdraw", "mandate:revoke", "candidate:reject", "project:open"]) {
      expect(needsPersonGesture(action, { id: "x" }), action).toBe(false);
    }
  });

  it("takes only a trusted click or key, and only for a few seconds", () => {
    const clock = new GestureClock();
    expect(clock.covers(1_000)).toBe(false);
    // An event a script dispatches is never trusted, and a focus or a scroll is no gesture.
    clock.note({ isTrusted: false, type: "click" }, 1_000);
    clock.note({ isTrusted: true, type: "focus" }, 1_000);
    expect(clock.covers(1_000)).toBe(false);
    clock.note({ isTrusted: true, type: "click" }, 2_000);
    expect(clock.covers(2_000 + GESTURE_WINDOW_MS)).toBe(true);
    expect(clock.covers(2_001 + GESTURE_WINDOW_MS)).toBe(false);
    clock.note({ isTrusted: true, type: "keydown" }, 10_000);
    expect(clock.covers(10_500)).toBe(true);
  });

  it("takes an action only from Trama's own page in Trama's own window", () => {
    const file = "/Applications/Trama.app/Contents/Resources/app.asar/dist/index.html";
    const page = { file, devServer: null };
    const own = { fromWindow: true, mainFrame: true, url: "file:///Applications/Trama.app/Contents/Resources/app.asar/dist/index.html#/chat" };
    expect(fromTramaPage(own, page)).toBe(true);
    expect(fromTramaPage({ ...own, fromWindow: false }, page)).toBe(false);
    expect(fromTramaPage({ ...own, mainFrame: false }, page)).toBe(false);
    expect(fromTramaPage({ ...own, url: "https://example.com/" }, page)).toBe(false);
    expect(fromTramaPage({ ...own, url: "file:///tmp/other.html" }, page)).toBe(false);
    expect(fromTramaPage({ ...own, url: "not a url" }, page)).toBe(false);
    const dev = { file: null, devServer: "http://localhost:5733/" };
    expect(fromTramaPage({ ...own, url: "http://localhost:5733/" }, dev)).toBe(true);
    expect(fromTramaPage({ ...own, url: "http://localhost:5734/" }, dev)).toBe(false);
    // A path with spaces, as a folder on the Mac can have.
    expect(fromTramaPage({ ...own, url: "file:///Users/ada/My%20Apps/Trama/dist/index.html" }, { file: "/Users/ada/My Apps/Trama/dist/index.html", devServer: null })).toBe(true);
  });
});
