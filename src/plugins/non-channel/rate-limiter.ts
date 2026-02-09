// rate-limiter — enforces request rate limits before runs
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "rate-limiter",
    name: "Rate Limiter",
    version: "0.1.0",
    description: "Pre-run request rate limiting",
  });

  api.registerHook("pre_run", async (_event, _data) => {
    console.log("Rate limiter: checking");
  });
}
