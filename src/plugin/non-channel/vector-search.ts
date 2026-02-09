// vector-search — semantic search over embedded documents
import type { TinyClawPluginApi } from "../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "vector-search",
    name: "Vector Search",
    version: "0.1.0",
    description: "Semantic vector search over document embeddings",
  });

  api.registerHook("boot", async (_event, _data) => {
    console.log("Vector search: initializing");
  });
}
