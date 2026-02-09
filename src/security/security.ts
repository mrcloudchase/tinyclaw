// Security Layer — Policy engine, SSRF guard, exec approval, prompt injection detection
// All in ONE file (~250 lines)

import { log } from "../utils/logger.js";
import type { TinyClawConfig } from "../config/schema.js";

// ══════════════════════════════════════════════
// ── Tool Policy Engine (10-layer priority) ──
// ══════════════════════════════════════════════

export type PolicyDecision = "allow" | "deny" | "confirm";

export interface PolicyContext {
  toolName: string;
  agentId?: string;
  channelId?: string;
  peerId?: string;
  callCount?: number;
}

// Policy layers (highest priority first):
// 1. Hardcoded deny (dangerous operations)
// 2. Config deniedTools
// 3. Config elevatedTools (→ confirm)
// 4. Per-agent tool allowlist
// 5. Per-channel restrictions
// 6. Max tool calls per turn
// 7. Exec approval mode
// 8. SSRF check (for web tools)
// 9. Tool policy mode (auto/interactive/strict)
// 10. Default: allow

const ALWAYS_DENY = new Set(["eval", "exec_raw", "system"]);
const ELEVATED_BY_DEFAULT = new Set(["bash", "write", "edit"]);

export function evaluatePolicy(config: TinyClawConfig, ctx: PolicyContext): PolicyDecision {
  const sec = config.security;

  // Layer 1: Hardcoded deny
  if (ALWAYS_DENY.has(ctx.toolName)) return "deny";

  // Layer 2: Config deniedTools
  if (sec?.deniedTools?.includes(ctx.toolName)) return "deny";

  // Layer 3: Config elevatedTools
  if (sec?.elevatedTools?.includes(ctx.toolName)) return "confirm";

  // Layer 4: Per-agent tool allowlist
  if (ctx.agentId && config.multiAgent?.agents) {
    const agent = config.multiAgent.agents.find((a) => a.id === ctx.agentId);
    if (agent?.tools && !agent.tools.includes(ctx.toolName)) return "deny";
  }

  // Layer 6: Max tool calls per turn
  if (ctx.callCount !== undefined) {
    const max = sec?.maxToolCallsPerTurn ?? 50;
    if (ctx.callCount >= max) return "deny";
  }

  // Layer 7: Exec approval mode (for bash/exec)
  if (ctx.toolName === "bash" || ctx.toolName === "exec") {
    const mode = sec?.execApproval ?? "auto";
    if (mode === "deny") return "deny";
    if (mode === "interactive") return "confirm";
  }

  // Layer 9: Tool policy mode
  const policyMode = sec?.toolPolicy ?? "auto";
  if (policyMode === "strict") {
    if (ELEVATED_BY_DEFAULT.has(ctx.toolName)) return "confirm";
  }
  if (policyMode === "interactive") return "confirm";

  // Layer 10: Default allow
  return "allow";
}

// ══════════════════════════════════════════════
// ── SSRF Guard ──
// ══════════════════════════════════════════════

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
  /^localhost$/i,
];

export function isPrivateIP(host: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(host));
}

export function ssrfCheck(url: string, config: TinyClawConfig): { allowed: boolean; reason?: string } {
  if (config.security?.ssrfProtection === false) return { allowed: true };

  try {
    const parsed = new URL(url);

    // Block private IPs
    if (isPrivateIP(parsed.hostname)) {
      return { allowed: false, reason: `Blocked: private IP (${parsed.hostname})` };
    }

    // Block non-HTTP(S) protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { allowed: false, reason: `Blocked: protocol ${parsed.protocol}` };
    }

    // Block common internal hostnames
    const internalPatterns = ["metadata.google", "169.254.169.254", "metadata.aws"];
    if (internalPatterns.some((p) => parsed.hostname.includes(p))) {
      return { allowed: false, reason: `Blocked: cloud metadata endpoint` };
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }
}

// ══════════════════════════════════════════════
// ── Exec Approval Manager ──
// ══════════════════════════════════════════════

export type ApprovalMode = "auto" | "interactive" | "deny";

interface PendingApproval {
  id: string;
  command: string;
  timestamp: number;
  resolve: (approved: boolean) => void;
}

const pendingApprovals = new Map<string, PendingApproval>();

