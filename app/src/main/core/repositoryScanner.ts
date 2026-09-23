import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { RepositoryFile, RepositoryModule, RepositorySnapshot } from "@shared/repository";

const MAXIMUM_FILE_COUNT = 3_000;
const MAXIMUM_FILE_BYTES = 256 * 1_024;
const SOURCE_EXTENSIONS = new Set(["swift", "js", "ts", "mjs", "cjs", "jsx", "tsx"]);

export class RepositoryScannerError extends Error {
  constructor(
    readonly kind: "invalidRoot" | "invalidRelativePath" | "unsafePath" | "fileTooLarge",
    readonly path: string,
  ) {
    super(
      {
        invalidRoot: `La cartella del repository non è leggibile: ${path}`,
        invalidRelativePath: `Il percorso deve essere relativo: ${path}`,
        unsafePath: `Il percorso non è disponibile per la lettura: ${path}`,
        fileTooLarge: `Il file supera il limite di lettura: ${path}`,
      }[kind],
    );
  }
}

interface ModuleBuilder {
  id: string;
  name: string;
  relativePath: string;
  files: RepositoryFile[];
  dependencies: Set<string>;
}

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function containsExcludedComponent(components: string[]): boolean {
  return components.some((component) => {
    const lower = component.toLowerCase();
    if (lower.startsWith(".") || lower === "node_modules" || lower === "build" || lower === "dist") {
      return true;
    }
    if (lower.includes("secret") || lower.includes("credential") || lower.startsWith(".env")) {
      return true;
    }
    return lower.endsWith(".pem") || lower.endsWith(".key") || lower.endsWith(".p12");
  });
}

export function isSupportedSourceFile(name: string): boolean {
  const extension = extname(name).slice(1).toLowerCase();
  if (SOURCE_EXTENSIONS.has(extension)) return true;
  return extension === "json" && name === "package.json";
}

export function moduleLocation(relativePath: string): { id: string; name: string; relativePath: string } {
  const components = relativePath.split("/").filter(Boolean);
  if (components.length >= 3 && ["sources", "src"].includes(components[0]!.toLowerCase())) {
    const location = `${components[0]}/${components[1]}`;
    return { id: location, name: components[1]!, relativePath: location };
  }
  if (components.length >= 2) {
    return { id: components[0]!, name: components[0]!, relativePath: components[0]! };
  }
  return { id: "root", name: "Root", relativePath: "." };
}

export function directImports(source: string, extension: string): string[] {
  let pattern: RegExp | null = null;
  switch (extension.toLowerCase()) {
    case "swift":
      pattern = /^\s*(?:@testable\s+)?import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm;
      break;
    case "js":
    case "ts":
    case "mjs":
    case "cjs":
    case "jsx":
    case "tsx":
      pattern = /\b(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+[^\n;]*?\s+from\s+|require\s*\()\s*["']([^"']+)["']/gm;
      break;
  }
  if (!pattern) return [];
  return [...source.matchAll(pattern)].map((match) => match[1]!).filter(Boolean);
}

export function moduleIdForRelativeImport(
  reference: string,
  sourcePath: string,
  locationsById: Map<string, string>,
): string | null {
  const components = sourcePath.split("/").slice(0, -1);
  for (const component of reference.split("/")) {
    if (component === "." || component === "") continue;
    if (component === "..") {
      if (components.length === 0) return null;
      components.pop();
    } else {
      components.push(component);
    }
  }
  const target = components.join("/");
  const sorted = [...locationsById.entries()].sort((a, b) => b[1].length - a[1].length);
  const match = sorted.find(([, path]) => target === path || target.startsWith(`${path}/`));
  return match ? match[0] : null;
}

export function lineCount(contents: string): number {
  if (contents.length === 0) return 0;
  return contents.split(/\r\n|\r|\n/).length;
}

export function contentHash(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

async function canonicalRoot(root: string): Promise<string> {
  try {
    const resolved = await realpath(root);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("not a directory");
    return resolved;
  } catch {
    throw new RepositoryScannerError("invalidRoot", root);
  }
}

async function safeFilePath(relativePath: string, root: string): Promise<string> {
  if (!relativePath || relativePath.startsWith("/")) {
    throw new RepositoryScannerError("invalidRelativePath", relativePath);
  }
  const components = relativePath.split("/");
  if (components.some((c) => c === "" || c === "." || c === "..")) {
    throw new RepositoryScannerError("invalidRelativePath", relativePath);
  }
  if (containsExcludedComponent(components)) {
    throw new RepositoryScannerError("unsafePath", relativePath);
  }
  let candidate = root;
  for (const component of components) {
    candidate = join(candidate, component);
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new RepositoryScannerError("unsafePath", relativePath);
      }
    } catch (error) {
      if (error instanceof RepositoryScannerError) throw error;
      throw new RepositoryScannerError("unsafePath", relativePath);
    }
  }
  const resolved = await realpath(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new RepositoryScannerError("unsafePath", relativePath);
  }
  return resolved;
}

