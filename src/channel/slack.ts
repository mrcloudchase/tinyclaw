// Slack Channel Implementation via @slack/bolt
// Socket Mode (default) for real-time messaging

import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { TinyClawConfig } from "../config/schema.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelInstance, InboundMessage } from "../channel.js";
import { dispatch } from "../pipeline.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface SlackChannelConfig {
  botToken?: string;
  botTokenEnv?: string;
  appToken?: string;
  appTokenEnv?: string;
  mentionOnly?: boolean;
  threadReplies?: boolean;
}

interface SlackContext {
  app: App;
  webClient: WebClient;
  botToken: string;
  appToken: string;
  config: TinyClawConfig;
  channelConfig: SlackChannelConfig;
  botUserId?: string;
}

// ══════════════════════════════════════════════
// ── Slack Adapter ──
// ══════════════════════════════════════════════

function createSlackAdapter(ctx: SlackContext): ChannelAdapter {
  const { webClient } = ctx;
  let connected = false;

  return {
    async sendText(peerId: string, text: string) {
      // Slack has no hard message length limit via API, but we chunk at 4000 for readability
      if (text.length <= 4000) {
        await webClient.chat.postMessage({ channel: peerId, text });
      } else {
        for (let i = 0; i < text.length; i += 4000) {
          await webClient.chat.postMessage({ channel: peerId, text: text.slice(i, i + 4000) });
        }
      }
    },

    async sendImage(peerId: string, url: string, caption?: string) {
      await webClient.chat.postMessage({
        channel: peerId,
        text: caption ?? "",
        blocks: [
          {
            type: "image",
            image_url: url,
            alt_text: caption ?? "Image",
          },
        ],
      });
    },

    async sendDocument(peerId: string, url: string, filename?: string) {
      // Use chat.postMessage with a link; for actual file uploads use uploadV2
      await webClient.chat.postMessage({
        channel: peerId,
        text: `📎 ${filename ?? "Document"}: ${url}`,
      });
    },

    async sendReaction(messageId: string, emoji: string) {
      // messageId format: "channel:ts"
      const [channel, ts] = messageId.split(":");
      if (!channel || !ts) return;
      try {
        await webClient.reactions.add({
          channel,
          timestamp: ts,
          name: emoji.replace(/:/g, ""),
        });
      } catch (err) {
        log.debug(`Slack reaction failed: ${err}`);
      }
    },

    async sendTyping(peerId: string) {
      // Slack doesn't have a direct typing indicator API for bots
      // This is a no-op
    },

    async editMessage(messageId: string, text: string) {
      const [channel, ts] = messageId.split(":");
      if (!channel || !ts) return;
      try {
        await webClient.chat.update({ channel, ts, text });
      } catch (err) {
        log.debug(`Slack edit failed: ${err}`);
      }
    },

    async deleteMessage(messageId: string) {
      const [channel, ts] = messageId.split(":");
      if (!channel || !ts) return;
      try {
        await webClient.chat.delete({ channel, ts });
      } catch (err) {
        log.debug(`Slack delete failed: ${err}`);
      }
    },

    async replyToThread(threadId: string, text: string) {
      // threadId format: "channel:thread_ts"
      const [channel, threadTs] = threadId.split(":");
      if (!channel || !threadTs) return;
      await webClient.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs,
      });
    },

    async uploadMedia(buf: Buffer, mime: string, filename?: string): Promise<string> {
      const result = await webClient.filesUploadV2({
        file: buf,
        filename: filename ?? "upload",
      });
      // Return the file permalink
      return (result as any).file?.permalink ?? "";
    },

    async connect() {
      if (connected) return;
      await ctx.app.start();

      // Get bot user ID for mention stripping
      try {
        const auth = await webClient.auth.test();
        ctx.botUserId = auth.user_id as string | undefined;
        log.info(`Slack bot connected as ${auth.user} (${ctx.botUserId})`);
      } catch (err) {
        log.warn(`Slack auth.test failed: ${err}`);
      }

      connected = true;
    },

    async disconnect() {
      if (!connected) return;
      try {
        await ctx.app.stop();
      } catch { /* ignore */ }
      connected = false;
      log.info("Slack bot disconnected");
    },

    isConnected() {
      return connected;
    },
  };
}

// ══════════════════════════════════════════════
// ── Slack Channel Factory ──
// ══════════════════════════════════════════════

