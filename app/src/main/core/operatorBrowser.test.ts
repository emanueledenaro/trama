import { describe, expect, it } from "vitest";
import type { AccessStep, SiteConsent } from "@shared/domain";
import { ComputerAccessGate } from "./computerAccess";
import {
  type BrowserDriver,
  type BrowserOpening,
  type BrowserSession,
  BROWSER_TOOLS,
  fixtureBrowserDriver,
  OPEN_IN_CHROME_TOOL,
  runBrowserTool,
  signedOut,
} from "./operatorBrowser";

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

const consent = (host: string): SiteConsent => ({ id: `c-${host}`, host, grantedAt: "2026-10-05T10:00:00.000Z", by: "button", phrase: null });

interface Harness {
  session: BrowserSession;
  opened: string[];
  steps: Omit<AccessStep, "id" | "at">[];
  asked: [string, string][];
  announced: string[];
  logins: string[];
  consents: SiteConsent[];
  answer: { next: BrowserOpening | (() => Promise<BrowserOpening>) };
  controller: AbortController;
  setOn: (on: boolean) => void;
}

function harness(options: { blocked?: string[]; consents?: string[]; role?: BrowserSession["role"] } = {}): Harness {
  let on = true;
  const controller = new AbortController();
  const h: Harness = {
    opened: [],
    steps: [],
    asked: [],
    announced: [],
    logins: [],
    consents: (options.consents ?? ["github.com"]).map(consent),
    answer: { next: { status: "opened", page: { finalAddress: "https://github.com/acme/repo", title: "acme/repo", text: "The repository.", asksForLogin: false } } },
    controller,
    setOn: (value) => void (on = value),
    session: null as never,
  };
  const browser: BrowserDriver = {
    // The sends have their own checks in operatorSend.test.ts.
    send: async () => ({ status: "unavailable", reason: "none" }),
    async open(address) {
      h.opened.push(address);
      return typeof h.answer.next === "function" ? h.answer.next() : h.answer.next;
    },
  };
  let counter = 0;
  h.session = {
    gate: new ComputerAccessGate(() => on, () => options.blocked ?? []),
    browser,
    agent: "Operatore",
    role: options.role ?? "operator",
    consents: () => h.consents,
    record: (step) => void h.steps.push(step),
    askConsent: (host, address) => void h.asked.push([host, address]),
    announce: (host) => void h.announced.push(host),
    needsLogin: (host) => void h.logins.push(host),
    signal: controller.signal,
    newId: () => `id${++counter}`,
  };
  return h;
}

const open = (h: Harness, url: string) => runBrowserTool({ url }, h.session);

describe("the real driver of Chrome never reaches for a cookie, a saved password or the keyboard (issue #411)", () => {
  it("calls only the protocol's page reading and evaluation, never a cookie, storage, password or input command", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./operatorBrowser.ts", import.meta.url), "utf8");
    const called = [...source.matchAll(/call\("([A-Za-z]+\.[A-Za-z]+)"/g)].map((match) => match[1]);
    expect(new Set(called)).toEqual(new Set(["Runtime.evaluate"]));
    expect(source).not.toMatch(/\b(?:Network\.(?:getCookies|getAllCookies|setCookie)|Storage\.|Input\.|Autofill|PasswordManager|document\.cookie)/);
  });
});

