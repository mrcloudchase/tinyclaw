// copilot-proxy — proxies requests to the Copilot API
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "copilot-proxy",
    name: "Copilot Proxy",
    version: "0.1.0",
    description: "HTTP proxy for Copilot-compatible endpoints",
  });

  api.registerHttpHandler("/v1/copilot", "POST", (_req, res) => {
    res.statusCode = 501;
    res.end(JSON.stringify({ error: "copilot-proxy: not implemented" }));
  });
}
