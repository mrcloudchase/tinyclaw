import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock("../plugin/plugin.js", () => ({}));

import { registerHook, unregisterHook, runHooks } from "./hooks.js";

describe("registerHook / unregisterHook", () => {
  const hookId = `test-hook-${Date.now()}`;

  afterEach(() => {
    unregisterHook(hookId);
  });

  it("registers and fires a hook", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHook(hookId, "boot", handler);

    await runHooks("boot", { test: true });

    expect(handler).toHaveBeenCalledWith("boot", expect.objectContaining({ test: true }));
  });

  it("unregisters a hook", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHook(hookId, "boot", handler);
    unregisterHook(hookId);

    await runHooks("boot", {});

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("runHooks", () => {
  it("handles hook abort", async () => {
    const id = `abort-hook-${Date.now()}`;
    registerHook(id, "message_inbound", (async () => ({
      abort: true,
      abortMessage: "Blocked",
    })) as any);

    const result = await runHooks("message_inbound", { body: "test" });
    expect(result?.abort).toBe(true);
    expect(result?.abortMessage).toBe("Blocked");

    unregisterHook(id);
  });

  it("applies hook transforms", async () => {
    const id = `transform-hook-${Date.now()}`;
    registerHook(id, "message_inbound", (async () => ({
      transform: { body: "TRANSFORMED" },
    })) as any);

    const data: Record<string, unknown> = { body: "original" };
    await runHooks("message_inbound", data);
    expect(data.body).toBe("TRANSFORMED");

    unregisterHook(id);
  });

  it("matches wildcard hooks", async () => {
    const id = `wildcard-hook-${Date.now()}`;
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHook(id, "*", handler);

    await runHooks("tool_start", { toolName: "bash" });
    expect(handler).toHaveBeenCalled();

    unregisterHook(id);
  });

  it("executes hooks in priority order", async () => {
    const order: number[] = [];
    const id1 = `priority-low-${Date.now()}`;
    const id2 = `priority-high-${Date.now()}`;

    registerHook(id1, "pre_run", async () => { order.push(1); }, 1);
    registerHook(id2, "pre_run", async () => { order.push(2); }, 10);

    await runHooks("pre_run", {});

    // Higher priority should execute first
    const idx1 = order.indexOf(1);
    const idx2 = order.indexOf(2);
    expect(idx2).toBeLessThan(idx1);

    unregisterHook(id1);
    unregisterHook(id2);
  });

  it("handles hook errors gracefully", async () => {
    const id = `error-hook-${Date.now()}`;
    registerHook(id, "error", async () => {
      throw new Error("hook failed");
    });

    // Should not throw
    await runHooks("error", { err: "test" });

    unregisterHook(id);
  });

  it("times out slow hooks", async () => {
    const id = `slow-hook-${Date.now()}`;
    registerHook(id, "boot", async () => {
      await new Promise((r) => setTimeout(r, 10_000));
    });

    // The hook has a 5s timeout, so this should complete before 10s
    const start = Date.now();
    await runHooks("boot", {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(8000);

    unregisterHook(id);
  }, 10000);
});
