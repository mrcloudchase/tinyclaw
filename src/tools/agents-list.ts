import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { defineTool } from "./helper.js";

export function createAgentsListTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "agents_list", description: "List all configured agents in the multi-agent setup.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const agents = config.multiAgent?.agents;
      if (!agents?.length) return "No agents configured.";
      return agents.map((a) => `[${a.id}] model=${typeof a.model === "string" ? a.model : a.model?.primary ?? "default"}`).join("\n");
    },
  });
}
