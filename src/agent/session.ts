import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type CreateAgentSessionResult,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { resolveModel, type ResolvedModel } from "../model/resolve.js";
import { assembleTinyClawTools } from "./tools.js";
import { buildSystemPrompt, loadBootstrapContent } from "./system-prompt.js";
import { resolveSessionFile, resolveSessionsDir, ensureDir } from "../config/paths.js";
import { log } from "../util/logger.js";

export interface TinyClawSession {
  session: AgentSession;
  resolved: ResolvedModel;
  sessionManager: SessionManager;
  extensionsResult: CreateAgentSessionResult["extensionsResult"];
}

/**
 * Creates a fully wired TinyClaw agent session using pi-coding-agent.
 */
export async function createTinyClawSession(params: {
  config: TinyClawConfig;
  sessionName: string;
  workspaceDir: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  ephemeral?: boolean;
}): Promise<TinyClawSession> {
  const {
    config,
    sessionName,
    workspaceDir,
    ephemeral = false,
  } = params;

  const provider = params.provider ?? config.agent?.provider ?? "anthropic";
  const modelId = params.modelId ?? config.agent?.model ?? "claude-sonnet-4-5-20250929";
  const thinkingLevel: ThinkingLevel =
    params.thinkingLevel ?? (config.agent?.thinkingLevel as ThinkingLevel) ?? "off";

  // Resolve model and auth
  const resolved = resolveModel(provider, modelId, config);

  // Assemble tools
  const { builtinTools, customTools } = assembleTinyClawTools(workspaceDir, config);

  // Session manager
  let sessionManager: SessionManager;
  if (ephemeral) {
    sessionManager = SessionManager.inMemory();
  } else {
    ensureDir(resolveSessionsDir());
    const sessionFile = resolveSessionFile(sessionName);
    sessionManager = SessionManager.open(sessionFile);
  }

  log.debug(
    `Creating session: provider=${provider} model=${modelId} thinking=${thinkingLevel}`,
  );

  // Create the agent session via pi-coding-agent
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

  if (modelFallbackMessage) {
    log.warn(modelFallbackMessage);
  }

  // Build and set system prompt
  const bootstrapContent = loadBootstrapContent(workspaceDir);
  const toolNames = builtinTools.map((t) => t.name);
  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    toolNames,
    model: `${provider}/${modelId}`,
    thinkingLevel,
    bootstrapContent,
  });
  session.agent.setSystemPrompt(systemPrompt);

  return {
    session,
    resolved,
    sessionManager,
    extensionsResult,
  };
}
