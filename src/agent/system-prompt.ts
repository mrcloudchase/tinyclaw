import fs from "node:fs";
import path from "node:path";
import type { TinyClawConfig } from "../config/schema.js";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Read file contents from the workspace",
  write: "Create or overwrite files in the workspace",
  edit: "Make precise find-and-replace edits to files",
  bash: "Run shell commands in the terminal",
  grep: "Search file contents for patterns using regex",
  find: "Find files by glob pattern",
  ls: "List directory contents",
  browser_navigate: "Navigate browser to URL",
  browser_click: "Click an element in the browser",
  browser_type: "Type text into a browser element",
  browser_screenshot: "Take a browser screenshot",
  browser_snapshot: "Get accessibility tree snapshot of page",
  web_search: "Search the web (Brave/Perplexity)",
  web_fetch: "Fetch and parse a URL",
  memory_search: "Search long-term memory",
  memory_store: "Store information in long-term memory",
  cron_list: "List scheduled tasks",
  cron_set: "Create or update a scheduled task",
  cron_delete: "Delete a scheduled task",
  tts: "Convert text to speech",
  message_send: "Send a message via channel",
  message_react: "React to a message",
  image_generate: "Generate an image",
  session_list: "List active sessions",
  session_send: "Send message to another session",
  apply_patch: "Apply a code patch",
};

export interface SystemPromptParams {
  workspaceDir: string;
  toolNames: string[];
  model: string;
  thinkingLevel: string;
  config: TinyClawConfig;
  bootstrapContent?: string;
  skillsSummary?: string;
  channelContext?: string;
  agentId?: string;
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { workspaceDir, toolNames, model, thinkingLevel, config, bootstrapContent, skillsSummary, channelContext, agentId } = params;
  const s: string[] = [];

  // 1. Identity
  s.push(`You are TinyClaw${agentId ? ` (agent: ${agentId})` : ""}, a local AI assistant. You help users with software engineering, system administration, research, and general tasks.`);

  // 2. Tools
  const toolList = toolNames.map((n) => `- ${n}: ${TOOL_DESCRIPTIONS[n] || n}`).join("\n");
  s.push(`## Available Tools\n\n${toolList}`);

  // 3. Tool usage
  s.push("## Tool Usage\n\nUse tools directly without narrating each step. Read files before modifying them. Prefer editing existing files over creating new ones. When running shell commands, use the bash tool.");

  // 4. Safety
  s.push("## Safety\n\nYou have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking. Prioritize safety and human oversight over completion. If instructions conflict, pause and ask. Do not manipulate or persuade anyone to expand access or disable safeguards.");

  // 5. Workspace
  s.push(`## Workspace\n\nWorking directory: ${workspaceDir}\nAll file operations are relative to this directory.`);

  // 6. Runtime
  const runtime = [`os=${process.platform}`, `arch=${process.arch}`, `node=${process.version}`, `model=${model}`, `thinking=${thinkingLevel}`].join(" | ");
  s.push(`## Runtime\n\n${runtime}`);

  // 7. Security policy
  if (config.security) {
    const sec = config.security;
    const lines = [`Tool policy: ${sec.toolPolicy}`, `Exec approval: ${sec.execApproval}`, `SSRF protection: ${sec.ssrfProtection}`];
    if (sec.deniedTools?.length) lines.push(`Denied tools: ${sec.deniedTools.join(", ")}`);
    if (sec.elevatedTools?.length) lines.push(`Elevated (require confirmation): ${sec.elevatedTools.join(", ")}`);
    s.push(`## Security Policy\n\n${lines.join("\n")}`);
  }

  // 8. Memory
  if (config.memory) {
    s.push("## Memory\n\nYou have access to long-term memory. Use memory_search to recall past conversations and memory_store to save important information. Memory persists across sessions.");
  }

  // 9. Browser
  if (config.browser?.enabled !== false) {
    s.push("## Browser\n\nYou can control a Chrome browser. Use browser_navigate, browser_click, browser_type, browser_screenshot, browser_snapshot to interact with web pages.");
  }

  // 10. Cron
  if (config.cron?.enabled !== false) {
    s.push("## Scheduled Tasks\n\nYou can manage cron jobs. Use cron_set to schedule tasks, cron_list to view them, cron_delete to remove them.");
  }

  // 11. TTS
  if (config.tts?.enabled) {
    s.push(`## Text-to-Speech\n\nTTS is enabled (provider: ${config.tts.provider}). Use the tts tool to convert text to audio.`);
  }

  // 12. Channels
  if (channelContext) {
    s.push(`## Messaging Channels\n\n${channelContext}`);
  }

  // 13. Multi-agent
  if (config.multiAgent?.enabled) {
    s.push("## Multi-Agent\n\nMultiple agents are configured. Use session_list and session_send to communicate with other agents.");
  }

  // 14. Skills
  if (skillsSummary) {
    s.push(`## Available Skills\n\n${skillsSummary}`);
  }

  // 15. Pipeline directives
  s.push("## Directives\n\nUsers can use directives in messages:\n- `++think [level]` — Set thinking level\n- `++model [provider/model]` — Switch model\n- `++exec [auto|interactive|deny]` — Set exec approval mode");

  // 16. Commands
  s.push("## Commands\n\nUsers can use slash commands:\n- `/new` — Reset session\n- `/compact` — Compact context\n- `/model [name]` — Switch model\n- `/stop` — Stop generation\n- `/reset` — Full reset");

  // 17. Bootstrap/Context
  if (bootstrapContent) {
    s.push(`## Project Context\n\n${bootstrapContent}`);
  }

  return s.join("\n\n");
}

export function loadBootstrapContent(workspaceDir: string): string | undefined {
  const candidates = ["TINYCLAW.md", "CLAUDE.md", "AGENTS.md", ".tinyclaw", ".claude"];
  const parts: string[] = [];
  for (const filename of candidates) {
    const filePath = path.join(workspaceDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size < 50_000) {
          const content = fs.readFileSync(filePath, "utf-8").trim();
          if (content) parts.push(`### ${filename}\n\n${content}`);
        }
      }
    } catch { /* skip */ }
  }
  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}
