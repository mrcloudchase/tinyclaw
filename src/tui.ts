// TUI Mode — Terminal UI via @mariozechner/pi-tui
// Uses pi-tui's component system for rich terminal rendering
// Falls back gracefully to bare REPL if pi-tui API doesn't match

import type { TinyClawConfig } from "./config/schema.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Component } from "@mariozechner/pi-tui";
import { runAgent } from "./agent/runner.js";
import { compactSession } from "./agent/compact.js";
import type { TinyClawSession } from "./agent/session.js";
import { log } from "./utils/logger.js";
import chalk from "chalk";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface TuiOptions {
  sessionName: string;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  ephemeral?: boolean;
  forceNew?: boolean;
}

// ══════════════════════════════════════════════
// ── TUI Launcher ──
// ══════════════════════════════════════════════

export async function startTui(config: TinyClawConfig, opts: TuiOptions): Promise<void> {
  // Dynamic import — throw to let caller fall back to bare REPL
  const { TUI, ProcessTerminal, Text, Markdown, Editor } = await import("@mariozechner/pi-tui");

  // Validate that the API surface matches what we expect
  if (typeof TUI !== "function" || typeof ProcessTerminal !== "function") {
    throw new Error("pi-tui API mismatch");
  }

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  let currentSession: TinyClawSession | undefined;
  let running = true;

  // Build a simple markdown theme
  const mdTheme = {
    heading: (t: string) => chalk.bold.cyan(t),
    link: (t: string) => chalk.underline.blue(t),
    linkUrl: (t: string) => chalk.dim(t),
    code: (t: string) => chalk.yellow(t),
    codeBlock: (t: string) => t,
    codeBlockBorder: (t: string) => chalk.dim(t),
    codeBlockPrefix: "  ",
    quote: (t: string) => chalk.italic(t),
    quoteBorder: (t: string) => chalk.dim(t),
    hr: (t: string) => chalk.dim(t),
    listBullet: (t: string) => chalk.cyan(t),
    bold: (t: string) => chalk.bold(t),
    italic: (t: string) => chalk.italic(t),
    strikethrough: (t: string) => chalk.strikethrough(t),
    underline: (t: string) => chalk.underline(t),
  };

  // Build editor theme
  const editorTheme = {
    borderColor: (t: string) => chalk.green(t),
    selectList: {
      selectedPrefix: (t: string) => chalk.green(t),
      selectedText: (t: string) => chalk.inverse(t),
      description: (t: string) => chalk.dim(t),
      scrollInfo: (t: string) => chalk.dim(t),
      noMatch: (t: string) => chalk.dim(t),
    },
  };

  // Create components
  const headerText = new Text(
    `TinyClaw TUI — ${config.agent?.provider ?? "anthropic"}/${config.agent?.model ?? "claude-sonnet-4-5-20250929"}\nType /quit to exit, /new to reset, /compact to compact\n`,
    1, 0,
  );
  const outputMd = new Markdown("", 1, 0, mdTheme);
  const editor = new Editor(tui, editorTheme);

  // Build a simple root component that stacks header + output + editor
  const root: Component = {
    render(width: number): string[] {
      const lines: string[] = [];
      lines.push(...headerText.render(width));
      lines.push(...outputMd.render(width));
      lines.push(""); // spacer
      lines.push(...editor.render(width));
      return lines;
    },
    handleInput(data: string) {
      editor.handleInput?.(data);
    },
    invalidate() {
      headerText.invalidate();
      outputMd.invalidate();
      editor.invalidate();
    },
  };

  // Wire up TUI
  tui.setFocus(root);

  let outputText = "";
  const updateOutput = (text: string) => {
    outputText += text;
    // Update the markdown content by reconstructing
    (outputMd as any).text = outputText;
    outputMd.invalidate();
    tui.requestRender(true);
  };

  // Handle editor submit
  editor.onSubmit = (input: string) => {
    handleInput(input).catch((err: Error) => {
      log.error(`TUI input error: ${err}`);
    });
  };

  async function handleInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
      running = false;
      return;
    }

    if (trimmed === "/new") {
      currentSession?.session.dispose();
      currentSession = undefined;
      updateOutput("\n--- Session reset ---\n\n");
      return;
    }

    if (trimmed === "/compact") {
      if (currentSession) {
        await compactSession(currentSession.session);
        updateOutput("\n--- Session compacted ---\n\n");
      } else {
        updateOutput("\nNo active session to compact.\n\n");
      }
      return;
    }

    updateOutput(`\n**You:** ${trimmed}\n\n`);

    try {
      const result = await runAgent({
        config,
        prompt: trimmed,
        sessionName: opts.sessionName,
        workspaceDir: opts.workspaceDir,
        provider: opts.provider,
        modelId: opts.modelId,
        thinkingLevel: opts.thinkingLevel,
        existingSession: currentSession,
        options: {
          ephemeral: opts.ephemeral,
          onText: (text: string) => updateOutput(text),
          onToolEvent: (evt: any) => {
            if (evt.type === "start") {
              updateOutput(`\n*[tool: ${evt.toolName}]*\n`);
            }
          },
        },
      });

      currentSession = result.tinyClawSession;
      updateOutput("\n\n");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateOutput(`\n**Error:** ${msg}\n\n`);
      log.error(msg);
    }
  }

  // Start TUI render loop
  tui.start();

  // Run until quit
  await new Promise<void>((resolve) => {
    const checkRunning = setInterval(() => {
      if (!running) {
        clearInterval(checkRunning);
        resolve();
      }
    }, 100);
  });

  // Cleanup
  currentSession?.session.dispose();
  tui.stop();
}
