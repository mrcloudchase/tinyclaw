// Block Streaming Coalescer — accumulates text chunks into properly-sized messages
// Respects per-channel text limits and never splits inside fenced code blocks

import { log } from "../utils/logger.js";

export interface CoalescerOptions {
  maxTextLength: number; // per-channel limit (WhatsApp 1600, Telegram 4096, Discord 2000)
  minChars?: number;     // minimum chars before flushing (default 800)
  maxChars?: number;     // maximum chars to accumulate (default from maxTextLength)
  idleMs?: number;       // idle timeout before flushing (default 1000)
  onFlush: (text: string) => void | Promise<void>;
}

// Per-channel text limits
export const CHANNEL_TEXT_LIMITS: Record<string, number> = {
  whatsapp: 1600,
  telegram: 4096,
  discord: 2000,
  slack: 4000,
};

export function createCoalescer(opts: CoalescerOptions) {
  const maxLen = opts.maxTextLength;
  const minChars = opts.minChars ?? 800;
  const idleMs = opts.idleMs ?? 1000;

  let buffer = "";
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const seenKeys = new Set<string>();

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => flush(), idleMs);
  }

  function isInsideCodeBlock(text: string): boolean {
    const fenceCount = (text.match(/^```/gm) || []).length;
    return fenceCount % 2 !== 0; // odd = unclosed
  }

  async function flush() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!buffer.trim()) return;

    const text = buffer.trim();
    buffer = "";

    // Dedup
    const key = text;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    if (seenKeys.size > 200) seenKeys.clear(); // prevent unbounded growth

    await opts.onFlush(text);
  }

  async function splitAndFlush() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!buffer.trim()) return;

    // Split into chunks respecting code blocks
    const chunks = splitRespectingCodeBlocks(buffer.trim(), maxLen);
    buffer = "";

    for (const chunk of chunks) {
      const key = chunk.trim();
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      await opts.onFlush(chunk);
    }

    if (seenKeys.size > 200) seenKeys.clear();
  }

  return {
    push(text: string) {
      buffer += text;
      if (buffer.length >= maxLen) {
        splitAndFlush().catch((err) => log.error(`Coalescer flush error: ${err}`));
        return;
      }
      if (buffer.length >= minChars && !isInsideCodeBlock(buffer)) {
        resetIdle();
      } else {
        resetIdle();
      }
    },

    async finish() {
      if (buffer.trim()) await splitAndFlush();
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    },

    clear() {
      buffer = "";
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      seenKeys.clear();
    },
  };
}

// Split text into chunks respecting code blocks and paragraph boundaries
function splitRespectingCodeBlocks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const searchEnd = Math.min(remaining.length, maxLen);

    // Check if splitting would break a code block
    const prefix = remaining.slice(0, searchEnd);
    const fenceCount = (prefix.match(/^```/gm) || []).length;
    const insideCodeBlock = fenceCount % 2 !== 0;

    if (insideCodeBlock) {
      // Find the closing fence after searchEnd
      const closingFence = remaining.indexOf("\n```", searchEnd);
      if (closingFence >= 0 && closingFence < remaining.length) {
        const endOfFence = remaining.indexOf("\n", closingFence + 4);
        splitAt = endOfFence >= 0 ? endOfFence + 1 : closingFence + 4;
      }
    }

    // If not in code block or couldn't find closing fence, use normal splitting
    if (splitAt < 0) {
      // Paragraph boundary
      const paraIdx = remaining.lastIndexOf("\n\n", searchEnd);
      if (paraIdx >= maxLen * 0.3) splitAt = paraIdx + 2;
    }
    if (splitAt < 0) {
      // Newline
      const nlIdx = remaining.lastIndexOf("\n", searchEnd);
      if (nlIdx >= maxLen * 0.3) splitAt = nlIdx + 1;
    }
    if (splitAt < 0) {
      splitAt = searchEnd;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}
