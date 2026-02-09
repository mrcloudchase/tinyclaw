import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const CONFIG_DIR_NAME = "tinyclaw";

export function resolveConfigDir(): string {
  const override = process.env.TINYCLAW_HOME?.trim();
  if (override) return override;
  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdgConfig || path.join(os.homedir(), ".config");
  return path.join(base, CONFIG_DIR_NAME);
}

export function resolveAgentDir(): string { return path.join(resolveConfigDir(), "agent"); }
export function resolveSessionsDir(): string { return path.join(resolveConfigDir(), "sessions"); }
export function resolveSessionFile(sessionName: string): string { return path.join(resolveSessionsDir(), `${sessionName}.jsonl`); }
export function resolveConfigFilePath(): string {
  const override = process.env.TINYCLAW_CONFIG?.trim();
  if (override) return override;
  return path.join(resolveConfigDir(), "config.json5");
}

// New subsystem dirs
export function resolvePluginsDir(): string { return path.join(resolveConfigDir(), "plugins"); }
export function resolveSkillsDir(): string { return path.join(resolveConfigDir(), "skills"); }
export function resolveHooksDir(): string { return path.join(resolveConfigDir(), "hooks"); }
export function resolveMemoryDir(): string { return path.join(resolveConfigDir(), "memory"); }
export function resolveCronDir(): string { return path.join(resolveConfigDir(), "cron"); }
export function resolveBrowserDir(): string { return path.join(resolveConfigDir(), "browser"); }
export function resolveLogsDir(): string { return path.join(resolveConfigDir(), "logs"); }
export function resolveMediaDir(): string { return path.join(resolveConfigDir(), "media"); }

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
