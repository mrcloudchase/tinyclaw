// memory-lancedb — vector memory backed by LanceDB
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "memory-lancedb",
    name: "Memory LanceDB",
    version: "0.1.0",
    description: "LanceDB-backed vector memory store",
  });

  api.registerHook("boot", async (_event, _data) => {
    console.log("LanceDB memory: initialized");
  });
}
