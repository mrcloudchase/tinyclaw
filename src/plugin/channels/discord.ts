import type { TinyClawPluginApi } from "../plugin.js";

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
      document: true,
      reaction: true,
      typing: true,
      editMessage: true,
      deleteMessage: true,
      threads: true,
      sticker: false,
      groups: true,
    },
    adapter: {},
  });
}
