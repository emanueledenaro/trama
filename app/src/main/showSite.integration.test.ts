import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TramaController } from "./controller";
import type { BackgroundHandle } from "./core/backgroundCommands";
import type { BrowserDriver } from "./core/operatorBrowser";
import { git } from "./core/process";
import { SecretLock } from "./core/secretLock";

const root = join(import.meta.dirname, "../..");
let controller: TramaController | null = null;
afterEach(async () => {
  await controller?.stop();
  controller = null;
});

const PREVIEW = "http://127.0.0.1:4321";

interface FakeServer extends BackgroundHandle {
  stopped: number;
}

function fakeServer(): FakeServer {
  let end: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => (end = resolve));
  const server: FakeServer = {
    stopped: 0,
    stop: () => {
      server.stopped += 1;
      end(null);
    },
    output: () => `Local: ${PREVIEW}/`,
    exited,
  };
  return server;
}

const chrome: BrowserDriver & { opened: string[] } = {
  opened: [],
  send: async () => ({ status: "unavailable", reason: "no send" }),
  async open(address) {
    chrome.opened.push(address);
    return { status: "opened", page: { finalAddress: address, title: "Anteprima", text: "Pagina", asksForLogin: false } };
  },
};

async function open() {
  const opened: string[] = [];
  const servers: FakeServer[] = [];
  const started: string[] = [];
  chrome.opened.length = 0;
  controller = new TramaController(await mkdtemp(join(tmpdir(), "trama-data-")), {
    publish: () => undefined,
    openExternal: async (address) => void opened.push(address),
    applyTheme: () => undefined,
    notify: () => undefined,
    setOpenAtLogin: () => undefined,
    aiHeroResourceDirectory: join(root, "resources/AIHero"),
    demoResourceDirectory: "",
    codexExecutable: join(root, "test-fixtures/fake-codex.mjs"),
    commandRunner: { run: async () => ({ exitCode: 0, output: "", timedOut: false }) },
    backgroundStarter: (command) => {
      started.push(command);
      const server = fakeServer();
      servers.push(server);
      return server;
    },
    browserDriver: chrome,
    secretLock: new SecretLock({ home: "/Users/ada", realpath: () => null }),
  });
  const repo = await mkdtemp(join(tmpdir(), "trama-show-"));
  await cp(join(root, "resources/DemoProject"), repo, { recursive: true });
  await git(["init", "-b", "main"], repo, false);
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "init"], repo, false);
  await controller.start();
  await controller.openProject(repo);
  await until(() => controller!.snapshot.project?.phase.kind === "ready" && controller!.snapshot.project.github.status !== "loading", 20_000);
  return { c: controller, opened, servers, started };
}

async function until(check: () => boolean, timeout = 40_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const doc = (c: TramaController) => c.snapshot.project!.document;
const replies = (c: TramaController) => doc(c).events.flatMap((e) => (e.content.type === "coordinatorText" ? [e.content.text] : []));
const chatLines = (c: TramaController) => doc(c).events.flatMap((e) => (e.content.type === "card" && e.content.kind === "contextNotice" ? [e.content.title] : []));
const order = async (c: TramaController, commands: string, count: number) => {
  await c.send(`[operatore:${commands}] fai`, null, null, null);
  await until(() => replies(c).filter((r) => r.startsWith("Operatore: ")).length > count);
  return JSON.parse(replies(c).filter((r) => r.startsWith("Operatore: "))[count]!.slice("Operatore: ".length)) as { report?: string };
};

describe("showing the site to the person without a consent (issue #595)", () => {
  it("starts the preview in the background, opens it in the default browser with no consent, and stops it when Trama quits", async () => {
    const { c, opened, servers, started } = await open();
    const report = await order(c, `background:npm run preview -- --port 4321 ;; show:${PREVIEW}`, 0);
    expect(report.report).toMatch(/background:npm run preview -- --port 4321: avviato id=\w+/);
    expect(report.report).toContain(`show:${PREVIEW}: mostrato 127.0.0.1:4321`);
    expect(started).toEqual(["npm run preview -- --port 4321"]);
    expect(opened).toEqual([`${PREVIEW}/`]);
    // The page was not read and nobody was asked.
    expect(chrome.opened).toEqual([]);
    expect(doc(c).siteConsentRequests ?? []).toEqual([]);
    expect(chatLines(c)).toContain("Operatore ha aperto 127.0.0.1:4321 nel tuo browser");
    expect(doc(c).accessSteps!.filter((s) => s.kind === "browser").map((s) => [s.target, s.outcome, s.detail])).toEqual([["127.0.0.1:4321", "done", "shown"]]);

    // The server goes on after the Operator's turn and goes off with Trama.
    expect(servers).toHaveLength(1);
    expect(servers[0]!.stopped).toBe(0);
    await c.stop();
    expect(servers[0]!.stopped).toBe(1);
  }, 120_000);

  it("stops the server when the Operator asks, and when the person turns the access off", async () => {
    const { c, servers } = await open();
    const first = await order(c, "background:npm run preview", 0);
    const id = first.report!.match(/id=(\w+)/)![1]!;
    const second = await order(c, `stop:${id}`, 1);
    expect(second.report).toContain(`stop:${id}: spento`);
    expect(servers[0]!.stopped).toBe(1);
    expect(chatLines(c)).toContain("Operatore ha spento il server avviato in background: npm run preview");

    await order(c, "background:npm run preview", 2);
    expect(servers).toHaveLength(2);
    await c.setComputerAccess(false);
    expect(servers[1]!.stopped).toBe(1);
  }, 120_000);

  it("keeps the blocked sites and the switch, and refuses an address that is not https or a local preview", async () => {
    const { c, opened } = await open();
    await c.updateSettings({ blockedSites: ["bank.example"] });
    const report = await order(c, "show:https://bank.example/login ;; show:http://example.org ;; show:https://example.org/ciao", 0);
    expect(report.report).toContain("show:https://bank.example/login: rifiutato (blocked)");
    expect(report.report).toContain("show:http://example.org: rifiutato (invalid_arguments)");
    expect(report.report).toContain("show:https://example.org/ciao: mostrato example.org/ciao");
    expect(opened).toEqual(["https://example.org/ciao"]);
    await c.setComputerAccess(false);
    // With the switch off the Operator itself does not start.
    expect(((await order(c, "show:https://example.org", 1)) as { error?: { code: string } }).error?.code).toBe("access_off");
    expect(opened).toEqual(["https://example.org/ciao"]);
  }, 120_000);

  it("keeps open_in_chrome behind the consent, and the Coordinator hears the person's yes and goes on", async () => {
    const { c } = await open();
    await order(c, `chrome:${PREVIEW}`, 0);
    expect(chrome.opened).toEqual([]);
    const request = doc(c).siteConsentRequests![0]!;
    expect(request).toMatchObject({ host: "127.0.0.1", status: "waiting" });

    const before = doc(c).requests.length;
    c.confirmSiteConsentRequest(request.id);
    // The yes reaches the Coordinator as the person's choice and starts a turn of its own.
    await until(() => doc(c).requests.length > before && doc(c).requests.every((r) => r.state !== "running"));
    expect(doc(c).requests.at(-1)!.text).toBe("Ti do il consenso per 127.0.0.1. Riprova quello che si era fermato.");
    expect(replies(c).length).toBeGreaterThan(1);
    expect(doc(c).siteConsents).toMatchObject([{ host: "127.0.0.1", by: "button" }]);

    // With the consent the Operator now reads the page.
    const again = await order(c, `chrome:${PREVIEW}`, 1);
    expect(again.report).toContain("aperto «Anteprima»");
  }, 120_000);
});
