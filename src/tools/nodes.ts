import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { defineTools } from "./helper.js";

interface NodeInfo { id: string; type: string; connectedAt: number; lastSeen: number; metadata: Record<string, unknown>; }
const nodes = new Map<string, NodeInfo>();

export function registerNode(id: string, type: string, metadata: Record<string, unknown> = {}): void {
  nodes.set(id, { id, type, connectedAt: Date.now(), lastSeen: Date.now(), metadata });
}
export function removeNode(id: string): void { nodes.delete(id); }
export function updateNodeSeen(id: string): void { const n = nodes.get(id); if (n) n.lastSeen = Date.now(); }

export function createNodeTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "nodes_list", description: "List all connected gateway nodes/clients.",
      parameters: { type: "object", properties: {} },
      async execute() {
        if (nodes.size === 0) return "No nodes connected.";
        return [...nodes.values()].map((n) => `[${n.id}] type=${n.type} connected=${new Date(n.connectedAt).toISOString()}`).join("\n");
      },
    },
    {
      name: "nodes_info", description: "Get detailed info about a specific node.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args: { id: string }) { const n = nodes.get(args.id); return n ? JSON.stringify(n, null, 2) : `Node ${args.id} not found.`; },
    },
  ]);
}
