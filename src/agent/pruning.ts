// Tool Result Truncation — prevents oversized tool results from permanently overflowing context

import { log } from "../util/logger.js";

const DEFAULT_CONTEXT_WINDOW = 200_000; // chars (conservative)
const TRUNCATION_THRESHOLD = 0.3; // 30% of context window

interface MessageLike {
  role: string;
  content?: string | Array<{ type: string; text?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

function getContentLength(content: MessageLike["content"]): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
  }
  return 0;
}

function truncateContent(content: string, maxLen: number): string {
  return content.slice(0, maxLen) + `\n\n⚠️ [Content truncated from ${content.length} to ${maxLen} chars]`;
}

export function truncateOversizedToolResults(
  messages: MessageLike[],
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): { messages: MessageLike[]; truncated: number } {
  const maxResultLen = Math.floor(contextWindow * TRUNCATION_THRESHOLD);
  let truncated = 0;

  const result = messages.map((msg) => {
    if (msg.role !== "tool") return msg;

    const len = getContentLength(msg.content);
    if (len <= maxResultLen) return msg;

    truncated++;
    log.warn(`Truncating oversized tool result: ${len} → ${maxResultLen} chars`);

    if (typeof msg.content === "string") {
      return { ...msg, content: truncateContent(msg.content, maxResultLen) };
    }

    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === "text" && block.text && block.text.length > maxResultLen) {
            return { ...block, text: truncateContent(block.text, maxResultLen) };
          }
          return block;
        }),
      };
    }

    return msg;
  });

  return { messages: result, truncated };
}

// Estimate total context size from messages
export function estimateContextSize(messages: MessageLike[]): number {
  return messages.reduce((sum, msg) => sum + getContentLength(msg.content) + 20, 0);
}
