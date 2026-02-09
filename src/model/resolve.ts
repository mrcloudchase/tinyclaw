import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveAgentDir, ensureDir } from "../config/paths.js";
import { resolveApiKey, setApiKeyOnAuthStorage } from "../auth/keys.js";
import { log } from "../util/logger.js";

export interface ResolvedModel {
  model: Model<any>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

/**
 * Resolves a Model object from provider + modelId.
 * Creates AuthStorage and ModelRegistry, sets the API key.
 */
export function resolveModel(
  provider: string,
  modelId: string,
  config: TinyClawConfig,
): ResolvedModel {
  const agentDir = resolveAgentDir();
  ensureDir(agentDir);

  const authStorage = new AuthStorage(path.join(agentDir, "auth.json"));
  const modelRegistry = new ModelRegistry(
    authStorage,
    path.join(agentDir, "models.json"),
  );

  // Set API key on auth storage
  const apiKey = resolveApiKey(provider, config, authStorage);
  if (apiKey) {
    setApiKeyOnAuthStorage(provider, apiKey, authStorage);
  } else {
    log.warn(
      `No API key found for provider "${provider}". ` +
        `Set ${provider.toUpperCase()}_API_KEY or add it to your config.`,
    );
  }

  // Try to find the model in the registry
  const model = modelRegistry.find(provider, modelId);
  if (model) {
    log.debug(`Resolved model: ${provider}/${modelId}`);
    return { model, authStorage, modelRegistry };
  }

  // Fallback: create a generic model entry
  log.debug(
    `Model ${provider}/${modelId} not in registry, creating generic entry`,
  );
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

  return { model: fallbackModel, authStorage, modelRegistry };
}
