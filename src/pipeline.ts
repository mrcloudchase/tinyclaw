// Message Pipeline — MsgContext + dispatch + inbound + directives + commands + orchestrate + streaming + delivery
// All in ONE file

import type { TinyClawConfig } from "./config/schema.js";
import type { ChannelAdapter, ChannelInstance } from "./channel.js";
import type { TinyClawSession } from "./agent/session.js";
import type { HookFn } from "./agent/runner.js";
import { runAgent } from "./agent/runner.js";
import { createTinyClawSession, parseSessionKey, buildSessionKey, resolveAgentForChannel } from "./agent/session.js";
import { runHooks } from "./hooks.js";
import { detectInjection, wrapUntrustedContent, sanitizeForLog } from "./security.js";
import { shouldAutoTts, synthesize, summarizeForTts } from "./tts/tts.js";
import { log } from "./utils/logger.js";

// ══════════════════════════════════════════════
// ── MsgContext ──
// ══════════════════════════════════════════════

export interface MsgContext {
  // Source identification
  source: "cli" | "gateway" | "channel";
  channelId?: string;
  accountId?: string;
  peerId: string;
  peerName?: string;
  messageId?: string;

  // Message content
  body: string;
  rawBody?: string;
  mediaUrls?: string[];
  mediaType?: string;
  isGroup?: boolean;
  threadId?: string;
  replyToId?: string;

  // Routing
  agentId?: string;
  sessionKey: string;

  // Pipeline state
  directives: ParsedDirectives;
  command?: ParsedCommand;
  injectionWarning?: boolean;

  // Config
  config: TinyClawConfig;

  // Channel reference (for delivery)
  channel?: ChannelInstance;

  // Abort
  abortController: AbortController;

  // Timestamps
  receivedAt: number;
}

export interface ParsedDirectives {
  thinkOverride?: "off" | "low" | "medium" | "high";
  modelOverride?: string;
  execOverride?: "auto" | "interactive" | "deny";
}

export interface ParsedCommand {
  name: string;
  args: string;
}

export interface PipelineResult {
  reply?: string;
  chunks?: string[];
  ttsAudio?: Buffer;
  sessionKey: string;
  aborted?: boolean;
  error?: string;
}

// ══════════════════════════════════════════════
// ── Dispatch (Entry Point) ──
// ══════════════════════════════════════════════

const activeSessions = new Map<string, TinyClawSession>();

// ── Message Deduplication ──
const recentMessages = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;

function isDuplicate(channelId: string | undefined, messageId: string | undefined): boolean {
  if (!channelId || !messageId) return false;
  const key = `${channelId}:${messageId}`;
  const now = Date.now();
  // Sweep expired entries (every check, cheap since Map is small)
  for (const [k, ts] of recentMessages) {
    if (now - ts > DEDUP_TTL_MS) recentMessages.delete(k);
  }
  if (recentMessages.has(key)) {
    log.debug(`Dedup: skipping duplicate message ${key}`);
    return true;
  }
  recentMessages.set(key, now);
  return false;
}

// ── Collect Buffer (batch rapid messages) ──
const collectBuffers = new Map<string, { parts: string[]; timer: ReturnType<typeof setTimeout>; callback: (combined: string) => void }>();

function collectBuffer(key: string, body: string, windowMs: number, callback: (combined: string) => void): void {
  const existing = collectBuffers.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.parts.push(body);
    existing.timer = setTimeout(() => {
      collectBuffers.delete(key);
      existing.callback(existing.parts.join("\n"));
    }, windowMs);
  } else {
    const entry = {
      parts: [body],
      callback,
      timer: setTimeout(() => {
        collectBuffers.delete(key);
        callback(entry.parts.join("\n"));
      }, windowMs),
    };
    collectBuffers.set(key, entry);
  }
}

