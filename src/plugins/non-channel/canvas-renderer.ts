// canvas-renderer — renders visual canvas output
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "canvas-renderer",
    name: "Canvas Renderer",
    version: "0.1.0",
    description: "Visual canvas rendering service",
  });

  api.registerService(
    "canvas",
    async () => { /* start canvas renderer */ },
    async () => { /* stop canvas renderer */ },
  );
}
