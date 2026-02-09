// Plugin Install System — Install plugins from npm, archives, local paths
// Simplified port from OpenClaw's src/plugins/install.ts

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { resolvePluginsDir, ensureDir } from "../config/paths.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export type PluginInstallLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type InstallPluginResult =
  | { ok: true; pluginId: string; targetDir: string; version?: string }
  | { ok: false; error: string };

// ══════════════════════════════════════════════
// ── Validation Helpers ──
// ══════════════════════════════════════════════

export function validatePluginId(pluginId: string): string | null {
  if (!pluginId) return "invalid plugin name: missing";
  if (pluginId === "." || pluginId === "..") return "invalid plugin name: reserved path segment";
  if (pluginId.includes("/") || pluginId.includes("\\")) return "invalid plugin name: path separators not allowed";
  if (/[<>:"|?*]/.test(pluginId)) return "invalid plugin name: contains illegal characters";
  return null;
}

function safeDirName(input: string): string {
  return input.trim().replaceAll("/", "__").replaceAll("\\", "__");
}

function isPathInside(basePath: string, candidatePath: string): boolean {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function unscopedPackageName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.includes("/") ? (trimmed.split("/").pop() ?? trimmed) : trimmed;
}

function resolveArchiveKind(filePath: string): "zip" | "tgz" | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return "tgz";
  return null;
}

function resolveUserPath(raw: string): string {
  if (raw.startsWith("~")) return path.join(os.homedir(), raw.slice(1));
  return path.resolve(raw);
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function resolveSafeInstallDir(
  extensionsDir: string,
  pluginId: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const targetDir = path.join(extensionsDir, safeDirName(pluginId));
  const resolvedBase = path.resolve(extensionsDir);
  const resolvedTarget = path.resolve(targetDir);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { ok: false, error: "invalid plugin name: path traversal detected" };
  }
  return { ok: true, path: targetDir };
}

// ══════════════════════════════════════════════
// ── Shell Command Runner ──
// ══════════════════════════════════════════════

function runCommand(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const [cmd, ...rest] = args;
    const child = execFile(cmd, rest, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code ?? 1 : 0, stdout, stderr });
    });
  });
}

// ══════════════════════════════════════════════
// ── Install from Local Path (auto-detect file/dir/archive) ──
// ══════════════════════════════════════════════

export async function installPluginFromPath(params: {
  path: string;
  extensionsDir?: string;
  timeoutMs?: number;
  logger?: PluginInstallLogger;
  dryRun?: boolean;
}): Promise<InstallPluginResult> {
  const resolved = resolveUserPath(params.path);
  if (!(await fileExists(resolved))) {
    return { ok: false, error: `path not found: ${resolved}` };
  }

  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    return await installPluginFromDir({
      dirPath: resolved,
      extensionsDir: params.extensionsDir,
      timeoutMs: params.timeoutMs,
      logger: params.logger,
      dryRun: params.dryRun,
    });
  }

  const archiveKind = resolveArchiveKind(resolved);
  if (archiveKind) {
    return await installPluginFromArchive({
      archivePath: resolved,
      extensionsDir: params.extensionsDir,
      timeoutMs: params.timeoutMs,
      logger: params.logger,
      dryRun: params.dryRun,
    });
  }

  return await installPluginFromFile({
    filePath: resolved,
    extensionsDir: params.extensionsDir,
    logger: params.logger,
    dryRun: params.dryRun,
  });
}

// ══════════════════════════════════════════════
// ── Install from npm Spec ──
// ══════════════════════════════════════════════

export async function installPluginFromNpmSpec(params: {
  spec: string;
  extensionsDir?: string;
  timeoutMs?: number;
  logger?: PluginInstallLogger;
  dryRun?: boolean;
}): Promise<InstallPluginResult> {
  const logger = params.logger ?? {};
  const timeoutMs = params.timeoutMs ?? 120_000;
  const spec = params.spec.trim();
  if (!spec) return { ok: false, error: "missing npm spec" };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinyclaw-npm-pack-"));

  logger.info?.(`Downloading ${spec}…`);
  const res = await runCommand(["npm", "pack", spec], { cwd: tmpDir, timeoutMs: Math.max(timeoutMs, 300_000) });
  if (res.code !== 0) {
    return { ok: false, error: `npm pack failed: ${res.stderr.trim() || res.stdout.trim()}` };
  }

  const packed = (res.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean).pop();
  if (!packed) return { ok: false, error: "npm pack produced no archive" };

  const archivePath = path.join(tmpDir, packed);
  return await installPluginFromArchive({
    archivePath,
    extensionsDir: params.extensionsDir,
    timeoutMs,
    logger,
    dryRun: params.dryRun,
  });
}

// ══════════════════════════════════════════════
// ── Install from Archive (.zip / .tgz) ──
// ══════════════════════════════════════════════

