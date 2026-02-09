import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { defineTools } from "./helper.js";

export function createMessageTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "message_send",
      description: "Send a message to a user via a messaging channel.",
      parameters: { type: "object", properties: { channel: { type: "string" }, to: { type: "string" }, text: { type: "string" }, accountId: { type: "string" } }, required: ["channel", "to", "text"] },
      async execute(args: { channel: string; to: string; text: string; accountId?: string }) {
        try {
          const { getChannelRegistry } = await import("../channel/channel.js");
          const reg = getChannelRegistry();
          const ch = reg.get(args.channel);
          if (!ch) return `Channel "${args.channel}" not found.`;
          if (ch.adapter.sendText) { await ch.adapter.sendText(args.to, args.text, args.accountId); return `Sent to ${args.to} via ${args.channel}`; }
          return "Channel does not support sending text.";
        } catch { return "Channel system not available."; }
      },
    },
    {
      name: "message_react",
      description: "React to a message with an emoji.",
      parameters: { type: "object", properties: { channel: { type: "string" }, messageId: { type: "string" }, emoji: { type: "string" } }, required: ["channel", "messageId", "emoji"] },
      async execute(args: { channel: string; messageId: string; emoji: string }) {
        try {
          const { getChannelRegistry } = await import("../channel/channel.js");
          const ch = getChannelRegistry().get(args.channel);
          if (!ch?.adapter.sendReaction) return "Reactions not supported.";
          await ch.adapter.sendReaction(args.messageId, args.emoji);
          return `Reacted with ${args.emoji}`;
        } catch { return "Channel system not available."; }
      },
    },
    {
      name: "message_typing",
      description: "Send typing indicator to a chat.",
      parameters: { type: "object", properties: { channel: { type: "string" }, to: { type: "string" } }, required: ["channel", "to"] },
      async execute(args: { channel: string; to: string }) {
        try {
          const { getChannelRegistry } = await import("../channel/channel.js");
          const ch = getChannelRegistry().get(args.channel);
          if (!ch?.adapter.sendTyping) return "Typing not supported.";
          await ch.adapter.sendTyping(args.to);
          return "Typing indicator sent.";
        } catch { return "Channel system not available."; }
      },
    },
  ]);
}
