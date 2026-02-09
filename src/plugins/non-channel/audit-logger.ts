// audit-logger — logs tool invocation start and end events
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "audit-logger",
    name: "Audit Logger",
    version: "0.1.0",
    description: "Audit trail for tool invocations",
  });

  api.registerHook("tool_start", async (_event, _data) => {
    console.log("Audit logger: tool started");
  });

  api.registerHook("tool_end", async (_event, _data) => {
    console.log("Audit logger: tool ended");
  });
}
