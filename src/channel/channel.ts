// Channel System — Types + capabilities + registry + lifecycle
// All in ONE file

import type { TinyClawConfig } from "../config/schema.js";
import { log } from "../utils/logger.js";
import { runHooks } from "../hooks/hooks.js";

// ══════════════════════════════════════════════
// ── Channel Adapter Interface (23 adapter slots) ──
// ══════════════════════════════════════════════

export interface ChannelAdapter {
  // Core messaging
  sendText?(peerId: string, text: string, accountId?: string): Promise<void>;
  sendImage?(peerId: string, url: string, caption?: string): Promise<void>;
  sendAudio?(peerId: string, url: string): Promise<void>;
  sendDocument?(peerId: string, url: string, filename?: string): Promise<void>;
  sendVideo?(peerId: string, url: string, caption?: string): Promise<void>;
  sendSticker?(peerId: string, url: string): Promise<void>;

  // Interactions
  sendReaction?(messageId: string, emoji: string): Promise<void>;
  sendTyping?(peerId: string): Promise<void>;
  sendReadReceipt?(messageId: string): Promise<void>;
  editMessage?(messageId: string, text: string): Promise<void>;
  deleteMessage?(messageId: string): Promise<void>;

  // Media
  downloadMedia?(mediaId: string): Promise<Buffer>;
  uploadMedia?(buf: Buffer, mime: string, filename?: string): Promise<string>;

  // Groups
  createGroup?(name: string, participants: string[]): Promise<string>;
  addParticipant?(groupId: string, userId: string): Promise<void>;
  removeParticipant?(groupId: string, userId: string): Promise<void>;
  setGroupName?(groupId: string, name: string): Promise<void>;
  leaveGroup?(groupId: string): Promise<void>;

  // Threads
  replyToThread?(threadId: string, text: string): Promise<void>;
  createThread?(channelId: string, name: string): Promise<string>;

  // Lifecycle
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  isConnected?(): boolean;
}

// ══════════════════════════════════════════════
// ── Channel Capabilities ──
// ══════════════════════════════════════════════

export interface ChannelCapabilities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  document: boolean;
  sticker: boolean;
  reaction: boolean;
  typing: boolean;
  readReceipt: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  groups: boolean;
  threads: boolean;
  maxTextLength?: number;
  maxMediaBytes?: number;
}

export function defaultCapabilities(): ChannelCapabilities {
  return {
    text: true, image: false, audio: false, video: false, document: false, sticker: false,
    reaction: false, typing: false, readReceipt: false, editMessage: false, deleteMessage: false,
    groups: false, threads: false,
  };
}

// ══════════════════════════════════════════════
// ── Channel Instance ──
// ══════════════════════════════════════════════

export interface ChannelInstance {
  id: string;
  name: string;
  adapter: ChannelAdapter;
  capabilities: ChannelCapabilities;
  accountId?: string;
  config?: Record<string, unknown>;
}

// ══════════════════════════════════════════════
// ── Inbound Message (from channel webhook/event) ──
// ══════════════════════════════════════════════

export interface InboundMessage {
  channelId: string;
  accountId?: string;
  peerId: string;
  peerName?: string;
  messageId?: string;
  body: string;
  mediaUrls?: string[];
  mediaType?: string;
  isGroup?: boolean;
  threadId?: string;
  replyToId?: string;
  timestamp?: number;
  raw?: unknown;
}

// ══════════════════════════════════════════════
// ── Channel Registry ──
// ══════════════════════════════════════════════

export interface ChannelRegistry {
  get(channelId: string): ChannelInstance | undefined;
  list(): ChannelInstance[];
  register(channel: ChannelInstance): void;
  unregister(channelId: string): void;
}

let _registry: ChannelRegistry | undefined;

