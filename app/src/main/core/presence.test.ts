import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyConsent, type PresenceConsent, type PresenceView } from "@shared/presence";
import { git } from "./process";
import { hasOtherAuthors, type PresenceContext, PresenceService, readLocalActivity, statusPaths } from "./presence";

const identity = (name: string) => ["-c", `user.name=${name}`, "-c", `user.email=${name.toLowerCase()}@example.com`];

async function clone(remote: string, name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `trama-presence-${name.toLowerCase()}-`));
  await git(["clone", "-q", remote, root], tmpdir(), false);
  await git(["config", "user.name", name], root, false);
  await git(["config", "user.email", `${name.toLowerCase()}@example.com`], root, false);
  return root;
}

/** A local bare remote with one commit on main, and two people with their own clone. */
async function setup() {
  const remote = await mkdtemp(join(tmpdir(), "trama-presence-remote-"));
  await git(["init", "--bare", "-q", "-b", "main"], remote, false);
  const seed = await mkdtemp(join(tmpdir(), "trama-presence-seed-"));
  await git(["init", "-q", "-b", "main"], seed, false);
  await writeFile(join(seed, "payments.ts"), "export const pay = () => 1;\n");
  await git(["add", "."], seed, false);
  await git([...identity("Seed"), "commit", "-qm", "init"], seed, false);
  await git(["push", "-q", remote, "main"], seed, false);
  return { remote, ada: await clone(remote, "Ada"), bea: await clone(remote, "Bea") };
}

function service(root: string, consent: () => PresenceConsent | null, extra: Partial<PresenceContext> = {}) {
  const views: (PresenceView & { hasCollaborators: boolean })[] = [];
  const instance = new PresenceService({
    cacheRoot: join(root, "..", `${root.split("/").at(-1)}-cache`),
    context: () => ({ root, consent: consent(), canPush: null, githubLogin: null, focusBranch: null, task: null, agents: [], ...extra }),
    onView: (view) => views.push(view),
    intervalMs: 3_600_000,
  });
  return { instance, views, last: () => views.at(-1)! };
}

const shared = (): PresenceConsent => ({ ...emptyConsent(), choice: "shared", proposedAt: new Date().toISOString(), decidedAt: new Date().toISOString() });

