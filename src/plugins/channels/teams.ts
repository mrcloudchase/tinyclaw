import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "teams",
    name: "Teams Channel",
  });

  api.registerChannel({
    id: "teams",
    meta: {
      id: "teams",
      name: "Teams Channel",
    },
    capabilities: {
      text: true,
      image: true,
      document: true,
      threads: true,
    },
    adapter: {},
  });
}
