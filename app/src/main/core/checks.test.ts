import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availableChecks, runReadOnlyCheck, sandboxedCommand } from "./checks";
import { git } from "./process";

const fake = join(import.meta.dirname, "../../../test-fixtures/fake-codex.mjs");

describe("read-only checks", () => {
  it("wraps the command in the Codex sandbox with a scratch-only profile", () => {
    const command = sandboxedCommand("/bin/codex", ["git", "status"], "/tmp/scratch");
    expect(command.slice(0, 6)).toEqual(["/bin/codex", "sandbox", "-P", "trama_check_sandbox_v1", "-C", "/tmp/scratch"]);
    expect(command).toContain("--");
    expect(command.slice(-2)).toEqual(["git", "status"]);
  });

  it("runs git_status and reports an unchanged checkout", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-check-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "a.txt"), "x\n");
    expect(availableChecks(repo)).toEqual(["git_status", "git_diff_check"]);
    const result = await runReadOnlyCheck("git_status", repo, { codexExecutable: fake, scratchRoot: await mkdtemp(join(tmpdir(), "trama-scratch-")) });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("?? a.txt");
    expect(result.checkoutUnchanged).toBe(true);
    await expect(runReadOnlyCheck("swift_test", repo, { codexExecutable: fake, scratchRoot: tmpdir() })).rejects.toThrow(/does not apply/);
  });
});
