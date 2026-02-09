import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "rocket-chat",
    name: "Rocket.Chat Channel",
  });

  api.registerChannel({
    id: "rocket-chat",
    meta: {
      id: "rocket-chat",
      name: "Rocket.Chat Channel",
    },
    capabilities: {
      text: true,
      image: true,
      reaction: true,
      threads: true,
    },
    adapter: {},
  });
}
