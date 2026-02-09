#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config/loader.js";
import { runAgent, type RunResult } from "./agent/runner.js";
import { compactSession } from "./agent/compact.js";
import { setVerbose, setJsonMode, log } from "./util/logger.js";
import type { TinyClawSession } from "./agent/session.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

const program = new Command()
  .name("tinyclaw")
  .description("A minimal AI assistant platform")
  .version("0.2.0");

// ── Main chat command (default) ──
program
  .option("-m, --model <provider/model>", "Model override (e.g. anthropic/claude-opus-4-6)")
  .option("-s, --session <name>", "Session name", "default")
  .option("-n, --new", "Force new session")
  .option("--cwd <dir>", "Working directory")
  .option("--thinking <level>", "Thinking level: off, low, medium, high")
  .option("--verbose", "Verbose output")
  .option("--json", "JSON output mode")
  .option("--ephemeral", "Use in-memory session (no persistence)")
  .option("--no-tui", "Disable TUI mode, use bare REPL")
  .option("--config <path>", "Config file path override")
  .argument("[message...]", "Message to send (omit for interactive mode)")
  .action(async (messageParts: string[], opts) => {
    if (opts.verbose) setVerbose(true);
    if (opts.json) setJsonMode(true);

    const config = loadConfig(opts.config);
    const workspaceDir = opts.cwd || process.cwd();
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
      await runSingleShot(config, message, {
        sessionName: opts.session, workspaceDir, provider, modelId,
        thinkingLevel, json: opts.json, ephemeral: opts.ephemeral, forceNew: opts.new,
      });
    } else {
      await runInteractive(config, {
        sessionName: opts.session, workspaceDir, provider, modelId,
        thinkingLevel, ephemeral: opts.ephemeral, forceNew: opts.new, noTui: opts.noTui,
      });
    }
  });

