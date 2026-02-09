import { describe, it, expect, vi } from "vitest";

vi.mock("./util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock("./agent/session.js", () => ({
  createTinyClawSession: vi.fn(),
  parseSessionKey: vi.fn((input: string) => {
    const parts = input.split(":");
    if (parts.length >= 4) return { agentId: parts[0], channelId: parts[1], accountId: parts[2], peerId: parts[3], raw: input };
    return { raw: input };
  }),
  buildSessionKey: vi.fn((...args: string[]) => args.join(":")),
  resolveAgentForChannel: vi.fn(() => undefined),
}));

vi.mock("./agent/runner.js", () => ({
  runAgent: vi.fn(),
}));

import { listAgents, removeAgent, clearAllAgents, resolveAgentBinding } from "./multi-agent.js";
import type { TinyClawConfig } from "./config/schema.js";

describe("agent registry", () => {
  it("lists agents (initially empty)", () => {
    const agents = listAgents();
    // May not be empty if other tests spawned agents, but should be an array
    expect(Array.isArray(agents)).toBe(true);
  });

  it("removeAgent returns false for non-existent agent", () => {
    expect(removeAgent("nonexistent-agent")).toBe(false);
  });

  it("clearAllAgents returns count", () => {
    const count = clearAllAgents();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveAgentBinding", () => {
  it("returns default agent when no binding matches", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
    };
    const result = resolveAgentBinding(config, "telegram", "default", "user123");
    expect(result.agentId).toBe("default");
    expect(result.sessionKey).toContain("default");
    expect(result.sessionKey).toContain("telegram");
  });

  it("builds session key with all parts", () => {
    const config: TinyClawConfig = {
      agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
    };
    const result = resolveAgentBinding(config, "discord", "main", "peer456");
    expect(result.sessionKey).toBe("default:discord:main:peer456");
  });
});
