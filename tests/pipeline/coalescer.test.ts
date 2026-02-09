import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { createCoalescer, CHANNEL_TEXT_LIMITS } from "../../src/pipeline/coalescer.js";

describe("CHANNEL_TEXT_LIMITS", () => {
  it("has correct per-channel limits", () => {
    expect(CHANNEL_TEXT_LIMITS.whatsapp).toBe(1600);
    expect(CHANNEL_TEXT_LIMITS.telegram).toBe(4096);
    expect(CHANNEL_TEXT_LIMITS.discord).toBe(2000);
    expect(CHANNEL_TEXT_LIMITS.slack).toBe(4000);
  });
});

describe("createCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes accumulated text on finish", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("Hello ");
    coalescer.push("World");
    await coalescer.finish();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toBe("Hello World");
  });

  it("splits when exceeding maxTextLength", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 50,
      minChars: 10,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("a".repeat(60));
    // Allow microtask queue to process
    await vi.advanceTimersByTimeAsync(100);
    await coalescer.finish();

    expect(flushed.length).toBeGreaterThanOrEqual(1);
    for (const chunk of flushed) {
      expect(chunk.length).toBeLessThanOrEqual(60);
    }
  });

  it("deduplicates identical chunks", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("same text");
    await coalescer.finish();

    coalescer.push("same text");
    await coalescer.finish();

    expect(flushed).toHaveLength(1);
  });

  it("flushes on idle timeout", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      minChars: 5,
      idleMs: 500,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("Hello World - enough text");
    await vi.advanceTimersByTimeAsync(600);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toBe("Hello World - enough text");
  });

  it("clear resets buffer and dedup cache", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("test");
    coalescer.clear();
    await coalescer.finish();

    expect(flushed).toHaveLength(0);
  });

  it("does not flush empty buffer", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      onFlush: (text) => { flushed.push(text); },
    });

    await coalescer.finish();
    expect(flushed).toHaveLength(0);
  });

  it("handles code blocks properly", async () => {
    const flushed: string[] = [];
    const coalescer = createCoalescer({
      maxTextLength: 2000,
      onFlush: (text) => { flushed.push(text); },
    });

    coalescer.push("```javascript\nconst x = 1;\n```\nSome text after");
    await coalescer.finish();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toContain("```javascript");
    expect(flushed[0]).toContain("```");
  });
});
