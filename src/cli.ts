#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config/loader.js";
import { runAgent, type RunResult } from "./agent/runner.js";
import { compactSession } from "./agent/compact.js";
import { setVerbose, setJsonMode, log } from "./utils/logger.js";
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

// ── Config subcommand ──
const configCmd = program
  .command("config")
  .description("Get or set config values");

configCmd
  .command("get [key]")
  .description("Get a config value (omit key to show all)")
  .option("--config <path>", "Config file path override")
  .action(async (key: string | undefined, opts: any) => {
    const config = loadConfig(opts.config);
    if (!key) { console.log(JSON.stringify(config, null, 2)); return; }
    const parts = key.split(".");
    let val: any = config;
    for (const p of parts) { val = val?.[p]; if (val === undefined) break; }
    if (val === undefined) { console.log(chalk.dim("(not set)")); return; }
    console.log(typeof val === "object" ? JSON.stringify(val, null, 2) : String(val));
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value")
  .option("--config <path>", "Config file path override")
  .action(async (key: string, value: string, opts: any) => {
    const { resolveConfigFilePath } = await import("./config/paths.js");
    const configPath = opts.config || resolveConfigFilePath();
    const fs = await import("node:fs");
    const JSON5 = (await import("json5")).default;
    let raw: any = {};
    try { raw = JSON5.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
    const parts = key.split(".");
    let target = raw;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]] || typeof target[parts[i]] !== "object") target[parts[i]] = {};
      target = target[parts[i]];
    }
    // Parse value (bool, number, string)
    let parsed: any = value;
    if (value === "true") parsed = true;
    else if (value === "false") parsed = false;
    else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
    target[parts[parts.length - 1]] = parsed;
    fs.writeFileSync(configPath, JSON5.stringify(raw, null, 2));
    console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsed)}`));
  });

// ── Sessions subcommand ──
program
  .command("sessions")
  .description("List active sessions")
  .option("--port <port>", "Gateway port", "18789")
  .action(async (opts) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${opts.port}/health`);
      if (!resp.ok) { console.log(chalk.red("Gateway not running")); return; }
      const data = await resp.json() as any;
      console.log(chalk.cyan("Gateway Status:"));
      console.log(`  Uptime: ${data.uptime}s`);
      console.log(`  Sessions: ${data.sessions}`);
      console.log(`  Model: ${data.model}`);
      console.log(`  WS Clients: ${data.wsClients}`);
      console.log(`  Heap: ${data.heap}MB`);
    } catch {
      console.log(chalk.red("Cannot connect to gateway. Is it running?"));
    }
  });

// ── Cron subcommand ──
const cronCmd = program
  .command("cron")
  .description("Manage cron jobs");

cronCmd
  .command("list")
  .description("List scheduled jobs")
  .option("--config <path>", "Config file path override")
  .action(async (opts: any) => {
    const config = loadConfig(opts.config);
    const { createCronStore } = await import("./cron.js");
    const store = createCronStore(config);
    const jobs = store.list();
    if (jobs.length === 0) { console.log(chalk.dim("No cron jobs.")); return; }
    for (const j of jobs) {
      console.log(`  ${chalk.cyan(j.id)}  ${j.schedule}  ${j.enabled ? chalk.green("enabled") : chalk.dim("disabled")}  ${j.name ?? ""}`);
    }
  });

cronCmd
  .command("add <schedule> <prompt>")
  .description("Add a cron job (e.g. '0 9 * * *' 'Good morning check')")
  .option("--name <name>", "Job name")
  .option("--config <path>", "Config file path override")
  .action(async (schedule: string, prompt: string, opts: any) => {
    const config = loadConfig(opts.config);
    const { createCronStore } = await import("./cron.js");
    const store = createCronStore(config);
    const id = `job_${Date.now()}`;
    store.set({ id, name: opts.name ?? prompt.slice(0, 30), type: "cron", schedule, prompt, enabled: true, createdAt: Date.now() });
    console.log(chalk.green(`Created cron job: ${id}`));
  });

cronCmd
  .command("remove <id>")
  .description("Remove a cron job")
  .option("--config <path>", "Config file path override")
  .action(async (id: string, opts: any) => {
    const config = loadConfig(opts.config);
    const { createCronStore } = await import("./cron.js");
    const store = createCronStore(config);
    if (store.delete(id)) console.log(chalk.yellow(`Deleted: ${id}`));
    else console.log(chalk.dim("Job not found."));
  });

