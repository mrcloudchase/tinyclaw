// webhook-relay — receives and dispatches incoming webhooks
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "webhook-relay",
    name: "Webhook Relay",
    version: "0.1.0",
    description: "Inbound webhook receiver and dispatcher",
  });

  api.registerHttpHandler("/webhooks/:id", "POST", (_req, res) => {
    res.statusCode = 501;
    res.end(JSON.stringify({ error: "webhook-relay: not implemented" }));
  });
}
