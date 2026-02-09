import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { createMemoryStore, type MemoryStore } from "../memory.js";
import { defineTools } from "./helper.js";

let store: MemoryStore | null = null;
function getStore(config: TinyClawConfig): MemoryStore {
  if (!store) store = createMemoryStore(config);
  return store;
}

export function createMemoryTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "memory_search",
      description: "Search long-term memory for relevant information.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      async execute(args: { query: string; limit?: number }) {
        const results = await getStore(config).search(args.query, args.limit ?? 10);
        if (results.length === 0) return "No memories found.";
        return results.map((r) => `[#${r.entry.id} score=${r.score.toFixed(2)}] ${r.entry.content.slice(0, 200)}`).join("\n\n");
      },
    },
    {
      name: "memory_store",
      description: "Store information in long-term memory.",
      parameters: { type: "object", properties: { content: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["content"] },
      async execute(args: { content: string; tags?: string[] }) {
        const id = await getStore(config).store(args.content, {}, args.tags);
        return `Stored as memory #${id}`;
      },
    },
  ]);
}
