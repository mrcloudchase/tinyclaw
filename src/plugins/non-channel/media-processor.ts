// media-processor — handles inbound media attachments
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "media-processor",
    name: "Media Processor",
    version: "0.1.0",
    description: "Processes inbound media attachments",
  });

  api.registerHook("message_inbound", async (_event, _data) => {
    console.log("Media processor: processing");
  });
}
