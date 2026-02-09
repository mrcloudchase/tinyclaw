// Telegram Channel Implementation via grammY
// Long-polling (default) or webhook mode

import { Bot, type Context as GrammyContext } from "grammy";
import type { TinyClawConfig } from "../config/schema.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelInstance, InboundMessage } from "../channel.js";
import { dispatch } from "../pipeline.js";
import { log } from "../util/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface TelegramChannelConfig {
  botToken?: string;
  botTokenEnv?: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  webhookPath?: string;
  webhookSecret?: string;
}

interface TelegramContext {
  bot: Bot;
  botToken: string;
  config: TinyClawConfig;
  channelConfig: TelegramChannelConfig;
}

// ══════════════════════════════════════════════
// ── Telegram Adapter ──
// ══════════════════════════════════════════════

function createTelegramAdapter(ctx: TelegramContext): ChannelAdapter {
  const { bot } = ctx;
  let connected = false;

  return {
    async sendText(peerId: string, text: string) {
      // Telegram max message length is 4096; chunk if needed
      const chatId = peerId;
      if (text.length <= 4096) {
        await bot.api.sendMessage(chatId, text);
      } else {
        // Send in chunks
        for (let i = 0; i < text.length; i += 4096) {
          await bot.api.sendMessage(chatId, text.slice(i, i + 4096));
        }
      }
    },

    async sendImage(peerId: string, url: string, caption?: string) {
      await bot.api.sendPhoto(peerId, url, caption ? { caption } : undefined);
    },

    async sendAudio(peerId: string, url: string) {
      await bot.api.sendAudio(peerId, url);
    },

    async sendDocument(peerId: string, url: string, filename?: string) {
      await bot.api.sendDocument(peerId, url, filename ? { caption: filename } : undefined);
    },

    async sendVideo(peerId: string, url: string, caption?: string) {
      await bot.api.sendVideo(peerId, url, caption ? { caption } : undefined);
    },

    async sendSticker(peerId: string, url: string) {
      await bot.api.sendSticker(peerId, url);
    },

    async sendReaction(messageId: string, emoji: string) {
      // Telegram reactions require chat_id — we store this in a best-effort way
      // For now, log only (reactions need full context from the inbound message)
      log.debug(`Telegram reaction: ${emoji} on ${messageId}`);
    },

    async sendTyping(peerId: string) {
      try {
        await bot.api.sendChatAction(peerId, "typing");
      } catch { /* typing is best-effort */ }
    },

    async editMessage(messageId: string, text: string) {
      // messageId format for edits: "chatId:messageId"
      const [chatId, msgId] = messageId.split(":");
      if (chatId && msgId) {
        await bot.api.editMessageText(chatId, parseInt(msgId, 10), text);
      }
    },

    async deleteMessage(messageId: string) {
      const [chatId, msgId] = messageId.split(":");
      if (chatId && msgId) {
        await bot.api.deleteMessage(chatId, parseInt(msgId, 10));
      }
    },

    async replyToThread(threadId: string, text: string) {
      // threadId format: "chatId:message_thread_id"
      const [chatId, threadMsgId] = threadId.split(":");
      if (chatId && threadMsgId) {
        await bot.api.sendMessage(chatId, text, {
          message_thread_id: parseInt(threadMsgId, 10),
        });
      }
    },

    async connect() {
      if (connected) return;
      const mode = ctx.channelConfig.mode ?? "polling";

      if (mode === "polling") {
        bot.start({
          onStart: () => {
            connected = true;
            log.info("Telegram bot started (long-polling)");
          },
        });
      } else {
        // Webhook mode: bot.init() fetches bot info but doesn't start polling
        await bot.init();
        connected = true;
        log.info("Telegram bot initialized (webhook mode)");
      }
    },

    async disconnect() {
      if (!connected) return;
      try {
        await bot.stop();
      } catch { /* ignore */ }
      connected = false;
      log.info("Telegram bot stopped");
    },

    isConnected() {
      return connected;
    },
  };
}

// ══════════════════════════════════════════════
// ── Normalize Inbound Messages ──
// ══════════════════════════════════════════════

