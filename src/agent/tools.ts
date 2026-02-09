import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { createExecTool } from "../exec/exec-tool.js";

// pi-coding-agent built-in tool names
const BUILTIN_TOOL_NAMES = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

export interface AssembledTools {
  /** Tools pi-coding-agent recognizes natively */
  builtinTools: AgentTool<any>[];
  /** Custom tools passed separately to createAgentSession */
  customTools: AgentTool<any>[];
}

/**
 * Assembles the complete tool set for a TinyClaw session.
 *
 * Uses pi-coding-agent's built-in coding tools (read, write, edit, grep, find, ls, bash)
 * and replaces the bash tool with our simplified exec tool.
 */
export function assembleTinyClawTools(
  workspaceDir: string,
  config: TinyClawConfig,
): AssembledTools {
  // Get all built-in coding tools from pi-coding-agent
  // createCodingTools returns: read, write, edit, grep, find, ls, bash
  const builtinTools: AgentTool<any>[] = [...createCodingTools(workspaceDir)];

  // Create our simplified exec tool to override the built-in bash tool
  const execTool = createExecTool({
    cwd: workspaceDir,
    timeoutSec: config.exec?.timeoutSec,
    backgroundMs: config.exec?.backgroundMs,
    maxOutput: config.exec?.maxOutput,
  });

  // Replace the built-in bash tool with our exec tool
  const toolIndex = builtinTools.findIndex((t) => t.name === "bash");
  if (toolIndex >= 0) {
    builtinTools[toolIndex] = execTool as unknown as AgentTool<any>;
  } else {
    builtinTools.push(execTool as unknown as AgentTool<any>);
  }

  return {
    builtinTools,
    customTools: [],
  };
}
