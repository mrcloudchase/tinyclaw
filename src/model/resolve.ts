import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveAgentDir, ensureDir } from "../config/paths.js";
import { resolveApiKey, setApiKeyOnAuthStorage, loadKeysFromEnv } from "../auth/keys.js";
import { log } from "../util/logger.js";

export interface ResolvedModel {
  model: Model<any>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  provider: string;
  modelId: string;
}

// ── Model Aliases ──
const MODEL_ALIASES: Record<string, string> = {
  "sonnet": "anthropic/claude-sonnet-4-5-20250929",
  "opus": "anthropic/claude-opus-4-6",
  "haiku": "anthropic/claude-haiku-4-5-20251001",
  "gpt4o": "openai/gpt-4o",
  "gpt4": "openai/gpt-4o",
  "o3": "openai/o3",
};

export function resolveAlias(input: string): { provider: string; modelId: string } {
  const alias = MODEL_ALIASES[input.toLowerCase()];
  if (alias) {
    const [provider, ...rest] = alias.split("/");
    return { provider, modelId: rest.join("/") };
  }
  if (input.includes("/")) {
    const [provider, ...rest] = input.split("/");
    return { provider, modelId: rest.join("/") };
  }
  return { provider: "anthropic", modelId: input };
}

// ── Fallback Chain ──
export function buildFallbackChain(config: TinyClawConfig): Array<{ provider: string; modelId: string }> {
  const primary = {
    provider: config.agent?.provider ?? "anthropic",
    modelId: config.agent?.model ?? "claude-sonnet-4-5-20250929",
  };
  const chain = [primary];
  const fallbacks = config.agent?.fallbacks;
  if (fallbacks) {
    for (const fb of fallbacks) {
      chain.push(resolveAlias(fb));
    }
  }
  return chain;
}

export function resolveModel(
  provider: string,
  modelId: string,
  config: TinyClawConfig,
): ResolvedModel {
  const agentDir = resolveAgentDir();
  ensureDir(agentDir);

  const authStorage = new AuthStorage(path.join(agentDir, "auth.json"));
  const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.json"));

  // Load multi-key pools
  loadKeysFromEnv(provider);

  // Set API key on auth storage
  const apiKey = resolveApiKey(provider, config, authStorage);
  if (apiKey) {
    setApiKeyOnAuthStorage(provider, apiKey, authStorage);
  } else {
    log.warn(`No API key found for provider "${provider}". Set ${provider.toUpperCase()}_API_KEY or add it to your config.`);
  }

  // Check custom providers in config
  const customProvider = config.models?.providers?.[provider];
  if (customProvider) {
    const customModel = customProvider.models?.find((m) => m.id === modelId);
    const model: Model<any> = {
      id: modelId,
      name: customModel?.name ?? modelId,
      provider,
      api: customProvider.api ?? "openai-responses",
      baseUrl: customProvider.baseUrl,
      reasoning: false,
      input: ["text"],
      contextWindow: customModel?.contextWindow ?? 128_000,
      maxTokens: customModel?.maxTokens ?? 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    log.debug(`Resolved custom provider model: ${provider}/${modelId}`);
    return { model, authStorage, modelRegistry, provider, modelId };
  }

  // Try model registry
  const model = modelRegistry.find(provider, modelId);
  if (model) {
    log.debug(`Resolved model: ${provider}/${modelId}`);
    return { model, authStorage, modelRegistry, provider, modelId };
  }

  // Fallback: generic model entry
  log.debug(`Model ${provider}/${modelId} not in registry, creating generic entry`);
  const fallbackModel: Model<any> = {
    id: modelId,
    name: modelId,
    provider,
    api: provider === "openai" ? "openai-responses" : "anthropic-messages",
    baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com",
    reasoning: false,
    input: ["text"],
    contextWindow: config.agent?.contextWindow ?? 200_000,
    maxTokens: config.agent?.maxTokens ?? 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  return { model: fallbackModel, authStorage, modelRegistry, provider, modelId };
}

// Resolve next fallback model in chain
export function resolveNextFallback(
  currentIdx: number,
  chain: Array<{ provider: string; modelId: string }>,
  config: TinyClawConfig,
): ResolvedModel | undefined {
  const next = chain[currentIdx + 1];
  if (!next) return undefined;
  return resolveModel(next.provider, next.modelId, config);
}
