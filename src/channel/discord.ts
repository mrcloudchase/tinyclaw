// Discord Channel Implementation via discord.js
// Gateway intents: Guilds, GuildMessages, MessageContent, DirectMessages

import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message as DiscordMessage,
} from "discord.js";
import type { TinyClawConfig } from "../config/schema.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelInstance, InboundMessage } from "../channel.js";
import { dispatch } from "../pipeline.js";
import { log } from "../util/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface DiscordChannelConfig {
  botToken?: string;
  botTokenEnv?: string;
  mentionOnly?: boolean;
  dmEnabled?: boolean;
}

interface DiscordContext {
  client: Client;
  botToken: string;
  config: TinyClawConfig;
  channelConfig: DiscordChannelConfig;
  botUserId?: string;
}

// ══════════════════════════════════════════════
// ── Discord Adapter ──
// ══════════════════════════════════════════════

function createDiscordAdapter(ctx: DiscordContext): ChannelAdapter {
  const { client } = ctx;
  let connected = false;

  return {
    async sendText(peerId: string, text: string) {
      const channel = await client.channels.fetch(peerId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      // Discord max is 2000 chars
      if (text.length <= 2000) {
        await channel.send(text);
      } else {
        for (let i = 0; i < text.length; i += 2000) {
          await channel.send(text.slice(i, i + 2000));
        }
      }
    },

    async sendImage(peerId: string, url: string, caption?: string) {
      const channel = await client.channels.fetch(peerId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      await channel.send({ content: caption ?? undefined, files: [url] });
    },

    async sendDocument(peerId: string, url: string, filename?: string) {
      const channel = await client.channels.fetch(peerId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      await channel.send({ files: [{ attachment: url, name: filename }] });
    },

    async sendVideo(peerId: string, url: string, caption?: string) {
      const channel = await client.channels.fetch(peerId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      await channel.send({ content: caption ?? undefined, files: [url] });
    },

    async sendReaction(messageId: string, emoji: string) {
      // messageId format: "channelId:messageId"
      const [channelId, msgId] = messageId.split(":");
      if (!channelId || !msgId) return;
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased() || !("messages" in channel)) return;
        const msg = await channel.messages.fetch(msgId);
        await msg.react(emoji);
      } catch (err) {
        log.debug(`Discord reaction failed: ${err}`);
      }
    },

    async sendTyping(peerId: string) {
      try {
        const channel = await client.channels.fetch(peerId);
        if (channel?.isTextBased() && "sendTyping" in channel) {
          await channel.sendTyping();
        }
      } catch { /* typing is best-effort */ }
    },

    async editMessage(messageId: string, text: string) {
      const [channelId, msgId] = messageId.split(":");
      if (!channelId || !msgId) return;
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased() || !("messages" in channel)) return;
        const msg = await channel.messages.fetch(msgId);
        await msg.edit(text);
      } catch (err) {
        log.debug(`Discord edit failed: ${err}`);
      }
    },

    async deleteMessage(messageId: string) {
      const [channelId, msgId] = messageId.split(":");
      if (!channelId || !msgId) return;
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased() || !("messages" in channel)) return;
        const msg = await channel.messages.fetch(msgId);
        await msg.delete();
      } catch (err) {
        log.debug(`Discord delete failed: ${err}`);
      }
    },

    async replyToThread(threadId: string, text: string) {
      const channel = await client.channels.fetch(threadId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      await channel.send(text);
    },

    async connect() {
      if (connected) return;
      await client.login(ctx.botToken);
      connected = true;
    },

    async disconnect() {
      if (!connected) return;
      try {
        await client.destroy();
      } catch { /* ignore */ }
      connected = false;
      log.info("Discord bot disconnected");
    },

    isConnected() {
      return connected;
    },
  };
}

// ══════════════════════════════════════════════
// ── Normalize Inbound Messages ──
// ══════════════════════════════════════════════

