// TinyClaw — A minimal AI assistant platform
// Public API exports

// Config
export { type TinyClawConfig, TinyClawConfigSchema, DEFAULT_CONFIG } from "./config/schema.js";
export { loadConfig, watchConfig } from "./config/loader.js";
export { resolveConfigDir, resolvePluginsDir, resolveSkillsDir, resolveMemoryDir } from "./config/paths.js";
export { startConfigWatcher, diffConfig, requiresRestart } from "./config/watcher.js";

// Agent
export { runAgent, type RunOptions, type RunResult, type HookFn } from "./agent/runner.js";
export { createTinyClawSession, type TinyClawSession, type SessionUsage, parseSessionKey, buildSessionKey, acquireSessionLock, releaseSessionLock, repairSessionFileIfNeeded } from "./agent/session.js";
export { truncateOversizedToolResults, estimateContextSize } from "./agent/pruning.js";
export { compactSession } from "./agent/compact.js";
export { buildSystemPrompt, loadBootstrapContent, type SystemPromptParams } from "./agent/system-prompt.js";
export { assembleTinyClawTools, assembleAllTools, normalizeToolParams, type AssembledTools } from "./agent/tools.js";

// Model
export { resolveModel, resolveAlias, buildFallbackChain, type ResolvedModel } from "./model/resolve.js";

// Auth
export { resolveApiKey, addKeyToPool, markKeyFailed, markKeySuccess, getKeyPoolHealth } from "./auth/keys.js";

// Security
export { evaluatePolicy, ssrfCheck, detectInjection, wrapUntrustedContent, sanitizePath, isCommandAllowed, trackApproval, type PolicyDecision, type PolicyContext } from "./security.js";

// Pipeline
export { dispatch, chunkReply, createDebouncer, clearSession, getActiveSessionKeys, type MsgContext, type PipelineResult } from "./pipeline.js";

// Channels
export { createChannelRegistry, getChannelRegistry, initChannels, shutdownChannels, type ChannelAdapter, type ChannelCapabilities, type ChannelInstance, type ChannelRegistry, type InboundMessage } from "./channel.js";

// Gateway
export { startGateway, stopGateway, type GatewayContext, type PresenceEntry } from "./gateway.js";

// Plugins
export { TinyClawPluginApi, PluginRegistry, discoverAndLoadPlugins, type PluginMeta, type PluginInitFn, type PluginRegistration } from "./plugin.js";

// Hooks
export { registerHook, unregisterHook, runHooks, initHooksFromConfig, type HookEvent, type HookResult } from "./hooks.js";

// Multi-Agent
export { spawnAgent, sendToAgent, resolveAgentBinding, listAgents } from "./multi-agent.js";

// Subsystems
export { createMemoryStore, type MemoryStore } from "./memory.js";
export { generateEmbeddings, cosineSimilarity } from "./memory/embeddings.js";
export { launchBrowser, type BrowserInstance } from "./browser.js";
export { startScheduler, type CronJob } from "./cron.js";
export { synthesize, shouldAutoTts, type TtsResult, type TtsProvider } from "./tts.js";
export { describeImage, processImage, saveMediaFile, detectMime } from "./media.js";

// Sandbox
export { ensureSandboxImage, ensureSandboxContainer, execInSandbox, removeSandboxContainer, listSandboxContainers, cleanupAllSandboxes, containerName, resolveSandboxConfig, type SandboxConfig, type SandboxExecResult } from "./sandbox.js";

// Pairing
export { PairingStore, getPairingStore, initPairingStore } from "./pairing.js";

// Web Tools
export { createWebSearchTool, createWebFetchTool } from "./tools/web.js";

// Util
export { log, setVerbose, setJsonMode, setLogFile } from "./utils/logger.js";
export { isContextOverflowError, isAuthError, isRateLimitError, describeError } from "./utils/errors.js";
