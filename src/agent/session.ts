import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type CreateAgentSessionResult,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveModel, resolveAlias, type ResolvedModel } from "../model/resolve.js";
import { assembleTinyClawTools } from "./tools.js";
import { buildSystemPrompt, loadBootstrapContent } from "./system-prompt.js";
import { resolveSessionFile, resolveSessionsDir, ensureDir } from "../config/paths.js";
import { log } from "../util/logger.js";

export interface TinyClawSession {
  session: AgentSession;
  resolved: ResolvedModel;
  sessionManager: SessionManager;
  extensionsResult: CreateAgentSessionResult["extensionsResult"];
  agentId?: string;
}

// ── Multi-Agent Session Key Parsing ──
// Format: "agentId:channelId:accountId:peerId" or just "sessionName"
export interface SessionKey {
  agentId?: string;
  channelId?: string;
  accountId?: string;
  peerId?: string;
  raw: string;
}

export function parseSessionKey(input: string): SessionKey {
  const parts = input.split(":");
  if (parts.length >= 4) {
    return { agentId: parts[0], channelId: parts[1], accountId: parts[2], peerId: parts[3], raw: input };
  }
  if (parts.length >= 2) {
    return { agentId: parts[0], channelId: parts[1], raw: input };
  }
  return { raw: input };
}

export function buildSessionKey(agentId: string, channelId: string, accountId: string, peerId: string): string {
  return `${agentId}:${channelId}:${accountId}:${peerId}`;
}

// ── Resolve Agent Binding ──
export function resolveAgentForChannel(
  config: TinyClawConfig,
  channelId: string,
  accountId?: string,
  peerId?: string,
): string | undefined {
  const bindings = config.multiAgent?.bindings;
  if (!bindings) return undefined;
  for (const b of bindings) {
    if (b.match?.channel && b.match.channel !== channelId) continue;
    if (b.match?.accountId && b.match.accountId !== accountId) continue;
    if (b.match?.peer && b.match.peer !== peerId) continue;
    return b.agentId;
  }
  return undefined;
}

export async function createTinyClawSession(params: {
  config: TinyClawConfig;
  sessionName: string;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  ephemeral?: boolean;
  agentId?: string;
}): Promise<TinyClawSession> {
  const { config, sessionName, workspaceDir, ephemeral = false, agentId } = params;

  // Resolve model (support aliases)
  let provider = params.provider ?? config.agent?.provider ?? "anthropic";
  let modelId = params.modelId ?? config.agent?.model ?? "claude-sonnet-4-5-20250929";

  // Check for agent-specific model override
  if (agentId && config.multiAgent?.agents) {
    const agentDef = config.multiAgent.agents.find((a) => a.id === agentId);
    if (agentDef?.model) {
      const m = typeof agentDef.model === "string" ? resolveAlias(agentDef.model) : resolveAlias(agentDef.model.primary ?? modelId);
      provider = m.provider;
      modelId = m.modelId;
    }
  }

  const thinkingLevel: ThinkingLevel = params.thinkingLevel ?? (config.agent?.thinkingLevel as ThinkingLevel) ?? "off";
  const resolved = resolveModel(provider, modelId, config);
  const { builtinTools, customTools } = assembleTinyClawTools(workspaceDir, config);

  let sessionManager: SessionManager;
  if (ephemeral) {
    sessionManager = SessionManager.inMemory();
  } else {
    ensureDir(resolveSessionsDir());
    sessionManager = SessionManager.open(resolveSessionFile(sessionName));
  }

  log.debug(`Creating session: provider=${provider} model=${modelId} thinking=${thinkingLevel}${agentId ? ` agent=${agentId}` : ""}`);

  const result = await createAgentSession({
    cwd: workspaceDir,
    model: resolved.model,
    thinkingLevel,
    tools: builtinTools,
    customTools: customTools as any,
    authStorage: resolved.authStorage,
    modelRegistry: resolved.modelRegistry,
    sessionManager,
  });

  const { session, extensionsResult, modelFallbackMessage } = result;
  if (modelFallbackMessage) log.warn(modelFallbackMessage);

  // Build system prompt with full context
  const bootstrapContent = loadBootstrapContent(workspaceDir);
  const toolNames = builtinTools.map((t) => t.name);
  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    toolNames,
    model: `${provider}/${modelId}`,
    thinkingLevel,
    config,
    bootstrapContent,
    agentId,
  });
  session.agent.setSystemPrompt(systemPrompt);

  return { session, resolved, sessionManager, extensionsResult, agentId };
}