export function createChannelRegistry(_config: TinyClawConfig): ChannelRegistry {
  const channels = new Map<string, ChannelInstance>();
  _registry = {
    get: (id) => channels.get(id),
    list: () => [...channels.values()],
    register: (ch) => {
      channels.set(ch.id, ch);
      log.info(`Channel registered: ${ch.id} (${ch.name})`);
      runHooks("channel_connect", { channelId: ch.id, name: ch.name }).catch(() => {});
    },
    unregister: (id) => {
      channels.delete(id);
      log.info(`Channel unregistered: ${id}`);
      runHooks("channel_disconnect", { channelId: id }).catch(() => {});
    },
  };
  return _registry;
}

export function getChannelRegistry(): ChannelRegistry {
  if (!_registry) throw new Error("Channel registry not initialized");
  return _registry;
}

// ══════════════════════════════════════════════
// ── Channel Lifecycle Manager ──
// ══════════════════════════════════════════════

export async function initChannels(config: TinyClawConfig, registry: ChannelRegistry): Promise<void> {
  // WhatsApp
  if (config.channels?.whatsapp?.enabled) {
    try {
      const { createWhatsAppChannel } = await import("./whatsapp.js");
      const accounts = config.channels.whatsapp.accounts ?? {};
      for (const [accountId, accountConfig] of Object.entries(accounts)) {
        const ch = createWhatsAppChannel(accountId, accountConfig, config);
        registry.register(ch);
      }
    } catch (err) {
      log.warn(`Failed to init WhatsApp: ${err}`);
    }
  }

  // Telegram
  if (config.channels?.telegram?.enabled) {
    try {
      const { createTelegramChannel } = await import("./telegram.js");
      const telegramConfig = config.channels.telegram;
      const botToken = telegramConfig.botToken
        ?? (telegramConfig.botTokenEnv ? process.env[telegramConfig.botTokenEnv] : undefined)
        ?? process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const ch = createTelegramChannel(botToken, telegramConfig, config);
        registry.register(ch);
        if (ch.adapter.connect) await ch.adapter.connect();
      } else {
        log.warn("Telegram enabled but no bot token found");
      }
    } catch (err) {
      log.warn(`Failed to init Telegram: ${err}`);
    }
  }

  // Discord
  if (config.channels?.discord?.enabled) {
    try {
      const { createDiscordChannel } = await import("./discord.js");
      const discordConfig = config.channels.discord;
      const botToken = discordConfig.botToken
        ?? (discordConfig.botTokenEnv ? process.env[discordConfig.botTokenEnv] : undefined)
        ?? process.env.DISCORD_BOT_TOKEN;
      if (botToken) {
        const ch = createDiscordChannel(botToken, discordConfig, config);
        registry.register(ch);
        if (ch.adapter.connect) await ch.adapter.connect();
      } else {
        log.warn("Discord enabled but no bot token found");
      }
    } catch (err) {
      log.warn(`Failed to init Discord: ${err}`);
    }
  }

  // Slack
  if (config.channels?.slack?.enabled) {
    try {
      const { createSlackChannel } = await import("./slack.js");
      const slackConfig = config.channels.slack;
      const botToken = slackConfig.botToken
        ?? (slackConfig.botTokenEnv ? process.env[slackConfig.botTokenEnv] : undefined)
        ?? process.env.SLACK_BOT_TOKEN;
      const appToken = slackConfig.appToken
        ?? (slackConfig.appTokenEnv ? process.env[slackConfig.appTokenEnv] : undefined)
        ?? process.env.SLACK_APP_TOKEN;
      if (botToken && appToken) {
        const ch = createSlackChannel(botToken, appToken, slackConfig, config);
        registry.register(ch);
        if (ch.adapter.connect) await ch.adapter.connect();
      } else {
        log.warn("Slack enabled but bot token or app token not found");
      }
    } catch (err) {
      log.warn(`Failed to init Slack: ${err}`);
    }
  }

  // Other channels can be initialized similarly via plugins
  log.info(`Initialized ${registry.list().length} channels`);
}

export async function shutdownChannels(registry: ChannelRegistry): Promise<void> {
  for (const ch of registry.list()) {
    try {
      if (ch.adapter.disconnect) await ch.adapter.disconnect();
    } catch (err) {
      log.warn(`Error disconnecting channel ${ch.id}: ${err}`);
    }
  }
}
