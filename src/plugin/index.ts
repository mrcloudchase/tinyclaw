// Bundled Plugins Manifest — 33 plugins (18 channel + 15 non-channel)
import type { PluginInitFn } from "./plugin.js";

// Channel plugins
import telegram from "./channels/telegram.js";
import discord from "./channels/discord.js";
import slack from "./channels/slack.js";
import signal from "./channels/signal.js";
import imessage from "./channels/imessage.js";
import instagram from "./channels/instagram.js";
import messenger from "./channels/messenger.js";
import twitter from "./channels/twitter.js";
import matrix from "./channels/matrix.js";
import teams from "./channels/teams.js";
import line from "./channels/line.js";
import wechat from "./channels/wechat.js";
import viber from "./channels/viber.js";
import rocketChat from "./channels/rocket-chat.js";
import zulip from "./channels/zulip.js";
import webex from "./channels/webex.js";
import googleChat from "./channels/google-chat.js";
import mattermost from "./channels/mattermost.js";

// Non-channel plugins
import memoryCore from "./non-channel/memory-core.js";
import memoryLancedb from "./non-channel/memory-lancedb.js";
import copilotProxy from "./non-channel/copilot-proxy.js";
import ttsManager from "./non-channel/tts-manager.js";
import canvasRenderer from "./non-channel/canvas-renderer.js";
import cronScheduler from "./non-channel/cron-scheduler.js";
import mediaProcessor from "./non-channel/media-processor.js";
import browserManager from "./non-channel/browser-manager.js";
import analytics from "./non-channel/analytics.js";
import rateLimiter from "./non-channel/rate-limiter.js";
import auditLogger from "./non-channel/audit-logger.js";
import webhookRelay from "./non-channel/webhook-relay.js";
import vectorSearch from "./non-channel/vector-search.js";
import notificationHub from "./non-channel/notification-hub.js";
import backupManager from "./non-channel/backup-manager.js";

export function getBundledPlugins(): PluginInitFn[] {
  return [
    // Channels
    telegram, discord, slack, signal, imessage, instagram, messenger, twitter,
    matrix, teams, line, wechat, viber, rocketChat, zulip, webex, googleChat, mattermost,
    // Non-channel
    memoryCore, memoryLancedb, copilotProxy, ttsManager, canvasRenderer, cronScheduler,
    mediaProcessor, browserManager, analytics, rateLimiter, auditLogger, webhookRelay,
    vectorSearch, notificationHub, backupManager,
  ];
}
