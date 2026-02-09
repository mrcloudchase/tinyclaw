import type { TinyClawPluginApi } from "../plugin.js";
import type { TinyClawConfig } from "../../config/schema.js";

export default function init(api: TinyClawPluginApi, config: TinyClawConfig) {
  Object.assign(api.meta, {
    id: "signal",
    name: "Signal Channel",
    description: "Signal messaging via signal-cli REST API",
  });

  // Signal is now a first-class channel adapter (src/channel/signal.ts)
  // registered via initChannels() when channels.signal.enabled is true.
  // This plugin stub provides metadata only.
  api.registerChannel({
    id: "signal",
    meta: {
      id: "signal",
      name: "Signal Channel",
    },
    capabilities: {
      text: true,
      image: true,
      audio: true,
      typing: true,
      readReceipt: true,
      groups: true,
    },
    adapter: {},
  });
}
