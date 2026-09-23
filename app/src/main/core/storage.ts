import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppSettings, MonitorState, ProjectDocument, RecentProject } from "@shared/domain";
import type { ImageAttachmentInput } from "@shared/ipc";
import type { OnboardingState } from "@shared/onboarding";
import { normalizeDocument } from "./document";

const MAXIMUM_RECENT_PROJECTS = 20;
const MAXIMUM_IMAGES = 8;
const MAXIMUM_IMAGE_BYTES = 10 * 1_048_576;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export async function writeAtomically(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`Il file di stato è un collegamento simbolico: ${path}`);
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export class AppStorage {
  constructor(readonly root: string) {}

  get examplesDirectory(): string {
    return join(this.root, "Examples");
  }

  async hasRecentProjects(): Promise<boolean> {
    return existsSync(join(this.root, "recent-projects.json"));
  }

  async loadRecentProjects(): Promise<RecentProject[]> {
    try {
      const projects = (await readJson<RecentProject[]>(join(this.root, "recent-projects.json"))) ?? [];
      return projects.filter((p) => p && typeof p.id === "string" && typeof p.path === "string");
    } catch {
      return [];
    }
  }

  async saveRecentProjects(projects: RecentProject[]): Promise<void> {
    const sorted = [...projects]
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      .slice(0, MAXIMUM_RECENT_PROJECTS);
    await writeAtomically(join(this.root, "recent-projects.json"), JSON.stringify(sorted, null, 2));
  }

  async loadSettings(): Promise<
    Partial<AppSettings> & { lastProjectId?: string | null; monitor?: Partial<Omit<MonitorState, "status">>; onboarding?: Partial<OnboardingState> }
  > {
    try {
      return (await readJson(join(this.root, "settings.json"))) ?? {};
    } catch {
      return {};
    }
  }

  async saveSettings(
    settings: AppSettings & { lastProjectId: string | null; monitor: Omit<MonitorState, "status">; onboarding?: OnboardingState },
  ): Promise<void> {
    await writeAtomically(join(this.root, "settings.json"), JSON.stringify(settings, null, 2));
  }

  documentPath(projectId: string): string {
    const hash = createHash("sha256").update(projectId).digest("hex");
    return join(this.root, "Projects", `${hash}.json`);
  }

  /**
   * Loads a project document. An unreadable file is kept untouched and reported as not writable,
   * so Trama never overwrites state it could not read.
   */
  async loadDocument(projectId: string): Promise<{ document: ProjectDocument | null; writable: boolean; error: string | null }> {
    const path = this.documentPath(projectId);
    try {
      const raw = await readJson<Partial<ProjectDocument>>(path);
      return { document: raw ? normalizeDocument(raw, projectId) : null, writable: true, error: null };
    } catch (error) {
      return {
        document: null,
        writable: false,
        error: `Lo stato del progetto non è leggibile e resta invariato in ${path}. ${(error as Error).message}`,
      };
    }
  }

  /** Stores composer images inside Trama's folder and returns their absolute paths. */
  async saveAttachments(projectId: string, images: ImageAttachmentInput[]): Promise<string[]> {
    if (images.length > MAXIMUM_IMAGES) throw new Error(`Puoi allegare al massimo ${MAXIMUM_IMAGES} immagini per messaggio.`);
    const directory = join(this.root, "Attachments", createHash("sha256").update(projectId).digest("hex").slice(0, 16));
    const paths: string[] = [];
    for (const image of images) {
      const extension = IMAGE_EXTENSIONS[image.mimeType];
      if (!extension) throw new Error(`Formato immagine non supportato: ${image.name}.`);
      const data = Buffer.from(image.dataBase64, "base64");
      if (data.length === 0 || data.length > MAXIMUM_IMAGE_BYTES) throw new Error(`L'immagine ${image.name} supera 10 MB o è vuota.`);
      const path = join(directory, `${randomUUID()}.${extension}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path, data, { mode: 0o600 });
      paths.push(path);
    }
    return paths;
  }

  async saveDocument(document: ProjectDocument): Promise<void> {
    await writeAtomically(this.documentPath(document.projectId), JSON.stringify(document));
  }
}
