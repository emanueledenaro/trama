import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditError } from "./audit";
import { captureFocusRange, fixedPointSuggestions, readFixedPointRef } from "./focusScope";
import { git } from "./process";

async function commit(repo: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  await git(["add", "."], repo, false);
  await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", message], repo, false);
}

async function repository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "trama-focus-"));
  await git(["init", "-b", "main"], repo, false);
  await commit(repo, { "Sources/Orders/Order.swift": "struct Order {}\n", "Sources/Billing/Bill.swift": "struct Bill {}\n" }, "init");
  await git(["tag", "v1.0.0"], repo, false);
  await commit(repo, { "Sources/Orders/Order.swift": "struct Order { let paid: Bool }\n", ".env": "SECRET=1\n" }, "feat: track paid orders (#12)");
  await commit(repo, { "README.md": "Negozio\n" }, "docs: add the readme");
  return repo;
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AuditError);
  return error as AuditError;
};

describe("the fixed point of a module or the project (F03)", () => {
  it("captures the diff from the fixed point to HEAD once, without sensitive files, with the commits", async () => {
    const repo = await repository();
    const range = await captureFocusRange(repo, " v1.0.0 ", null);
    expect(range.ref).toBe("v1.0.0");
    expect(range.fixedPoint).toBe((await git(["rev-parse", "v1.0.0^{commit}"], repo)).trim());
    expect(range.headSHA).toBe((await git(["rev-parse", "HEAD"], repo)).trim());
    expect(range.changedFiles).toEqual(["README.md", "Sources/Orders/Order.swift"]);
    expect(range.excludedSensitiveFiles).toEqual([".env"]);
    expect(range.diff).toContain("+struct Order { let paid: Bool }");
    expect(range.diff).not.toContain("SECRET");
    expect(range.commits.map((c) => c.replace(/^[0-9a-f]+ /, ""))).toEqual(["docs: add the readme", "feat: track paid orders (#12)"]);
  });

  it("keeps a module's diff and commits inside its folder", async () => {
    const repo = await repository();
    const range = await captureFocusRange(repo, "v1.0.0", "Sources/Orders");
    expect(range.changedFiles).toEqual(["Sources/Orders/Order.swift"]);
    expect(range.diff).not.toContain("README.md");
    expect(range.commits.map((c) => c.replace(/^[0-9a-f]+ /, ""))).toEqual(["feat: track paid orders (#12)"]);
  });

  it("fails clearly on a fixed point that does not exist, before any check or axis", async () => {
    const repo = await repository();
    const error = await refusal(captureFocusRange(repo, "release-9", null));
    expect(error.code).toBe("fixed_point_not_found");
    expect(error.message).toBe('Il punto fisso "release-9" non esiste in questo repository: scrivi un commit, un branch o un tag che esiste.');
  });

  it("fails clearly on an empty diff, also when the module did not change", async () => {
    const repo = await repository();
    expect((await refusal(captureFocusRange(repo, "HEAD", null))).message).toBe('Nessun cambiamento tra il punto fisso "HEAD" e HEAD: scegli un punto fisso più indietro.');
    const module = await refusal(captureFocusRange(repo, "v1.0.0", "Sources/Billing"));
    expect(module.code).toBe("empty_diff");
    expect(module.message).toContain("nel modulo `Sources/Billing`");
  });

  it("refuses text that could pass for an option or a range", async () => {
    for (const text of ["", "  ", "--output=/tmp/x", "main..HEAD", "main HEAD", "a\nb"]) {
      expect(() => readFixedPointRef(text)).toThrow(AuditError);
    }
    expect(readFixedPointRef("HEAD~5")).toBe("HEAD~5");
    expect(readFixedPointRef("origin/main")).toBe("origin/main");
  });

  it("suggests the default branch when HEAD is ahead of it, the last tag and a few steps back", async () => {
    const repo = await repository();
    expect(await fixedPointSuggestions(repo)).toEqual(["v1.0.0", "HEAD~1"]);
    await git(["checkout", "-b", "feature/paid"], repo, false);
    await commit(repo, { "Sources/Orders/Refund.swift": "struct Refund {}\n" }, "feat: add refunds");
    expect(await fixedPointSuggestions(repo)).toEqual(["main", "v1.0.0", "HEAD~1"]);
  });
});
