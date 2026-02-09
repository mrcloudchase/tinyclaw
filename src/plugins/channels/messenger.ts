import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "messenger",
    name: "Messenger Channel",
  });

  api.registerChannel({
    id: "messenger",
    meta: {
      id: "messenger",
      name: "Messenger Channel",
    },
    capabilities: {
      text: true,
      image: true,
    },
    adapter: {},
  });
}
