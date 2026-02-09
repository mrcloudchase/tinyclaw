import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "discord",
    name: "Discord Channel",
  });

  api.registerChannel({
    id: "discord",
    meta: {
      id: "discord",
      name: "Discord Channel",
    },
    capabilities: {
      text: true,
      image: true,
      video: true,
      audio: false,
      document: false,
      reaction: true,
      threads: true,
      sticker: false,
      groups: false,
    },
    adapter: {},
  });
}
