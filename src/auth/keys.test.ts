import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => JSON.stringify({ profiles: {} })),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
  },
}));

vi.mock("../config/paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  resolveAgentDir: () => "/mock/.config/tinyclaw/agent",
  ensureDir: vi.fn(),
}));

vi.mock("../config/loader.js", () => ({
  resolveApiKeyFromEnv: vi.fn(() => undefined),
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import {
  classifyFailoverReason,
  addKeyToPool,
  markKeyFailed,
  markKeySuccess,
  getKeyPoolHealth,
  loadKeysFromEnv,
} from "./keys.js";

describe("classifyFailoverReason", () => {
  it("classifies 402 as billing", () => {
    expect(classifyFailoverReason({ status: 402, message: "" })).toBe("billing");
  });

  it("classifies billing message", () => {
    expect(classifyFailoverReason(new Error("insufficient credit"))).toBe("billing");
  });

  it("classifies 429 as rate_limit", () => {
    expect(classifyFailoverReason({ status: 429, message: "" })).toBe("rate_limit");
  });

  it("classifies rate limit message", () => {
    expect(classifyFailoverReason(new Error("rate_limit exceeded"))).toBe("rate_limit");
    expect(classifyFailoverReason(new Error("too many requests"))).toBe("rate_limit");
  });

  it("classifies 401 as auth", () => {
    expect(classifyFailoverReason({ status: 401, message: "" })).toBe("auth");
  });

  it("classifies 403 as auth", () => {
    expect(classifyFailoverReason({ status: 403, message: "" })).toBe("auth");
  });

  it("classifies auth messages", () => {
    expect(classifyFailoverReason(new Error("unauthorized"))).toBe("auth");
    expect(classifyFailoverReason(new Error("invalid_api_key"))).toBe("auth");
    expect(classifyFailoverReason(new Error("invalid x-api-key"))).toBe("auth");
  });

  it("classifies timeout errors", () => {
    expect(classifyFailoverReason({ status: 408, message: "" })).toBe("timeout");
    expect(classifyFailoverReason(new Error("timeout occurred"))).toBe("timeout");
    expect(classifyFailoverReason(new Error("ETIMEDOUT"))).toBe("timeout");
    expect(classifyFailoverReason(new Error("ECONNRESET"))).toBe("timeout");
  });

  it("classifies format errors", () => {
    expect(classifyFailoverReason(new Error("invalid_request"))).toBe("format");
    expect(classifyFailoverReason(new Error("malformed body"))).toBe("format");
  });

  it("defaults to unknown", () => {
    expect(classifyFailoverReason(new Error("something weird"))).toBe("unknown");
  });
});

describe("key pool management", () => {
  const provider = `test-provider-${Date.now()}`;

  it("adds keys to pool", () => {
    addKeyToPool(provider, "key-1");
    addKeyToPool(provider, "key-2");
    const health = getKeyPoolHealth(provider);
    expect(health.total).toBe(2);
    expect(health.healthy).toBe(2);
    expect(health.backoff).toBe(0);
  });

  it("does not add duplicate keys", () => {
    const p = `dup-${Date.now()}`;
    addKeyToPool(p, "key-dup");
    addKeyToPool(p, "key-dup");
    expect(getKeyPoolHealth(p).total).toBe(1);
  });

  it("marks key as failed with backoff", () => {
    const p = `fail-${Date.now()}`;
    addKeyToPool(p, "key-fail");
    markKeyFailed(p, "key-fail", "rate_limit");
    const health = getKeyPoolHealth(p);
    expect(health.backoff).toBe(1);
  });

  it("resets key on success", () => {
    const p = `success-${Date.now()}`;
    addKeyToPool(p, "key-success");
    markKeyFailed(p, "key-success", "rate_limit");
    expect(getKeyPoolHealth(p).backoff).toBe(1);
    markKeySuccess(p, "key-success");
    expect(getKeyPoolHealth(p).backoff).toBe(0);
  });
});

describe("loadKeysFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads comma-separated keys", () => {
    const p = `env-${Date.now()}`;
    vi.stubEnv(`${p.toUpperCase()}_API_KEYS`, "key1,key2,key3");
    loadKeysFromEnv(p);
    expect(getKeyPoolHealth(p).total).toBe(3);
  });

  it("handles missing env var", () => {
    const p = `noenv-${Date.now()}`;
    loadKeysFromEnv(p);
    expect(getKeyPoolHealth(p).total).toBe(0);
  });
});
