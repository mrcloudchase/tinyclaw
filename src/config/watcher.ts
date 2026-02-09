// Config File Watcher — watches config file for changes and triggers reload
// Uses Node.js built-in fs.watch (no chokidar dependency needed)

import fs from "node:fs";
import { log } from "../util/logger.js";

export type ConfigChangeHandler = (changedPath: string) => void;

const RESTART_PATHS = ["gateway.", "plugins."];

export function startConfigWatcher(
  configPath: string,
  onChange: ConfigChangeHandler,
  debounceMs = 300,
): { stop: () => void } {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMtime = 0;

  const watcher = fs.watch(configPath, (eventType) => {
    if (eventType !== "change") return;

    // Debounce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const stat = fs.statSync(configPath);
        if (stat.mtimeMs === lastMtime) return; // no actual change
        lastMtime = stat.mtimeMs;
        log.info(`Config file changed: ${configPath}`);
        onChange(configPath);
      } catch (err) {
        log.warn(`Config watcher error: ${err}`);
      }
    }, debounceMs);
  });

  watcher.on("error", (err) => {
    log.warn(`Config watcher error: ${err.message}`);
  });

  log.debug(`Watching config: ${configPath}`);

  return {
    stop() {
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}

export function diffConfig(prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of allKeys) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}

export function requiresRestart(changedPaths: string[]): boolean {
  return changedPaths.some((p) => RESTART_PATHS.some((rp) => p.startsWith(rp)));
}
