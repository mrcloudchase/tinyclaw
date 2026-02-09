// Signal Channel Implementation via signal-cli REST API (JSON-RPC 2.0)
// SSE event stream for inbound messages, JSON-RPC for outbound

import { randomUUID } from "node:crypto";
import type { TinyClawConfig } from "../config/schema.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelInstance, InboundMessage } from "./channel.js";
import { dispatch } from "../pipeline/pipeline.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface SignalChannelConfig {
  enabled?: boolean;
  baseUrl?: string;
  account?: string;
  autoStart?: boolean;
  mediaMaxMb?: number;
}

interface SignalRpcResponse<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
  id?: string | number | null;
}

interface SignalSseEvent {
  event?: string;
  data?: string;
  id?: string;
}

interface SignalEnvelope {
  account?: string;
  source?: string;
  sourceName?: string;
  sourceNumber?: string;
  sourceUuid?: string;
  dataMessage?: {
    timestamp?: number;
    message?: string;
    groupInfo?: { groupId?: string; groupName?: string };
    attachments?: Array<{ contentType?: string; id?: string; filename?: string }>;
  };
  typingMessage?: { action?: string; groupId?: string };
}

// ══════════════════════════════════════════════
// ── JSON-RPC Client ──
// ══════════════════════════════════════════════

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Signal base URL is required");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `http://${trimmed}`.replace(/\/+$/, "");
}

async function signalRpcRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> | undefined,
  opts: { baseUrl: string; timeoutMs?: number },
): Promise<T> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const id = randomUUID();
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  try {
    const res = await fetch(`${baseUrl}/api/v1/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    if (res.status === 201) return undefined as T;

    const text = await res.text();
    if (!text) throw new Error(`Signal RPC empty response (status ${res.status})`);

    const parsed = JSON.parse(text) as SignalRpcResponse<T>;
    if (parsed.error) {
      throw new Error(`Signal RPC ${parsed.error.code ?? "unknown"}: ${parsed.error.message ?? "error"}`);
    }
    return parsed.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function signalCheck(
  baseUrl: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status?: number | null; error?: string | null }> {
  const normalized = normalizeBaseUrl(baseUrl);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${normalized}/api/v1/check`, { method: "GET", signal: controller.signal });
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      return { ok: true, status: res.status, error: null };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ══════════════════════════════════════════════
// ── SSE Event Stream ──
// ══════════════════════════════════════════════

async function streamSignalEvents(params: {
  baseUrl: string;
  account?: string;
  abortSignal?: AbortSignal;
  onEvent: (event: SignalSseEvent) => void;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const url = new URL(`${baseUrl}/api/v1/events`);
  if (params.account) url.searchParams.set("account", params.account);

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    signal: params.abortSignal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Signal SSE failed (${res.status} ${res.statusText || "error"})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: SignalSseEvent = {};

  const flushEvent = () => {
    if (!currentEvent.data && !currentEvent.event && !currentEvent.id) return;
    params.onEvent({ event: currentEvent.event, data: currentEvent.data, id: currentEvent.id });
    currentEvent = {};
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      let line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        flushEvent();
        lineEnd = buffer.indexOf("\n");
        continue;
      }
      if (line.startsWith(":")) {
        lineEnd = buffer.indexOf("\n");
        continue;
      }
      const [rawField, ...rest] = line.split(":");
      const field = rawField.trim();
      const rawValue = rest.join(":");
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") currentEvent.event = value;
      else if (field === "data") currentEvent.data = currentEvent.data ? `${currentEvent.data}\n${value}` : value;
      else if (field === "id") currentEvent.id = value;

      lineEnd = buffer.indexOf("\n");
    }
  }
  flushEvent();
}

// ══════════════════════════════════════════════
// ── Normalize Inbound Messages ──
// ══════════════════════════════════════════════

function normalizeSignalMessage(envelope: SignalEnvelope, channelId: string): InboundMessage | null {
  const dm = envelope.dataMessage;
  if (!dm) return null;

  const peerId = envelope.sourceNumber ?? envelope.sourceUuid ?? envelope.source ?? "unknown";
  const peerName = envelope.sourceName;
  const isGroup = !!dm.groupInfo?.groupId;
  const groupPeer = isGroup ? `group:${dm.groupInfo!.groupId}` : peerId;

  const inbound: InboundMessage = {
    channelId,
    peerId: groupPeer,
    peerName,
    messageId: dm.timestamp ? String(dm.timestamp) : undefined,
    body: dm.message ?? "",
    isGroup,
    timestamp: dm.timestamp,
  };

  // Attachments
  if (dm.attachments?.length) {
    inbound.mediaUrls = dm.attachments.map((a) => a.id ?? a.filename ?? "").filter(Boolean);
    const firstType = dm.attachments[0]?.contentType ?? "";
    if (firstType.startsWith("image/")) inbound.mediaType = "image";
    else if (firstType.startsWith("audio/")) inbound.mediaType = "audio";
    else if (firstType.startsWith("video/")) inbound.mediaType = "video";
    else inbound.mediaType = "document";
  }

  // Skip empty messages
  if (!inbound.body && !inbound.mediaUrls?.length) return null;

  return inbound;
}