// ── Doctor subcommand ──
program
  .command("doctor")
  .description("Check configuration and connectivity")
  .option("--config <path>", "Config file path override")
  .action(async (opts) => {
    const config = loadConfig(opts.config);
    const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];

    // Check config
    checks.push({ label: "Config loaded", ok: true });

    // Check API key
    const provider = config.agent?.provider ?? "anthropic";
    const keyVar = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" }[provider];
    const hasKey = keyVar ? !!process.env[keyVar]?.trim() : false;
    checks.push({ label: `API key (${provider})`, ok: hasKey, detail: hasKey ? "found" : `Set ${keyVar ?? provider.toUpperCase() + "_API_KEY"}` });

    // Check gateway
    const port = config.gateway?.port ?? 18789;
    let gwOk = false;
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); gwOk = r.ok; } catch {}
    checks.push({ label: "Gateway reachable", ok: gwOk, detail: gwOk ? `port ${port}` : `not running on port ${port}` });

    // Check channels
    const wa = config.channels?.whatsapp?.enabled; if (wa) checks.push({ label: "WhatsApp", ok: !!config.channels?.whatsapp?.accounts, detail: config.channels?.whatsapp?.accounts ? "configured" : "no accounts" });
    const tg = config.channels?.telegram?.enabled; if (tg) checks.push({ label: "Telegram", ok: !!(config.channels?.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN), detail: "token check" });
    const dc = config.channels?.discord?.enabled; if (dc) checks.push({ label: "Discord", ok: !!(config.channels?.discord?.botToken || process.env.DISCORD_BOT_TOKEN), detail: "token check" });
    const sl = config.channels?.slack?.enabled; if (sl) checks.push({ label: "Slack", ok: !!(config.channels?.slack?.botToken || process.env.SLACK_BOT_TOKEN), detail: "token check" });

    // Check Brave Search
    const hasBrave = !!process.env.BRAVE_API_KEY || !!process.env.BRAVE_SEARCH_API_KEY;
    checks.push({ label: "Web search (Brave)", ok: hasBrave, detail: hasBrave ? "API key found" : "Set BRAVE_API_KEY for web search" });

    // Print results
    console.log(chalk.cyan("\nTinyClaw Doctor\n"));
    for (const c of checks) {
      const icon = c.ok ? chalk.green("✓") : chalk.red("✗");
      const detail = c.detail ? chalk.dim(` — ${c.detail}`) : "";
      console.log(`  ${icon} ${c.label}${detail}`);
    }
    const failed = checks.filter((c) => !c.ok);
    console.log();
    if (failed.length === 0) console.log(chalk.green("All checks passed!"));
    else console.log(chalk.yellow(`${failed.length} issue(s) found.`));
  });

// ── Status subcommand ──
program
  .command("status")
  .description("Show gateway status")
  .option("--port <port>", "Gateway port", "18789")
  .action(async (opts) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${opts.port}/health`);
      if (!resp.ok) { console.log(chalk.red("Gateway returned error")); return; }
      const data = await resp.json() as any;
      console.log(chalk.cyan("TinyClaw Gateway"));
      console.log(`  Status:   ${chalk.green(data.status)}`);
      console.log(`  Uptime:   ${data.uptime}s`);
      console.log(`  Model:    ${data.model}`);
      console.log(`  Sessions: ${data.sessions}`);
      console.log(`  Clients:  ${data.wsClients}`);
      console.log(`  Heap:     ${data.heap}MB`);
      if (data.channels?.length) {
        console.log(`  Channels: ${data.channels.map((c: any) => c.id).join(", ")}`);
      }
    } catch {
      console.log(chalk.red("Cannot connect to gateway. Is it running?"));
    }
  });

// ── Logs subcommand ──
program
  .command("logs")
  .description("Tail gateway logs")
  .option("--lines <n>", "Number of lines", "50")
  .action(async (opts) => {
    const { resolveLogsDir } = await import("./config/paths.js");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const logsDir = resolveLogsDir();
    const logFile = path.join(logsDir, "gateway.log");
    if (!fs.existsSync(logFile)) { console.log(chalk.dim("No log file found at " + logFile)); return; }
    const lines = fs.readFileSync(logFile, "utf-8").split("\n");
    const n = parseInt(opts.lines, 10) || 50;
    const tail = lines.slice(-n).join("\n");
    console.log(tail);
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
