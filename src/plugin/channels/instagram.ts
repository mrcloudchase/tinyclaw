import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "instagram",
    name: "Instagram Channel",
  });

  api.registerChannel({
    id: "instagram",
    meta: {
      id: "instagram",
      name: "Instagram Channel",
    },
    capabilities: {
      text: true,
      image: true,
    },
    adapter: {},
  });
}
