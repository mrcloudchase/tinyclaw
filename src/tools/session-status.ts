import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { getKeyPoolHealth } from "../auth/keys.js";
import { defineTool } from "./helper.js";

export function createSessionStatusTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "session_status", description: "Get current session and system status.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const provider = config.agent?.provider ?? "anthropic";
      return JSON.stringify({
        model: `${provider}/${config.agent?.model ?? "unknown"}`,
        thinking: config.agent?.thinkingLevel ?? "off",
        keyPool: getKeyPoolHealth(provider),
        uptime: `${Math.round(process.uptime())}s`,
        heap: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        channels: { whatsapp: config.channels?.whatsapp?.enabled ?? false, telegram: config.channels?.telegram?.enabled ?? false, discord: config.channels?.discord?.enabled ?? false },
      }, null, 2);
    },
  });
}