function normalizeMessage(msg: GrammyContext, channelId: string): InboundMessage | null {
  const m = msg.message ?? msg.editedMessage;
  if (!m) return null;

  const peerId = String(m.chat.id);
  const isGroup = m.chat.type === "group" || m.chat.type === "supergroup";
  const threadId = m.message_thread_id ? String(m.message_thread_id) : undefined;
  const peerName = m.from?.first_name
    ? `${m.from.first_name}${m.from.last_name ? ` ${m.from.last_name}` : ""}`
    : m.from?.username;

  const inbound: InboundMessage = {
    channelId,
    peerId,
    peerName,
    messageId: String(m.message_id),
    body: "",
    isGroup,
    threadId,
    replyToId: m.reply_to_message ? String(m.reply_to_message.message_id) : undefined,
    timestamp: m.date * 1000,
  };

  // Text
  if (m.text) {
    inbound.body = m.text;
  } else if (m.caption) {
    inbound.body = m.caption;
  }

  // Media
  if (m.photo?.length) {
    // Take the largest photo
    const largest = m.photo[m.photo.length - 1];
    inbound.mediaUrls = [largest.file_id];
    inbound.mediaType = "image";
  } else if (m.audio) {
    inbound.mediaUrls = [m.audio.file_id];
    inbound.mediaType = "audio";
  } else if (m.video) {
    inbound.mediaUrls = [m.video.file_id];
    inbound.mediaType = "video";
  } else if (m.document) {
    inbound.mediaUrls = [m.document.file_id];
    inbound.mediaType = "document";
  } else if (m.sticker) {
    inbound.mediaUrls = [m.sticker.file_id];
    inbound.mediaType = "sticker";
  } else if (m.voice) {
    inbound.mediaUrls = [m.voice.file_id];
    inbound.mediaType = "audio";
  } else if (m.video_note) {
    inbound.mediaUrls = [m.video_note.file_id];
    inbound.mediaType = "video";
  }

  // Skip messages with no text and no media
  if (!inbound.body && !inbound.mediaUrls?.length) return null;

  return inbound;
}

// ══════════════════════════════════════════════
// ── Telegram Channel Factory ──
// ══════════════════════════════════════════════

export function createTelegramChannel(
  botToken: string,
  channelConfig: TelegramChannelConfig,
  config: TinyClawConfig,
): ChannelInstance {
  const bot = new Bot(botToken);
  const channelId = "telegram:default";

  const ctx: TelegramContext = { bot, botToken, config, channelConfig };

  // Set up message handler
  bot.on("message", async (grammyCtx) => {
    try {
      const msg = normalizeMessage(grammyCtx, channelId);
      if (!msg) return;

      // Skip bot's own messages
      if (grammyCtx.message?.from?.is_bot) return;

      const channel = getChannelInstance();
      await dispatch({
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
        threadId: msg.threadId,
        channel,
      });
    } catch (err) {
      log.error(`Telegram message handler error: ${err}`);
    }
  });

  // Also handle edited messages
  bot.on("edited_message", async (grammyCtx) => {
    try {
      const msg = normalizeMessage(grammyCtx, channelId);
      if (!msg) return;
      if (grammyCtx.editedMessage?.from?.is_bot) return;

      const channel = getChannelInstance();
      await dispatch({
        source: "channel",
        body: msg.body,
        config,
        channelId: msg.channelId,
        peerId: msg.peerId,
        peerName: msg.peerName,
        messageId: msg.messageId,
        mediaUrls: msg.mediaUrls,
        isGroup: msg.isGroup,
        threadId: msg.threadId,
        channel,
      });
    } catch (err) {
      log.error(`Telegram edited_message handler error: ${err}`);
    }
  });

  const capabilities: ChannelCapabilities = {
    text: true,
    image: true,
    audio: true,
    video: true,
    document: true,
    sticker: true,
    reaction: false, // Telegram reactions need chatId context — partial support
    typing: true,
    readReceipt: false,
    editMessage: true,
    deleteMessage: true,
    groups: true,
    threads: true, // Forum topics
    maxTextLength: 4096,
    maxMediaBytes: 50 * 1024 * 1024,
  };

  const adapter = createTelegramAdapter(ctx);

  let _instance: ChannelInstance;
  function getChannelInstance(): ChannelInstance { return _instance; }

  _instance = {
    id: channelId,
    name: "Telegram",
    adapter,
    capabilities,
  };

  return _instance;
}

// ══════════════════════════════════════════════
// ── Webhook Handler (for gateway integration) ──
// ══════════════════════════════════════════════

export function createTelegramWebhookHandler(bot: Bot) {
  return async (body: unknown): Promise<void> => {
    await bot.handleUpdate(body as any);
  };
}

// Get the bot instance from a channel instance (for webhook integration)
export function getTelegramBot(channel: ChannelInstance): Bot | undefined {
  // The bot is captured in the adapter closure — we expose it via a convention
  return (channel as any)._bot;
}
