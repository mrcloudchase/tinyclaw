// notification-hub — dispatches notifications on errors
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "notification-hub",
    name: "Notification Hub",
    version: "0.1.0",
    description: "Error notification dispatcher",
  });

  api.registerHook("error", async (_event, _data) => {
    console.log("Notification hub: error");
  });
}
