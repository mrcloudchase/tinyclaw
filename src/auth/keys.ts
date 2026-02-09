import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveApiKeyFromEnv } from "../config/loader.js";
import { log } from "../util/logger.js";

// ── Key Health Tracking ──
interface KeyState {
  key: string;
  failures: number;
  lastFailure: number;
  backoffUntil: number;
}

const keyPool = new Map<string, KeyState[]>();

function getPool(provider: string): KeyState[] {
  if (!keyPool.has(provider)) keyPool.set(provider, []);
  return keyPool.get(provider)!;
}

export function addKeyToPool(provider: string, key: string): void {
  const pool = getPool(provider);
  if (!pool.some((k) => k.key === key)) {
    pool.push({ key, failures: 0, lastFailure: 0, backoffUntil: 0 });
  }
}

export function markKeyFailed(provider: string, key: string): void {
  const pool = getPool(provider);
  const entry = pool.find((k) => k.key === key);
  if (entry) {
    entry.failures++;
    entry.lastFailure = Date.now();
    entry.backoffUntil = Date.now() + Math.min(1000 * Math.pow(2, entry.failures), 60000);
    log.debug(`Key for ${provider} marked failed (${entry.failures} failures, backoff until ${new Date(entry.backoffUntil).toISOString()})`);
  }
}

export function markKeySuccess(provider: string, key: string): void {
  const pool = getPool(provider);
  const entry = pool.find((k) => k.key === key);
  if (entry) { entry.failures = 0; entry.backoffUntil = 0; }
}

// Round-robin with backoff: pick the next healthy key
function pickKeyFromPool(provider: string): string | undefined {
  const pool = getPool(provider);
  const now = Date.now();
  const available = pool.filter((k) => k.backoffUntil <= now);
  if (available.length === 0) {
    // All keys in backoff — pick least recently failed
    const sorted = [...pool].sort((a, b) => a.backoffUntil - b.backoffUntil);
    return sorted[0]?.key;
  }
  // Round-robin: rotate first element to end
  const picked = available[0];
  const idx = pool.indexOf(picked);
  pool.splice(idx, 1);
  pool.push(picked);
  return picked.key;
}

export function getKeyPoolHealth(provider: string): { total: number; healthy: number; backoff: number } {
  const pool = getPool(provider);
  const now = Date.now();
  const healthy = pool.filter((k) => k.backoffUntil <= now).length;
  return { total: pool.length, healthy, backoff: pool.length - healthy };
}

// ── Key Resolution (priority chain) ──
export function resolveApiKey(
  provider: string,
  config: TinyClawConfig,
  authStorage?: AuthStorage,
): string | undefined {
  // 1. Pool rotation (if multiple keys loaded)
  const poolKey = pickKeyFromPool(provider);
  if (poolKey) return poolKey;

  // 2. Env vars
  const envKey = resolveApiKeyFromEnv(provider);
  if (envKey) { addKeyToPool(provider, envKey); return envKey; }

  // 3. Config profiles
  const profiles = config.auth?.profiles;
  if (profiles) {
    for (const profile of Object.values(profiles)) {
      if (profile.provider === provider) {
        const key = profile.apiKey || (profile.envVar ? process.env[profile.envVar]?.trim() : undefined);
        if (key) { addKeyToPool(provider, key); return key; }
      }
    }
  }

  return undefined;
}

export function setApiKeyOnAuthStorage(provider: string, apiKey: string, authStorage: AuthStorage): void {
  authStorage.setRuntimeApiKey(provider, apiKey);
  log.debug(`Set runtime API key for provider: ${provider}`);
}

// Load multiple keys from comma-separated env var
export function loadKeysFromEnv(provider: string): void {
  const envVar = `${provider.toUpperCase()}_API_KEYS`;
  const raw = process.env[envVar]?.trim();
  if (raw) {
    const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
    for (const key of keys) addKeyToPool(provider, key);
    log.debug(`Loaded ${keys.length} keys for ${provider} from ${envVar}`);
  }
}
