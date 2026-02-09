import type { AgentSession, CompactionResult } from "@mariozechner/pi-coding-agent";
import { log } from "../utils/logger.js";

/**
 * Triggers context compaction on a session.
 * Uses pi-coding-agent's built-in compaction which:
 * 1. Splits messages into old + recent
 * 2. Summarizes old messages via LLM
 * 3. Replaces them with a compact summary
 */
export async function compactSession(
  session: AgentSession,
  customInstructions?: string,
): Promise<CompactionResult> {
  log.info("Compacting session context...");
  const result = await session.compact(customInstructions);
  log.info(
    `Compaction complete: ${result.tokensBefore} tokens compacted`,
  );
  return result;
}