// ── Serve subcommand ──
program
  .command("serve")
  .description("Start the TinyClaw gateway server")
  .option("-p, --port <port>", "Port override")
  .option("--config <path>", "Config file path override")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    const config = loadConfig(opts.config);
    if (opts.port) {
      const gw = config.gateway ?? { mode: "local" as const, port: 18789, bind: "loopback" as const };
      config.gateway = { ...gw, port: parseInt(opts.port, 10) };
    }
    const port = config.gateway?.port ?? 18789;

    try {
      const { startGateway } = await import("./gateway.js");
      await startGateway(config);
      log.info(`TinyClaw gateway listening on port ${port}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Cannot find module")) {
        log.error("Gateway module not found. Build first with: npm run build");
      } else {
        log.error(`Failed to start gateway: ${err instanceof Error ? err.message : err}`);
      }
      process.exit(1);
    }
  });

// ── Init subcommand ──
program
  .command("init")
  .description("Interactive setup wizard")
  .option("--force", "Overwrite existing config")
  .action(async (opts) => {
    const { runInitWizard } = await import("./init.js");
    await runInitWizard({ force: opts.force });
  });

// ── Pair subcommand ──
const pairCmd = program
  .command("pair")
  .description("Manage DM pairing for unknown senders");

pairCmd
  .command("list")
  .description("Show pending pairing requests and allowed senders")
  .action(async () => {
    const { getPairingStore } = await import("./pairing.js");
    const store = getPairingStore();
    const pending = store.listPending();
    const allowed = store.listAllowed();
    console.log(chalk.cyan("Pending Pairing Requests:"));
    if (pending.length === 0) {
      console.log(chalk.dim("  (none)"));
    } else {
      for (const r of pending) {
        const expires = new Date(r.expiresAt).toLocaleTimeString();
        console.log(`  ${chalk.yellow(r.code)}  ${r.channelId}/${r.peerId}${r.peerName ? ` (${r.peerName})` : ""}  expires ${expires}`);
      }
    }
    console.log();
    console.log(chalk.cyan("Allowed Senders:"));
    if (allowed.length === 0) {
      console.log(chalk.dim("  (none)"));
    } else {
      for (const a of allowed) {
        const when = new Date(a.approvedAt).toLocaleDateString();
        console.log(`  ${a.channelId}/${a.peerId}  approved ${when} via ${a.approvedVia ?? "unknown"}`);
      }
    }
  });

pairCmd
  .command("approve <code>")
  .description("Approve a pairing code")
  .action(async (code: string) => {
    const { getPairingStore } = await import("./pairing.js");
    const store = getPairingStore();
    const result = store.approveCode(code);
    if (result) {
      console.log(chalk.green(`✓ Approved: ${result.channelId}/${result.peerId}`));
    } else {
      console.log(chalk.red("✗ Invalid or expired code."));
    }
  });

pairCmd
  .command("revoke <peerId>")
  .description("Revoke access for a peer (format: channelId/peerId)")
  .action(async (peerArg: string) => {
    const { getPairingStore } = await import("./pairing.js");
    const store = getPairingStore();
    const [channelId, peerId] = peerArg.includes("/") ? peerArg.split("/", 2) : ["*", peerArg];
    if (channelId === "*") {
      // Revoke across all channels
      const allowed = store.listAllowed().filter((a) => a.peerId === peerId);
      for (const a of allowed) {
        store.revokeAccess(a.channelId, a.peerId);
      }
      console.log(chalk.yellow(`Revoked access for peerId ${peerId} across ${allowed.length} channel(s)`));
    } else {
      const ok = store.revokeAccess(channelId, peerId);
      if (ok) console.log(chalk.yellow(`Revoked: ${channelId}/${peerId}`));
      else console.log(chalk.dim("No matching entry found."));
    }
  });

async function runSingleShot(
  config: ReturnType<typeof loadConfig>,
  message: string,
  opts: {
    sessionName: string; workspaceDir: string; provider?: string; modelId?: string;
    thinkingLevel?: ThinkingLevel; json?: boolean; ephemeral?: boolean; forceNew?: boolean;
  },
) {
  try {
    const result = await runAgent({
      config, prompt: message, sessionName: opts.sessionName, workspaceDir: opts.workspaceDir,
      provider: opts.provider, modelId: opts.modelId, thinkingLevel: opts.thinkingLevel,
      options: {
        ephemeral: opts.ephemeral, forceNew: opts.forceNew,
        onText: opts.json ? undefined : (text) => process.stdout.write(text),
        onToolEvent: opts.json ? undefined : (evt) => {
          if (evt.type === "start") process.stderr.write(chalk.dim(`\n[tool: ${evt.toolName}]\n`));
        },
      },
    });
    if (opts.json) {
      console.log(JSON.stringify({ text: result.text, compacted: result.compacted }));
    } else if (!result.text.endsWith("\n")) {
      process.stdout.write("\n");
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runInteractive(
  config: ReturnType<typeof loadConfig>,
  opts: {
    sessionName: string; workspaceDir: string; provider?: string; modelId?: string;
    thinkingLevel?: ThinkingLevel; ephemeral?: boolean; forceNew?: boolean; noTui?: boolean;
  },
) {
  // Try TUI mode first (unless --no-tui)
  if (!opts.noTui) {
    try {
      const { startTui } = await import("./tui.js");
      await startTui(config, opts);
      return;
    } catch {
      // TUI not available or failed, fall back to bare REPL
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  console.error(chalk.cyan("TinyClaw Interactive Mode"));
  console.error(chalk.dim("Type /quit to exit, /new to reset session, /compact to compact context\n"));

  let currentSession: TinyClawSession | undefined;
  const cleanup = () => { rl.close(); currentSession?.session.dispose(); };
  process.on("SIGINT", () => { console.error(chalk.dim("\nGoodbye!")); cleanup(); process.exit(0); });

  try {
    while (true) {
      const input = await rl.question(chalk.green("tinyclaw> "));
      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") break;

      if (trimmed === "/new") {
        currentSession?.session.dispose();
        currentSession = undefined;
        console.error(chalk.dim("Session reset."));
        continue;
      }

      if (trimmed === "/compact") {
        if (currentSession) { await compactSession(currentSession.session); console.error(chalk.dim("Session compacted.")); }
        else console.error(chalk.dim("No active session to compact."));
        continue;
      }

      if (trimmed.startsWith("/")) { console.error(chalk.dim(`Unknown command: ${trimmed}`)); continue; }

      try {
        const result = await runAgent({
          config, prompt: trimmed, sessionName: opts.sessionName, workspaceDir: opts.workspaceDir,
          provider: opts.provider, modelId: opts.modelId, thinkingLevel: opts.thinkingLevel,
          existingSession: currentSession,
          options: {
            ephemeral: opts.ephemeral,
            onText: (text) => process.stdout.write(text),
            onToolEvent: (evt) => { if (evt.type === "start") process.stderr.write(chalk.dim(`\n[tool: ${evt.toolName}]\n`)); },
          },
        });
        if (!result.text.endsWith("\n")) process.stdout.write("\n");
        console.error();
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
