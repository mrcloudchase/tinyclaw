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
  // Override model from env
  const envModel = process.env.TINYCLAW_MODEL?.trim();
  if (envModel) {
    const [provider, ...rest] = envModel.split("/");
    const modelId = rest.join("/");
    if (provider && modelId) {
      config.agent = { ...config.agent!, provider, model: modelId };
    }
  }

  // Override workspace from env
  const envWorkspace = process.env.TINYCLAW_WORKSPACE?.trim();
  if (envWorkspace) {
    config.workspace = { ...config.workspace, dir: envWorkspace };
  }

  return config;
}

function writeDefaultConfig(configPath: string): void {
  const content = JSON5.stringify(
    {
      // TinyClaw configuration
      // See: https://github.com/mrcloudchase/tinyclaw
      agent: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        thinkingLevel: "off",
      },
    },
    null,
    2,
  );
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, content, "utf-8");
  log.info(`Created default config at ${configPath}`);
}

export function loadConfig(overridePath?: string): TinyClawConfig {
  const configPath = overridePath || resolveConfigFilePath();

  // Ensure config directory exists
  ensureDir(resolveConfigDir());

  let raw: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      raw = JSON5.parse(content) as Record<string, unknown>;
    } catch (err) {
      log.warn(`Failed to parse config at ${configPath}: ${err}`);
    }
  } else {
    writeDefaultConfig(configPath);
  }

  // Validate with Zod
  const result = TinyClawConfigSchema.safeParse(raw);
  if (!result.success) {
    log.warn(`Config validation issues: ${result.error.message}`);
    // Fall back to defaults with what we can salvage
    const partial = TinyClawConfigSchema.partial().safeParse(raw);
    return mergeEnvVars({ ...DEFAULT_CONFIG, ...(partial.success ? partial.data : {}) });
  }

  return mergeEnvVars({ ...DEFAULT_CONFIG, ...result.data });
}

export function resolveApiKeyFromEnv(provider: string): string | undefined {
  // Direct provider env var
  const envVar = ENV_KEY_MAP[provider];
  if (envVar) {
    const value = process.env[envVar]?.trim();
    if (value) return value;
  }

  // Generic fallback
  const generic = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  if (generic) return generic;

  return undefined;
}
