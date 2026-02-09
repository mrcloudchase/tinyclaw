import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "signal",
    name: "Signal Channel",
  });

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
    },
    adapter: {},
  });
}
