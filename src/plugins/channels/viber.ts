import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "viber",
    name: "Viber Channel",
  });

  api.registerChannel({
    id: "viber",
    meta: {
      id: "viber",
      name: "Viber Channel",
    },
    capabilities: {
      text: true,
      image: true,
    },
    adapter: {},
  });
}
