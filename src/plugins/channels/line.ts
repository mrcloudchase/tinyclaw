import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "line",
    name: "LINE Channel",
  });

  api.registerChannel({
    id: "line",
    meta: {
      id: "line",
      name: "LINE Channel",
    },
    capabilities: {
      text: true,
      image: true,
      sticker: true,
    },
    adapter: {},
  });
}
