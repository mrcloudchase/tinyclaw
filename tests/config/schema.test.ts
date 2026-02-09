import { describe, it, expect } from "vitest";
import { TinyClawConfigSchema, DEFAULT_CONFIG } from "../../src/config/schema.js";

describe("TinyClawConfigSchema", () => {
  it("parses empty object with defaults", () => {
    const result = TinyClawConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it("applies agent defaults", () => {
    const result = TinyClawConfigSchema.parse({ agent: {} });
    expect(result.agent?.provider).toBe("anthropic");
    expect(result.agent?.model).toBe("claude-sonnet-4-5-20250929");
    expect(result.agent?.thinkingLevel).toBe("off");
  });

  it("accepts valid full config", () => {
    const config = {
      agent: {
        provider: "openai",
        model: "gpt-4o",
        thinkingLevel: "high" as const,
        fallbacks: ["anthropic/claude-sonnet-4-5-20250929"],
      },
      gateway: { port: 3000, bind: "lan" as const },
      security: {
        toolPolicy: "strict" as const,
        ssrfProtection: true,
        maxToolCallsPerTurn: 25,
        deniedTools: ["eval"],
      },
      memory: { backend: "builtin" as const, embeddingModel: "text-embedding-3-small" },
    };
    const result = TinyClawConfigSchema.parse(config);
    expect(result.agent?.provider).toBe("openai");
    expect(result.gateway?.port).toBe(3000);
    expect(result.security?.maxToolCallsPerTurn).toBe(25);
  });

  it("rejects invalid thinking level", () => {
    const result = TinyClawConfigSchema.safeParse({
      agent: { thinkingLevel: "ultra" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid security toolPolicy", () => {
    const result = TinyClawConfigSchema.safeParse({
      security: { toolPolicy: "yolo" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all gateway bind modes", () => {
    for (const bind of ["auto", "lan", "loopback", "custom"] as const) {
      const result = TinyClawConfigSchema.safeParse({ gateway: { bind } });
      expect(result.success).toBe(true);
    }
  });

  it("applies exec defaults", () => {
    const result = TinyClawConfigSchema.parse({ exec: {} });
    expect(result.exec?.timeoutSec).toBe(1800);
    expect(result.exec?.backgroundMs).toBe(10000);
    expect(result.exec?.maxOutput).toBe(200_000);
  });

  it("rejects negative exec timeout", () => {
    const result = TinyClawConfigSchema.safeParse({
      exec: { timeoutSec: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("applies sandbox defaults", () => {
    const result = TinyClawConfigSchema.parse({ sandbox: {} });
    expect(result.sandbox?.enabled).toBe(false);
    expect(result.sandbox?.image).toBe("tinyclaw-sandbox");
    expect(result.sandbox?.networkMode).toBe("none");
  });

  it("applies session defaults", () => {
    const result = TinyClawConfigSchema.parse({ session: {} });
    expect(result.session?.resetMode).toBe("manual");
    expect(result.session?.resetAtHour).toBe(0);
    expect(result.session?.idleMinutes).toBe(120);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has anthropic as default provider", () => {
    expect(DEFAULT_CONFIG.agent?.provider).toBe("anthropic");
  });

  it("has sonnet as default model", () => {
    expect(DEFAULT_CONFIG.agent?.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("has exec defaults", () => {
    expect(DEFAULT_CONFIG.exec?.timeoutSec).toBe(1800);
  });
});
