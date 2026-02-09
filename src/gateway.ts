// Gateway — HTTP + WebSocket server, JSON-RPC framing, auth, broadcast, channel manager lifecycle
// All in ONE file

import http from "node:http";
import fs from "node:fs";
import type { TinyClawConfig } from "./config/schema.js";
import type { PluginRegistry } from "./plugin/plugin.js";
import { createChannelRegistry, initChannels, shutdownChannels, type ChannelRegistry } from "./channel.js";
import { dispatch, createDebouncer } from "./pipeline.js";
import { runHooks } from "./hooks.js";
import { log } from "./utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface PresenceEntry {
  id: string;
  role: "ui" | "cli" | "webchat" | "node" | "backend";
  connectedAt: number;
  lastSeen: number;
}

export interface GatewayContext {
  config: TinyClawConfig;
  server: http.Server;
  wss: any; // WebSocket.Server
  channelRegistry: ChannelRegistry;
  pluginRegistry?: PluginRegistry;
  clients: Set<any>;
  debouncer: ReturnType<typeof createDebouncer>;
  presence: Map<string, PresenceEntry>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ══════════════════════════════════════════════
// ── Broadcast Events (17 events) ──
// ══════════════════════════════════════════════

type BroadcastEvent =
  | "chat.message" | "chat.stream" | "chat.complete" | "chat.error"
  | "session.start" | "session.end" | "session.compact"
  | "tool.start" | "tool.end"
  | "channel.connect" | "channel.disconnect" | "channel.message"
  | "config.reload"
  | "health.heartbeat"
  | "approval.request" | "approval.resolve"
  | "system.shutdown";

function broadcast(ctx: GatewayContext, event: BroadcastEvent, data: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", method: event, params: data });
  for (const ws of ctx.clients) {
    try { if (ws.readyState === 1) ws.send(msg); } catch { /* skip dead clients */ }
  }
}

// ══════════════════════════════════════════════
// ── Auth ──
// ══════════════════════════════════════════════

function authenticateRequest(config: TinyClawConfig, req: http.IncomingMessage): boolean {
  const authConfig = config.gateway?.auth;
  if (!authConfig || authConfig.mode === "none") return true;

  const authHeader = req.headers.authorization ?? "";

  if (authConfig.mode === "token") {
    const token = authConfig.token ?? process.env.TINYCLAW_GATEWAY_TOKEN;
    if (!token) return true; // No token configured = open access
    return authHeader === `Bearer ${token}`;
  }

  if (authConfig.mode === "password") {
    const password = authConfig.password ?? process.env.TINYCLAW_GATEWAY_PASSWORD;
    if (!password) return true;
    const encoded = authHeader.replace(/^Basic\s+/, "");
    try {
      const decoded = Buffer.from(encoded, "base64").toString();
      return decoded.split(":")[1] === password;
    } catch { return false; }
  }

  return false;
}

// ══════════════════════════════════════════════
// ── Resolve Bind Address ──
// ══════════════════════════════════════════════

function resolveBindHost(config: TinyClawConfig): string {
  const bind = config.gateway?.bind ?? "loopback";
  switch (bind) {
    case "loopback": return "127.0.0.1";
    case "lan": return "0.0.0.0";
    case "auto": return "127.0.0.1";
    case "custom": return config.gateway?.customBindHost ?? "127.0.0.1";
    default: return "127.0.0.1";
  }
}

// ══════════════════════════════════════════════
// ── Start Gateway ──
// ══════════════════════════════════════════════

export async function startGateway(config: TinyClawConfig, pluginRegistry?: PluginRegistry): Promise<GatewayContext> {
  const port = config.gateway?.port ?? 18789;
  const host = resolveBindHost(config);

  // Initialize channel registry
  const channelRegistry = createChannelRegistry(config);
  await initChannels(config, channelRegistry);

  // Create debouncer
  const debouncer = createDebouncer(config, async (sessionKey, combined) => {
    log.debug(`Debouncer flushed: ${sessionKey} (${combined.length} chars)`);
    const result = await dispatch({ source: "gateway", body: combined, config, peerId: sessionKey });
    if (result.reply) {
      broadcast(ctx, "chat.message", { sessionKey, text: result.reply });
    }
  });

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    if (!authenticateRequest(config, req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // WhatsApp webhook
    const waPath = config.channels?.whatsapp?.webhookPath ?? "/webhook/whatsapp";
    if (url.pathname === waPath) {
      await handleWhatsAppWebhook(req, res, config, ctx);
      return;
    }

    // Telegram webhook
    const tgPath = config.channels?.telegram?.webhookPath ?? "/webhook/telegram";
    if (url.pathname === tgPath && req.method === "POST") {
      await handleTelegramWebhook(req, res, config, ctx);
      return;
    }

    // Generic webhook endpoint
    const webhookCfg = config.gateway?.webhook;
    const webhookPath = webhookCfg?.path ?? "/webhook";
    if (webhookCfg?.enabled && url.pathname === webhookPath && req.method === "POST") {
      await handleGenericWebhook(req, res, config, ctx);
      return;
    }

    // Plugin HTTP handlers
    if (pluginRegistry) {
      for (const handler of pluginRegistry.getAllHttpHandlers()) {
        if (url.pathname === handler.path && req.method?.toUpperCase() === handler.method.toUpperCase()) {
          handler.handler(req, res);
          return;
        }
      }
    }

    // HTTP API endpoints
    const { handleHttpRequest } = await import("./gateway-http.js");
    await handleHttpRequest(req, res, config, ctx);
  });

  // Create WebSocket server
  const WebSocket = await import("ws");
  const wss = new WebSocket.WebSocketServer({ server });

  const clients = new Set<any>();
  const presence = new Map<string, PresenceEntry>();

  // Seed gateway self-presence
  presence.set("gateway", { id: "gateway", role: "backend", connectedAt: Date.now(), lastSeen: Date.now() });

  const ctx: GatewayContext = { config, server, wss, channelRegistry, pluginRegistry, clients, debouncer, presence };

  wss.on("connection", (ws: any, req: http.IncomingMessage) => {
    if (!authenticateRequest(config, req)) {
      ws.close(4001, "Unauthorized");
      return;
    }

    clients.add(ws);
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    (ws as any).__presenceId = clientId;
    presence.set(clientId, { id: clientId, role: "ui", connectedAt: Date.now(), lastSeen: Date.now() });
    log.info(`WebSocket client connected (${clients.size} total)`);

    ws.on("message", async (data: Buffer) => {
      try {
        const rpc: JsonRpcRequest = JSON.parse(data.toString());
        const { handleRpcMethod } = await import("./gateway-methods.js");
        const result = await handleRpcMethod(rpc.method, rpc.params ?? {}, config, ctx);
        const response: JsonRpcResponse = { jsonrpc: "2.0", id: rpc.id, result };
        ws.send(JSON.stringify(response));
      } catch (err) {
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        };
        ws.send(JSON.stringify(response));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      presence.delete((ws as any).__presenceId);
      log.debug(`WebSocket client disconnected (${clients.size} remaining)`);
    });

    ws.on("error", (err: Error) => {
      log.warn(`WebSocket error: ${err.message}`);
      clients.delete(ws);
    });
  });

  // Start listening
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  log.info(`Gateway listening on ${host}:${port}`);

  // Fire boot hook
  await runHooks("boot", { config, port, host });

  // Presence sweep + heartbeat (every 60s)
  const presenceInterval = setInterval(() => {
    const now = Date.now();
    const PRESENCE_TTL = 5 * 60_000;
    for (const [id, entry] of presence) {
      if (id !== "gateway" && now - entry.lastSeen > PRESENCE_TTL) presence.delete(id);
    }
    presence.get("gateway")!.lastSeen = now;
    broadcast(ctx, "health.heartbeat", { uptime: Math.round(process.uptime()), clients: clients.size, sessions: 0 });
  }, 60_000);
  (ctx as any).__presenceInterval = presenceInterval;

  // Start config watcher if auto-reload is enabled
  if (config.gateway?.reload?.mode !== "manual") {
    try {
      const { startConfigWatcher, diffConfig, requiresRestart } = await import("./config/watcher.js");
      const { resolveConfigFilePath } = await import("./config/paths.js");
      const configPath = resolveConfigFilePath();
      if (fs.existsSync(configPath)) {
        const watcher = startConfigWatcher(configPath, async () => {
          try {
            const { loadConfig } = await import("./config/loader.js");
            const newConfig = loadConfig();
            const changed = diffConfig(ctx.config as any, newConfig as any);
            if (changed.length === 0) return;
            log.info(`Config reloaded (changed: ${changed.join(", ")})`);
            if (requiresRestart(changed)) {
              log.warn("Config change requires restart: " + changed.filter((c) => c.startsWith("gateway.") || c.startsWith("plugins.")).join(", "));
            }
            ctx.config = newConfig;
            broadcast(ctx, "config.reload", { changed });
            await runHooks("config_reload", { config: newConfig, changed });
          } catch (err) {
            log.warn(`Config reload failed: ${err}`);
          }
        }, config.gateway?.reload?.debounceMs ?? 2000);

        // Store watcher for cleanup
        (ctx as any).__configWatcher = watcher;
      }
    } catch (err) {
      log.debug(`Config watcher setup failed: ${err}`);
    }
  }

  // Start plugin services
  if (pluginRegistry) {
    for (const svc of pluginRegistry.getAllServices()) {
      try {
        await svc.start();
        log.info(`Started plugin service: ${svc.name}`);
      } catch (err) {
        log.warn(`Failed to start service ${svc.name}: ${err}`);
      }
    }
  }

  return ctx;
}

// ══════════════════════════════════════════════
// ── Stop Gateway ──
// ══════════════════════════════════════════════

export async function stopGateway(ctx: GatewayContext): Promise<void> {
  log.info("Shutting down gateway...");

  // Stop config watcher + presence sweep
  (ctx as any).__configWatcher?.stop();
  clearInterval((ctx as any).__presenceInterval);

  await runHooks("shutdown", {});
  ctx.debouncer.clear();

  // Stop plugin services
  if (ctx.pluginRegistry) {
    for (const svc of ctx.pluginRegistry.getAllServices()) {
      try { await svc.stop(); } catch { /* ignore */ }
    }
  }

  // Disconnect channels
  await shutdownChannels(ctx.channelRegistry);

  // Close WebSocket connections
  for (const ws of ctx.clients) {
    try { ws.close(1001, "Server shutting down"); } catch { /* ignore */ }
  }
  ctx.clients.clear();

  // Close servers
  ctx.wss.close();
  await new Promise<void>((resolve) => ctx.server.close(() => resolve()));

  log.info("Gateway stopped");
}

// ══════════════════════════════════════════════
// ── WhatsApp Webhook Handler ──
// ══════════════════════════════════════════════

async function handleWhatsAppWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
  ctx: GatewayContext,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // GET = verification
  if (req.method === "GET") {
    const { verifyWebhook } = await import("./channel/whatsapp.js");
    const query = Object.fromEntries(url.searchParams);
    const verifyToken = config.channels?.whatsapp?.accounts
      ? Object.values(config.channels.whatsapp.accounts)[0]?.verifyToken ?? "tinyclaw"
      : "tinyclaw";
    const challenge = verifyWebhook(query, verifyToken);
    if (challenge) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
    return;
  }