export async function readRepositoryFile(relativePath: string, root: string): Promise<string> {
  const rootPath = await canonicalRoot(root);
  const filePath = await safeFilePath(relativePath, rootPath);
  const info = await stat(filePath);
  if (!info.isFile()) throw new RepositoryScannerError("unsafePath", relativePath);
  if (info.size > MAXIMUM_FILE_BYTES) throw new RepositoryScannerError("fileTooLarge", relativePath);
  const buffer = await readFile(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function gitOutput(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", ...args],
      {
        cwd,
        timeout: 3_000,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_CEILING_DIRECTORIES: cwd,
        },
      },
      (error, stdout) => resolve(error ? null : stdout.trim()),
    );
  });
}

async function gitMetadata(root: string): Promise<{ branch: string | null; headSHA: string | null }> {
  if (!existsSync(join(root, ".git"))) return { branch: null, headSHA: null };
  const headSHA = await gitOutput(["rev-parse", "--verify", "HEAD"], root);
  if (!headSHA) return { branch: null, headSHA: null };
  const branch = await gitOutput(["branch", "--show-current"], root);
  return { branch: branch || null, headSHA };
}

export async function scanRepository(root: string, isDemo = false): Promise<RepositorySnapshot> {
  const rootPath = await canonicalRoot(root);
  const builders = new Map<string, ModuleBuilder>();
  const importsByFile = new Map<string, string[]>();
  const warnings: string[] = [];
  let accepted = 0;
  let stopped = false;

  const walk = async (directory: string, prefix: string[]): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      warnings.push(`Impossibile leggere gli attributi di ${prefix.join("/") || "."}.`);
      return;
    }
    entries.sort((a, b) => naturalCompare(a.name, b.name));
    for (const entry of entries) {
      if (stopped) return;
      const components = [...prefix, entry.name];
      const relativePath = components.join("/");
      // Symbolic links are never followed or indexed.
      if (containsExcludedComponent(components) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), components);
        continue;
      }
      if (!entry.isFile() || !isSupportedSourceFile(entry.name)) continue;
      if (accepted >= MAXIMUM_FILE_COUNT) {
        warnings.push(`La scansione si è fermata a ${MAXIMUM_FILE_COUNT} file sorgente.`);
        stopped = true;
        return;
      }
      const info = await stat(join(directory, entry.name)).catch(() => null);
      if (!info || info.size > MAXIMUM_FILE_BYTES) {
        if (info) warnings.push(`File ignorato perché supera ${MAXIMUM_FILE_BYTES / 1_024} KB: ${relativePath}.`);
        continue;
      }
      let contents: string;
      try {
        contents = await readRepositoryFile(relativePath, rootPath);
      } catch {
        warnings.push(`File non leggibile o non UTF-8 ignorato: ${relativePath}.`);
        continue;
      }
      const location = moduleLocation(relativePath);
      const builder = builders.get(location.id) ?? {
        ...location,
        files: [],
        dependencies: new Set<string>(),
      };
      builder.files.push({
        id: relativePath,
        relativePath,
        lineCount: lineCount(contents),
        contentHash: contentHash(contents),
      });
      builders.set(location.id, builder);
      importsByFile.set(relativePath, directImports(contents, extname(entry.name).slice(1)));
      accepted += 1;
    }
  };
  await walk(rootPath, []);

  const locationsById = new Map([...builders.values()].map((b) => [b.id, b.relativePath]));
  for (const [moduleId, builder] of builders) {
    for (const file of builder.files) {
      for (const reference of importsByFile.get(file.relativePath) ?? []) {
        if (reference.startsWith(".")) {
          const dependencyId = moduleIdForRelativeImport(reference, file.relativePath, locationsById);
          const dependency = dependencyId ? builders.get(dependencyId) : undefined;
          if (dependency && dependencyId !== moduleId) builder.dependencies.add(dependency.name);
        } else {
          builder.dependencies.add(reference);
        }
      }
    }
  }

  const modules: RepositoryModule[] = [...builders.values()]
    .map((builder) => {
      const files = [...builder.files].sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
      return {
        id: builder.id,
        name: builder.name,
        summary: `${files.length} file rilevati in ${builder.relativePath}. Per Swift sono riportati solo gli import diretti; per gli altri linguaggi restano disponibili i file e gli import relativi risolvibili.`,
        relativePath: builder.relativePath,
        files,
        dependencies: [...builder.dependencies].sort(naturalCompare),
        symbol: "folder",
      };
    })
    .sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  const contextualInputHashes: Record<string, string> = {};
  for (const name of ["README.md", "CONTEXT.md"]) {
    if (!existsSync(join(rootPath, name))) continue;
    try {
      contextualInputHashes[name] = contentHash(await readRepositoryFile(name, rootPath));
    } catch (error) {
      warnings.push(`File di contesto ignorato: ${name}. ${(error as Error).message}`);
    }
  }
  const git = await gitMetadata(rootPath);
  return {
    name: basename(rootPath),
    rootPath,
    branch: git.branch,
    headSHA: git.headSHA,
    contextualInputHashes,
    modules,
    totalFileCount: accepted,
    scannedAt: new Date().toISOString(),
    warnings,
    isDemo,
  };
}
