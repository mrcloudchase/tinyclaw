// Gateway RPC Methods — 15 JSON-RPC method handlers
// All in ONE file

import type { TinyClawConfig } from "./config/schema.js";
import type { GatewayContext } from "./gateway.js";
import { dispatch, clearSession, getActiveSessionKeys, getActiveSessionCount } from "./pipeline.js";
import { listPendingApprovals, resolveApproval } from "./security.js";
import { loadConfig, watchConfig } from "./config/loader.js";
import { log } from "./utils/logger.js";

// ══════════════════════════════════════════════
// ── Method Registry ──
// ══════════════════════════════════════════════

type RpcHandler = (params: Record<string, unknown>, config: TinyClawConfig, ctx: GatewayContext) => Promise<unknown>;

const methods: Record<string, RpcHandler> = {};

function defineMethod(name: string, handler: RpcHandler): void {
  methods[name] = handler;
}

export async function handleRpcMethod(
  method: string,
  params: Record<string, unknown>,
  config: TinyClawConfig,
  ctx: GatewayContext,
): Promise<unknown> {
  // Check plugin methods first
  if (ctx.pluginRegistry) {
    for (const pm of ctx.pluginRegistry.getAllGatewayMethods()) {
      if (pm.method === method) {
        return pm.handler(params);
      }
    }
  }

  const handler = methods[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler(params, config, ctx);
}

// ══════════════════════════════════════════════
// ── Chat Methods ──
// ══════════════════════════════════════════════

// 1. chat.send — Send a message and get a complete response
defineMethod("chat.send", async (params, config) => {
  const body = params.message as string ?? params.body as string;
  if (!body) throw new Error("Missing 'message' parameter");
  const result = await dispatch({
    source: "gateway",
    body,
    config,
    peerId: params.sessionKey as string ?? "gateway",
    channelId: params.channelId as string,
  });
  return { reply: result.reply, sessionKey: result.sessionKey, error: result.error };
});

// 2. chat.stream — Send a message and stream chunks back
defineMethod("chat.stream", async (params, config, ctx) => {
  const body = params.message as string ?? params.body as string;
  if (!body) throw new Error("Missing 'message' parameter");
  const sessionKey = params.sessionKey as string ?? "gateway";

  const result = await dispatch({
    source: "gateway",
    body,
    config,
    peerId: sessionKey,
    onChunk: (chunk) => {
      const { broadcast } = require("./gateway.js");
      broadcast(ctx, "chat.stream", { sessionKey, delta: chunk });
    },
  });
  return { reply: result.reply, sessionKey: result.sessionKey };
});

// ══════════════════════════════════════════════
// ── Session Methods ──
// ══════════════════════════════════════════════

// 3. sessions.list
defineMethod("sessions.list", async () => {
  return { sessions: getActiveSessionKeys(), count: getActiveSessionCount() };
});

// 4. sessions.clear
defineMethod("sessions.clear", async (params) => {
  const key = params.sessionKey as string;
  if (!key) throw new Error("Missing 'sessionKey' parameter");
  const cleared = clearSession(key);
  return { cleared, sessionKey: key };
});

// 5. sessions.clearAll
defineMethod("sessions.clearAll", async () => {
  const keys = getActiveSessionKeys();
  for (const key of keys) clearSession(key);
  return { cleared: keys.length };
});

// ══════════════════════════════════════════════
// ── Config Methods ──
// ══════════════════════════════════════════════

// 6. config.get
defineMethod("config.get", async (_params, config) => {
  // Return sanitized config (strip API keys)
  const sanitized = { ...config };
  if (sanitized.auth) sanitized.auth = { ...sanitized.auth, profiles: undefined };
  return sanitized;
});

// 7. config.reload
defineMethod("config.reload", async (_params, _config, ctx) => {
  try {
    const newConfig = loadConfig();
    ctx.config = newConfig;
    log.info("Config reloaded via RPC");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ══════════════════════════════════════════════
// ── Health ──
// ══════════════════════════════════════════════

// 8. health
defineMethod("health", async (_params, config, ctx) => {
  return {
    status: "ok",
    uptime: Math.round(process.uptime()),
    heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    sessions: getActiveSessionCount(),
    channels: ctx.channelRegistry.list().map((c) => ({ id: c.id, name: c.name })),
    wsClients: ctx.clients.size,
    presence: ctx.presence.size,
    model: `${config.agent?.provider}/${config.agent?.model}`,
  };
});

// ══════════════════════════════════════════════
// ── Channel Methods ──
// ══════════════════════════════════════════════

// 9. channels.list
defineMethod("channels.list", async (_params, _config, ctx) => {
  return ctx.channelRegistry.list().map((c) => ({
    id: c.id,
    name: c.name,
    capabilities: c.capabilities,
    accountId: c.accountId,
  }));
});

// 10. channels.send
defineMethod("channels.send", async (params, _config, ctx) => {
  const channelId = params.channelId as string;
  const peerId = params.to as string;
  const text = params.text as string;
  if (!channelId || !peerId || !text) throw new Error("Missing channelId, to, or text");

  const channel = ctx.channelRegistry.get(channelId);
  if (!channel) throw new Error(`Channel not found: ${channelId}`);
  if (!channel.adapter.sendText) throw new Error("Channel does not support text");

  await channel.adapter.sendText(peerId, text);
  return { sent: true, channelId, to: peerId };
});

// ══════════════════════════════════════════════
// ── Model Methods ──
// ══════════════════════════════════════════════

// 11. models.list
defineMethod("models.list", async (_params, config) => {
  const models = [
    { id: `${config.agent?.provider}/${config.agent?.model}`, primary: true },
    ...(config.agent?.fallbacks ?? []).map((f) => ({ id: f, primary: false })),
  ];
  if (config.models?.providers) {
    for (const [providerId, providerConfig] of Object.entries(config.models.providers)) {
      for (const model of providerConfig.models ?? []) {
        models.push({ id: `${providerId}/${model.id}`, primary: false });
      }
    }
  }
  return { models };
});

// ══════════════════════════════════════════════
// ── Exec Approval Methods ──
// ══════════════════════════════════════════════

// 12. exec.pending
defineMethod("exec.pending", async () => {
  return { approvals: listPendingApprovals() };
});

// 13. exec.approve
defineMethod("exec.approve", async (params) => {
  const id = params.id as string;
  if (!id) throw new Error("Missing 'id' parameter");
  return { resolved: resolveApproval(id, true) };
});

// 14. exec.deny
defineMethod("exec.deny", async (params) => {
  const id = params.id as string;
  if (!id) throw new Error("Missing 'id' parameter");
  return { resolved: resolveApproval(id, false) };
});

// ══════════════════════════════════════════════
// ── Memory Methods ──
// ══════════════════════════════════════════════

// 15. memory.search
defineMethod("memory.search", async (params, config) => {
  const query = params.query as string;
  if (!query) throw new Error("Missing 'query' parameter");
  const limit = (params.limit as number) ?? 10;
  const { createMemoryStore } = await import("./memory.js");
  const store = createMemoryStore(config);
  const results = await store.search(query, limit);
  return { results: results.map((r) => ({ id: r.entry.id, content: r.entry.content, score: r.score, matchType: r.matchType })) };
});

// 16. memory.store
defineMethod("memory.store", async (params, config) => {
  const content = params.content as string;
  if (!content) throw new Error("Missing 'content' parameter");
  const { createMemoryStore } = await import("./memory.js");
  const store = createMemoryStore(config);
  const id = await store.store(content, (params.metadata as Record<string, unknown>) ?? {}, (params.tags as string[]) ?? []);
  return { id };
});

// ══════════════════════════════════════════════
// ── Cron Methods ──
// ══════════════════════════════════════════════

// 17. cron.list
defineMethod("cron.list", async (_params, config) => {
  const { createCronStore } = await import("./cron.js");
  const store = createCronStore(config);
  return { jobs: store.list() };
});

// 18. cron.add
defineMethod("cron.add", async (params, config) => {
  const { createCronStore } = await import("./cron.js");
  const store = createCronStore(config);
  const job = {
    id: params.id as string ?? `job_${Date.now()}`,
    name: params.name as string ?? "Untitled",
    type: (params.type as "at" | "every" | "cron") ?? "cron",
    schedule: params.schedule as string,
    prompt: params.prompt as string,
    sessionName: params.sessionName as string,
    enabled: params.enabled !== false,
    createdAt: Date.now(),
  };
  if (!job.schedule || !job.prompt) throw new Error("Missing 'schedule' or 'prompt'");
  store.set(job);
  return { job };
});

// 19. cron.remove
defineMethod("cron.remove", async (params, config) => {
  const id = params.id as string;
  if (!id) throw new Error("Missing 'id' parameter");
  const { createCronStore } = await import("./cron.js");
  const store = createCronStore(config);
  return { deleted: store.delete(id) };
});

// ══════════════════════════════════════════════
// ── Session Detail Methods ──
// ══════════════════════════════════════════════

// 20. sessions.get
defineMethod("sessions.get", async (params) => {
  const key = params.sessionKey as string;
  if (!key) throw new Error("Missing 'sessionKey' parameter");
  const keys = getActiveSessionKeys();
  const exists = keys.includes(key);
  return { sessionKey: key, exists };
});

// ══════════════════════════════════════════════
// ── System Methods ──
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// ── Presence Methods ──
// ══════════════════════════════════════════════

// 21. presence.list
defineMethod("presence.list", async (_params, _config, ctx) => {
  const entries = [...ctx.presence.values()];
  return { entries, count: entries.length };
});

// 22. presence.upsert
defineMethod("presence.upsert", async (params, _config, ctx) => {
  const id = params.id as string;
  if (!id) throw new Error("Missing 'id' parameter");
  const existing = ctx.presence.get(id);
  if (existing) {
    existing.lastSeen = Date.now();
    if (params.role) existing.role = params.role as any;
  } else {
    ctx.presence.set(id, {
      id,
      role: (params.role as any) ?? "ui",
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    });
  }
  return { id, upserted: true };
});

// ══════════════════════════════════════════════
// ── System Methods ──
// ══════════════════════════════════════════════

// 23. system.shutdown
defineMethod("system.shutdown", async (_params, _config, ctx) => {
  const { stopGateway, broadcast } = await import("./gateway.js");
  broadcast(ctx, "system.shutdown", { reason: "RPC shutdown request" });
  // Defer shutdown to allow response to be sent
  setTimeout(async () => {
    await stopGateway(ctx);
    process.exit(0);
  }, 500);
  return { status: "shutting_down" };
});
