import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "twitter",
    name: "Twitter Channel",
  });

  api.registerChannel({
    id: "twitter",
    meta: {
      id: "twitter",
      name: "Twitter Channel",
    },
    capabilities: {
      text: true,
      image: true,
    },
    adapter: {},
  });
}
