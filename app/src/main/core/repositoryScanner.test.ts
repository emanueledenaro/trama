import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsExcludedComponent,
  directImports,
  moduleLocation,
  readRepositoryFile,
  scanRepository,
} from "./repositoryScanner";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trama-scan-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}

describe("repository scanner", () => {
  it("groups Sources and src folders into modules", () => {
    expect(moduleLocation("Sources/Core/A.swift")).toEqual({ id: "Sources/Core", name: "Core", relativePath: "Sources/Core" });
    expect(moduleLocation("lib/a.ts")).toEqual({ id: "lib", name: "lib", relativePath: "lib" });
    expect(moduleLocation("index.ts")).toEqual({ id: "root", name: "Root", relativePath: "." });
  });

  it("excludes secrets, hidden folders and build output", () => {
    expect(containsExcludedComponent([".env.local"])).toBe(true);
    expect(containsExcludedComponent(["config", "my-secret.ts"])).toBe(true);
    expect(containsExcludedComponent(["node_modules", "x.js"])).toBe(true);
    expect(containsExcludedComponent(["certs", "server.pem"])).toBe(true);
    expect(containsExcludedComponent(["src", "app.ts"])).toBe(false);
  });

  it("detects Swift and JavaScript imports", () => {
    expect(directImports("import Foundation\n@testable import Core\n", "swift")).toEqual(["Foundation", "Core"]);
    expect(directImports('import x from "./a";\nexport * from "../b";\nconst c = require("c");', "ts")).toEqual([
      "./a",
      "../b",
      "c",
    ]);
  });

  it("builds modules with resolved relative dependencies and skips symlinks", async () => {
    const root = await fixture({
      "src/app/main.ts": 'import { util } from "../lib/util";\nimport React from "react";\n',
      "src/lib/util.ts": "export const util = 1;\n",
      "package.json": "{}",
      "secrets/token.ts": "export const t = 1;",
      "notes.md": "ignored",
    });
    await symlink(join(root, "src/lib/util.ts"), join(root, "src/app/link.ts"));
    const snapshot = await scanRepository(root);
    expect(snapshot.modules.map((m) => m.id)).toEqual(["root", "src/app", "src/lib"]);
    const app = snapshot.modules.find((m) => m.id === "src/app")!;
    expect(app.files.map((f) => f.relativePath)).toEqual(["src/app/main.ts"]);
    expect(app.dependencies).toEqual(["lib", "react"]);
    expect(snapshot.totalFileCount).toBe(3);
    await expect(readRepositoryFile("src/app/link.ts", root)).rejects.toThrow();
    await expect(readRepositoryFile("../etc/passwd", root)).rejects.toThrow();
  });
});
