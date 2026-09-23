export interface RepositoryFile {
  id: string;
  relativePath: string;
  lineCount: number;
  contentHash: string;
}

export interface RepositoryModule {
  id: string;
  name: string;
  summary: string;
  relativePath: string;
  files: RepositoryFile[];
  dependencies: string[];
  symbol: string;
}

export interface RepositorySnapshot {
  name: string;
  rootPath: string;
  branch: string | null;
  headSHA: string | null;
  contextualInputHashes: Record<string, string>;
  modules: RepositoryModule[];
  totalFileCount: number;
  scannedAt: string;
  warnings: string[];
  isDemo: boolean;
}
