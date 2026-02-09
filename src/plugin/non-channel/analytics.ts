// analytics — tracks message flow metrics
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "analytics",
    name: "Analytics",
    version: "0.1.0",
    description: "Message flow analytics and metrics tracking",
  });

  api.registerHook("message_inbound", async (_event, _data) => {
    console.log("Analytics: inbound message tracked");
  });

  api.registerHook("message_outbound", async (_event, _data) => {
    console.log("Analytics: outbound message tracked");
  });
}