export function requestApproval(command: string): { id: string; promise: Promise<boolean> } {
  const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let resolveRef: (v: boolean) => void;
  const promise = new Promise<boolean>((resolve) => { resolveRef = resolve; });
  pendingApprovals.set(id, { id, command, timestamp: Date.now(), resolve: resolveRef! });

  // Auto-expire after 60s
  setTimeout(() => {
    const pending = pendingApprovals.get(id);
    if (pending) {
      pending.resolve(false);
      pendingApprovals.delete(id);
      log.warn(`Approval ${id} expired (60s timeout)`);
    }
  }, 60_000);

  return { id, promise };
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(id);
  if (!pending) return false;
  pending.resolve(approved);
  pendingApprovals.delete(id);
  return true;
}

export function listPendingApprovals(): Array<{ id: string; command: string; timestamp: number }> {
  return [...pendingApprovals.values()].map(({ id, command, timestamp }) => ({ id, command, timestamp }));
}

// ══════════════════════════════════════════════
// ── Prompt Injection Detection ──
// ══════════════════════════════════════════════

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*prompt\s*[:=]/i,
  /\bDAN\b.*mode/i,
  /jailbreak/i,
  /bypass\s+(your\s+)?restrictions/i,
  /override\s+(your\s+)?safety/i,
  /pretend\s+you\s+(are|have)/i,
  /act\s+as\s+(if|though)\s+you/i,
  /forget\s+(your|all|previous)/i,
];

export function detectInjection(text: string): { detected: boolean; patterns: string[] } {
  const matched: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) matched.push(pattern.source);
  }
  return { detected: matched.length > 0, patterns: matched };
}

export function wrapUntrustedContent(content: string, source: string): string {
  return `<<<EXTERNAL_UNTRUSTED_CONTENT source="${source}">>>\n${content}\n<<<END_UNTRUSTED_CONTENT>>>`;
}

// ══════════════════════════════════════════════
// ── Sanitization ──
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// ── Exec Allowlist (auto-allow after repeated approvals) ──
// ══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const AUTO_ALLOW_THRESHOLD = 3;
const allowlistPath = () => {
  const { resolveConfigDir } = require("./config/paths.js");
  return path.join(resolveConfigDir(), "exec-allowlist.json");
};

interface AllowlistEntry { pattern: string; approvalCount: number; autoAllowed: boolean }
let allowlist: AllowlistEntry[] | null = null;

function loadAllowlist(): AllowlistEntry[] {
  if (allowlist) return allowlist;
  try {
    allowlist = JSON.parse(fs.readFileSync(allowlistPath(), "utf-8"));
    return allowlist!;
  } catch { allowlist = []; return allowlist; }
}

function saveAllowlist(): void {
  try {
    fs.mkdirSync(path.dirname(allowlistPath()), { recursive: true });
    fs.writeFileSync(allowlistPath(), JSON.stringify(loadAllowlist(), null, 2));
  } catch {}
}

function commandPrefix(cmd: string): string {
  return cmd.split(/\s+/).slice(0, 2).join(" ");
}

export function isCommandAllowed(command: string): boolean {
  const prefix = commandPrefix(command);
  return loadAllowlist().some((e) => e.autoAllowed && (e.pattern === command || e.pattern === prefix));
}

export function trackApproval(command: string): void {
  const prefix = commandPrefix(command);
  const list = loadAllowlist();
  let entry = list.find((e) => e.pattern === prefix);
  if (!entry) { entry = { pattern: prefix, approvalCount: 0, autoAllowed: false }; list.push(entry); }
  entry.approvalCount++;
  if (entry.approvalCount >= AUTO_ALLOW_THRESHOLD) {
    entry.autoAllowed = true;
    log.info(`Auto-allowed exec pattern: "${prefix}" (${entry.approvalCount} approvals)`);
  }
  saveAllowlist();
}

// ══════════════════════════════════════════════
// ── Sanitization ──
// ══════════════════════════════════════════════

export function sanitizeForLog(text: string, maxLen = 500): string {
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "..." : cleaned;
}

export function sanitizePath(inputPath: string, workspaceDir: string): { safe: boolean; resolved: string } {
  const { resolve, relative } = require("node:path");
  const resolved = resolve(workspaceDir, inputPath);
  const rel = relative(workspaceDir, resolved);
  const safe = !rel.startsWith("..") && !resolve(resolved).includes("\0");
  return { safe, resolved };
}
