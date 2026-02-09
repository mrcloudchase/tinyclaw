#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config/loader.js";
import { runAgent, type RunResult } from "./agent/runner.js";
import { compactSession } from "./agent/compact.js";
import { setVerbose, log } from "./util/logger.js";
import type { TinyClawSession } from "./agent/session.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

const program = new Command()
  .name("tinyclaw")
  .description("A minimal AI coding agent")
  .version("0.1.0")
  .option("-m, --model <provider/model>", "Model override (e.g. anthropic/claude-opus-4-6)")
  .option("-s, --session <name>", "Session name", "default")
  .option("-n, --new", "Force new session")
  .option("--cwd <dir>", "Working directory")
  .option("--thinking <level>", "Thinking level: off, low, medium, high")
  .option("--verbose", "Verbose output")
  .option("--json", "JSON output mode")
  .option("--ephemeral", "Use in-memory session (no persistence)")
  .argument("[message...]", "Message to send (omit for interactive mode)")
  .action(async (messageParts: string[], opts) => {
    if (opts.verbose) setVerbose(true);

    const config = loadConfig();
    const workspaceDir = opts.cwd ? opts.cwd : process.cwd();

    // Parse model override
    let provider: string | undefined;
    let modelId: string | undefined;
    if (opts.model) {
      const [p, ...rest] = opts.model.split("/");
      provider = p;
      modelId = rest.join("/");
    }

    const thinkingLevel = opts.thinking as ThinkingLevel | undefined;
    const message = messageParts.join(" ").trim();

    if (message) {
      // Single-shot mode
      await runSingleShot(config, message, {
        sessionName: opts.session,
        workspaceDir,
        provider,
        modelId,
        thinkingLevel,
        json: opts.json,
        ephemeral: opts.ephemeral,
        forceNew: opts.new,
      });
    } else {
      // Interactive REPL mode
      await runInteractive(config, {
        sessionName: opts.session,
        workspaceDir,
        provider,
        modelId,
        thinkingLevel,
        ephemeral: opts.ephemeral,
        forceNew: opts.new,
      });
    }
  });

async function runSingleShot(
  config: ReturnType<typeof loadConfig>,
  message: string,
  opts: {
    sessionName: string;
    workspaceDir: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
    json?: boolean;
    ephemeral?: boolean;
    forceNew?: boolean;
  },
) {
  try {
    const result = await runAgent({
      config,
      prompt: message,
      sessionName: opts.sessionName,
      workspaceDir: opts.workspaceDir,
      provider: opts.provider,
      modelId: opts.modelId,
      thinkingLevel: opts.thinkingLevel,
      options: {
        ephemeral: opts.ephemeral,
        forceNew: opts.forceNew,
        onText: opts.json ? undefined : (text) => process.stdout.write(text),
        onToolEvent: opts.json
          ? undefined
          : (evt) => {
              if (evt.type === "start") {
                process.stderr.write(
                  chalk.dim(`\n[tool: ${evt.toolName}]\n`),
                );
              }
            },
      },
    });

    if (opts.json) {
      console.log(JSON.stringify({ text: result.text, compacted: result.compacted }));
    } else {
      // Ensure trailing newline
      if (!result.text.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runInteractive(
  config: ReturnType<typeof loadConfig>,
  opts: {
    sessionName: string;
    workspaceDir: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
    ephemeral?: boolean;
    forceNew?: boolean;
  },
) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error(chalk.cyan("TinyClaw Interactive Mode"));
  console.error(chalk.dim("Type /quit to exit, /new to reset session, /compact to compact context\n"));

  let currentSession: TinyClawSession | undefined;

  const cleanup = () => {
    rl.close();
    if (currentSession) {
      currentSession.session.dispose();
    }
  };

  process.on("SIGINT", () => {
    console.error(chalk.dim("\nGoodbye!"));
    cleanup();
    process.exit(0);
  });

  try {
    while (true) {
      const input = await rl.question(chalk.green("tinyclaw> "));
      const trimmed = input.trim();

      if (!trimmed) continue;

      // Handle commands
      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
        break;
      }

      if (trimmed === "/new") {
        if (currentSession) {
          currentSession.session.dispose();
          currentSession = undefined;
        }
        console.error(chalk.dim("Session reset."));
        continue;
      }

      if (trimmed === "/compact") {
        if (currentSession) {
          await compactSession(currentSession.session);
          console.error(chalk.dim("Session compacted."));
        } else {
          console.error(chalk.dim("No active session to compact."));
        }
        continue;
      }

      if (trimmed.startsWith("/")) {
        console.error(chalk.dim(`Unknown command: ${trimmed}`));
        continue;
      }

      // Run agent
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
            onText: (text) => process.stdout.write(text),
            onToolEvent: (evt) => {
              if (evt.type === "start") {
                process.stderr.write(
                  chalk.dim(`\n[tool: ${evt.toolName}]\n`),
                );
              }
            },
          },
        });

        // Ensure trailing newline after response
        if (!result.text.endsWith("\n")) {
          process.stdout.write("\n");
        }
        console.error(); // blank line after response

        // Keep session for next turn
        currentSession = result.tinyClawSession;
      } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    cleanup();
  }

  console.error(chalk.dim("Goodbye!"));
}

program.parse();
