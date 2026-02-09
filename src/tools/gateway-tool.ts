import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { log } from "../utils/logger.js";
import { defineTool } from "./helper.js";

export function createGatewayTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "gateway_control", description: "Control the gateway server: reload config, get status, restart.",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["status", "reload", "restart"] } }, required: ["action"] },
    async execute(args: { action: string }) {
      switch (args.action) {
        case "status": return JSON.stringify({ running: true, port: config.gateway?.port ?? 18789, mode: config.gateway?.mode ?? "local", uptime: process.uptime() });
        case "reload": log.info("Config reload requested"); return "Config reload requested.";
        case "restart": return "Use process manager to restart.";
        default: return "Unknown action.";
      }
    },
  });
}
