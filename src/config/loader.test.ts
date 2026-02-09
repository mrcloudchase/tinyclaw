import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    watch: vi.fn(() => ({ close: vi.fn() })),
  },
}));

vi.mock("./paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  resolveConfigFilePath: () => "/mock/.config/tinyclaw/config.json5",
  ensureDir: vi.fn(),
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import fs from "node:fs";
import { loadConfig, resolveApiKeyFromEnv } from "./loader.js";

describe("loadConfig", () => {
  beforeEach(() => {
    vi.stubEnv("TINYCLAW_MODEL", "");
    vi.stubEnv("TINYCLAW_WORKSPACE", "");
    vi.stubEnv("TINYCLAW_PORT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns defaults when config file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.agent?.provider).toBe("anthropic");
    expect(config.agent?.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("loads valid config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ agent: { provider: "openai", model: "gpt-4o" } }),
    );
    const config = loadConfig("/test/config.json5");
    expect(config.agent?.provider).toBe("openai");
    expect(config.agent?.model).toBe("gpt-4o");
  });

  it("falls back to defaults on invalid JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json{{{");
    const config = loadConfig("/test/config.json5");
    expect(config.agent?.provider).toBe("anthropic");
  });

  it("merges TINYCLAW_MODEL env var", () => {
    vi.stubEnv("TINYCLAW_MODEL", "openai/gpt-4o");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.agent?.provider).toBe("openai");
    expect(config.agent?.model).toBe("gpt-4o");
  });

  it("merges TINYCLAW_PORT env var", () => {
    vi.stubEnv("TINYCLAW_PORT", "9999");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.gateway?.port).toBe(9999);
  });

  it("merges TINYCLAW_WORKSPACE env var", () => {
    vi.stubEnv("TINYCLAW_WORKSPACE", "/tmp/workspace");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.workspace?.dir).toBe("/tmp/workspace");
  });
});

describe("resolveApiKeyFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves anthropic key from ANTHROPIC_API_KEY", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(resolveApiKeyFromEnv("anthropic")).toBe("sk-ant-test");
  });

  it("resolves openai key from OPENAI_API_KEY", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(resolveApiKeyFromEnv("openai")).toBe("sk-test");
  });

  it("falls back to PROVIDER_API_KEY format", () => {
    vi.stubEnv("CUSTOM_API_KEY", "key-123");
    expect(resolveApiKeyFromEnv("custom")).toBe("key-123");
  });

  it("returns undefined when no key found", () => {
    expect(resolveApiKeyFromEnv("nonexistent")).toBeUndefined();
  });
});
