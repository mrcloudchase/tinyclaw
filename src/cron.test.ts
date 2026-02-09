import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "[]"),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("./config/paths.js", () => ({
  resolveCronDir: () => "/mock/.config/tinyclaw/cron",
  ensureDir: vi.fn(),
}));

vi.mock("./util/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { createCronStore, startScheduler, stopScheduler, catchUpMissedJobs, type CronJob } from "./cron.js";
import type { TinyClawConfig } from "./config/schema.js";

const baseConfig: TinyClawConfig = {
  agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" },
  exec: { timeoutSec: 1800, backgroundMs: 10000, maxOutput: 200_000 },
};

describe("createCronStore", () => {
  it("creates empty store when no file exists", () => {
    const store = createCronStore(baseConfig);
    expect(store.list()).toEqual([]);
  });

  it("adds and retrieves jobs", () => {
    const store = createCronStore(baseConfig);
    const job: CronJob = {
      id: "test1",
      name: "Test Job",
      type: "every",
      schedule: "30m",
      prompt: "Do something",
      enabled: true,
      createdAt: Date.now(),
    };
    store.set(job);
    expect(store.get("test1")).toEqual(job);
    expect(store.list()).toHaveLength(1);
  });

  it("deletes jobs", () => {
    const store = createCronStore(baseConfig);
    const job: CronJob = {
      id: "del1",
      name: "Delete Me",
      type: "every",
      schedule: "1h",
      prompt: "test",
      enabled: true,
      createdAt: Date.now(),
    };
    store.set(job);
    expect(store.delete("del1")).toBe(true);
    expect(store.get("del1")).toBeUndefined();
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("updates existing jobs", () => {
    const store = createCronStore(baseConfig);
    const job: CronJob = {
      id: "upd1",
      name: "Update Me",
      type: "every",
      schedule: "1h",
      prompt: "old",
      enabled: true,
      createdAt: Date.now(),
    };
    store.set(job);
    store.set({ ...job, prompt: "new" });
    expect(store.get("upd1")?.prompt).toBe("new");
    expect(store.list()).toHaveLength(1);
  });
});

describe("scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it("starts and stops without error", () => {
    const store = createCronStore(baseConfig);
    const onRun = vi.fn().mockResolvedValue(undefined);
    startScheduler(store, baseConfig, onRun);
    stopScheduler();
  });

  it("does not start twice", () => {
    const store = createCronStore(baseConfig);
    const onRun = vi.fn().mockResolvedValue(undefined);
    startScheduler(store, baseConfig, onRun);
    startScheduler(store, baseConfig, onRun); // should be no-op
    stopScheduler();
  });
});

describe("catchUpMissedJobs", () => {
  it("runs missed jobs", async () => {
    const store = createCronStore(baseConfig);
    const now = Date.now();
    const job: CronJob = {
      id: "missed1",
      name: "Missed",
      type: "every",
      schedule: "1h",
      prompt: "catch up",
      enabled: true,
      createdAt: now - 7200_000,
      nextRun: now - 120_000, // 2 minutes ago
    };
    store.set(job);

    const onRun = vi.fn().mockResolvedValue(undefined);
    const count = await catchUpMissedJobs(store, onRun);
    expect(count).toBe(1);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("skips disabled jobs", async () => {
    const store = createCronStore(baseConfig);
    const job: CronJob = {
      id: "disabled1",
      name: "Disabled",
      type: "every",
      schedule: "1h",
      prompt: "skip me",
      enabled: false,
      createdAt: Date.now() - 7200_000,
      nextRun: Date.now() - 120_000,
    };
    store.set(job);

    const onRun = vi.fn().mockResolvedValue(undefined);
    const count = await catchUpMissedJobs(store, onRun);
    expect(count).toBe(0);
  });
});
