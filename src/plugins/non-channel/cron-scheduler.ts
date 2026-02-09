// cron-scheduler — runs tasks on a cron schedule
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "cron-scheduler",
    name: "Cron Scheduler",
    version: "0.1.0",
    description: "Scheduled task execution via cron expressions",
  });

  api.registerService(
    "cron",
    async () => { /* start cron scheduler */ },
    async () => { /* stop cron scheduler */ },
  );
}
