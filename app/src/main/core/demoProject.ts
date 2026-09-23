import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MARKER = ".trama-example";

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Trama", "-c", "user.email=demo@trama.local", ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()),
    );
  });
}

/** Copies the bundled example into Trama's folder as a git repository, once. */
export async function prepareDemoProject(resourceDirectory: string, examplesDirectory: string): Promise<string> {
  const destination = join(examplesDirectory, "Negozio");
  if (existsSync(destination)) {
    if (!existsSync(join(destination, MARKER))) {
      throw new Error("La cartella dell'esempio esiste già e non è gestita da Trama. Spostala o rinominala per ricreare il progetto di esempio.");
    }
    return destination;
  }
  await mkdir(examplesDirectory, { recursive: true });
  const staging = join(examplesDirectory, `.prepare-${randomUUID()}`);
  try {
    await cp(resourceDirectory, staging, { recursive: true });
    await writeFile(join(staging, MARKER), "Trama example v1\n");
    await writeFile(join(staging, ".gitignore"), ".build/\n.swiftpm/\n.DS_Store\n");
    await git(["init", "-b", "main"], staging);
    await git(["add", "."], staging);
    await git(["commit", "-m", "Progetto di esempio iniziale"], staging);
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return destination;
}
