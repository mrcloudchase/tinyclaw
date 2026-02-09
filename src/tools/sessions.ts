import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import fs from "node:fs";
import path from "node:path";
import { resolveSessionsDir } from "../config/paths.js";
import { defineTools } from "./helper.js";

export function createSessionTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "session_list", description: "List all saved sessions.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const dir = resolveSessionsDir();
        if (!fs.existsSync(dir)) return "No sessions.";
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        if (files.length === 0) return "No saved sessions.";
        return files.map((f) => { const s = fs.statSync(path.join(dir, f)); return `${path.basename(f, ".jsonl")} — ${s.size}B, ${s.mtime.toISOString()}`; }).join("\n");
      },
    },
    {
      name: "session_history", description: "Get recent messages from a session.",
      parameters: { type: "object", properties: { name: { type: "string" }, limit: { type: "number" } }, required: ["name"] },
      async execute(args: { name: string; limit?: number }) {
        const fp = path.join(resolveSessionsDir(), `${args.name}.jsonl`);
        if (!fs.existsSync(fp)) return `Session "${args.name}" not found.`;
        const lines = fs.readFileSync(fp, "utf-8").trim().split("\n").slice(-(args.limit ?? 10));
        return lines.map((l) => { try { const m = JSON.parse(l); return `[${m.role ?? "?"}] ${(m.content ?? "").slice(0, 200)}`; } catch { return l.slice(0, 200); } }).join("\n");
      },
    },
    {
      name: "session_send", description: "Send a message to another agent's session.",
      parameters: { type: "object", properties: { agentId: { type: "string" }, message: { type: "string" } }, required: ["agentId", "message"] },
      async execute(args: { agentId: string; message: string }) { return `Queued for "${args.agentId}": ${args.message.slice(0, 100)}`; },
    },
    {
      name: "session_spawn", description: "Spawn a new agent session for a task.",
      parameters: { type: "object", properties: { agentId: { type: "string" }, prompt: { type: "string" }, model: { type: "string" } }, required: ["prompt"] },
      async execute(args: { agentId?: string; prompt: string }) { return `Spawn: agent=${args.agentId ?? "default"}, "${args.prompt.slice(0, 100)}"`; },
    },
  ]);
}