function normalizeMessage(msg: DiscordMessage, channelId: string, botUserId?: string): InboundMessage | null {
  // Skip bot messages
  if (msg.author.bot) return null;

  const isDM = !msg.guild;
  const isThread = msg.channel.isThread();
  const peerId = msg.channel.id;
  const peerName = msg.author.displayName ?? msg.author.username;

  // Strip bot mention from text
  let body = msg.content;
  if (botUserId) {
    body = body.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
  }

  const inbound: InboundMessage = {
    channelId,
    peerId,
    peerName,
    messageId: `${msg.channel.id}:${msg.id}`,
    body,
    isGroup: !isDM,
    threadId: isThread ? msg.channel.id : undefined,
    replyToId: msg.reference?.messageId ? `${msg.channel.id}:${msg.reference.messageId}` : undefined,
    timestamp: msg.createdTimestamp,
  };

  // Attachments
  if (msg.attachments.size > 0) {
    inbound.mediaUrls = [];
    for (const [, attachment] of msg.attachments) {
      inbound.mediaUrls.push(attachment.url);
      if (!inbound.mediaType) {
        if (attachment.contentType?.startsWith("image/")) inbound.mediaType = "image";
        else if (attachment.contentType?.startsWith("audio/")) inbound.mediaType = "audio";
        else if (attachment.contentType?.startsWith("video/")) inbound.mediaType = "video";
        else inbound.mediaType = "document";
      }
    }
  }

  // Skip empty messages with no attachments
  if (!inbound.body && !inbound.mediaUrls?.length) return null;

  return inbound;
}

// ══════════════════════════════════════════════
// ── Discord Channel Factory ──
// ══════════════════════════════════════════════

export function createDiscordChannel(
  botToken: string,
  channelConfig: DiscordChannelConfig,
  config: TinyClawConfig,
): ChannelInstance {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  const channelId = "discord:default";
  const mentionOnly = channelConfig.mentionOnly ?? true;
  const dmEnabled = channelConfig.dmEnabled ?? true;

  const ctx: DiscordContext = { client, botToken, config, channelConfig };

  // Ready event — capture bot user ID
  client.on("ready", () => {
    ctx.botUserId = client.user?.id;
    log.info(`Discord bot ready as ${client.user?.tag} (${ctx.botUserId})`);
  });

  // Message handler
  client.on("messageCreate", async (msg) => {
    try {
      // Skip bot messages
      if (msg.author.bot) return;

      const isDM = !msg.guild;

      // DM gating
      if (isDM && !dmEnabled) return;

      // Mention gating for guilds
      if (!isDM && mentionOnly) {
        const mentioned = ctx.botUserId && msg.mentions.users.has(ctx.botUserId);
        if (!mentioned) return;
      }

      const normalized = normalizeMessage(msg, channelId, ctx.botUserId);
      if (!normalized) return;

      const channel = getChannelInstance();
      await dispatch({
        source: "channel",
        body: normalized.body,
        config,
        channelId: normalized.channelId,
        peerId: normalized.peerId,
        peerName: normalized.peerName,
        messageId: normalized.messageId,
        mediaUrls: normalized.mediaUrls,
        isGroup: normalized.isGroup,
        threadId: normalized.threadId,
        channel,
      });
    } catch (err) {
      log.error(`Discord message handler error: ${err}`);
    }
  });

  const capabilities: ChannelCapabilities = {
    text: true,
    image: true,
    audio: false,
    video: true,
    document: true,
    sticker: false,
    reaction: true,
    typing: true,
    readReceipt: false,
    editMessage: true,
    deleteMessage: true,
    groups: true,
    threads: true,
    maxTextLength: 2000,
    maxMediaBytes: 25 * 1024 * 1024,
  };

  const adapter = createDiscordAdapter(ctx);

  let _instance: ChannelInstance;
  function getChannelInstance(): ChannelInstance { return _instance; }

  _instance = {
    id: channelId,
    name: "Discord",
    adapter,
    capabilities,
  };

  return _instance;
}
