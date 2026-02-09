// Plugin Install Records — Track installed plugins in config
// Simplified port from OpenClaw's src/plugins/installs.ts

import type { TinyClawConfig } from "../config/schema.js";

export interface PluginInstallRecord {
  source: "npm" | "archive" | "path";
  spec?: string;
  sourcePath?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
}

export interface PluginInstallUpdate extends PluginInstallRecord {
  pluginId: string;
}

export function recordPluginInstall(
  cfg: TinyClawConfig,
  update: PluginInstallUpdate,
): TinyClawConfig {
  const { pluginId, ...record } = update;
  const installs = {
    ...cfg.plugins?.installs,
    [pluginId]: {
      ...cfg.plugins?.installs?.[pluginId],
      ...record,
      installedAt: record.installedAt ?? new Date().toISOString(),
    },
  };

  return {
    ...cfg,
    plugins: {
      enabled: true,
      ...cfg.plugins,
      installs,
    },
  };
}
