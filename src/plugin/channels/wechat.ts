import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "wechat",
    name: "WeChat Channel",
  });

  api.registerChannel({
    id: "wechat",
    meta: {
      id: "wechat",
      name: "WeChat Channel",
    },
    capabilities: {
      text: true,
      image: true,
    },
    adapter: {},
  });
}
