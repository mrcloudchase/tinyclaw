import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("../config/paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  resolveAgentDir: () => "/mock/.config/tinyclaw/agent",
  ensureDir: vi.fn(),
}));

vi.mock("../auth/keys.js", () => ({
  resolveApiKey: vi.fn(() => "test-key"),
  setApiKeyOnAuthStorage: vi.fn(),
  loadKeysFromEnv: vi.fn(),
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: vi.fn().mockImplementation(() => ({
    setRuntimeApiKey: vi.fn(),
  })),
  ModelRegistry: vi.fn().mockImplementation(() => ({
    find: vi.fn(() => null),
  })),
}));

import { resolveAlias, buildFallbackChain } from "./resolve.js";
import type { TinyClawConfig } from "../config/schema.js";

describe("resolveAlias", () => {
  it("resolves 'sonnet' alias", () => {
    const result = resolveAlias("sonnet");
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toContain("claude-sonnet");
  });

  it("resolves 'opus' alias", () => {
    const result = resolveAlias("opus");
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toContain("claude-opus");
  });

  it("resolves 'haiku' alias", () => {
    const result = resolveAlias("haiku");
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toContain("claude-haiku");
  });

  it("resolves 'gpt4o' alias", () => {
    const result = resolveAlias("gpt4o");
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
  });

  it("resolves 'o3' alias", () => {
    const result = resolveAlias("o3");
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("o3");
  });

  it("parses slash format (provider/model)", () => {
    const result = resolveAlias("openai/gpt-4o-mini");
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4o-mini");
  });

  it("handles model with multiple slashes", () => {
    const result = resolveAlias("custom/models/v2/latest");
    expect(result.provider).toBe("custom");
    expect(result.modelId).toBe("models/v2/latest");
  });

  it("defaults unknown bare names to anthropic", () => {
    const result = resolveAlias("unknown-model");
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("unknown-model");
  });

  it("is case-insensitive for aliases", () => {
    const result = resolveAlias("SONNET");
    expect(result.provider).toBe("anthropic");
  });
});

describe("buildFallbackChain", () => {
  it("builds chain with primary model", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
    };
    const chain = buildFallbackChain(config);
    expect(chain).toHaveLength(1);
    expect(chain[0].provider).toBe("anthropic");
    expect(chain[0].modelId).toBe("claude-sonnet-4-5-20250929");
  });

  it("includes fallback models", () => {
    const config: TinyClawConfig = {
      agent: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        thinkingLevel: "off",
        fallbacks: ["openai/gpt-4o", "haiku"],
      },
    };
    const chain = buildFallbackChain(config);
    expect(chain).toHaveLength(3);
    expect(chain[1].provider).toBe("openai");
    expect(chain[1].modelId).toBe("gpt-4o");
    expect(chain[2].provider).toBe("anthropic");
    expect(chain[2].modelId).toContain("haiku");
  });

  it("uses defaults when no agent config", () => {
    const config: TinyClawConfig = {};
    const chain = buildFallbackChain(config);
    expect(chain).toHaveLength(1);
    expect(chain[0].provider).toBe("anthropic");
  });
});