export async function dispatch(params: {
  source: MsgContext["source"];
  body: string;
  config: TinyClawConfig;
  channelId?: string;
  accountId?: string;
  peerId?: string;
  peerName?: string;
  messageId?: string;
  mediaUrls?: string[];
  isGroup?: boolean;
  threadId?: string;
  channel?: ChannelInstance;
  onChunk?: (chunk: string) => void;
  onTts?: (audio: Buffer) => void;
}): Promise<PipelineResult> {
  // Dedup check — skip duplicate channel messages
  if (isDuplicate(params.channelId, params.messageId)) {
    return { sessionKey: "", reply: undefined };
  }

  // Collect mode — batch rapid messages from same peer before dispatching
  if (params.source === "channel" && params.config.pipeline?.collectMode === "collect" && !(params as any)._collected) {
    const peerId = params.peerId ?? "unknown";
    const collectKey = `${params.channelId ?? ""}:${peerId}`;
    return new Promise<PipelineResult>((resolve) => {
      collectBuffer(collectKey, params.body, params.config.pipeline?.collectWindowMs ?? 3000, async (combined) => {
        const result = await dispatch({ ...params, body: combined, _collected: true } as any);
        resolve(result);
      });
    });
  }

  const ac = new AbortController();

  // Build initial context
  const ctx: MsgContext = {
    source: params.source,
    channelId: params.channelId,
    accountId: params.accountId,
    peerId: params.peerId ?? "cli",
    peerName: params.peerName,
    messageId: params.messageId,
    body: params.body,
    rawBody: params.body,
    mediaUrls: params.mediaUrls,
    isGroup: params.isGroup,
    threadId: params.threadId,
    config: params.config,
    channel: params.channel,
    sessionKey: "",
    directives: {},
    abortController: ac,
    receivedAt: Date.now(),
  };

  try {
    // Pipeline stages
    await finalizeInbound(ctx);

    // Pairing gate — block unknown senders if pairing is required
    if (ctx.source === "channel" && ctx.config.security?.pairingRequired && ctx.channelId) {
      const { getPairingStore } = await import("./pairing.js");
      const store = getPairingStore();
      if (!store.isAllowed(ctx.channelId, ctx.peerId)) {
        const request = store.createRequest(ctx.channelId, ctx.peerId, ctx.peerName);
        const reply = `🔒 Access requires pairing.\n\nYour pairing code: **${request.code}**\n\nAsk the admin to run:\n\`tinyclaw pair approve ${request.code}\`\n\nCode expires in 1 hour.`;
        // Send pairing instructions directly
        if (ctx.channel?.adapter.sendText) {
          await ctx.channel.adapter.sendText(ctx.peerId, reply, ctx.accountId);
        }
        return { reply, sessionKey: ctx.sessionKey };
      }
    }

    processDirectives(ctx);

    const cmdResult = await processCommand(ctx);
    if (cmdResult) return { reply: cmdResult, sessionKey: ctx.sessionKey };

    const result = await orchestrate(ctx, params.onChunk);

    // Deliver chunks to channel if applicable
    if (ctx.channel && result.chunks?.length) {
      await deliver(ctx, result.chunks);
    }

    // TTS
    if (result.reply && shouldAutoTts(ctx.config, ctx.source === "channel")) {
      try {
        const ttsText = summarizeForTts(result.reply);
        const ttsResult = await synthesize(ttsText, ctx.config);
        if (params.onTts) params.onTts(ttsResult.audio);
        return { ...result, ttsAudio: ttsResult.audio };
      } catch (err) {
        log.warn(`TTS failed: ${err}`);
      }
    }

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Pipeline error: ${error}`);
    await runHooks("error", { error, sessionKey: ctx.sessionKey });
    return { error, sessionKey: ctx.sessionKey };
  }
}

// ══════════════════════════════════════════════
// ── Finalize Inbound ──
// ══════════════════════════════════════════════

async function finalizeInbound(ctx: MsgContext): Promise<void> {
  // Resolve agent binding
  if (ctx.channelId) {
    ctx.agentId = resolveAgentForChannel(ctx.config, ctx.channelId, ctx.accountId, ctx.peerId);
  }

  // Build session key (with group/thread isolation)
  if (ctx.channelId) {
    const isolation = ctx.config.channels?.defaults?.groupIsolation ?? "per-group";
    let sessionPeer: string;
    if (ctx.isGroup && ctx.threadId && isolation === "per-thread") {
      sessionPeer = `${ctx.peerId}:${ctx.threadId}`;
    } else if (ctx.isGroup && isolation === "shared") {
      sessionPeer = "shared";
    } else {
      sessionPeer = ctx.threadId ?? ctx.peerId;
    }
    ctx.sessionKey = buildSessionKey(
      ctx.agentId ?? "default",
      ctx.channelId,
      ctx.accountId ?? "default",
      sessionPeer,
    );
  } else {
    ctx.sessionKey = ctx.peerId;
  }

  // Trim body
  ctx.body = ctx.body.trim();

  // Check for injection
  const injection = detectInjection(ctx.body);
  if (injection.detected) {
    ctx.injectionWarning = true;
    ctx.body = wrapUntrustedContent(ctx.body, ctx.channelId ?? ctx.source);
    log.warn(`Injection detected from ${ctx.peerId}: ${injection.patterns.join(", ")}`);
  }

  // Fire inbound hook (check for abort)
  const hookResult = await runHooks("message_inbound", {
    body: ctx.body,
    peerId: ctx.peerId,
    channelId: ctx.channelId,
    sessionKey: ctx.sessionKey,
    injectionWarning: ctx.injectionWarning,
  });
  if (hookResult && typeof hookResult === "object" && hookResult.abort) {
    throw new Error(hookResult.abortMessage ?? "Message blocked by hook");
  }

  log.debug(`Inbound [${ctx.source}] from ${ctx.peerId}: ${sanitizeForLog(ctx.body, 100)}`);
}

// ══════════════════════════════════════════════
// ── Process Directives (++think, ++model, ++exec) ──
// ══════════════════════════════════════════════

const DIRECTIVE_RE = /^\+\+(\w+)\s+(\S+)/gm;

function processDirectives(ctx: MsgContext): void {
  const matches = [...ctx.body.matchAll(DIRECTIVE_RE)];
  for (const m of matches) {
    const [, key, value] = m;
    switch (key) {
      case "think":
        if (["off", "low", "medium", "high"].includes(value)) {
          ctx.directives.thinkOverride = value as ParsedDirectives["thinkOverride"];
        }
        break;
      case "model":
        ctx.directives.modelOverride = value;
        break;
      case "exec":
        if (["auto", "interactive", "deny"].includes(value)) {
          ctx.directives.execOverride = value as ParsedDirectives["execOverride"];
        }
        break;
    }
  }
  // Strip directives from body
  ctx.body = ctx.body.replace(DIRECTIVE_RE, "").trim();
}

// ══════════════════════════════════════════════
// ── Process Commands (/new, /reset, /stop, /compact, /model) ──
// ══════════════════════════════════════════════

async function processCommand(ctx: MsgContext): Promise<string | undefined> {
  if (!ctx.body.startsWith("/")) return undefined;

  const spaceIdx = ctx.body.indexOf(" ");
  const name = (spaceIdx > 0 ? ctx.body.slice(1, spaceIdx) : ctx.body.slice(1)).toLowerCase();
  const args = spaceIdx > 0 ? ctx.body.slice(spaceIdx + 1).trim() : "";

  switch (name) {
    case "new":
    case "reset": {
      activeSessions.delete(ctx.sessionKey);
      return "Session cleared. Starting fresh.";
    }
    case "stop": {
      ctx.abortController.abort();
      return "Stopped.";
    }
    case "compact": {
      const existing = activeSessions.get(ctx.sessionKey);
      if (!existing) return "No active session to compact.";
      const { compactSession } = await import("./agent/compact.js");
      const result = await compactSession(existing.session);
      return `Compacted: ${result.tokensBefore} tokens compacted`;
    }
    case "model": {
      if (!args) return `Current model: ${ctx.config.agent?.provider}/${ctx.config.agent?.model}`;
      ctx.directives.modelOverride = args;
      return `Model set to ${args} for this session.`;
    }
    case "status": {
      const s = activeSessions.get(ctx.sessionKey);
      if (!s) return `No active session for ${ctx.sessionKey}`;
      const u = s.usage;
      return `Session: ${ctx.sessionKey}\nAgent: ${s.agentId ?? "default"}\nModel: ${s.resolved.provider}/${s.resolved.modelId}\nTokens: ${u.totalTokens} (in: ${u.inputTokens}, out: ${u.outputTokens}, cache-r: ${u.cacheRead}, cache-w: ${u.cacheWrite})`;
    }
    default: {
      // Check if it matches a skill name
      const { executeSkillCommand } = await import("./skills/skills.js");
      const skillResult = executeSkillCommand(name, args);
      if (skillResult.type === "prompt" && skillResult.rewrittenBody) {
        ctx.body = skillResult.rewrittenBody;
        return undefined; // Continue to orchestrate with rewritten body
      }
      return undefined; // Not a recognized command
    }
  }
}

// ══════════════════════════════════════════════
// ── Orchestrate (Session → Hooks → Agent → Fallback) ──
// ══════════════════════════════════════════════

async function orchestrate(ctx: MsgContext, onChunk?: (chunk: string) => void): Promise<PipelineResult> {
  const workspaceDir = ctx.config.workspace?.dir ?? process.cwd();

  // Resolve sandbox container if enabled for channel sessions
  let sandboxContainer: string | undefined;
  if (ctx.source === "channel" && ctx.config.sandbox?.enabled) {
    try {
      const { ensureSandboxContainer } = await import("./sandbox/sandbox.js");
      sandboxContainer = await ensureSandboxContainer(ctx.sessionKey, ctx.config.sandbox) ?? undefined;
    } catch (err) {
      log.warn(`Sandbox setup failed: ${err}`);
    }
  }

  // Get or create session (with freshness check)
  let tinyClawSession = activeSessions.get(ctx.sessionKey);
  if (tinyClawSession && evaluateSessionFreshness(ctx.sessionKey, ctx.config)) {
    log.info(`Session ${ctx.sessionKey} is stale, resetting`);
    tinyClawSession.session.dispose();
    activeSessions.delete(ctx.sessionKey);
    tinyClawSession = undefined;
  }

  // Parse model override
  let provider: string | undefined;
  let modelId: string | undefined;
  if (ctx.directives.modelOverride) {
    const { resolveAlias } = await import("./model/resolve.js");
    const resolved = resolveAlias(ctx.directives.modelOverride);
    provider = resolved.provider;
    modelId = resolved.modelId;
  }

  // Build hooks function
  const hookFn: HookFn = async (event, data) => {
    await runHooks(event, { ...data, sessionKey: ctx.sessionKey, channelId: ctx.channelId, peerId: ctx.peerId });
  };

  // Prepare media context prefix
  let prompt = ctx.body;
  if (ctx.mediaUrls?.length) {
    const mediaList = ctx.mediaUrls.map((u) => `[Media: ${u}]`).join("\n");
    prompt = `${mediaList}\n\n${prompt}`;
  }

  // Envelope context for channel messages
  if (ctx.source === "channel" && (ctx.config.pipeline?.envelope !== false)) {
    const elapsed = Math.round((Date.now() - ctx.receivedAt) / 1000);
    const ts = new Date(ctx.receivedAt).toISOString().slice(11, 19);
    const sender = ctx.peerName ?? ctx.peerId;
    prompt = `[${ctx.channelId} from ${sender} +${elapsed}s ${ts}] ${prompt}`;
  }

  // Start typing indicator for channel messages
  const typingCtrl = (ctx.channel && ctx.config.pipeline?.typingIndicator !== false)
    ? createTypingController(ctx.channel.adapter, ctx.peerId)
    : undefined;
  typingCtrl?.start();

  // Run agent
  let result;
  try {
    result = await runAgent({
      config: ctx.config,
      prompt,
      sessionName: ctx.sessionKey,
      workspaceDir,
      provider,
      modelId,
      thinkingLevel: ctx.directives.thinkOverride as any,
      options: {
        onText: onChunk,
        abortSignal: ctx.abortController.signal,
      },
      existingSession: tinyClawSession,
      hooks: hookFn,
    });
  } finally {
    typingCtrl?.seal();
  }

  // Cache session for reuse + track timestamp
  activeSessions.set(ctx.sessionKey, result.tinyClawSession);
  sessionTimestamps.set(ctx.sessionKey, Date.now());

  // Chunk the reply for channel delivery
  const chunks = ctx.channel ? chunkReply(result.text, ctx.config) : undefined;

  // Fire outbound hook
  await runHooks("message_outbound", {
    reply: result.text,
    sessionKey: ctx.sessionKey,
    channelId: ctx.channelId,
    peerId: ctx.peerId,
    chunks: chunks?.length,
  });

  return {
    reply: result.text,
    chunks,
    sessionKey: ctx.sessionKey,
  };
}

// ══════════════════════════════════════════════
// ── Chunk Reply (paragraph/sentence-aware, 800-1200 chars) ──
// ══════════════════════════════════════════════

export function chunkReply(text: string, config: TinyClawConfig): string[] {
  const minSize = config.pipeline?.chunkSize?.min ?? 800;
  const maxSize = config.pipeline?.chunkSize?.max ?? 1200;

  if (text.length <= maxSize) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitAt = -1;
    const searchEnd = Math.min(remaining.length, maxSize);
    const paraIdx = remaining.lastIndexOf("\n\n", searchEnd);
    if (paraIdx >= minSize) {
      splitAt = paraIdx + 2;
    }

    // Try sentence boundary
    if (splitAt < 0) {
      const sentenceEnds = [". ", "! ", "? ", ".\n", "!\n", "?\n"];
      for (const end of sentenceEnds) {
        const idx = remaining.lastIndexOf(end, searchEnd);
        if (idx >= minSize) {
          splitAt = Math.max(splitAt, idx + end.length);
        }
      }
    }

    // Try newline
    if (splitAt < 0) {
      const nlIdx = remaining.lastIndexOf("\n", searchEnd);
      if (nlIdx >= minSize) splitAt = nlIdx + 1;
    }

    // Hard split
    if (splitAt < 0) splitAt = maxSize;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

// ══════════════════════════════════════════════
// ── Typing Controller (lifecycle-aware) ──
// ══════════════════════════════════════════════

function createTypingController(adapter: ChannelAdapter, peerId: string) {
  let interval: ReturnType<typeof setInterval> | null = null;
  let sealed = false;
  const TTL = 2 * 60_000; // 2 min max
  const REFRESH = 6_000;   // 6s refresh
  let startedAt = 0;

  return {
    start() {
      if (sealed || !adapter.sendTyping) return;
      startedAt = Date.now();
      adapter.sendTyping(peerId).catch(() => {});
      interval = setInterval(() => {
        if (Date.now() - startedAt > TTL) { this.stop(); return; }
        adapter.sendTyping!(peerId).catch(() => {});
      }, REFRESH);
    },
    stop() {
      if (interval) { clearInterval(interval); interval = null; }
    },
    seal() { sealed = true; this.stop(); },
  };
}

// ══════════════════════════════════════════════
// ── Deliver (send chunks to channel with delays + typing) ──
// ══════════════════════════════════════════════

async function deliver(ctx: MsgContext, chunks: string[]): Promise<void> {
  const adapter = ctx.channel?.adapter;
  if (!adapter?.sendText) return;

  const minDelay = ctx.config.pipeline?.deliveryDelayMs?.min ?? 800;
  const maxDelay = ctx.config.pipeline?.deliveryDelayMs?.max ?? 2500;

  // Apply response prefix if configured
  const prefix = ctx.config.agent?.responsePrefix;
  if (prefix && chunks.length > 0) {
    chunks[0] = prefix + chunks[0];
  }

  for (let i = 0; i < chunks.length; i++) {
    if (ctx.abortController.signal.aborted) break;

    // Delay between chunks (not before first)
    if (i > 0) {
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await new Promise((r) => setTimeout(r, delay));
    }

    // Send chunk
    try {
      await adapter.sendText(ctx.peerId, chunks[i], ctx.accountId);
    } catch (err) {
      log.error(`Delivery failed for chunk ${i + 1}/${chunks.length}: ${err}`);
      break;
    }
  }
}

// ══════════════════════════════════════════════
// ── Debouncer (batch inbound messages by session key) ──
// ══════════════════════════════════════════════

interface DebouncerEntry {
  messages: Array<{ body: string; receivedAt: number }>;
  timer: ReturnType<typeof setTimeout>;
}

export function createDebouncer(config: TinyClawConfig, onFlush: (sessionKey: string, combined: string) => void) {
  const buffers = new Map<string, DebouncerEntry>();
  const debounceMs = config.pipeline?.inboundDebounceMs ?? 1500;

  return {
    add(sessionKey: string, body: string) {
      const existing = buffers.get(sessionKey);
      if (existing) {
        clearTimeout(existing.timer);
        existing.messages.push({ body, receivedAt: Date.now() });
      } else {
        buffers.set(sessionKey, { messages: [{ body, receivedAt: Date.now() }], timer: null as any });
      }

      const entry = buffers.get(sessionKey)!;
      entry.timer = setTimeout(() => {
        buffers.delete(sessionKey);
        const combined = entry.messages.map((m) => m.body).join("\n");
        onFlush(sessionKey, combined);
      }, debounceMs);
    },

    flush(sessionKey: string) {
      const entry = buffers.get(sessionKey);
      if (entry) {
        clearTimeout(entry.timer);
        buffers.delete(sessionKey);
        const combined = entry.messages.map((m) => m.body).join("\n");
        onFlush(sessionKey, combined);
      }
    },

    clear() {
      for (const [, entry] of buffers) clearTimeout(entry.timer);
      buffers.clear();
    },

    get size() { return buffers.size; },
  };
}

// ══════════════════════════════════════════════
// ── Session Freshness Evaluation ──
// ══════════════════════════════════════════════

const sessionTimestamps = new Map<string, number>();

function evaluateSessionFreshness(sessionKey: string, config: TinyClawConfig): boolean {
  const mode = config.session?.resetMode ?? "manual";
  if (mode === "manual") return false; // never stale

  const lastActive = sessionTimestamps.get(sessionKey) ?? 0;
  if (lastActive === 0) return false; // no prior session

  const now = Date.now();

  if (mode === "daily") {
    const resetHour = config.session?.resetAtHour ?? 0;
    const today = new Date();
    today.setHours(resetHour, 0, 0, 0);
    return lastActive < today.getTime();
  }

  if (mode === "idle") {
    const idleMs = (config.session?.idleMinutes ?? 120) * 60_000;
    return (now - lastActive) > idleMs;
  }

  return false;
}

// ══════════════════════════════════════════════
// ── Pipeline Lifecycle ──
// ══════════════════════════════════════════════

export function clearSession(sessionKey: string): boolean {
  return activeSessions.delete(sessionKey);
}

export function getActiveSessionKeys(): string[] {
  return [...activeSessions.keys()];
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
