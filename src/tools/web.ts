// Web Tools — web_search (Brave) + web_fetch (HTML→text)
// All in ONE file

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── web_search (Brave Search API) ──
// ══════════════════════════════════════════════

export function createWebSearchTool(): AgentTool<any> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web using Brave Search API. Returns titles, snippets, and URLs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Number of results (default 5, max 20)" },
      },
      required: ["query"],
    },
    async execute(_toolCallId: string, args: { query: string; count?: number }) {
      const apiKey = process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) return { content: [{ type: "text" as const, text: "Error: BRAVE_API_KEY not set. Set the environment variable to enable web search." }], details: {} };

      const count = Math.min(args.count ?? 5, 20);
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}`;

      try {
        const resp = await fetch(url, {
          headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
        });
        if (!resp.ok) return { content: [{ type: "text" as const, text: `Search error: HTTP ${resp.status} ${resp.statusText}` }], details: {} };

        const data = await resp.json() as any;
        const results = (data.web?.results ?? []).slice(0, count);
        if (results.length === 0) return { content: [{ type: "text" as const, text: "No results found." }], details: {} };

        const text = results.map((r: any, i: number) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ""}`,
        ).join("\n\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err) {
        log.warn(`web_search error: ${err}`);
        const text = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: "text" as const, text }], details: {} };
      }
    },
  } as unknown as AgentTool<any>;
}

// ══════════════════════════════════════════════
// ── web_fetch (URL → text) ──
// ══════════════════════════════════════════════

export function createWebFetchTool(): AgentTool<any> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a URL and extract its text content. HTML is stripped to plain text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        maxLength: { type: "number", description: "Max characters to return (default 10000)" },
      },
      required: ["url"],
    },
    async execute(_toolCallId: string, args: { url: string; maxLength?: number }) {
      const maxLen = args.maxLength ?? 10_000;
      const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

      try {
        const resp = await fetch(args.url, {
          headers: { "User-Agent": "TinyClaw/1.0 (web_fetch tool)", "Accept": "text/html,application/json,text/plain,*/*" },
          signal: AbortSignal.timeout(15_000),
          redirect: "follow",
        });
        if (!resp.ok) return result(`Fetch error: HTTP ${resp.status} ${resp.statusText}`);

        const contentType = resp.headers.get("content-type") ?? "";
        const raw = await resp.text();

        if (contentType.includes("json")) return result(raw.slice(0, maxLen));
        if (contentType.includes("html") || raw.trimStart().startsWith("<")) return result(stripHtml(raw).slice(0, maxLen));
        return result(raw.slice(0, maxLen));
      } catch (err) {
        log.warn(`web_fetch error: ${err}`);
        return result(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  } as unknown as AgentTool<any>;
}

// Simple HTML → text: remove tags, decode common entities, collapse whitespace
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|hr|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
