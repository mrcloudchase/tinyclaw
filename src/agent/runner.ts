import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { createTinyClawSession, type TinyClawSession, type SessionUsage } from "./session.js";
import { compactSession } from "./compact.js";
import { truncateOversizedToolResults } from "./pruning.js";
import { buildFallbackChain, resolveNextFallback } from "../model/resolve.js";
import { markKeyFailed, markKeySuccess, classifyFailoverReason, type FailureReason } from "../auth/keys.js";
import {
  isContextOverflowError,
  isAuthError,
  isRateLimitError,
  describeError,
} from "../utils/errors.js";
import { log } from "../utils/logger.js";

export interface RunOptions {
  onText?: (text: string) => void;
  onToolEvent?: (event: { type: "start" | "end"; toolName: string; input?: string; output?: string }) => void;
  onEvent?: (event: AgentSessionEvent) => void;
  abortSignal?: AbortSignal;
  forceNew?: boolean;
  ephemeral?: boolean;
}

export interface RunResult {
  text: string;
  compacted: boolean;
  tinyClawSession: TinyClawSession;
}

// Hook points for pipeline integration
export type HookFn = (event: string, data: Record<string, unknown>) => Promise<void>;

const MAX_RETRIES = 3;
const THINKING_FALLBACK: ThinkingLevel[] = ["high", "medium", "low", "off"];