describe("presence via git on a local bare remote", () => {
  it("publishes paths only with consent, and a read-only person sees without sharing", async () => {
    const { remote, ada, bea } = await setup();
    await git(["checkout", "-q", "-b", "feature/pagamenti"], ada, false);
    await writeFile(join(ada, "payments.ts"), "SECRET CONTENT THAT MUST NOT TRAVEL\n");
    await writeFile(join(ada, ".env"), "TOKEN=abc\n");
    let adaConsent: PresenceConsent | null = null;
    const adaService = service(ada, () => adaConsent, { task: { kind: "goal", title: "Pagamenti con carta" } });

    // Without consent nothing reaches the remote.
    await adaService.instance.tick();
    expect((await git(["for-each-ref", "refs/trama"], remote)).trim()).toBe("");
    expect(adaService.last().mode).toBe("readOnly");
    expect(adaService.last().self!.record.files).toEqual(["payments.ts"]);

    adaConsent = shared();
    await adaService.instance.tick();
    expect(adaService.last().mode).toBe("shared");
    const ref = "refs/trama/presence/ada-at-example.com";
    expect((await git(["for-each-ref", "--format=%(refname)", "refs/trama"], remote)).trim()).toBe(ref);
    const published = await git(["cat-file", "blob", `${ref}:presence.json`], remote);
    expect(published).toContain('"payments.ts"');
    expect(published).toContain("feature/pagamenti");
    expect(published).toContain("Pagamenti con carta");
    expect(published).not.toContain("SECRET CONTENT");
    expect(published).not.toContain(".env");
    // The record is not a branch: a normal clone or fetch does not see it.
    expect(await git(["ls-remote", "--heads", remote], ada)).not.toContain("trama");
    await git(["fetch", "-q", "origin"], bea, false);
    expect(await git(["branch", "-a"], bea)).not.toContain("presence");

    // Bea has no consent and read access only: she sees Ada and publishes nothing.
    const beaService = service(bea, () => null, { canPush: false });
    await beaService.instance.tick();
    const view = beaService.last();
    expect(view.mode).toBe("readOnly");
    expect(view.hasCollaborators).toBe(true);
    expect(view.others.map((o) => [o.record.user, o.record.activeBranch, o.status])).toEqual([["ada-at-example.com", "feature/pagamenti", "active"]]);
    expect((await git(["for-each-ref", "--format=%(refname)", "refs/trama"], remote)).trim()).toBe(ref);

    // A pause leaves only who and when; the close says "visto l'ultima volta".
    adaConsent = { ...shared(), paused: true };
    await adaService.instance.tick();
    const paused = JSON.parse(await git(["cat-file", "blob", `${ref}:presence.json`], remote));
    expect(paused).toMatchObject({ activeBranch: null, files: [], task: null });
    expect(paused.closedAt).not.toBeNull();
    await beaService.instance.tick();
    expect(beaService.last().others[0]!.status).toBe("offline");

    // Stopping sharing withdraws the record from the remote.
    adaConsent = { ...shared(), choice: "declined" };
    await adaService.instance.tick();
    expect((await git(["for-each-ref", "refs/trama"], remote)).trim()).toBe("");
    await adaService.instance.stop();
    await beaService.instance.stop();
  });

  it("falls back to reading when the remote refuses the ref", async () => {
    const { remote, ada } = await setup();
    // A hidden namespace is refused on push, as GitHub does for refs/pull.
    await git(["config", "receive.hideRefs", "refs/trama"], remote, false);
    const adaService = service(ada, shared);
    await adaService.instance.tick();
    expect(adaService.last().canShare).toBe(false);
    expect(adaService.last().mode).toBe("readOnly");
    expect(adaService.last().message).toMatch(/non accetta la tua presenza/);
    await adaService.instance.stop();
  });

  it("closes the record when Trama stops", async () => {
    const { remote, ada } = await setup();
    const adaService = service(ada, shared);
    await adaService.instance.tick();
    await adaService.instance.stop();
    const closed = JSON.parse(await git(["cat-file", "blob", "refs/trama/presence/ada-at-example.com:presence.json"], remote));
    expect(closed.closedAt).not.toBeNull();
    expect(closed.files).toEqual([]);
  });

  it("stays local without a remote, with the person's agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "trama-presence-local-"));
    await git(["init", "-q", "-b", "main"], root, false);
    await git(["config", "user.email", "ada@example.com"], root, false);
    await writeFile(join(root, "a.ts"), "a\n");
    await git(["add", "."], root, false);
    await git([...identity("Ada"), "commit", "-qm", "init"], root, false);
    await git(["branch", "trama/agent-ui"], root, false);
    const now = new Date().toISOString();
    const local = service(root, shared, {
      focusBranch: "trama/agent-ui",
      agents: [{ id: "S-1", name: "Iris", color: "violet", tag: "Interfaccia", worktreeRoot: null, branch: "trama/agent-ui", baseSHA: null, task: { kind: "assignment", title: "Pulsante Annulla" }, since: now, updatedAt: now }],
    });
    await local.instance.tick();
    const view = local.last();
    expect(view.mode).toBe("local");
    expect(view.others).toEqual([]);
    expect(view.hasCollaborators).toBe(false);
    expect(view.self!.record.activeBranch).toBe("trama/agent-ui");
    expect(view.self!.record.alsoOn).toEqual(["main"]);
    expect(view.self!.record.agents.map((a) => [a.name, a.branch])).toEqual([["Iris", "trama/agent-ui"]]);
    await local.instance.stop();
  });

  it("updates at once when the branch changes", async () => {
    const { ada } = await setup();
    const adaService = service(ada, () => null);
    adaService.instance.start(ada);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await adaService.instance.tick();
    expect(adaService.last().self!.record.activeBranch).toBe("main");
    const before = adaService.views.length;
    await git(["checkout", "-q", "-b", "feature/nuovo"], ada, false);
    await git([...identity("Ada"), "commit", "-q", "--allow-empty", "-m", "start"], ada, false);
    for (let i = 0; i < 40 && adaService.last().self!.record.activeBranch !== "feature/nuovo"; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(adaService.views.length).toBeGreaterThan(before);
    expect(adaService.last().self!.record.activeBranch).toBe("feature/nuovo");
    await adaService.instance.stop();
  });
});

describe("local activity", () => {
  it("reads renamed paths from git status", () => {
    expect(statusPaths("R  new.ts\0old.ts\0 M a.ts\0?? b.ts\0")).toEqual(["new.ts", "a.ts", "b.ts"]);
  });

  it("lists branches and the files touched against the default branch", async () => {
    const { ada, bea } = await setup();
    await git(["checkout", "-q", "-b", "feature/x"], ada, false);
    await writeFile(join(ada, "x.ts"), "x\n");
    await git(["add", "."], ada, false);
    await git(["commit", "-qm", "x"], ada, false);
    await writeFile(join(ada, "y.ts"), "y\n");
    const activity = await readLocalActivity(ada);
    expect(activity.current).toBe("feature/x");
    expect(activity.branches.map((b) => b.name).sort()).toEqual(["feature/x", "main"]);
    expect(activity.files).toEqual(["x.ts", "y.ts"]);
    expect(await hasOtherAuthors(bea)).toBe(true);
  });
});