export async function installPluginFromArchive(params: {
  archivePath: string;
  extensionsDir?: string;
  timeoutMs?: number;
  logger?: PluginInstallLogger;
  dryRun?: boolean;
}): Promise<InstallPluginResult> {
  const logger = params.logger ?? {};
  const timeoutMs = params.timeoutMs ?? 120_000;
  const archivePath = resolveUserPath(params.archivePath);

  if (!(await fileExists(archivePath))) return { ok: false, error: `archive not found: ${archivePath}` };

  const kind = resolveArchiveKind(archivePath);
  if (!kind) return { ok: false, error: `unsupported archive: ${archivePath}` };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinyclaw-plugin-"));
  const extractDir = path.join(tmpDir, "extract");
  await fs.mkdir(extractDir, { recursive: true });

  logger.info?.(`Extracting ${archivePath}…`);

  // Extract
  if (kind === "tgz") {
    const res = await runCommand(["tar", "xzf", archivePath, "-C", extractDir], { timeoutMs });
    if (res.code !== 0) return { ok: false, error: `tar extract failed: ${res.stderr.trim()}` };
  } else {
    const res = await runCommand(["unzip", "-o", archivePath, "-d", extractDir], { timeoutMs });
    if (res.code !== 0) return { ok: false, error: `unzip failed: ${res.stderr.trim()}` };
  }

  // Find package root (may be nested in a "package/" directory from npm pack)
  let packageDir = extractDir;
  const entries = await fs.readdir(extractDir);
  if (entries.length === 1) {
    const single = path.join(extractDir, entries[0]);
    const stat = await fs.stat(single);
    if (stat.isDirectory()) packageDir = single;
  }

  return await installPluginFromDir({
    dirPath: packageDir,
    extensionsDir: params.extensionsDir,
    timeoutMs,
    logger,
    dryRun: params.dryRun,
  });
}

// ══════════════════════════════════════════════
// ── Install from Directory ──
// ══════════════════════════════════════════════

export async function installPluginFromDir(params: {
  dirPath: string;
  extensionsDir?: string;
  timeoutMs?: number;
  logger?: PluginInstallLogger;
  dryRun?: boolean;
}): Promise<InstallPluginResult> {
  const logger = params.logger ?? {};
  const timeoutMs = params.timeoutMs ?? 120_000;
  const dirPath = resolveUserPath(params.dirPath);

  if (!(await fileExists(dirPath))) return { ok: false, error: `directory not found: ${dirPath}` };
  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) return { ok: false, error: `not a directory: ${dirPath}` };

  // Try to read package.json for metadata
  let pluginId = path.basename(dirPath);
  let version: string | undefined;
  const manifestPath = path.join(dirPath, "package.json");
  if (await fileExists(manifestPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      if (raw.name) pluginId = unscopedPackageName(raw.name);
      if (raw.version) version = raw.version;
    } catch { /* ignore malformed manifest */ }
  }

  const pluginIdError = validatePluginId(pluginId);
  if (pluginIdError) return { ok: false, error: pluginIdError };

  const extensionsDir = params.extensionsDir
    ? resolveUserPath(params.extensionsDir)
    : resolvePluginsDir();
  await fs.mkdir(extensionsDir, { recursive: true });

  const targetDirResult = resolveSafeInstallDir(extensionsDir, pluginId);
  if (!targetDirResult.ok) return { ok: false, error: targetDirResult.error };
  const targetDir = targetDirResult.path;

  if (await fileExists(targetDir)) {
    return { ok: false, error: `plugin already exists: ${targetDir} (delete it first)` };
  }

  if (params.dryRun) {
    return { ok: true, pluginId, targetDir, version };
  }

  // Path traversal check on all files
  const allFiles = await walkDir(dirPath);
  for (const file of allFiles) {
    const relative = path.relative(dirPath, file);
    const destPath = path.join(targetDir, relative);
    if (!isPathInside(targetDir, destPath)) {
      return { ok: false, error: `path traversal detected in plugin files: ${relative}` };
    }
  }

  logger.info?.(`Installing to ${targetDir}…`);
  await fs.cp(dirPath, targetDir, { recursive: true });

  // Install npm deps if package.json with dependencies exists
  const targetManifest = path.join(targetDir, "package.json");
  if (await fileExists(targetManifest)) {
    try {
      const raw = JSON.parse(await fs.readFile(targetManifest, "utf-8"));
      if (raw.dependencies && Object.keys(raw.dependencies).length > 0) {
        logger.info?.("Installing plugin dependencies…");
        const npmRes = await runCommand(["npm", "install", "--omit=dev", "--silent"], {
          cwd: targetDir,
          timeoutMs: Math.max(timeoutMs, 300_000),
        });
        if (npmRes.code !== 0) {
          // Rollback
          await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
          return { ok: false, error: `npm install failed: ${npmRes.stderr.trim() || npmRes.stdout.trim()}` };
        }
      }
    } catch { /* ignore */ }
  }

  return { ok: true, pluginId, targetDir, version };
}

// ══════════════════════════════════════════════
// ── Install from Single File ──
// ══════════════════════════════════════════════

export async function installPluginFromFile(params: {
  filePath: string;
  extensionsDir?: string;
  logger?: PluginInstallLogger;
  dryRun?: boolean;
}): Promise<InstallPluginResult> {
  const logger = params.logger ?? {};
  const filePath = resolveUserPath(params.filePath);

  if (!(await fileExists(filePath))) return { ok: false, error: `file not found: ${filePath}` };

  const extensionsDir = params.extensionsDir
    ? resolveUserPath(params.extensionsDir)
    : resolvePluginsDir();
  await fs.mkdir(extensionsDir, { recursive: true });

  const base = path.basename(filePath, path.extname(filePath));
  const pluginId = base || "plugin";
  const pluginIdError = validatePluginId(pluginId);
  if (pluginIdError) return { ok: false, error: pluginIdError };

  const targetFile = path.join(extensionsDir, `${safeDirName(pluginId)}${path.extname(filePath)}`);

  if (await fileExists(targetFile)) {
    return { ok: false, error: `plugin already exists: ${targetFile} (delete it first)` };
  }

  if (params.dryRun) {
    return { ok: true, pluginId, targetDir: targetFile };
  }

  logger.info?.(`Installing to ${targetFile}…`);
  await fs.copyFile(filePath, targetFile);

  return { ok: true, pluginId, targetDir: targetFile };
}

// ══════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...(await walkDir(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}
