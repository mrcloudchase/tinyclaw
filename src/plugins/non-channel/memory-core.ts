// memory-core — persists session context across restarts
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "memory-core",
    name: "Memory Core",
    version: "0.1.0",
    description: "Core memory persistence layer",
  });

  api.registerHook("session_end", async (_event, _data) => {
    console.log("Memory core: session ended");
  });
}
