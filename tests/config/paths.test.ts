import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  default: { mkdirSync: vi.fn() },
}));

vi.mock("node:os", () => ({
  default: { homedir: () => "/home/testuser" },
}));

import {
  resolveConfigDir,
  resolveConfigFilePath,
  resolveSessionsDir,
  resolveSessionFile,
  resolvePluginsDir,
  resolveSkillsDir,
  resolveMemoryDir,
  resolveLogsDir,
  ensureDir,
} from "../../src/config/paths.js";

describe("resolveConfigDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses TINYCLAW_HOME when set", () => {
    vi.stubEnv("TINYCLAW_HOME", "/custom/tinyclaw");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveConfigDir()).toBe("/custom/tinyclaw");
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "/custom/xdg");
    expect(resolveConfigDir()).toBe("/custom/xdg/tinyclaw");
  });

  it("falls back to ~/.config/tinyclaw", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveConfigDir()).toBe("/home/testuser/.config/tinyclaw");
  });
});

describe("resolveConfigFilePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses TINYCLAW_CONFIG when set", () => {
    vi.stubEnv("TINYCLAW_CONFIG", "/custom/config.json5");
    expect(resolveConfigFilePath()).toBe("/custom/config.json5");
  });

  it("falls back to config dir + config.json5", () => {
    vi.stubEnv("TINYCLAW_CONFIG", "");
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveConfigFilePath()).toContain("config.json5");
  });
});

describe("subsystem dirs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves sessions dir", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveSessionsDir()).toBe("/home/testuser/.config/tinyclaw/sessions");
  });

  it("resolves session file path", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveSessionFile("my-session")).toBe("/home/testuser/.config/tinyclaw/sessions/my-session.jsonl");
  });

  it("resolves plugins dir", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolvePluginsDir()).toBe("/home/testuser/.config/tinyclaw/plugins");
  });

  it("resolves skills dir", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveSkillsDir()).toBe("/home/testuser/.config/tinyclaw/skills");
  });

  it("resolves memory dir", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveMemoryDir()).toBe("/home/testuser/.config/tinyclaw/memory");
  });

  it("resolves logs dir", () => {
    vi.stubEnv("TINYCLAW_HOME", "");
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(resolveLogsDir()).toBe("/home/testuser/.config/tinyclaw/logs");
  });
});

describe("ensureDir", () => {
  it("calls mkdirSync with recursive", async () => {
    const fsMod = await import("node:fs");
    const mkdirSpy = vi.mocked(fsMod.default.mkdirSync);
    mkdirSpy.mockClear();
    ensureDir("/test/dir");
    expect(mkdirSpy).toHaveBeenCalledWith("/test/dir", { recursive: true });
  });
});
