import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "webex",
    name: "Webex Channel",
  });

  api.registerChannel({
    id: "webex",
    meta: {
      id: "webex",
      name: "Webex Channel",
    },
    capabilities: {
      text: true,
      image: true,
      document: true,
    },
    adapter: {},
  });
}