describe("the Operator opens a site in the person's Chrome (issue #410)", () => {
  it("opens a site with a consent, reads it as data, and leaves a row in Activity and a line in the chat", async () => {
    const h = harness();
    const result = parse(await open(h, "https://github.com/acme/repo?tab=readme#top"));
    expect(result).toMatchObject({ data: true, url: "github.com/acme/repo", title: "acme/repo", text: "The repository." });
    expect(result.note).toMatch(/data/i);
    expect(h.opened).toEqual(["https://github.com/acme/repo?tab=readme#top"]);
    expect(h.steps).toEqual([{ agent: "Operatore", kind: "browser", target: "github.com/acme/repo", outcome: "done", detail: null }]);
    expect(h.announced).toEqual(["github.com"]);
  });

  it("does not open a site without a consent: the request waits for the person, and nothing is opened", async () => {
    const h = harness({ consents: [] });
    const result = parse(await open(h, "https://github.com/acme/repo"));
    expect(result.error.code).toBe("waiting_for_person");
    expect(h.opened).toEqual([]);
    expect(h.asked).toEqual([["github.com", "https://github.com/acme/repo"]]);
    expect(h.steps).toEqual([{ agent: "Operatore", kind: "browser", target: "github.com/acme/repo", outcome: "waiting", detail: "consent" }]);
    expect(h.announced).toEqual([]);
  });

  it("does not take a consent for one site as a consent for another", async () => {
    const h = harness({ consents: ["github.com"] });
    expect(parse(await open(h, "https://gist.github.com/x")).error.code).toBe("waiting_for_person");
    expect(parse(await open(h, "https://npmjs.com/")).error.code).toBe("waiting_for_person");
    expect(h.opened).toEqual([]);
  });

  it("never opens a blocked site, even one the person had consented to, and does not ask for a consent", async () => {
    const h = harness({ blocked: ["bank.example"], consents: ["bank.example"] });
    const result = parse(await open(h, "https://www.bank.example/accounts"));
    expect(result.error.code).toBe("blocked");
    expect(h.opened).toEqual([]);
    expect(h.asked).toEqual([]);
    expect(h.steps).toEqual([{ agent: "Operatore", kind: "browser", target: "www.bank.example/accounts", outcome: "blocked", detail: "bank.example" }]);
  });

  it("stops when the page leads to a blocked site and hands back none of what it read", async () => {
    const h = harness({ blocked: ["bank.example"], consents: ["github.com", "bank.example"] });
    h.answer.next = { status: "opened", page: { finalAddress: "https://bank.example/home", title: "Bank", text: "Balance: 1000", asksForLogin: false } };
    const result = await open(h, "https://github.com/redirect");
    expect(parse(result).error.code).toBe("blocked");
    expect(result.content[0]!.text).not.toContain("Balance");
    expect(h.announced).toEqual([]);
  });

  it("asks for a consent when the page leads to another site, and hands back none of what it read", async () => {
    const h = harness();
    h.answer.next = { status: "opened", page: { finalAddress: "https://other.example/landing", title: "Other", text: "Secret offer", asksForLogin: false } };
    const result = await open(h, "https://github.com/redirect");
    expect(parse(result).error.code).toBe("waiting_for_person");
    expect(result.content[0]!.text).not.toContain("Secret offer");
    expect(h.asked).toEqual([["other.example", "other.example/landing"]]);
  });

  it("stops and tells the person to sign in when the page asks for a password, and fills nothing", async () => {
    const h = harness();
    h.answer.next = { status: "opened", page: { finalAddress: "https://github.com/login", title: "Sign in", text: "Username Password", asksForLogin: true } };
    const result = await open(h, "https://github.com/acme/private");
    expect(parse(result).error.code).toBe("login_needed");
    expect(h.logins).toEqual(["github.com"]);
    expect(h.steps.at(-1)).toMatchObject({ kind: "browser", outcome: "waiting", detail: "login" });
    expect(h.announced).toEqual([]);
    // The driver can only open an address: there is no way to type into the page.
    // Since issue #411 it can also send one request, from the site's own tab; there is still no call to fill a field.
    expect(Object.keys(h.session.browser).sort()).toEqual(["open", "send"]);
  });

  it("recognises a sign-in by its address even without a visible field", () => {
    expect(signedOut({ asksForLogin: false, finalAddress: "https://github.com/login?return_to=%2Facme" })).toBe(true);
    expect(signedOut({ asksForLogin: false, finalAddress: "https://example.org/users/sign_in" })).toBe(false);
    expect(signedOut({ asksForLogin: false, finalAddress: "https://github.com/acme/repo" })).toBe(false);
  });

  it("offers no tool to type, click or read cookies and passwords", () => {
    expect(BROWSER_TOOLS.map((tool) => tool.name)).toEqual([OPEN_IN_CHROME_TOOL]);
    expect(Object.keys(BROWSER_TOOLS[0]!.properties)).toEqual(["url"]);
  });

  it("is refused with the switch off, and for a role that has no browser", async () => {
    const off = harness();
    off.setOn(false);
    expect(parse(await open(off, "https://github.com/")).error.code).toBe("access_off");
    expect(off.opened).toEqual([]);
    const developer = harness({ role: "developer" });
    expect(parse(await open(developer, "https://github.com/")).error.code).toBe("role_not_allowed");
    expect(developer.opened).toEqual([]);
  });

  it("stops at once when the switch goes off during the page", async () => {
    const h = harness();
    h.answer.next = () =>
      new Promise((resolve) => {
        queueMicrotask(() => void h.session.gate.stopAll().then(() => resolve({ status: "unavailable", reason: "stopped" })));
      });
    const result = await open(h, "https://github.com/");
    expect(parse(result).error.code).toBe("stopped");
    expect(h.announced).toEqual([]);
  });

  it("says plainly when Chrome cannot be reached", async () => {
    const h = harness();
    h.answer.next = { status: "unavailable", reason: "connection refused" };
    expect(parse(await open(h, "https://github.com/")).error.code).toBe("browser_unavailable");
    expect(h.steps.at(-1)).toMatchObject({ kind: "browser", outcome: "failed", detail: "start" });
  });

  it("filters a secret from the page before the model reads it", async () => {
    const h = harness();
    h.answer.next = { status: "opened", page: { finalAddress: "https://github.com/acme/repo", title: "t", text: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end", asksForLogin: false } };
    const result = await open(h, "https://github.com/acme/repo");
    expect(result.content[0]!.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("refuses an address that is not http or https, or does not name a site", async () => {
    const h = harness();
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url", ""]) expect(parse(await open(h, url)).error.code).toBe("invalid_arguments");
    expect(h.opened).toEqual([]);
  });

  it("the fixture driver answers from a file and cannot be reached for an address it lacks", async () => {
    const driver = fixtureBrowserDriver({ pages: { "https://github.com/": { title: "GitHub", text: "Home" } } });
    const signal = new AbortController().signal;
    expect(await driver.open("https://github.com/", { signal })).toEqual({ status: "opened", page: { finalAddress: "https://github.com/", title: "GitHub", text: "Home", asksForLogin: false } });
    expect(await driver.open("https://nowhere.example/", { signal })).toMatchObject({ status: "unavailable" });
  });
});
