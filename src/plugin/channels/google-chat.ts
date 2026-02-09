import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "google-chat",
    name: "Google Chat Channel",
  });

  api.registerChannel({
    id: "google-chat",
    meta: {
      id: "google-chat",
      name: "Google Chat Channel",
    },
    capabilities: {
      text: true,
      image: true,
      threads: true,
    },
    adapter: {},
  });
}
