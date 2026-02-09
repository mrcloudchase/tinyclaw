// Tool Assembly — collects all TinyClaw tools and applies policy filtering

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { evaluatePolicy, type PolicyContext } from "../security.js";
import { log } from "../utils/logger.js";

import { createBrowserTools } from "./browser.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createMemoryTools } from "./memory.js";
import { createCronTools } from "./cron.js";
import { createTtsTool } from "./tts.js";
import { createMessageTools } from "./message.js";
import { createCanvasTool } from "./canvas.js";
import { createNodeTools } from "./nodes.js";
import { createGatewayTool } from "./gateway-tool.js";
import { createAgentsListTool } from "./agents-list.js";
import { createSessionTools } from "./sessions.js";
import { createSessionStatusTool } from "./session-status.js";
import { createImageTool } from "./image.js";
import { createApplyPatchTool } from "./apply-patch.js";

export function assembleExtendedTools(config: TinyClawConfig): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [
    ...createBrowserTools(config),
    createWebSearchTool(config),
    createWebFetchTool(config),
    ...createMemoryTools(config),
    ...createCronTools(config),
    createTtsTool(config),
    ...createMessageTools(config),
    createCanvasTool(config),
    ...createNodeTools(config),
    createGatewayTool(config),
    createAgentsListTool(config),
    ...createSessionTools(config),
    createSessionStatusTool(config),
    createImageTool(config),
    createApplyPatchTool(config),
  ];

  // Filter by policy
  const denied = new Set(config.security?.deniedTools ?? []);
  const filtered = tools.filter((t) => {
    if (denied.has(t.name)) { log.debug(`Tool ${t.name} denied by config`); return false; }
    return true;
  });

  log.debug(`Assembled ${filtered.length} extended tools (${tools.length - filtered.length} denied)`);
  return filtered;
}
