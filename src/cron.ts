// Cron System — Scheduler + store + catch-up
// All in ONE file

import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { TinyClawConfig } from "./config/schema.js";
import { resolveCronDir, ensureDir } from "./config/paths.js";
import { log } from "./util/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface CronJob {
  id: string;
  name: string;
  type: "at" | "every" | "cron";
  schedule: string; // ISO date for "at", interval string for "every", cron expression for "cron"
  prompt: string;
  sessionName?: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
}

export interface CronStore {
  list(): CronJob[];
  get(id: string): CronJob | undefined;
  set(job: CronJob): void;
  delete(id: string): boolean;
  save(): void;
}

// ══════════════════════════════════════════════
// ── JSON5 Store (atomic writes) ──
// ══════════════════════════════════════════════

export function createCronStore(config: TinyClawConfig): CronStore {
  const storePath = config.cron?.store ?? path.join(resolveCronDir(), "jobs.json5");
  ensureDir(path.dirname(storePath));

  let jobs: Map<string, CronJob>;

  // Load existing
  try {
    if (fs.existsSync(storePath)) {
      const raw = JSON5.parse(fs.readFileSync(storePath, "utf-8")) as CronJob[];
      jobs = new Map(raw.map((j) => [j.id, j]));
    } else {
      jobs = new Map();
    }
  } catch {
    jobs = new Map();
  }

  const save = () => {
    const tmpPath = storePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON5.stringify([...jobs.values()], null, 2));
    fs.renameSync(tmpPath, storePath);
  };

  return {
    list() { return [...jobs.values()]; },
    get(id) { return jobs.get(id); },
    set(job) { jobs.set(job.id, job); save(); },
    delete(id) { const had = jobs.delete(id); if (had) save(); return had; },
    save,
  };
}

// ══════════════════════════════════════════════
// ── Scheduler ──
// ══════════════════════════════════════════════

type RunCallback = (job: CronJob) => Promise<void>;

let schedulerInterval: ReturnType<typeof setInterval> | undefined;
let runningCount = 0;

export function startScheduler(
  store: CronStore,
  config: TinyClawConfig,
  onRun: RunCallback,
): void {
  if (schedulerInterval) return;
  const maxConcurrent = config.cron?.maxConcurrentRuns ?? 3;

  schedulerInterval = setInterval(async () => {
    const now = Date.now();
    const jobs = store.list().filter((j) => j.enabled);

    for (const job of jobs) {
      if (runningCount >= maxConcurrent) break;

      const nextRun = computeNextRun(job);
      if (nextRun && nextRun <= now) {
        runningCount++;
        job.lastRun = now;
        job.nextRun = computeNextRunAfter(job, now);
        store.set(job);

        onRun(job).catch((err) => {
          log.warn(`Cron job ${job.id} failed: ${err}`);
        }).finally(() => {
          runningCount--;
        });
      }
    }
  }, 10_000); // Check every 10s

  log.info("Cron scheduler started");
}

export function stopScheduler(): void {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = undefined; }
}

function computeNextRun(job: CronJob): number | undefined {
  if (job.nextRun) return job.nextRun;
  return computeNextRunAfter(job, Date.now());
}

function computeNextRunAfter(job: CronJob, after: number): number | undefined {
  switch (job.type) {
    case "at": {
      const t = new Date(job.schedule).getTime();
      return t > after ? t : undefined;
    }
    case "every": {
      const ms = parseInterval(job.schedule);
      if (!ms) return undefined;
      const lastRun = job.lastRun ?? job.createdAt;
      return lastRun + ms;
    }
    case "cron": {
      // Simplified: parse common cron patterns
      return after + 60_000; // Fallback: next minute
    }
    default:
      return undefined;
  }
}

function parseInterval(spec: string): number | undefined {
  const match = spec.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!match) return undefined;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000, day: 86_400_000 };
  return n * (multipliers[unit] ?? 0);
}

// ── Catch-up: run any missed jobs on startup ──
export async function catchUpMissedJobs(store: CronStore, onRun: RunCallback): Promise<number> {
  const now = Date.now();
  let count = 0;
  for (const job of store.list()) {
    if (!job.enabled) continue;
    const nextRun = computeNextRun(job);
    if (nextRun && nextRun < now - 60_000) {
      log.info(`Catching up missed cron job: ${job.name}`);
      job.lastRun = now;
      job.nextRun = computeNextRunAfter(job, now);
      store.set(job);
      await onRun(job);
      count++;
    }
  }
  return count;
}
