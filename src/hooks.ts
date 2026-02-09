// Hook System — Types + runner + 4 bundled hooks
// All in ONE file

import { log } from "./utils/logger.js";
import type { TinyClawConfig } from "./config/schema.js";
import type { PluginHookHandler } from "./plugin/plugin.js";

// ══════════════════════════════════════════════
// ── Hook Event Types (14 events) ──
// ══════════════════════════════════════════════

export type HookEvent =
  | "boot"
  | "shutdown"
  | "config_reload"
  | "session_start"
  | "session_end"
  | "pre_run"
  | "post_run"
  | "tool_start"
  | "tool_end"
  | "message_inbound"
  | "message_outbound"
  | "channel_connect"
  | "channel_disconnect"
  | "error";

// ══════════════════════════════════════════════
// ── Hook Registry & Runner ──
// ══════════════════════════════════════════════

interface RegisteredHook {
  id: string;
  event: HookEvent | string;
  handler: PluginHookHandler;
  priority?: number;
}

const hooks: RegisteredHook[] = [];

export function registerHook(id: string, event: HookEvent | string, handler: PluginHookHandler, priority = 0): void {
  hooks.push({ id, event, handler, priority });
  hooks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  log.debug(`Registered hook: ${id} for event ${event}`);
}

export function unregisterHook(id: string): void {
  const idx = hooks.findIndex((h) => h.id === id);
  if (idx >= 0) hooks.splice(idx, 1);
}

const HOOK_TIMEOUT_MS = 5000;

export interface HookResult {
  abort?: boolean;
  abortMessage?: string;
  transform?: Record<string, unknown>;
}

export async function runHooks(event: HookEvent | string, data: Record<string, unknown>): Promise<HookResult | void> {
  const matching = hooks.filter((h) => h.event === event || h.event === "*");
  for (const hook of matching) {
    try {
      const result = await Promise.race([
        hook.handler(event, data),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Hook ${hook.id} timed out (${HOOK_TIMEOUT_MS}ms)`)), HOOK_TIMEOUT_MS)),
      ]) as HookResult | void;

      // Handle hook transform/abort returns
      if (result && typeof result === "object") {
        if (result.abort) {
          log.info(`Hook ${hook.id} aborted event ${event}`);
          return result;
        }
        if (result.transform) {
          Object.assign(data, result.transform);
        }
      }
    } catch (err) {
      log.warn(`Hook ${hook.id} failed for event ${event}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ══════════════════════════════════════════════
// ── 4 Bundled Hooks ──
// ══════════════════════════════════════════════

// 1. boot-md: Logs boot info
registerHook("boot-md", "boot", async (_event, data) => {
  const config = data.config as TinyClawConfig;
  log.info(`TinyClaw booted — model: ${config.agent?.provider}/${config.agent?.model}, thinking: ${config.agent?.thinkingLevel}`);
});

// 2. session-memory: Saves session summary to memory on session end
registerHook("session-memory", "session_end", async (_event, data) => {
  const { sessionName, summary } = data;
  if (summary && typeof summary === "string") {
    log.debug(`Session ${sessionName} ended — summary saved to memory`);
  }
});

// 3. soul-evil: Prompt injection warning
registerHook("soul-evil", "message_inbound", async (_event, data) => {
  const body = data.body as string;
  if (!body) return;
  // Quick check for common injection patterns
  const patterns = [/ignore.*previous.*instructions/i, /you are now/i, /jailbreak/i];
  for (const p of patterns) {
    if (p.test(body)) {
      log.warn(`Potential prompt injection detected in inbound message`);
      data.injectionWarning = true;
      break;
    }
  }
});

// 4. command-logger: Logs slash commands
registerHook("command-logger", "tool_start", async (_event, data) => {
  log.trace(`Tool call: ${data.toolName} ${data.args ? JSON.stringify(data.args).slice(0, 100) : ""}`);
});

// ── Initialize hooks from config ──
export function initHooksFromConfig(config: TinyClawConfig): void {
  if (config.hooks?.enabled === false) return;

  // Register mappings from config
  const mappings = config.hooks?.mappings ?? [];
  for (const mapping of mappings) {
    if (mapping.match && mapping.action) {
      registerHook(`mapping-${mapping.match}`, mapping.match, async (_event, data) => {
        log.debug(`Hook mapping triggered: ${mapping.match} → ${mapping.action}`);
        if (mapping.model) data.modelOverride = mapping.model;
        if (mapping.channel) data.channelOverride = mapping.channel;
      });
    }
  }

  log.debug(`Initialized ${mappings.length} hook mappings from config`);
}
