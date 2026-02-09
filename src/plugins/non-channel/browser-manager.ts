// browser-manager — manages headless browser instances
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "browser-manager",
    name: "Browser Manager",
    version: "0.1.0",
    description: "Headless browser instance lifecycle manager",
  });

  api.registerService(
    "browser",
    async () => { /* start browser pool */ },
    async () => { /* stop browser pool */ },
  );
}
