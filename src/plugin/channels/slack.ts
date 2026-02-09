import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "slack",
    name: "Slack Channel",
  });

  api.registerChannel({
    id: "slack",
    meta: {
      id: "slack",
      name: "Slack Channel",
    },
    capabilities: {
      text: true,
      image: true,
      document: true,
      threads: true,
      reaction: true,
      editMessage: true,
      deleteMessage: true,
      video: false,
      audio: false,
      sticker: false,
      groups: true,
    },
    adapter: {},
  });
}
