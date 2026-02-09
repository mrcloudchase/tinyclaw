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
import { log } from "../utils/logger.js";
import fs from "node:fs";
import path from "node:path";

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface TinyClawSession {
  session: AgentSession;
  resolved: ResolvedModel;
  sessionManager: SessionManager;
  extensionsResult: CreateAgentSessionResult["extensionsResult"];
  agentId?: string;
  usage: SessionUsage;
}

// ── Session File Locking ──
// Advisory lock via exclusive file creation to prevent concurrent corruption

const lockRefCounts = new Map<string, number>();
const cleanupRegistered = new Set<string>();

function lockPathFor(sessionFile: string): string {
  return sessionFile + ".lock";
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function acquireSessionLock(sessionFile: string, timeoutMs = 10000): Promise<void> {
  const lockPath = lockPathFor(sessionFile);

  // Recursive lock for same process
  const existing = lockRefCounts.get(lockPath);
  if (existing !== undefined) { lockRefCounts.set(lockPath, existing + 1); return; }

  const deadline = Date.now() + timeoutMs;
  let delay = 50;

  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      fs.closeSync(fd);
      lockRefCounts.set(lockPath, 1);

      // Register cleanup on first lock
      if (!cleanupRegistered.has(lockPath)) {
        cleanupRegistered.add(lockPath);
        process.on("exit", () => { try { fs.unlinkSync(lockPath); } catch {} });
      }
      return;
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;

      // Check for stale lock
      try {
        const raw = fs.readFileSync(lockPath, "utf-8");
        const { pid, createdAt } = JSON.parse(raw);
        const stale = (Date.now() - createdAt > 30 * 60 * 1000) || !isPidAlive(pid);
        if (stale) { try { fs.unlinkSync(lockPath); } catch {} continue; }
      } catch { try { fs.unlinkSync(lockPath); } catch {} continue; }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1000);
    }
  }

  throw new Error(`Failed to acquire session lock for ${sessionFile} within ${timeoutMs}ms`);
}

export function releaseSessionLock(sessionFile: string): void {
  const lockPath = lockPathFor(sessionFile);
  const count = lockRefCounts.get(lockPath);
  if (count === undefined) return;
  if (count > 1) { lockRefCounts.set(lockPath, count - 1); return; }
  lockRefCounts.delete(lockPath);
  try { fs.unlinkSync(lockPath); } catch {}
}

// ── Session File Repair ──
// Recovers from mid-write crashes by dropping unparseable JSONL lines

export function repairSessionFileIfNeeded(sessionFile: string): void {
  if (!fs.existsSync(sessionFile)) return;

  const raw = fs.readFileSync(sessionFile, "utf-8");
  const lines = raw.split("\n");
  const valid: string[] = [];
  let repaired = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { valid.push(line); continue; }
    try { JSON.parse(trimmed); valid.push(line); } catch {
      repaired = true;
      log.warn(`Dropping unparseable session line: ${trimmed.slice(0, 80)}...`);
    }
  }

  if (repaired) {
    const backupPath = `${sessionFile}.bak-${process.pid}-${Date.now()}`;
    fs.copyFileSync(sessionFile, backupPath);
    log.info(`Session backup: ${backupPath}`);

    const tmpPath = sessionFile + ".tmp";
    fs.writeFileSync(tmpPath, valid.join("\n"));
    fs.renameSync(tmpPath, sessionFile);
    log.info(`Session file repaired: ${sessionFile}`);
  }
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
    const sessionFile = resolveSessionFile(sessionName);
    await acquireSessionLock(sessionFile);
    repairSessionFileIfNeeded(sessionFile);
    sessionManager = SessionManager.open(sessionFile);
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

  return { session, resolved, sessionManager, extensionsResult, agentId, usage: emptyUsage() };
}

export function emptyUsage(): SessionUsage {
  return { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}
