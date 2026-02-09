import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveApiKeyFromEnv } from "../config/loader.js";
import { log } from "../util/logger.js";

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
};

/**
 * Resolves an API key for a provider using the priority chain:
 * 1. Environment variables
 * 2. Config auth profiles
 * 3. AuthStorage on disk
 */
export function resolveApiKey(
  provider: string,
  config: TinyClawConfig,
  authStorage?: AuthStorage,
): string | undefined {
  // 1. Check env vars
  const envKey = resolveApiKeyFromEnv(provider);
  if (envKey) return envKey;

  // 2. Check config profiles
  const profiles = config.auth?.profiles;
  if (profiles) {
    // Look for a profile matching this provider
    for (const profile of Object.values(profiles)) {
      if (profile.provider === provider) {
        if (profile.apiKey) return profile.apiKey;
        if (profile.envVar) {
          const val = process.env[profile.envVar]?.trim();
          if (val) return val;
        }
      }
    }
  }

  // 3. AuthStorage not easily queryable without provider internals
  // The pi-* libraries handle this via authStorage.setRuntimeApiKey

  return undefined;
}

/**
 * Sets an API key on AuthStorage so the pi-* libraries can use it.
 */
export function setApiKeyOnAuthStorage(
  provider: string,
  apiKey: string,
  authStorage: AuthStorage,
): void {
  authStorage.setRuntimeApiKey(provider, apiKey);
  log.debug(`Set runtime API key for provider: ${provider}`);
}
