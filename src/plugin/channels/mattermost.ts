import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "mattermost",
    name: "Mattermost Channel",
  });

  api.registerChannel({
    id: "mattermost",
    meta: {
      id: "mattermost",
      name: "Mattermost Channel",
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
