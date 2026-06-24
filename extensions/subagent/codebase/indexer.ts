/**
 * Codebase indexer — recursive repo scanner
 *
 * Walks a directory tree, collects JS/TS source files, and parses
 * imports, exports, and top-level symbols with pragmatic regexes.
 * Builds dependency and reverse-dependency maps.
 *
 * Dependencies: Node built-ins only (fs, path, crypto).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type FileEntry,
  type ImportEntry,
  type ExportEntry,
  type IndexData,
  type ScanOptions,
  type SymbolEntry,
  CODEBASE_CONTRACT_VERSION,
  DEFAULT_MAX_FILES,
} from "./types.js";

// ── Default exclude patterns ────────────────────────────────────────────────

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".pi",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  "__pycache__",
  ".turbo",
  ".vercel",
  ".output",
  "*.min.js",
  "*.min.mjs",
  "*.min.cjs",
  ".DS_Store",
];

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function shouldExclude(name: string, extraExcludes: string[]): boolean {
  const all = [...DEFAULT_EXCLUDES, ...extraExcludes];
  return all.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      return regex.test(name);
    }
    return name === pattern;
  });
}

function isSourceFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return SOURCE_EXTS.has(ext);
}

function quickHash(content: string): string {
  return crypto
    .createHash("sha256")
    .update(content.slice(0, 16384), "utf8")
    .digest("hex");
}

// ── Regex-based parsers (pragmatic, not spec-complete) ──────────────────────

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;

const IMPORT_NAMED_RE = /\{([^}]+)\}/;

const EXPORT_RE =
  /export\s+\{([^}]+)\}|export\s+default\s+(?:(?:class|function|async\s+function)\s+([A-Za-z_$][\w$]*)|(?!function\b|class\b|async\b)([A-Za-z_$][\w$]*))|export\s+(?:type\s+)?(?:const|let|var|function|class|interface|enum|type|async\s+function)\s+([A-Za-z_$][\w$]*)/g;

const ANONYMOUS_DEFAULT_EXPORT_RE =
  /export\s+default\s+(?:(?:async\s+function|function)\s*\(|class\s*\{|[^A-Za-z_$\s])/;

const SYMBOL_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class|interface|enum|type|async\s+function)\s+(\w+)/g;

function parseImports(content: string, relativeDir: string): ImportEntry[] {
  const imports: ImportEntry[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(IMPORT_RE)) {
    const source = match[1];
    const stmt = match[0];
    const isType = stmt.startsWith("import type");
    const names: string[] = [];
    const namedMatch = stmt.match(IMPORT_NAMED_RE);
    if (namedMatch) {
      names.push(
        ...namedMatch[1]
          .split(",")
          .map((s) => s.replace(/as\s+\w+/, "").trim())
          .filter(Boolean),
      );
    } else if (stmt.includes("* as ")) {
      const nsMatch = stmt.match(/\*\s+as\s+(\w+)/);
      if (nsMatch) names.push(nsMatch[1]);
    } else {
      // default import
      const defaultMatch = stmt.match(/import\s+(\w+)/);
      if (defaultMatch && defaultMatch[1] !== "type") {
        names.push(defaultMatch[1]);
      }
    }

    let resolved = "";
    if (source.startsWith(".")) {
      resolved = path.posix.normalize(path.posix.join(relativeDir, source));
    }

    const key = `${source}|${names.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    imports.push({
      source,
      names,
      isDefault: !namedMatch && !stmt.includes("* as "),
      isType,
      resolved,
    });
  }

  return imports;
}

function parseExports(content: string): ExportEntry[] {
  const exports: ExportEntry[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const re = new RegExp(EXPORT_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    if (match[1]) {
      // export { a, b, c }
      const names = match[1]
        .split(",")
        .map((s) => s.replace(/as\s+\w+/, "").trim())
        .filter(Boolean);
      for (const name of names) {
        if (!seen.has(name)) {
          seen.add(name);
          exports.push({ name, kind: "named" });
        }
      }
    } else if (match[2] || match[3]) {
      // export default <name> or export default function/class <name>
      const name = match[2] ?? match[3];
      if (!seen.has(name)) {
        seen.add(name);
        exports.push({ name, kind: "default" });
      }
    } else if (match[4]) {
      // export const/function/class/interface/enum/type Name
      const name = match[4];
      const isTypeExport =
        /export\s+type\s+/.test(match[0]) ||
        /export\s+interface\s+/.test(match[0]) ||
        /export\s+enum\s+/.test(match[0]);
      if (!seen.has(name)) {
        seen.add(name);
        exports.push({ name, kind: isTypeExport ? "type" : "named" });
      }
    }
  }

  if (ANONYMOUS_DEFAULT_EXPORT_RE.test(content) && !seen.has("default")) {
    exports.push({ name: "default", kind: "default" });
  }

  return exports;
}

function parseSymbols(content: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const re = new RegExp(SYMBOL_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const kind: SymbolEntry["kind"] = (() => {
      const decl = match[0];
      if (decl.includes("function") || decl.includes("async"))
        return "function";
      if (decl.includes("class")) return "class";
      if (decl.includes("interface")) return "interface";
      if (decl.includes("enum")) return "enum";
      if (decl.includes("type")) return "type";
      return "variable";
    })();

    symbols.push({ name, kind });
  }

  return symbols;
}

// ── Walker ──────────────────────────────────────────────────────────────────

interface WalkOptions {
  rootDir: string;
  extraExcludes: string[];
  maxFiles: number;
}

function walkFiles(opts: WalkOptions): string[] {
  const files: string[] = [];
  const stack: string[] = [opts.rootDir];

  while (stack.length > 0 && files.length < opts.maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldExclude(entry.name, opts.extraExcludes)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(fullPath);
        if (files.length >= opts.maxFiles) break;
      }
    }
  }

  return files;
}

function resolveImportPath(
  rawResolved: string,
  knownFiles: Set<string>,
): string | null {
  if (!rawResolved) return null;

  const ext = path.posix.extname(rawResolved);
  const candidates = ext
    ? [
        rawResolved,
        rawResolved.replace(/\.(js|jsx|mjs|cjs)$/i, ".ts"),
        rawResolved.replace(/\.(js|jsx|mjs|cjs)$/i, ".tsx"),
      ]
    : [
        rawResolved,
        `${rawResolved}.ts`,
        `${rawResolved}.tsx`,
        `${rawResolved}.js`,
        `${rawResolved}.jsx`,
        `${rawResolved}/index.ts`,
        `${rawResolved}/index.tsx`,
        `${rawResolved}/index.js`,
        `${rawResolved}/index.jsx`,
      ];

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan a repository and build a fresh index (no cache interaction).
 * Returns the raw IndexData without touching disk.
 */
