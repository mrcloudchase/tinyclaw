import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { createExecTool } from "../exec/exec-tool.js";
import { log } from "../util/logger.js";

const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

export interface AssembledTools {
  builtinTools: AgentTool<any>[];
  customTools: AgentTool<any>[];
}

export function assembleTinyClawTools(
  workspaceDir: string,
  config: TinyClawConfig,
): AssembledTools {
  const builtinTools: AgentTool<any>[] = [...createCodingTools(workspaceDir)];

  // Replace bash with our exec tool
  const execTool = createExecTool({
    cwd: workspaceDir,
    timeoutSec: config.exec?.timeoutSec,
    backgroundMs: config.exec?.backgroundMs,
    maxOutput: config.exec?.maxOutput,
  });
  const bashIdx = builtinTools.findIndex((t) => t.name === "bash");
  if (bashIdx >= 0) builtinTools[bashIdx] = execTool as unknown as AgentTool<any>;
  else builtinTools.push(execTool as unknown as AgentTool<any>);

  return { builtinTools, customTools: [] };
}

// Assemble all tools including plugin-registered tools
export function assembleAllTools(
  workspaceDir: string,
  config: TinyClawConfig,
  pluginTools?: AgentTool<any>[],
): AssembledTools {
  const base = assembleTinyClawTools(workspaceDir, config);

  if (pluginTools?.length) {
    // Filter by security policy
    const denied = new Set(config.security?.deniedTools ?? []);
    const allowed = pluginTools.filter((t) => !denied.has(t.name));
    base.customTools.push(...allowed);
    log.debug(`Added ${allowed.length} plugin tools (${pluginTools.length - allowed.length} denied)`);
  }

  return base;
}

// Check tool count against max per turn
export function checkToolLimit(toolCallCount: number, config: TinyClawConfig): boolean {
  const max = config.security?.maxToolCallsPerTurn ?? 50;
  return toolCallCount < max;
}
