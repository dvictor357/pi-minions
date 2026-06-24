/**
 * Codebase index types
 *
 * Schema for the sidecar cache file at .pi/codebase-index.json.
 * Increment contractVersion on breaking changes so readers can bail
 * rather than misread a newer shape.
 */

/** Increment when the cache schema changes in a breaking way. */
export const CODEBASE_CONTRACT_VERSION = 1;

/** Maximum files scanned per run (safety limit, overridable). */
export const DEFAULT_MAX_FILES = 50_000;

export interface SymbolEntry {
  name: string;
  kind:
    | "function"
    | "class"
    | "variable"
    | "type"
    | "interface"
    | "enum"
    | "other";
}

export interface ImportEntry {
  /** Module specifier or relative path */
  source: string;
  names: string[];
  isDefault: boolean;
  isType: boolean;
  /** If resolved, the relative path of the resolved file (empty if unresolved or external) */
  resolved: string;
}

export interface ExportEntry {
  name: string;
  kind: "default" | "named" | "type";
}

export interface FileEntry {
  /** Absolute path */
  path: string;
  /** basename */
  name: string;
  /** Repo-relative path (stripped root) */
  relativePath: string;
  /** Import statements found */
  imports: ImportEntry[];
  /** Export statements found */
  exports: ExportEntry[];
  /** Top-level symbols defined */
  symbols: SymbolEntry[];
  /** mtime at scan time (epoch ms) */
  mtime: number;
  /** Quick content hash (SHA-256 of first 16 KiB, for staleness) */
  hash: string;
}

export interface IndexData {
  contractVersion: number;
  rootDir: string;
  scannedAt: number;
  fileCount: number;
  /** Keyed by relative path */
  files: Record<string, FileEntry>;
  /** Dependency map: relativePath → relativePaths it imports */
  dependencies: Record<string, string[]>;
  /** Reverse dependency map: relativePath → relativePaths that import it */
  reverseDependencies: Record<string, string[]>;
}

/** Options for scanIndex. */
export interface ScanOptions {
  /** Repo root (default: cwd). */
  rootDir?: string;
  /** Extra glob patterns to exclude (added to defaults). */
  extraExcludes?: string[];
  /** Skip staleness check and force a re-scan. */
  force?: boolean;
  /** Safety limit on scanned files. */
  maxFiles?: number;
}

/** Options for query functions. */
export interface QueryOptions {
  rootDir?: string;
}
