// DM Pairing / Unknown Sender Security
// JSON5 file persistence for allow-list and pairing codes

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSON5 from "json5";
import { resolveConfigDir, ensureDir } from "./config/paths.js";
import { log } from "./utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface PairingRequest {
  code: string;
  channelId: string;
  peerId: string;
  peerName?: string;
  createdAt: number;
  expiresAt: number;
}

interface AllowEntry {
  channelId: string;
  peerId: string;
  approvedAt: number;
  approvedVia?: string; // "pairing" | "manual"
}

interface PairingData {
  pending: PairingRequest[];
  allowed: AllowEntry[];
}

// ══════════════════════════════════════════════
// ── Code Generation ──
// ══════════════════════════════════════════════

// No ambiguous chars: 0/O, 1/I/L removed
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_PENDING_PER_CHANNEL = 3;
const TTL_MS = 60 * 60 * 1000; // 1 hour

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes)
    .map((b) => CODE_CHARS[b % CODE_CHARS.length])
    .join("");
}

// ══════════════════════════════════════════════
// ── Pairing Store ──
// ══════════════════════════════════════════════

export class PairingStore {
  private data: PairingData = { pending: [], allowed: [] };
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(resolveConfigDir(), "pairing.json5");
    this.load();
  }

  // ── Persistence ──

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.data = JSON5.parse(raw);
        this.pruneExpired();
      }
    } catch (err) {
      log.warn(`Failed to load pairing data: ${err}`);
      this.data = { pending: [], allowed: [] };
    }
  }

  private save(): void {
    try {
      ensureDir(path.dirname(this.filePath));
      fs.writeFileSync(this.filePath, JSON5.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      log.error(`Failed to save pairing data: ${err}`);
    }
  }

  // ── Pairing Requests ──

  createRequest(channelId: string, peerId: string, peerName?: string): PairingRequest {
    this.pruneExpired();

    // Limit pending per channel
    const channelPending = this.data.pending.filter((r) => r.channelId === channelId);
    if (channelPending.length >= MAX_PENDING_PER_CHANNEL) {
      // Remove oldest
      const oldest = channelPending.sort((a, b) => a.createdAt - b.createdAt)[0];
      this.data.pending = this.data.pending.filter((r) => r.code !== oldest.code);
    }

    // Check if there's already a pending request for this peer
    const existing = this.data.pending.find(
      (r) => r.channelId === channelId && r.peerId === peerId,
    );
    if (existing && existing.expiresAt > Date.now()) {
      return existing;
    }

    // Remove expired existing
    if (existing) {
      this.data.pending = this.data.pending.filter((r) => r !== existing);
    }

    const request: PairingRequest = {
      code: generateCode(),
      channelId,
      peerId,
      peerName,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    };

    this.data.pending.push(request);
    this.save();
    log.info(`Pairing request created for ${channelId}/${peerId}: ${request.code}`);
    return request;
  }

  approveCode(code: string): { channelId: string; peerId: string } | null {
    const upperCode = code.toUpperCase();
    const idx = this.data.pending.findIndex((r) => r.code === upperCode);
    if (idx < 0) return null;

    const request = this.data.pending[idx];

    // Check expiry
    if (request.expiresAt < Date.now()) {
      this.data.pending.splice(idx, 1);
      this.save();
      return null;
    }

    // Move to allowed
    this.data.pending.splice(idx, 1);
    this.data.allowed.push({
      channelId: request.channelId,
      peerId: request.peerId,
      approvedAt: Date.now(),
      approvedVia: "pairing",
    });

    this.save();
    log.info(`Pairing approved for ${request.channelId}/${request.peerId}`);
    return { channelId: request.channelId, peerId: request.peerId };
  }

  // ── Allow List ──

  isAllowed(channelId: string, peerId: string): boolean {
    return this.data.allowed.some(
      (e) => e.channelId === channelId && e.peerId === peerId,
    );
  }

  addAllowed(channelId: string, peerId: string): void {
    if (this.isAllowed(channelId, peerId)) return;
    this.data.allowed.push({
      channelId,
      peerId,
      approvedAt: Date.now(),
      approvedVia: "manual",
    });
    this.save();
  }

  revokeAccess(channelId: string, peerId: string): boolean {
    const before = this.data.allowed.length;
    this.data.allowed = this.data.allowed.filter(
      (e) => !(e.channelId === channelId && e.peerId === peerId),
    );
    if (this.data.allowed.length < before) {
      this.save();
      log.info(`Access revoked for ${channelId}/${peerId}`);
      return true;
    }
    return false;
  }

  // ── Queries ──

  listPending(): PairingRequest[] {
    this.pruneExpired();
    return [...this.data.pending];
  }

  listAllowed(): AllowEntry[] {
    return [...this.data.allowed];
  }

  // ── Cleanup ──

  pruneExpired(): void {
    const now = Date.now();
    const before = this.data.pending.length;
    this.data.pending = this.data.pending.filter((r) => r.expiresAt > now);
    if (this.data.pending.length < before) {
      this.save();
    }
  }
}

// ══════════════════════════════════════════════
// ── Singleton Store ──
// ══════════════════════════════════════════════

let _store: PairingStore | undefined;

export function getPairingStore(): PairingStore {
  if (!_store) _store = new PairingStore();
  return _store;
}

export function initPairingStore(filePath?: string): PairingStore {
  _store = new PairingStore(filePath);
  return _store;
}
