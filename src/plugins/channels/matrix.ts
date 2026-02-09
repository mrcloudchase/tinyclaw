import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "matrix",
    name: "Matrix Channel",
  });

  api.registerChannel({
    id: "matrix",
    meta: {
      id: "matrix",
      name: "Matrix Channel",
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
