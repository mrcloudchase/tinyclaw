import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveApiKeyFromEnv } from "../config/loader.js";
import { resolveConfigDir } from "../config/paths.js";
import { log } from "../utils/logger.js";
import fs from "node:fs";
import path from "node:path";

// ── Failure Classification ──
export type FailureReason = "auth" | "rate_limit" | "billing" | "timeout" | "format" | "unknown";

export function classifyFailoverReason(error: unknown): FailureReason {
  const status = (error && typeof error === "object" && "status" in error) ? (error as any).status : undefined;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (status === 402 || msg.includes("insufficient") || msg.includes("billing") || msg.includes("credit")) return "billing";
  if (status === 429 || msg.includes("rate_limit") || msg.includes("rate limit") || msg.includes("too many requests")) return "rate_limit";
  if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("invalid_api_key") || msg.includes("invalid x-api-key")) return "auth";
  if (status === 408 || msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset") || msg.includes("econnaborted")) return "timeout";
  if (msg.includes("invalid_request") || msg.includes("malformed")) return "format";
  return "unknown";
}

// ── Cooldown State Persistence ──
interface CooldownState {
  profiles: Record<string, { cooldownUntil: number; errorCount: number; lastError: string; lastReason: FailureReason }>;
}

const AUTH_STATE_FILE = "auth-state.json";
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function authStatePath(): string { return path.join(resolveConfigDir(), AUTH_STATE_FILE); }

function loadCooldownState(): CooldownState {
  try {
    const raw = fs.readFileSync(authStatePath(), "utf-8");
    return JSON.parse(raw);
  } catch { return { profiles: {} }; }
}

function saveCooldownState(state: CooldownState): void {
  try {
    fs.mkdirSync(path.dirname(authStatePath()), { recursive: true });
    fs.writeFileSync(authStatePath(), JSON.stringify(state, null, 2));
  } catch (err) { log.debug(`Failed to save auth state: ${err}`); }
}

function computeBackoff(errorCount: number, reason: FailureReason): number {
  if (reason === "billing") {
    return Math.min(5 * 3600_000 * Math.pow(2, errorCount - 1), 24 * 3600_000); // 5hr → 10hr → 20hr → 24hr
  }
  return Math.min(60_000 * Math.pow(5, errorCount - 1), 3600_000); // 1min → 5min → 25min → 1hr
}

// ── Key Health Tracking ──
interface KeyState {
  key: string;
  failures: number;
  lastFailure: number;
  backoffUntil: number;
  lastReason?: FailureReason;
}

const keyPool = new Map<string, KeyState[]>();

function getPool(provider: string): KeyState[] {
  if (!keyPool.has(provider)) keyPool.set(provider, []);
  return keyPool.get(provider)!;
}

export function addKeyToPool(provider: string, key: string): void {
  const pool = getPool(provider);
  if (!pool.some((k) => k.key === key)) {
    // Load persisted cooldown
    const state = loadCooldownState();
    const profileId = `${provider}:${key.slice(-6)}`;
    const persisted = state.profiles[profileId];
    const now = Date.now();
    pool.push({
      key,
      failures: persisted && (now - (persisted.cooldownUntil - computeBackoff(persisted.errorCount, persisted.lastReason)) < FAILURE_WINDOW_MS) ? persisted.errorCount : 0,
      lastFailure: 0,
      backoffUntil: persisted?.cooldownUntil && persisted.cooldownUntil > now ? persisted.cooldownUntil : 0,
      lastReason: persisted?.lastReason,
    });
  }
}

export function markKeyFailed(provider: string, key: string, reason?: FailureReason): void {
  const pool = getPool(provider);
  const entry = pool.find((k) => k.key === key);
  const failReason = reason ?? "unknown";
  if (entry) {
    entry.failures++;
    entry.lastFailure = Date.now();
    entry.lastReason = failReason;
    entry.backoffUntil = Date.now() + computeBackoff(entry.failures, failReason);
    log.debug(`Key for ${provider} failed: ${failReason} (${entry.failures}x, backoff until ${new Date(entry.backoffUntil).toISOString()})`);

    // Persist cooldown
    const state = loadCooldownState();
    const profileId = `${provider}:${key.slice(-6)}`;
    state.profiles[profileId] = { cooldownUntil: entry.backoffUntil, errorCount: entry.failures, lastError: new Date().toISOString(), lastReason: failReason };
    saveCooldownState(state);
  }
}

export function markKeySuccess(provider: string, key: string): void {
  const pool = getPool(provider);
  const entry = pool.find((k) => k.key === key);
  if (entry) {
    entry.failures = 0;
    entry.backoffUntil = 0;
    entry.lastReason = undefined;

    // Clear persisted cooldown
    const state = loadCooldownState();
    const profileId = `${provider}:${key.slice(-6)}`;
    delete state.profiles[profileId];
    saveCooldownState(state);
  }
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
