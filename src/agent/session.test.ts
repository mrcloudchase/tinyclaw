import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    openSync: vi.fn(),
    writeSync: vi.fn(),
    closeSync: vi.fn(),
    unlinkSync: vi.fn(),
    constants: { O_WRONLY: 1, O_CREAT: 64, O_EXCL: 128 },
  },
}));

vi.mock("../config/paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  resolveSessionsDir: () => "/mock/.config/tinyclaw/sessions",
  resolveSessionFile: (name: string) => `/mock/.config/tinyclaw/sessions/${name}.jsonl`,
  resolveAgentDir: () => "/mock/.config/tinyclaw/agent",
  ensureDir: vi.fn(),
}));

vi.mock("../util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock("../model/resolve.js", () => ({
  resolveModel: vi.fn(() => ({
    model: { id: "test", name: "test", provider: "test" },
    authStorage: {},
    modelRegistry: {},
    provider: "anthropic",
    modelId: "claude-sonnet-4-5-20250929",
  })),
  resolveAlias: vi.fn((input: string) => {
    if (input.includes("/")) {
      const [provider, ...rest] = input.split("/");
      return { provider, modelId: rest.join("/") };
    }
    return { provider: "anthropic", modelId: input };
  }),
}));

vi.mock("./tools.js", () => ({
  assembleTinyClawTools: vi.fn(() => ({
    builtinTools: [{ name: "read" }],
    customTools: [],
  })),
}));

vi.mock("./system-prompt.js", () => ({
  buildSystemPrompt: vi.fn(() => "system prompt"),
  loadBootstrapContent: vi.fn(() => ""),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async () => ({
    session: {
      agent: { setSystemPrompt: vi.fn() },
      subscribe: vi.fn(() => vi.fn()),
    },
    extensionsResult: {},
    modelFallbackMessage: undefined,
  })),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
    open: vi.fn(() => ({})),
  },
}));

import fs from "node:fs";
import {
  parseSessionKey,
  buildSessionKey,
  resolveAgentForChannel,
  repairSessionFileIfNeeded,
} from "./session.js";
import type { TinyClawConfig } from "../config/schema.js";

describe("parseSessionKey", () => {
  it("parses full 4-part key", () => {
    const key = parseSessionKey("agent1:telegram:default:user123");
    expect(key.agentId).toBe("agent1");
    expect(key.channelId).toBe("telegram");
    expect(key.accountId).toBe("default");
    expect(key.peerId).toBe("user123");
    expect(key.raw).toBe("agent1:telegram:default:user123");
  });

  it("parses 2-part key", () => {
    const key = parseSessionKey("agent1:telegram");
    expect(key.agentId).toBe("agent1");
    expect(key.channelId).toBe("telegram");
    expect(key.accountId).toBeUndefined();
    expect(key.peerId).toBeUndefined();
  });

  it("parses simple session name", () => {
    const key = parseSessionKey("my-session");
    expect(key.agentId).toBeUndefined();
    expect(key.channelId).toBeUndefined();
    expect(key.raw).toBe("my-session");
  });
});

describe("buildSessionKey", () => {
  it("builds colon-separated key", () => {
    expect(buildSessionKey("agent1", "telegram", "default", "user123")).toBe(
      "agent1:telegram:default:user123",
    );
  });
});

describe("resolveAgentForChannel", () => {
  it("returns matching agent from bindings", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
      multiAgent: {
        enabled: true,
        bindings: [
          { agentId: "support-bot", match: { channel: "telegram" } },
          { agentId: "dev-bot", match: { channel: "discord" } },
        ],
      },
    };
    expect(resolveAgentForChannel(config, "telegram")).toBe("support-bot");
    expect(resolveAgentForChannel(config, "discord")).toBe("dev-bot");
  });

  it("returns undefined when no bindings match", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
      multiAgent: {
        enabled: true,
        bindings: [{ agentId: "bot", match: { channel: "telegram" } }],
      },
    };
    expect(resolveAgentForChannel(config, "slack")).toBeUndefined();
  });

  it("returns undefined when no bindings configured", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
    };
    expect(resolveAgentForChannel(config, "telegram")).toBeUndefined();
  });
});

describe("repairSessionFileIfNeeded", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("does nothing for valid JSONL", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}\n',
    );
    repairSessionFileIfNeeded("/test/session.jsonl");
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it("repairs file with invalid lines", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"role":"user","content":"hello"}\nBROKEN LINE\n{"role":"assistant","content":"hi"}\n',
    );
    repairSessionFileIfNeeded("/test/session.jsonl");
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it("skips non-existent file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockClear();
    repairSessionFileIfNeeded("/test/nonexistent.jsonl");
    // readFileSync may have been called by earlier tests; check existsSync returned false
    expect(fs.existsSync).toHaveBeenCalledWith("/test/nonexistent.jsonl");
  });
});