export async function runAgent(params: {
  config: TinyClawConfig;
  prompt: string;
  sessionName: string;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  options?: RunOptions;
  existingSession?: TinyClawSession;
  hooks?: HookFn;
}): Promise<RunResult> {
  const { config, prompt, sessionName, workspaceDir, options = {}, hooks } = params;

  let compacted = false;
  let truncatedToolResults = false;
  let thinkingLevel: ThinkingLevel = params.thinkingLevel ?? (config.agent?.thinkingLevel as ThinkingLevel) ?? "off";
  let tinyClawSession: TinyClawSession;
  const fallbackChain = buildFallbackChain(config);
  let fallbackIdx = 0;

  // Fire pre-run hook
  await hooks?.("pre_run", { prompt, sessionName });

  if (params.existingSession) {
    tinyClawSession = params.existingSession;
  } else {
    tinyClawSession = await createTinyClawSession({
      config, sessionName, workspaceDir,
      provider: params.provider, modelId: params.modelId,
      thinkingLevel, ephemeral: options.ephemeral,
    });
  }

  const { session } = tinyClawSession;

  let responseText = "";
  const runUsage: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    options.onEvent?.(event);

    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        responseText += ame.delta;
        options.onText?.(ame.delta);
      }
    }

    // Accumulate usage from message_end events
    if (event.type === "message_end" && (event as any).usage) {
      const u = (event as any).usage;
      runUsage.inputTokens += u.input_tokens ?? u.inputTokens ?? 0;
      runUsage.outputTokens += u.output_tokens ?? u.outputTokens ?? 0;
      runUsage.cacheRead += u.cache_read_input_tokens ?? u.cacheRead ?? 0;
      runUsage.cacheWrite += u.cache_creation_input_tokens ?? u.cacheWrite ?? 0;
      runUsage.totalTokens = runUsage.inputTokens + runUsage.outputTokens;
    }

    if (event.type === "tool_execution_start") {
      options.onToolEvent?.({ type: "start", toolName: event.toolName, input: JSON.stringify(event.args) });
    }

    if (event.type === "tool_execution_end") {
      options.onToolEvent?.({ type: "end", toolName: event.toolName, output: event.result ? String(event.result).slice(0, 500) : undefined });
    }

    if (event.type === "auto_compaction_start") { log.info("Auto-compaction triggered..."); compacted = true; }
    if (event.type === "auto_compaction_end" && event.result) {
      log.info(`Auto-compaction done: ${event.result.tokensBefore} tokens compacted`);
    }
  });

  let retries = 0;
  try {
    while (retries <= MAX_RETRIES) {
      try {
        responseText = "";
        await session.prompt(prompt);
        // Mark key as successful + accumulate usage
        markKeySuccess(tinyClawSession.resolved.provider, tinyClawSession.resolved.modelId);
        tinyClawSession.usage.inputTokens += runUsage.inputTokens;
        tinyClawSession.usage.outputTokens += runUsage.outputTokens;
        tinyClawSession.usage.cacheRead += runUsage.cacheRead;
        tinyClawSession.usage.cacheWrite += runUsage.cacheWrite;
        tinyClawSession.usage.totalTokens += runUsage.totalTokens;
        await hooks?.("post_run", { prompt, response: responseText, usage: runUsage });
        return { text: responseText, compacted, tinyClawSession };
      } catch (error) {
        if (options.abortSignal?.aborted) throw new Error("Aborted");

        // Context overflow → compact first, then truncate oversized tool results
        if (isContextOverflowError(error) && retries < MAX_RETRIES) {
          if (!truncatedToolResults) {
            // First try: truncate oversized tool results
            const messages = (session as any).messages ?? (session as any).agent?.messages;
            if (messages && Array.isArray(messages)) {
              const { truncated } = truncateOversizedToolResults(messages, config.agent?.contextWindow);
              if (truncated > 0) {
                log.warn(`Truncated ${truncated} oversized tool result(s), retrying...`);
                truncatedToolResults = true;
                retries++;
                continue;
              }
            }
          }
          log.warn("Context overflow, compacting...");
          await compactSession(session);
          compacted = true;
          retries++;
          continue;
        }

        // Classify error for targeted recovery
        const reason: FailureReason = classifyFailoverReason(error);

        // Format errors → don't retry
        if (reason === "format") throw error;

        // Rate limit → backoff & retry
        if (reason === "rate_limit" && retries < MAX_RETRIES) {
          const delayMs = Math.min(1000 * Math.pow(2, retries), 30000);
          log.warn(`Rate limited, waiting ${Math.round(delayMs / 1000)}s...`);
          markKeyFailed(tinyClawSession.resolved.provider, tinyClawSession.resolved.modelId, reason);
          await new Promise((r) => setTimeout(r, delayMs + Math.random() * delayMs * 0.1));
          retries++;
          continue;
        }

        // Timeout → short backoff, retry same key
        if (reason === "timeout" && retries < MAX_RETRIES) {
          const delayMs = Math.min(500 * Math.pow(2, retries), 5000);
          log.warn(`Timeout, retrying in ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
          retries++;
          continue;
        }

        // Auth or billing → mark key failed, try fallback model
        if ((reason === "auth" || reason === "billing") || isAuthError(error)) {
          markKeyFailed(tinyClawSession.resolved.provider, tinyClawSession.resolved.modelId, reason);
          const next = resolveNextFallback(fallbackIdx, fallbackChain, config);
          if (next && fallbackIdx < fallbackChain.length - 1) {
            fallbackIdx++;
            log.warn(`${reason === "billing" ? "Billing" : "Auth"} failed, falling back to ${next.provider}/${next.modelId}`);
            tinyClawSession = await createTinyClawSession({
              config, sessionName, workspaceDir,
              provider: next.provider, modelId: next.modelId,
              thinkingLevel, ephemeral: options.ephemeral,
            });
            retries++;
            continue;
          }
          throw new Error(`Authentication failed for provider "${tinyClawSession.resolved.provider}". Check your API key. ${describeError(error)}`);
        }

        // Thinking level error → downgrade
        const errMsg = describeError(error).toLowerCase();
        if (errMsg.includes("thinking") && retries < MAX_RETRIES) {
          const currentIdx = THINKING_FALLBACK.indexOf(thinkingLevel);
          if (currentIdx < THINKING_FALLBACK.length - 1) {
            thinkingLevel = THINKING_FALLBACK[currentIdx + 1];
            log.warn(`Thinking level error, downgrading to ${thinkingLevel}`);
            retries++;
            continue;
          }
        }

        throw error;
      }
    }

    throw new Error(`Failed after ${MAX_RETRIES} retries`);
  } finally {
    unsubscribe();
  }
}
