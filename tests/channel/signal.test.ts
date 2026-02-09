import { describe, it, expect, vi, beforeEach } from "vitest";
import { signalCheck, createSignalChannel, type SignalChannelConfig } from "../../src/channel/signal.js";
import type { TinyClawConfig } from "../../src/config/schema.js";

const testConfig: TinyClawConfig = {
  agent: { provider: "anthropic", model: "test", thinkingLevel: "off" },
};

describe("signalCheck", () => {
  it("returns ok:false when server is unreachable", async () => {
    const result = await signalCheck("http://127.0.0.1:19999", 2000);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("normalizes base URL", async () => {
    // Test that protocol is added if missing
    const result = await signalCheck("127.0.0.1:19999", 2000);
    expect(result.ok).toBe(false);
  });

  it("throws on empty URL", async () => {
    await expect(signalCheck("", 2000)).rejects.toThrow("Signal base URL is required");
  });
});

describe("createSignalChannel", () => {
  const signalConfig: SignalChannelConfig = {
    enabled: true,
    baseUrl: "http://localhost:8080",
    account: "+15551234567",
  };

  it("creates a channel instance with correct id", () => {
    const ch = createSignalChannel(signalConfig, testConfig);
    expect(ch.id).toBe("signal:+15551234567");
    expect(ch.name).toBe("Signal");
  });

  it("creates a channel with default account", () => {
    const ch = createSignalChannel({ ...signalConfig, account: undefined }, testConfig);
    expect(ch.id).toBe("signal:default");
  });

  it("has correct capabilities", () => {
    const ch = createSignalChannel(signalConfig, testConfig);
    expect(ch.capabilities.text).toBe(true);
    expect(ch.capabilities.image).toBe(true);
    expect(ch.capabilities.typing).toBe(true);
    expect(ch.capabilities.readReceipt).toBe(true);
    expect(ch.capabilities.groups).toBe(true);
    expect(ch.capabilities.threads).toBe(false);
    expect(ch.capabilities.video).toBe(false);
    expect(ch.capabilities.editMessage).toBe(false);
  });

  it("has adapter methods", () => {
    const ch = createSignalChannel(signalConfig, testConfig);
    expect(typeof ch.adapter.sendText).toBe("function");
    expect(typeof ch.adapter.sendImage).toBe("function");
    expect(typeof ch.adapter.sendTyping).toBe("function");
    expect(typeof ch.adapter.sendReadReceipt).toBe("function");
    expect(typeof ch.adapter.connect).toBe("function");
    expect(typeof ch.adapter.disconnect).toBe("function");
    expect(typeof ch.adapter.isConnected).toBe("function");
  });

  it("starts disconnected", () => {
    const ch = createSignalChannel(signalConfig, testConfig);
    expect(ch.adapter.isConnected!()).toBe(false);
  });

  it("respects mediaMaxMb config", () => {
    const ch = createSignalChannel({ ...signalConfig, mediaMaxMb: 16 }, testConfig);
    expect(ch.capabilities.maxMediaBytes).toBe(16 * 1024 * 1024);
  });
});

describe("Signal adapter sendText", () => {
  it("calls RPC with recipient for DM", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const ch = createSignalChannel({
      baseUrl: "http://localhost:8080",
      account: "+15551234567",
    }, testConfig);

    await ch.adapter.sendText!("+15559876543", "Hello Signal!");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/v1/rpc");
    const body = JSON.parse(init.body);
    expect(body.method).toBe("send");
    expect(body.params.message).toBe("Hello Signal!");
    expect(body.params.recipient).toEqual(["+15559876543"]);
    expect(body.params.account).toBe("+15551234567");

    vi.unstubAllGlobals();
  });

  it("calls RPC with groupId for group messages", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const ch = createSignalChannel({
      baseUrl: "http://localhost:8080",
      account: "+15551234567",
    }, testConfig);

    await ch.adapter.sendText!("group:abc123", "Group message!");

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.params.groupId).toBe("abc123");
    expect(body.params.recipient).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe("Signal adapter typing", () => {
  it("sends typing indicator (best-effort)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const ch = createSignalChannel({
      baseUrl: "http://localhost:8080",
      account: "+15551234567",
    }, testConfig);

    await ch.adapter.sendTyping!("+15559876543");
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("does not throw on typing failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connection failed"));
    vi.stubGlobal("fetch", mockFetch);

    const ch = createSignalChannel({
      baseUrl: "http://localhost:8080",
      account: "+15551234567",
    }, testConfig);

    // Should not throw
    await ch.adapter.sendTyping!("+15559876543");

    vi.unstubAllGlobals();
  });
});
