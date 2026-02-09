import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "imessage",
    name: "iMessage Channel",
  });

  api.registerChannel({
    id: "imessage",
    meta: {
      id: "imessage",
      name: "iMessage Channel",
    },
    capabilities: {
      text: true,
      image: true,
      reaction: true,
    },
    adapter: {},
  });
}
