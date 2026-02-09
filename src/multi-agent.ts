// Multi-Agent — Session keys + bindings + spawn + A2A routing
// All in ONE file

import type { TinyClawConfig } from "./config/schema.js";
import type { TinyClawSession } from "./agent/session.js";
import { createTinyClawSession, parseSessionKey, buildSessionKey, resolveAgentForChannel } from "./agent/session.js";
import { runAgent } from "./agent/runner.js";
import { log } from "./util/logger.js";

// ══════════════════════════════════════════════
// ── Agent Registry ──
// ══════════════════════════════════════════════

interface AgentEntry {
  id: string;
  session: TinyClawSession;
  spawnerAgentId?: string;
  createdAt: number;
}

const agentSessions = new Map<string, AgentEntry>();

export function getAgentSession(agentId: string): AgentEntry | undefined {
  return agentSessions.get(agentId);
}

export function listAgents(): Array<{ id: string; spawner?: string; createdAt: number }> {
  return [...agentSessions.values()].map((e) => ({
    id: e.id,
    spawner: e.spawnerAgentId,
    createdAt: e.createdAt,
  }));
}

// ══════════════════════════════════════════════
// ── Spawn Agent ──
// ══════════════════════════════════════════════

export async function spawnAgent(params: {
  config: TinyClawConfig;
  agentId?: string;
  prompt: string;
  workspaceDir: string;
  spawnerAgentId?: string;
}): Promise<{ agentId: string; response: string }> {
  const agentId = params.agentId ?? `agent-${Date.now().toString(36)}`;
  const { config, prompt, workspaceDir, spawnerAgentId } = params;

  // Resolve agent-specific model
  const agentDef = config.multiAgent?.agents?.find((a) => a.id === agentId);

  log.info(`Spawning agent: ${agentId}${spawnerAgentId ? ` (spawned by ${spawnerAgentId})` : ""}`);

  const session = await createTinyClawSession({
    config,
    sessionName: `agent:${agentId}`,
    workspaceDir,
    agentId,
    ephemeral: true,
  });

  agentSessions.set(agentId, {
    id: agentId,
    session,
    spawnerAgentId,
    createdAt: Date.now(),
  });

  // Run the initial prompt
  const result = await runAgent({
    config,
    prompt,
    sessionName: `agent:${agentId}`,
    workspaceDir,
    existingSession: session,
  });

  return { agentId, response: result.text };
}

// ══════════════════════════════════════════════
// ── Agent-to-Agent Messaging ──
// ══════════════════════════════════════════════

export async function sendToAgent(params: {
  config: TinyClawConfig;
  fromAgentId: string;
  toAgentId: string;
  message: string;
  workspaceDir: string;
}): Promise<{ response: string }> {
  const target = agentSessions.get(params.toAgentId);
  if (!target) {
    throw new Error(`Agent ${params.toAgentId} not found`);
  }

  const prefix = `[Message from agent "${params.fromAgentId}"]:\n`;
  const result = await runAgent({
    config: params.config,
    prompt: prefix + params.message,
    sessionName: `agent:${params.toAgentId}`,
    workspaceDir: params.workspaceDir,
    existingSession: target.session,
  });

  return { response: result.text };
}

// ══════════════════════════════════════════════
// ── Route Inbound to Agent ──
// ══════════════════════════════════════════════

export function resolveAgentBinding(
  config: TinyClawConfig,
  channelId: string,
  accountId?: string,
  peerId?: string,
): { agentId: string; sessionKey: string } {
  const agentId = resolveAgentForChannel(config, channelId, accountId, peerId) ?? "default";
  const sessionKey = buildSessionKey(agentId, channelId, accountId ?? "default", peerId ?? "default");
  return { agentId, sessionKey };
}

// ══════════════════════════════════════════════
// ── Cleanup ──
// ══════════════════════════════════════════════

export function removeAgent(agentId: string): boolean {
  return agentSessions.delete(agentId);
}

export function clearAllAgents(): number {
  const count = agentSessions.size;
  agentSessions.clear();
  return count;
}