export function createSlackChannel(
  botToken: string,
  appToken: string,
  channelConfig: SlackChannelConfig,
  config: TinyClawConfig,
): ChannelInstance {
  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  const webClient = new WebClient(botToken);
  const channelId = "slack:default";
  const mentionOnly = channelConfig.mentionOnly ?? true;
  const threadReplies = channelConfig.threadReplies ?? true;

  const ctx: SlackContext = { app, webClient, botToken, appToken, config, channelConfig };

  // Message handler
  app.message(async ({ message, say }) => {
    try {
      // Type guard: only handle standard messages
      if (!message || message.subtype) return;
      if (!("text" in message)) return;

      // Skip bot messages
      if ("bot_id" in message && message.bot_id) return;

      const peerId = message.channel;
      const userId = "user" in message ? message.user : undefined;
      const isGroup = message.channel_type === "channel" || message.channel_type === "group";
      const threadTs = "thread_ts" in message ? message.thread_ts : undefined;

      // Mention gating for channels (not DMs)
      if (isGroup && mentionOnly && ctx.botUserId) {
        const mentionPattern = `<@${ctx.botUserId}>`;
        if (!message.text?.includes(mentionPattern)) return;
      }

      // Strip bot mention from text
      let body = message.text ?? "";
      if (ctx.botUserId) {
        body = body.replace(new RegExp(`<@${ctx.botUserId}>`, "g"), "").trim();
      }

      if (!body && !("files" in message)) return;

      const inbound: InboundMessage = {
        channelId,
        peerId,
        peerName: userId,
        messageId: `${peerId}:${message.ts}`,
        body,
        isGroup,
        threadId: threadTs ? `${peerId}:${threadTs}` : undefined,
        timestamp: parseFloat(message.ts) * 1000,
      };

      // File attachments
      if ("files" in message && Array.isArray(message.files) && message.files.length > 0) {
        inbound.mediaUrls = [];
        for (const file of message.files as any[]) {
          if (file.url_private) {
            inbound.mediaUrls.push(file.url_private);
          }
          if (!inbound.mediaType && file.mimetype) {
            if (file.mimetype.startsWith("image/")) inbound.mediaType = "image";
            else if (file.mimetype.startsWith("audio/")) inbound.mediaType = "audio";
            else if (file.mimetype.startsWith("video/")) inbound.mediaType = "video";
            else inbound.mediaType = "document";
          }
        }
      }

      const channel = getChannelInstance();

      // Override sendText to reply in-thread if configured
      const originalSendText = channel.adapter.sendText;
      if (threadReplies && (threadTs || !isGroup)) {
        const replyThreadTs = threadTs ?? message.ts;
        channel.adapter.sendText = async (pid: string, text: string) => {
          if (text.length <= 4000) {
            await webClient.chat.postMessage({
              channel: pid,
              text,
              thread_ts: replyThreadTs,
            });
          } else {
            for (let i = 0; i < text.length; i += 4000) {
              await webClient.chat.postMessage({
                channel: pid,
                text: text.slice(i, i + 4000),
                thread_ts: replyThreadTs,
              });
            }
          }
        };
      }

      await dispatch({
        source: "channel",
        body: inbound.body,
        config,
        channelId: inbound.channelId,
        peerId: inbound.peerId,
        peerName: inbound.peerName,
        messageId: inbound.messageId,
        mediaUrls: inbound.mediaUrls,
        isGroup: inbound.isGroup,
        threadId: inbound.threadId,
        channel,
      });

      // Restore original sendText
      if (originalSendText) {
        channel.adapter.sendText = originalSendText;
      }
    } catch (err) {
      log.error(`Slack message handler error: ${err}`);
    }
  });

  const capabilities: ChannelCapabilities = {
    text: true,
    image: true,
    audio: false,
    video: false,
    document: true,
    sticker: false,
    reaction: true,
    typing: false,
    readReceipt: false,
    editMessage: true,
    deleteMessage: true,
    groups: true,
    threads: true,
    maxTextLength: 4000,
  };

  const adapter = createSlackAdapter(ctx);

  let _instance: ChannelInstance;
  function getChannelInstance(): ChannelInstance { return _instance; }

  _instance = {
    id: channelId,
    name: "Slack",
    adapter,
    capabilities,
  };

  return _instance;
}
