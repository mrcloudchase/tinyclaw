import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { createTinyClawSession, type TinyClawSession } from "./session.js";
import { compactSession } from "./compact.js";
import { buildFallbackChain, resolveNextFallback } from "../model/resolve.js";
import { markKeyFailed, markKeySuccess } from "../auth/keys.js";
import {
  isContextOverflowError,
  isAuthError,
  isRateLimitError,
  describeError,
} from "../util/errors.js";
import { log } from "../util/logger.js";

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
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    options.onEvent?.(event);

    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        responseText += ame.delta;
        options.onText?.(ame.delta);
      }
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
        // Mark key as successful
        markKeySuccess(tinyClawSession.resolved.provider, tinyClawSession.resolved.modelId);
        await hooks?.("post_run", { prompt, response: responseText });
        return { text: responseText, compacted, tinyClawSession };
      } catch (error) {
        if (options.abortSignal?.aborted) throw new Error("Aborted");

        // Context overflow → compact & retry
        if (isContextOverflowError(error) && retries < MAX_RETRIES) {
          log.warn("Context overflow, compacting...");
          await compactSession(session);
          compacted = true;
          retries++;
          continue;
        }

        // Rate limit → backoff & retry
        if (isRateLimitError(error) && retries < MAX_RETRIES) {
          const delayMs = Math.min(1000 * Math.pow(2, retries), 30000);
          log.warn(`Rate limited, waiting ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs + Math.random() * delayMs * 0.1));
          retries++;
          continue;
        }

        // Auth error → mark key failed, try fallback model
        if (isAuthError(error)) {
          markKeyFailed(tinyClawSession.resolved.provider, tinyClawSession.resolved.modelId);
          const next = resolveNextFallback(fallbackIdx, fallbackChain, config);
          if (next && fallbackIdx < fallbackChain.length - 1) {
            fallbackIdx++;
            log.warn(`Auth failed, falling back to ${next.provider}/${next.modelId}`);
            // Recreate session with fallback model
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