  // POST = incoming message
  if (req.method === "POST") {
    const body = await readBody(req);

    // Validate signature
    const appSecret = config.channels?.whatsapp?.appSecret
      ?? (config.channels?.whatsapp?.appSecretEnv ? process.env[config.channels.whatsapp.appSecretEnv] : undefined);
    if (appSecret) {
      const sig = req.headers["x-hub-signature-256"] as string;
      if (sig) {
        const { validateSignature } = await import("./channel/whatsapp.js");
        if (!validateSignature(body, sig, appSecret)) {
          res.writeHead(401);
          res.end("Invalid signature");
          return;
        }
      }
    }

    try {
      const { parseWebhookPayload } = await import("./channel/whatsapp.js");
      const messages = parseWebhookPayload(JSON.parse(body));

      for (const msg of messages) {
        const channel = ctx.channelRegistry.get(msg.channelId);

        if (msg.messageId && channel?.adapter.sendReadReceipt) {
          channel.adapter.sendReadReceipt(msg.messageId).catch(() => {});
        }

        dispatch({
          source: "channel",
          body: msg.body,
          config,
          channelId: msg.channelId,
          accountId: msg.accountId,
          peerId: msg.peerId,
          peerName: msg.peerName,
          messageId: msg.messageId,
          mediaUrls: msg.mediaUrls,
          isGroup: msg.isGroup,
          channel: channel ?? undefined,
        }).then((result) => {
          if (result.reply) {
            broadcast(ctx, "chat.message", { channelId: msg.channelId, peerId: msg.peerId, reply: result.reply });
          }
        }).catch((err) => {
          log.error(`WhatsApp dispatch error: ${err}`);
        });
      }
    } catch (err) {
      log.error(`WhatsApp webhook parse error: ${err}`);
    }

    res.writeHead(200);
    res.end("OK");
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
}

// ══════════════════════════════════════════════
// ── Telegram Webhook Handler ──
// ══════════════════════════════════════════════

async function handleTelegramWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
  ctx: GatewayContext,
): Promise<void> {
  // Validate webhook secret if configured
  const secret = config.channels?.telegram?.webhookSecret;
  if (secret) {
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
    if (headerSecret !== secret) {
      res.writeHead(401);
      res.end("Invalid secret");
      return;
    }
  }

  try {
    const body = await readBody(req);
    const update = JSON.parse(body);

    // Find the Telegram channel instance and forward the update to its bot
    const channel = ctx.channelRegistry.get("telegram:default");
    if (channel) {
      // The grammY bot handles the update internally via bot.handleUpdate()
      const { Bot } = await import("grammy");
      // Get the bot from the channel — it was connected in webhook mode via bot.init()
      // We need to call handleUpdate directly, which processes the update through all handlers
      const botToken = config.channels?.telegram?.botToken
        ?? (config.channels?.telegram?.botTokenEnv ? process.env[config.channels.telegram.botTokenEnv] : undefined)
        ?? process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        // Create a temporary bot just for update handling
        // (The real bot's handlers were set up during createTelegramChannel)
        // In practice, the channel's bot instance is used
        const tempBot = new Bot(botToken);
        await tempBot.handleUpdate(update);
      }
    }
  } catch (err) {
    log.error(`Telegram webhook error: ${err}`);
  }

  res.writeHead(200);
  res.end("OK");
}