export function scanRepo(opts: ScanOptions = {}): IndexData {
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const extraExcludes = opts.extraExcludes ?? [];
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  const absFiles = walkFiles({ rootDir, extraExcludes, maxFiles });

  const files: Record<string, FileEntry> = {};
  const dependencies: Record<string, string[]> = {};
  // Temporary set-of-sets for reverse deps (built after)
  const revDepsTemp = new Map<string, Set<string>>();

  let fileCount = 0;

  for (const absPath of absFiles) {
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const relativePath = path.posix.relative(
      rootDir.replace(/\\/g, "/"),
      absPath.replace(/\\/g, "/"),
    );
    const stat = fs.statSync(absPath);
    const relativeDir = path.posix.dirname(relativePath);

    const entry: FileEntry = {
      path: absPath,
      name: path.basename(absPath),
      relativePath,
      imports: parseImports(content, relativeDir === "." ? "" : relativeDir),
      exports: parseExports(content),
      symbols: parseSymbols(content),
      mtime: stat.mtimeMs,
      hash: quickHash(content),
    };

    files[relativePath] = entry;
    fileCount++;
  }

  const knownFiles = new Set(Object.keys(files));

  for (const [relativePath, entry] of Object.entries(files)) {
    const deps: string[] = [];
    for (const imp of entry.imports) {
      const resolved = resolveImportPath(imp.resolved, knownFiles);
      if (!resolved) {
        imp.resolved = "";
        continue;
      }

      imp.resolved = resolved;
      deps.push(resolved);
      let revSet = revDepsTemp.get(resolved);
      if (!revSet) {
        revSet = new Set();
        revDepsTemp.set(resolved, revSet);
      }
      revSet.add(relativePath);
    }
    dependencies[relativePath] = [...new Set(deps)];
  }

  // Convert reverse deps Map<Set> → Record<string, string[]>
  const reverseDependencies: Record<string, string[]> = {};
  for (const [target, sources] of revDepsTemp) {
    reverseDependencies[target] = [...sources];
  }

  // Ensure every file has entries in maps
  for (const rel of Object.keys(files)) {
    if (!dependencies[rel]) dependencies[rel] = [];
    if (!reverseDependencies[rel]) reverseDependencies[rel] = [];
  }

  return {
    contractVersion: CODEBASE_CONTRACT_VERSION,
    rootDir,
    scannedAt: Date.now(),
    fileCount,
    files,
    dependencies,
    reverseDependencies,
  };
}
