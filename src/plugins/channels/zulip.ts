import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "zulip",
    name: "Zulip Channel",
  });

  api.registerChannel({
    id: "zulip",
    meta: {
      id: "zulip",
      name: "Zulip Channel",
    },
    capabilities: {
      text: true,
      image: true,
      threads: true,
    },
    adapter: {},
  });
}
