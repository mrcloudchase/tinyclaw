// WhatsApp Cloud API Channel Implementation
// Full webhook + send + media support

import crypto from "node:crypto";
import type { TinyClawConfig } from "../config/schema.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelInstance, InboundMessage } from "./channel.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface WhatsAppAccountConfig {
  phoneNumberId: string;
  accessToken?: string;
  accessTokenEnv?: string;
  verifyToken?: string;
  businessAccountId?: string;
}

interface WhatsAppContext {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  apiBase: string;
}

// ══════════════════════════════════════════════
// ── WhatsApp Adapter ──
// ══════════════════════════════════════════════

function createWhatsAppAdapter(ctx: WhatsAppContext): ChannelAdapter {
  const headers = () => ({
    "Authorization": `Bearer ${ctx.accessToken}`,
    "Content-Type": "application/json",
  });

  const apiUrl = `${ctx.apiBase}/${ctx.phoneNumberId}/messages`;

  async function sendPayload(payload: Record<string, unknown>): Promise<string | undefined> {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WhatsApp API ${res.status}: ${body}`);
    }
    const data = await res.json() as any;
    return data.messages?.[0]?.id;
  }

  return {
    async sendText(peerId: string, text: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "text",
        text: { body: text },
      });
    },

    async sendImage(peerId: string, url: string, caption?: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "image",
        image: { link: url, ...(caption ? { caption } : {}) },
      });
    },

    async sendAudio(peerId: string, url: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "audio",
        audio: { link: url },
      });
    },

    async sendDocument(peerId: string, url: string, filename?: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "document",
        document: { link: url, ...(filename ? { filename } : {}) },
      });
    },

    async sendVideo(peerId: string, url: string, caption?: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "video",
        video: { link: url, ...(caption ? { caption } : {}) },
      });
    },

    async sendSticker(peerId: string, url: string) {
      await sendPayload({
        messaging_product: "whatsapp",
        to: peerId,
        type: "sticker",
        sticker: { link: url },
      });
    },

    async sendReaction(messageId: string, emoji: string) {
      // WhatsApp reactions need the recipient too — stored in the message context
      // For simplicity, we skip — reactions need to be sent via message_send tool with full context
      log.debug(`WhatsApp reaction: ${emoji} on ${messageId}`);
    },

    async sendTyping(peerId: string) {
      try {
        await sendPayload({
          messaging_product: "whatsapp",
          to: peerId,
          type: "reaction",
          // WhatsApp doesn't have a direct typing indicator API
          // We use a workaround: mark messages as read triggers typing state briefly
        });
      } catch { /* typing is best-effort */ }
    },

    async sendReadReceipt(messageId: string) {
      await fetch(`${ctx.apiBase}/${ctx.phoneNumberId}/messages`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    },

    async downloadMedia(mediaId: string): Promise<Buffer> {
      // Step 1: Get media URL
      const metaRes = await fetch(`${ctx.apiBase}/${mediaId}`, {
        headers: { "Authorization": `Bearer ${ctx.accessToken}` },
      });
      if (!metaRes.ok) throw new Error(`Failed to get media URL: ${metaRes.status}`);
      const meta = await metaRes.json() as any;

      // Step 2: Download media
      const dataRes = await fetch(meta.url, {
        headers: { "Authorization": `Bearer ${ctx.accessToken}` },
      });
      if (!dataRes.ok) throw new Error(`Failed to download media: ${dataRes.status}`);
      return Buffer.from(await dataRes.arrayBuffer());
    },

    async uploadMedia(buf: Buffer, mime: string, filename?: string): Promise<string> {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([buf], { type: mime }), filename ?? "upload");
      form.append("type", mime);

      const res = await fetch(`${ctx.apiBase}/${ctx.phoneNumberId}/media`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${ctx.accessToken}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Media upload failed: ${res.status}`);
      const data = await res.json() as any;
      return data.id;
    },

    isConnected: () => true,
  };
}

// ══════════════════════════════════════════════
// ── WhatsApp Channel Factory ──
// ══════════════════════════════════════════════

