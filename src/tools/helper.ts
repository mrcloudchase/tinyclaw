// Helper to create properly typed AgentTool objects
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export interface SimpleTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: any): Promise<string>;
}

export function defineTool(def: SimpleTool): AgentTool<any> {
  return {
    name: def.name,
    label: def.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: def.description,
    parameters: def.parameters as any,
    execute: async (_toolCallId: string, params: any): Promise<AgentToolResult<any>> => {
      const text = await def.execute(params);
      return { content: [{ type: "text", text }], details: undefined };
    },
  } as unknown as AgentTool<any>;
}

export function defineTools(defs: SimpleTool[]): AgentTool<any>[] {
  return defs.map(defineTool);
}
