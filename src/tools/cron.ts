import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { createCronStore, type CronStore, type CronJob } from "../cron/cron.js";
import { defineTools } from "./helper.js";

let store: CronStore | null = null;
function getStore(config: TinyClawConfig): CronStore {
  if (!store) store = createCronStore(config);
  return store;
}

export function createCronTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "cron_list", description: "List all scheduled cron jobs.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const jobs = getStore(config).list();
        if (jobs.length === 0) return "No scheduled jobs.";
        return jobs.map((j) => `[${j.id}] ${j.name} (${j.type}: ${j.schedule}) ${j.enabled ? "enabled" : "disabled"}`).join("\n");
      },
    },
    {
      name: "cron_set", description: "Create or update a scheduled task.",
      parameters: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["at", "every", "cron"] }, schedule: { type: "string" }, prompt: { type: "string" }, id: { type: "string" } }, required: ["name", "type", "schedule", "prompt"] },
      async execute(args: { name: string; type: "at" | "every" | "cron"; schedule: string; prompt: string; id?: string }) {
        const job: CronJob = { id: args.id ?? `job_${Date.now()}`, name: args.name, type: args.type, schedule: args.schedule, prompt: args.prompt, enabled: true, createdAt: Date.now() };
        getStore(config).set(job);
        return `Scheduled "${job.name}" (${job.id})`;
      },
    },
    {
      name: "cron_delete", description: "Delete a scheduled task by ID.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args: { id: string }) { return getStore(config).delete(args.id) ? `Deleted ${args.id}` : `Not found: ${args.id}`; },
    },
  ]);
}
