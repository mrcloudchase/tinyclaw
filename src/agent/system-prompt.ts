import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Read file contents from the workspace",
  write: "Create or overwrite files in the workspace",
  edit: "Make precise find-and-replace edits to files",
  bash: "Run shell commands in the terminal",
  grep: "Search file contents for patterns using regex",
  find: "Find files by glob pattern",
  ls: "List directory contents",
};

/**
 * Builds a simplified system prompt for TinyClaw.
 * 7 sections vs OpenClaw's 26.
 */
export function buildSystemPrompt(params: {
  workspaceDir: string;
  toolNames: string[];
  model: string;
  thinkingLevel: string;
  bootstrapContent?: string;
}): string {
  const { workspaceDir, toolNames, model, thinkingLevel, bootstrapContent } =
    params;

  const sections: string[] = [];

  // 1. Identity
  sections.push(
    "You are TinyClaw, a local AI coding assistant. You help users with software engineering tasks including writing code, debugging, refactoring, and explaining code.",
  );

  // 2. Tooling
  const toolList = toolNames
    .map((name) => {
      const desc = TOOL_DESCRIPTIONS[name] || name;
      return `- ${name}: ${desc}`;
    })
    .join("\n");
  sections.push(`## Available Tools\n\n${toolList}`);

  // 3. Tool Call Style
  sections.push(
    "## Tool Usage\n\n" +
      "Use tools directly without narrating each step. " +
      "Read files before modifying them. " +
      "Prefer editing existing files over creating new ones. " +
      "When running shell commands, use the bash tool.",
  );

  // 4. Safety
  sections.push(
    "## Safety\n\n" +
      "You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking. " +
      "Prioritize safety and human oversight over completion. " +
      "If instructions conflict, pause and ask. " +
      "Do not manipulate or persuade anyone to expand access or disable safeguards.",
  );

  // 5. Workspace
  sections.push(
    `## Workspace\n\nYour working directory is: ${workspaceDir}\nAll file operations are relative to this directory.`,
  );

  // 6. Runtime
  const runtime = [
    `os=${process.platform}`,
    `arch=${process.arch}`,
    `node=${process.version}`,
    `model=${model}`,
    `thinking=${thinkingLevel}`,
  ].join(" | ");
  sections.push(`## Runtime\n\n${runtime}`);

  // 7. Bootstrap/Context Files
  if (bootstrapContent) {
    sections.push(`## Project Context\n\n${bootstrapContent}`);
  }

  return sections.join("\n\n");
}

/**
 * Loads bootstrap content from workspace files like CLAUDE.md, TINYCLAW.md, etc.
 */
export function loadBootstrapContent(workspaceDir: string): string | undefined {
  const candidates = [
    "TINYCLAW.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".tinyclaw",
    ".claude",
  ];

  const parts: string[] = [];

  for (const filename of candidates) {
    const filePath = path.join(workspaceDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size < 50_000) {
          const content = fs.readFileSync(filePath, "utf-8").trim();
          if (content) {
            parts.push(`### ${filename}\n\n${content}`);
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}
