import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { ssrfCheck } from "../security.js";
import { log } from "../util/logger.js";
import { defineTool } from "./helper.js";

const fetchCache = new Map<string, { content: string; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export function createWebFetchTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "web_fetch",
    description: "Fetch a URL and return its content as text. HTML is converted to readable text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        maxLength: { type: "number", description: "Max content length (default 10000)" },
        noCache: { type: "boolean", description: "Bypass cache" },
      },
      required: ["url"],
    },
    async execute(args: { url: string; maxLength?: number; noCache?: boolean }) {
      const check = ssrfCheck(args.url, config);
      if (!check.allowed) return `Blocked: ${check.reason}`;
      if (!args.noCache) {
        const cached = fetchCache.get(args.url);
        if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.content.slice(0, args.maxLength ?? 10000);
      }
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(args.url, { signal: ctrl.signal, headers: { "User-Agent": "TinyClaw/0.2.0" }, redirect: "follow" });
        clearTimeout(tm);
        if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
        const ct = res.headers.get("content-type") ?? "";
        let content: string;
        if (ct.includes("text/html")) {
          const html = await res.text();
          content = htmlToText(html);
        } else if (ct.includes("application/json")) {
          content = JSON.stringify(await res.json(), null, 2);
        } else { content = await res.text(); }
        const maxLen = args.maxLength ?? 10000;
        const result = content.length > maxLen ? content.slice(0, maxLen) + "\n...[truncated]" : content;
        fetchCache.set(args.url, { content: result, ts: Date.now() });
        return result;
      } catch (err) { return `Fetch error: ${err instanceof Error ? err.message : err}`; }
    },
  });
}

function htmlToText(html: string): string {
  let t = html;
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const bodyMatch = t.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) t = bodyMatch[1];
  t = t.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n");
  t = t.replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  t = t.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
