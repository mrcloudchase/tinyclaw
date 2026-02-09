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
import { shouldAutoTts, synthesize, summarizeForTts } from "./tts.js";
import { log } from "./util/logger.js";

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
    finalizeInbound(ctx);

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

function finalizeInbound(ctx: MsgContext): void {
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

  // Fire inbound hook
  runHooks("message_inbound", {
    body: ctx.body,
    peerId: ctx.peerId,
    channelId: ctx.channelId,
    sessionKey: ctx.sessionKey,
    injectionWarning: ctx.injectionWarning,
  }).catch(() => {});

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
      return s
        ? `Session: ${ctx.sessionKey}\nAgent: ${s.agentId ?? "default"}\nModel: ${s.resolved.provider}/${s.resolved.modelId}`
        : `No active session for ${ctx.sessionKey}`;
    }
    default:
      return undefined; // Not a recognized command, treat as regular message
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
      const { ensureSandboxContainer } = await import("./sandbox.js");
      sandboxContainer = await ensureSandboxContainer(ctx.sessionKey, ctx.config.sandbox) ?? undefined;
    } catch (err) {
      log.warn(`Sandbox setup failed: ${err}`);
    }
  }

  // Get or create session
  let tinyClawSession = activeSessions.get(ctx.sessionKey);

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

  // Run agent
  const result = await runAgent({
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

  // Cache session for reuse
  activeSessions.set(ctx.sessionKey, result.tinyClawSession);

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
// ── Deliver (send chunks to channel with delays + typing) ──
// ══════════════════════════════════════════════

async function deliver(ctx: MsgContext, chunks: string[]): Promise<void> {
  const adapter = ctx.channel?.adapter;
  if (!adapter?.sendText) return;

  const minDelay = ctx.config.pipeline?.deliveryDelayMs?.min ?? 800;
  const maxDelay = ctx.config.pipeline?.deliveryDelayMs?.max ?? 2500;
  const showTyping = ctx.config.pipeline?.typingIndicator !== false;

  for (let i = 0; i < chunks.length; i++) {
    if (ctx.abortController.signal.aborted) break;

    // Send typing indicator
    if (showTyping && adapter.sendTyping) {
      try { await adapter.sendTyping(ctx.peerId); } catch { /* ignore */ }
    }

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
