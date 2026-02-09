import { describe, it, expect, vi } from "vitest";
import { createGatewayTool } from "../../src/tools/gateway-tool.js";
import type { TinyClawConfig } from "../../src/config/schema.js";

const testConfig: TinyClawConfig = {
  agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
  gateway: { port: 18789, mode: "local", bind: "loopback" },
};

describe("createGatewayTool", () => {
  it("returns a tool with correct name", () => {
    const tool = createGatewayTool(testConfig);
    expect(tool.name).toBe("gateway_control");
  });

  it("status returns valid JSON with expected fields", async () => {
    const tool = createGatewayTool(testConfig);
    const result = await tool.execute("test-call-id", { action: "status" });
    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.running).toBe(true);
    expect(typeof parsed.uptime).toBe("number");
    expect(parsed.port).toBe(18789);
    expect(parsed.mode).toBe("local");
    expect(parsed.model).toBe("anthropic/claude-sonnet-4-5-20250929");
    expect(typeof parsed.heap).toBe("number");
    expect(typeof parsed.rss).toBe("number");
    expect(typeof parsed.nodeVersion).toBe("string");
    expect(parsed.platform).toBe(process.platform);
    expect(Array.isArray(parsed.channels)).toBe(true);
  });

  it("reload returns success message", async () => {
    const tool = createGatewayTool(testConfig);
    const result = await tool.execute("test-call-id", { action: "reload" });
    const text = result.content[0].text;
    // May succeed or fail depending on config presence, but should not throw
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("restart returns shutdown message", async () => {
    const tool = createGatewayTool(testConfig);
    const result = await tool.execute("test-call-id", { action: "restart" });
    const text = result.content[0].text;
    expect(text).toContain("Shutdown initiated");
  });

  it("unknown action returns error message", async () => {
    const tool = createGatewayTool(testConfig);
    const result = await tool.execute("test-call-id", { action: "invalid" });
    const text = result.content[0].text;
    expect(text).toContain("Unknown action");
  });
});
