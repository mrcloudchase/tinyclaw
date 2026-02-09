import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { TinyClawConfigSchema, DEFAULT_CONFIG, type TinyClawConfig } from "./schema.js";
import { resolveConfigDir, resolveConfigFilePath, ensureDir } from "./paths.js";
import { log } from "../util/logger.js";

const ENV_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

function mergeEnvVars(config: TinyClawConfig): TinyClawConfig {
  const envModel = process.env.TINYCLAW_MODEL?.trim();
  if (envModel) {
    const [provider, ...rest] = envModel.split("/");
    const modelId = rest.join("/");
    if (provider && modelId) config.agent = { ...config.agent!, provider, model: modelId };
  }
  const envWorkspace = process.env.TINYCLAW_WORKSPACE?.trim();
  if (envWorkspace) config.workspace = { ...config.workspace, dir: envWorkspace };
  const envPort = process.env.TINYCLAW_PORT?.trim();
  if (envPort) {
    const gw = config.gateway ?? { mode: "local" as const, port: 18789, bind: "loopback" as const };
    config.gateway = { ...gw, port: parseInt(envPort, 10) };
  }
  return config;
}

function writeDefaultConfig(configPath: string): void {
  const content = JSON5.stringify({
    agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
  }, null, 2);
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, content, "utf-8");
  log.info(`Created default config at ${configPath}`);
}

export function loadConfig(overridePath?: string): TinyClawConfig {
  const configPath = overridePath || resolveConfigFilePath();
  ensureDir(resolveConfigDir());

  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON5.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      log.warn(`Failed to parse config at ${configPath}: ${err}`);
    }
  } else {
    writeDefaultConfig(configPath);
  }

  const result = TinyClawConfigSchema.safeParse(raw);
  if (!result.success) {
    log.warn(`Config validation issues: ${result.error.message}`);
    const partial = TinyClawConfigSchema.partial().safeParse(raw);
    return mergeEnvVars({ ...DEFAULT_CONFIG, ...(partial.success ? partial.data : {}) });
  }
  return mergeEnvVars({ ...DEFAULT_CONFIG, ...result.data });
}

export function resolveApiKeyFromEnv(provider: string): string | undefined {
  const envVar = ENV_KEY_MAP[provider];
  if (envVar) { const v = process.env[envVar]?.trim(); if (v) return v; }
  const generic = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  return generic || undefined;
}

// Hot-reload config watcher
export function watchConfig(
  configPath: string | undefined,
  onChange: (config: TinyClawConfig) => void,
): { close(): void } {
  const filePath = configPath || resolveConfigFilePath();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watcher = fs.watch(filePath, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        const updated = loadConfig(filePath);
        onChange(updated);
        log.info("Config reloaded");
      } catch (err) {
        log.warn(`Config reload failed: ${err}`);
      }
    }, 2000);
  });
  return { close: () => watcher.close() };
}
