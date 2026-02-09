import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { defineTool } from "./helper.js";

export function createWebSearchTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "web_search",
    description: "Search the web using Brave Search or Perplexity. Returns search results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Number of results (default 5)" },
        provider: { type: "string", enum: ["brave", "perplexity"] },
      },
      required: ["query"],
    },
    async execute(args: { query: string; count?: number; provider?: string }) {
      const count = args.count ?? 5;
      if (args.provider === "perplexity") {
        const apiKey = process.env.PERPLEXITY_API_KEY;
        if (!apiKey) return "PERPLEXITY_API_KEY not set.";
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: args.query }] }),
        });
        if (!res.ok) return `Perplexity search failed: ${res.status}`;
        const data = await res.json() as any;
        return data.choices?.[0]?.message?.content ?? "No results";
      }
      // Default: Brave
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) return "BRAVE_API_KEY not set.";
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}`;
      const res = await fetch(url, { headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey } });
      if (!res.ok) return `Search failed: ${res.status}`;
      const data = await res.json() as any;
      return JSON.stringify((data.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description })), null, 2);
    },
  });
}
