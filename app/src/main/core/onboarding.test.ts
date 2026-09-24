import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate } from "@shared/domain";
import { isExerciseAssessment } from "@shared/onboarding";
import { simulateColleagueChanges } from "./onboarding";
import { git } from "./process";
import { prepareWorktree, reviewWorktree } from "./workspace";

describe("conflict exercise", () => {
  it("compares the candidate with a compatible and an incompatible simulated change, locally", async () => {
    const repo = await mkdtemp(join(tmpdir(), "trama-exercise-"));
    await git(["init", "-b", "main"], repo, false);
    await writeFile(join(repo, "Order.swift"), "struct Order {\n  var status = \"open\"\n}\n");
    await git(["add", "."], repo, false);
    await git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "init"], repo, false);
    const head = (await git(["rev-parse", "HEAD"], repo)).trim();
    const session = await prepareWorktree(repo, "Ada", await mkdtemp(join(tmpdir(), "trama-wt-")));
    await writeFile(join(session.worktreeRoot, "Order.swift"), "struct Order {\n  var status = \"in_review\"\n}\n");
    const review = await reviewWorktree(session);
    const candidate = { id: "C-1", snapshotId: review.snapshotId, changedFiles: review.changedFiles } as Candidate;
    const root = await mkdtemp(join(tmpdir(), "trama-exercise-root-"));

    const [compatible, incompatible] = await simulateColleagueChanges({
      candidate,
      session,
      exerciseRoot: join(root, "Exercise"),
      cacheRoot: join(root, "Cache"),
      probeRoot: join(root, "Probe"),
    });

    expect(compatible!.classification).toBe("clean");
    expect(incompatible!.classification).toBe("conflict");
    expect(incompatible!.conflictingFiles).toEqual(["Order.swift"]);
    expect(isExerciseAssessment(compatible!) && isExerciseAssessment(incompatible!)).toBe(true);
    // The project and the worktree stay as they were.
    expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(head);
    expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
    expect((await reviewWorktree(session)).snapshotId).toBe(review.snapshotId);
  });
});