// ══════════════════════════════════════════════
// ── Signal Adapter ──
// ══════════════════════════════════════════════

function createSignalAdapter(
  baseUrl: string,
  account: string,
  _config: TinyClawConfig,
): ChannelAdapter {
  let abortController: AbortController | null = null;
  let connected = false;

  return {
    async sendText(peerId: string, text: string) {
      const isGroup = peerId.startsWith("group:");
      const params: Record<string, unknown> = { message: text };
      if (account) params.account = account;

      if (isGroup) {
        params.groupId = peerId.slice("group:".length);
      } else {
        params.recipient = [peerId];
      }

      await signalRpcRequest("send", params, { baseUrl });
    },

    async sendImage(peerId: string, url: string, caption?: string) {
      const isGroup = peerId.startsWith("group:");
      const params: Record<string, unknown> = {
        message: caption ?? "",
        attachments: [url],
      };
      if (account) params.account = account;
      if (isGroup) params.groupId = peerId.slice("group:".length);
      else params.recipient = [peerId];

      await signalRpcRequest("send", params, { baseUrl });
    },

    async sendTyping(peerId: string) {
      const isGroup = peerId.startsWith("group:");
      const params: Record<string, unknown> = {};
      if (account) params.account = account;
      if (isGroup) params.groupId = peerId.slice("group:".length);
      else params.recipient = [peerId];

      try {
        await signalRpcRequest("sendTyping", params, { baseUrl });
      } catch { /* typing is best-effort */ }
    },

    async sendReadReceipt(messageId: string) {
      const ts = parseInt(messageId, 10);
      if (!Number.isFinite(ts) || ts <= 0) return;
      try {
        await signalRpcRequest("sendReceipt", {
          account,
          targetTimestamp: ts,
          type: "read",
        }, { baseUrl });
      } catch { /* receipt is best-effort */ }
    },

    async connect() {
      if (connected) return;
      abortController = new AbortController();
      connected = true;
      log.info(`Signal channel connected (${baseUrl})`);

      // Start SSE stream in background with auto-reconnect
      const startStream = async () => {
        while (connected) {
          try {
            await streamSignalEvents({
              baseUrl,
              account,
              abortSignal: abortController!.signal,
              onEvent: (event) => {
                if (!event.data) return;
                try {
                  const envelope = JSON.parse(event.data) as SignalEnvelope;
                  const msg = normalizeSignalMessage(envelope, `signal:${account || "default"}`);
                  if (msg) {
                    const channelInstance = getChannelInstance();
                    dispatch({
                      source: "channel",
                      body: msg.body,
                      config: _config,
                      channelId: msg.channelId,
                      peerId: msg.peerId,
                      peerName: msg.peerName,
                      messageId: msg.messageId,
                      mediaUrls: msg.mediaUrls,
                      isGroup: msg.isGroup,
                      channel: channelInstance,
                    }).catch((err) => log.error(`Signal dispatch error: ${err}`));
                  }
                } catch (err) {
                  log.debug(`Signal event parse error: ${err}`);
                }
              },
            });
          } catch (err) {
            if (!connected) break;
            log.warn(`Signal SSE disconnected: ${err}. Reconnecting in 5s…`);
            await new Promise((r) => setTimeout(r, 5_000));
          }
        }
      };

      startStream().catch((err) => log.error(`Signal stream fatal: ${err}`));
    },

    async disconnect() {
      if (!connected) return;
      connected = false;
      abortController?.abort();
      abortController = null;
      log.info("Signal channel disconnected");
    },

    isConnected() {
      return connected;
    },
  };
}

// ══════════════════════════════════════════════
// ── Signal Channel Factory ──
// ══════════════════════════════════════════════

let _instance: ChannelInstance;
function getChannelInstance(): ChannelInstance { return _instance; }

export function createSignalChannel(
  channelConfig: SignalChannelConfig,
  config: TinyClawConfig,
): ChannelInstance {
  const baseUrl = channelConfig.baseUrl ?? "http://localhost:8080";
  const account = channelConfig.account ?? "";
  const channelId = `signal:${account || "default"}`;

  const adapter = createSignalAdapter(baseUrl, account, config);

  const capabilities: ChannelCapabilities = {
    text: true,
    image: true,
    audio: true,
    video: false,
    document: true,
    sticker: false,
    reaction: false,
    typing: true,
    readReceipt: true,
    editMessage: false,
    deleteMessage: false,
    groups: true,
    threads: false,
    maxMediaBytes: (channelConfig.mediaMaxMb ?? 8) * 1024 * 1024,
  };

  _instance = {
    id: channelId,
    name: "Signal",
    adapter,
    capabilities,
  };

  return _instance;
}