// ══════════════════════════════════════════════
// ── Generic Webhook Handler ──
// ══════════════════════════════════════════════

async function handleGenericWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
  ctx: GatewayContext,
): Promise<void> {
  // Authenticate webhook
  const webhookCfg = config.gateway?.webhook;
  const expectedToken = webhookCfg?.token
    ?? (webhookCfg?.tokenEnv ? process.env[webhookCfg.tokenEnv] : undefined)
    ?? process.env.TINYCLAW_WEBHOOK_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.authorization ?? "";
    if (authHeader !== `Bearer ${expectedToken}`) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
  }

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw);
    const mode = payload.mode ?? "wake"; // "wake" or "agent"
    const body = payload.message ?? payload.body ?? payload.text ?? raw;
    const sessionKey = payload.sessionKey ?? "webhook";

    if (mode === "agent") {
      // Full agent turn
      const result = await dispatch({ source: "gateway", body, config, peerId: sessionKey });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply: result.reply, sessionKey: result.sessionKey }));
    } else {
      // Wake: inject into session and broadcast
      broadcast(ctx, "channel.message", { source: "webhook", body, sessionKey });
      const result = await dispatch({ source: "gateway", body, config, peerId: sessionKey });
      if (result.reply) broadcast(ctx, "chat.message", { sessionKey, text: result.reply });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessionKey: result.sessionKey }));
    }
  } catch (err) {
    log.error(`Webhook error: ${err}`);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export { broadcast };
export type { JsonRpcRequest, JsonRpcResponse, BroadcastEvent };
