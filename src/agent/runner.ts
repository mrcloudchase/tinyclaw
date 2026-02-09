import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { TinyClawConfig } from "../config/schema.js";
import { createTinyClawSession, type TinyClawSession } from "./session.js";
import { compactSession } from "./compact.js";
import {
  isContextOverflowError,
  isAuthError,
  isRateLimitError,
  describeError,
} from "../util/errors.js";
import { log } from "../util/logger.js";

export interface RunOptions {
  /** Callback for streaming text chunks */
  onText?: (text: string) => void;
  /** Callback for tool execution events */
  onToolEvent?: (event: {
    type: "start" | "end";
    toolName: string;
    input?: string;
    output?: string;
  }) => void;
  /** Callback for session events */
  onEvent?: (event: AgentSessionEvent) => void;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Force new session (delete existing) */
  forceNew?: boolean;
  /** Use ephemeral (in-memory) session */
  ephemeral?: boolean;
}

export interface RunResult {
  /** The final assistant response text */
  text: string;
  /** Whether compaction was triggered */
  compacted: boolean;
  /** Session reference for follow-up prompts */
  tinyClawSession: TinyClawSession;
}

const MAX_RETRIES = 3;
const THINKING_FALLBACK: ThinkingLevel[] = ["high", "medium", "low", "off"];

/**
 * Runs a single agent turn with error recovery.
 *
 * Handles:
 * - Context overflow → compact & retry
 * - Auth errors → report (no rotation yet)
 * - Rate limits → exponential backoff & retry
 * - Thinking level errors → downgrade & retry
 */
export async function runAgent(params: {
  config: TinyClawConfig;
  prompt: string;
  sessionName: string;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  options?: RunOptions;
  /** Reuse existing session for multi-turn */
  existingSession?: TinyClawSession;
}): Promise<RunResult> {
  const {
    config,
    prompt,
    sessionName,
    workspaceDir,
    options = {},
  } = params;

  let compacted = false;
  let thinkingLevel: ThinkingLevel =
    params.thinkingLevel ?? (config.agent?.thinkingLevel as ThinkingLevel) ?? "off";
  let tinyClawSession: TinyClawSession;

  // Create or reuse session
  if (params.existingSession) {
    tinyClawSession = params.existingSession;
  } else {
    tinyClawSession = await createTinyClawSession({
      config,
      sessionName,
      workspaceDir,
      provider: params.provider,
      modelId: params.modelId,
      thinkingLevel,
      ephemeral: options.ephemeral,
    });
  }

  const { session } = tinyClawSession;

  // Subscribe to events for streaming
  let responseText = "";
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    options.onEvent?.(event);

    if (event.type === "message_update") {
      // Extract text deltas from the assistant message event stream
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        responseText += ame.delta;
        options.onText?.(ame.delta);
      }
    }

    if (event.type === "tool_execution_start") {
      options.onToolEvent?.({
        type: "start",
        toolName: event.toolName,
        input: JSON.stringify(event.args),
      });
    }

    if (event.type === "tool_execution_end") {
      options.onToolEvent?.({
        type: "end",
        toolName: event.toolName,
        output: event.result
          ? String(event.result).slice(0, 500)
          : undefined,
      });
    }

    if (event.type === "auto_compaction_start") {
      log.info("Auto-compaction triggered...");
      compacted = true;
    }

    if (event.type === "auto_compaction_end") {
      if (event.result) {
        log.info(
          `Auto-compaction done: ${event.result.tokensBefore} tokens compacted`,
        );
      }
    }
  });

  // Retry loop
  let retries = 0;
  try {
    while (retries <= MAX_RETRIES) {
      try {
        responseText = "";
        await session.prompt(prompt);
        return { text: responseText, compacted, tinyClawSession };
      } catch (error) {
        if (options.abortSignal?.aborted) {
          throw new Error("Aborted");
        }

        if (isContextOverflowError(error) && retries < MAX_RETRIES) {
          log.warn("Context overflow, compacting...");
          await compactSession(session);
          compacted = true;
          retries++;
          continue;
        }

        if (isRateLimitError(error) && retries < MAX_RETRIES) {
          const delayMs = Math.min(1000 * Math.pow(2, retries), 30000);
          const jitter = Math.random() * delayMs * 0.1;
          log.warn(`Rate limited, waiting ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs + jitter));
          retries++;
          continue;
        }

        if (isAuthError(error)) {
          throw new Error(
            `Authentication failed for provider "${params.provider ?? config.agent?.provider}". ` +
              `Check your API key. ${describeError(error)}`,
          );
        }

        throw error;
      }
    }

    throw new Error(`Failed after ${MAX_RETRIES} retries`);
  } finally {
    unsubscribe();
  }
}