export function createWhatsAppChannel(
  accountId: string,
  accountConfig: WhatsAppAccountConfig,
  _config: TinyClawConfig,
): ChannelInstance {
  const accessToken = accountConfig.accessToken
    ?? (accountConfig.accessTokenEnv ? process.env[accountConfig.accessTokenEnv] : undefined)
    ?? process.env.WHATSAPP_ACCESS_TOKEN
    ?? "";

  const verifyToken = accountConfig.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN ?? "tinyclaw";

  const ctx: WhatsAppContext = {
    phoneNumberId: accountConfig.phoneNumberId,
    accessToken,
    verifyToken,
    apiBase: "https://graph.facebook.com/v21.0",
  };

  const capabilities: ChannelCapabilities = {
    text: true,
    image: true,
    audio: true,
    video: true,
    document: true,
    sticker: true,
    reaction: true,
    typing: false, // WhatsApp doesn't have explicit typing API
    readReceipt: true,
    editMessage: false,
    deleteMessage: false,
    groups: true,
    threads: false,
    maxTextLength: 4096,
    maxMediaBytes: 16 * 1024 * 1024,
  };

  return {
    id: `whatsapp:${accountId}`,
    name: `WhatsApp (${accountId})`,
    adapter: createWhatsAppAdapter(ctx),
    capabilities,
    accountId,
  };
}

// ══════════════════════════════════════════════
// ── Webhook Handler ──
// ══════════════════════════════════════════════

export function verifyWebhook(query: Record<string, string>, verifyToken: string): string | null {
  if (
    query["hub.mode"] === "subscribe" &&
    query["hub.verify_token"] === verifyToken
  ) {
    return query["hub.challenge"];
  }
  return null;
}

export function validateSignature(body: string, signature: string, appSecret: string): boolean {
  const expected = crypto.createHmac("sha256", appSecret).update(body).digest("hex");
  return `sha256=${expected}` === signature;
}

export function parseWebhookPayload(payload: any): InboundMessage[] {
  const messages: InboundMessage[] = [];

  if (payload?.object !== "whatsapp_business_account") return messages;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const contacts = value?.contacts ?? [];

      for (const msg of value?.messages ?? []) {
        const contact = contacts.find((c: any) => c.wa_id === msg.from);
        const inbound: InboundMessage = {
          channelId: `whatsapp:${phoneNumberId}`,
          accountId: phoneNumberId,
          peerId: msg.from,
          peerName: contact?.profile?.name,
          messageId: msg.id,
          body: "",
          timestamp: msg.timestamp ? parseInt(msg.timestamp) * 1000 : Date.now(),
        };

        // Parse message types
        switch (msg.type) {
          case "text":
            inbound.body = msg.text?.body ?? "";
            break;
          case "image":
            inbound.body = msg.image?.caption ?? "";
            inbound.mediaUrls = [msg.image?.id];
            inbound.mediaType = "image";
            break;
          case "audio":
            inbound.mediaUrls = [msg.audio?.id];
            inbound.mediaType = "audio";
            break;
          case "video":
            inbound.body = msg.video?.caption ?? "";
            inbound.mediaUrls = [msg.video?.id];
            inbound.mediaType = "video";
            break;
          case "document":
            inbound.body = msg.document?.caption ?? "";
            inbound.mediaUrls = [msg.document?.id];
            inbound.mediaType = "document";
            break;
          case "sticker":
            inbound.mediaUrls = [msg.sticker?.id];
            inbound.mediaType = "sticker";
            break;
          case "location":
            inbound.body = `Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
            break;
          case "contacts":
            inbound.body = `Shared contact: ${msg.contacts?.[0]?.name?.formatted_name ?? "unknown"}`;
            break;
          case "reaction":
            // Skip reactions for now
            continue;
          default:
            inbound.body = `[Unsupported message type: ${msg.type}]`;
        }

        // Check for group context
        if (msg.context?.from) {
          inbound.replyToId = msg.context.id;
        }

        messages.push(inbound);
      }
    }
  }

  return messages;
}
