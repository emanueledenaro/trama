import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyDocument } from "./document";
import { AppStorage } from "./storage";

describe("AppStorage", () => {
  it("saves documents privately and marks unreadable state as not writable", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const document = emptyDocument("p1");
    document.requests.push({ id: "r", text: "t", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null });
    await storage.saveDocument(document);
    expect((await stat(storage.documentPath("p1"))).mode & 0o777).toBe(0o600);
    const loaded = await storage.loadDocument("p1");
    expect(loaded.document?.requests[0]?.state).toBe("interrupted");

    await writeFile(storage.documentPath("p1"), "{ non è json");
    const broken = await storage.loadDocument("p1");
    expect(broken).toMatchObject({ document: null, writable: false });
    expect(await readFile(storage.documentPath("p1"), "utf8")).toBe("{ non è json");
  });

  // A deferred save that started first must not finish last and put the older document back (#169).
  it("keeps the latest of two overlapping saves", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const older = emptyDocument("p1");
    older.composerDraft = "x".repeat(32 * 1_048_576);
    const newer = emptyDocument("p1");
    newer.composerDraft = "ultima";
    await Promise.all([storage.saveDocument(older), storage.saveDocument(newer)]);
    expect((await storage.loadDocument("p1")).document?.composerDraft).toBe("ultima");
  });

  it("accepts only supported images within the limits", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const png = { name: "a.png", mimeType: "image/png", dataBase64: Buffer.from("png").toString("base64") };
    const [path] = await storage.saveAttachments("p1", [png]);
    expect(await readFile(path!, "utf8")).toBe("png");
    await expect(storage.saveAttachments("p1", [{ ...png, mimeType: "image/svg+xml" }])).rejects.toThrow(/non supportato/);
    await expect(storage.saveAttachments("p1", Array(9).fill(png))).rejects.toThrow(/al massimo/);
  });
});
