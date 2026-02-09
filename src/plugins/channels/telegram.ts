import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "telegram",
    name: "Telegram Channel",
  });

  api.registerChannel({
    id: "telegram",
    meta: {
      id: "telegram",
      name: "Telegram Channel",
    },
    capabilities: {
      text: true,
      image: true,
      audio: true,
      video: true,
      document: true,
      sticker: true,
      reaction: false,
      typing: true,
      editMessage: true,
      deleteMessage: true,
      groups: true,
      threads: true,
    },
    adapter: {},
  });
}
