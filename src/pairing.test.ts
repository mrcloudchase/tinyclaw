import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{"pending":[],"allowed":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("node:crypto", () => ({
  default: {
    randomBytes: vi.fn((n: number) => Buffer.alloc(n, 5)),
  },
}));

vi.mock("./config/paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  ensureDir: vi.fn(),
}));

vi.mock("./utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { PairingStore } from "./pairing.js";

describe("PairingStore", () => {
  let store: PairingStore;

  beforeEach(() => {
    store = new PairingStore("/tmp/test-pairing.json5");
  });

  it("creates pairing request with code", () => {
    const request = store.createRequest("telegram", "user123", "TestUser");
    expect(request.code).toHaveLength(8);
    expect(request.channelId).toBe("telegram");
    expect(request.peerId).toBe("user123");
    expect(request.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns existing request for same peer", () => {
    const first = store.createRequest("telegram", "user123");
    const second = store.createRequest("telegram", "user123");
    expect(first.code).toBe(second.code);
  });

  it("approves valid code", () => {
    const request = store.createRequest("telegram", "user456");
    const result = store.approveCode(request.code);
    expect(result).not.toBeNull();
    expect(result?.channelId).toBe("telegram");
    expect(result?.peerId).toBe("user456");
  });

  it("returns null for invalid code", () => {
    expect(store.approveCode("INVALID1")).toBeNull();
  });

  it("checks allow list after approval", () => {
    expect(store.isAllowed("telegram", "user789")).toBe(false);
    const request = store.createRequest("telegram", "user789");
    store.approveCode(request.code);
    expect(store.isAllowed("telegram", "user789")).toBe(true);
  });

  it("manually adds to allow list", () => {
    store.addAllowed("discord", "manual-user");
    expect(store.isAllowed("discord", "manual-user")).toBe(true);
  });

  it("does not duplicate manual allow entries", () => {
    store.addAllowed("discord", "dup-user");
    store.addAllowed("discord", "dup-user");
    expect(store.listAllowed().filter((e) => e.peerId === "dup-user")).toHaveLength(1);
  });

  it("revokes access", () => {
    store.addAllowed("slack", "revoke-user");
    expect(store.isAllowed("slack", "revoke-user")).toBe(true);
    const revoked = store.revokeAccess("slack", "revoke-user");
    expect(revoked).toBe(true);
    expect(store.isAllowed("slack", "revoke-user")).toBe(false);
  });

  it("returns false when revoking non-existent access", () => {
    expect(store.revokeAccess("slack", "nonexistent")).toBe(false);
  });

  it("lists pending requests", () => {
    store.createRequest("telegram", "p1");
    store.createRequest("telegram", "p2");
    const pending = store.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it("case-insensitive code approval", () => {
    const request = store.createRequest("telegram", "case-user");
    const result = store.approveCode(request.code.toLowerCase());
    expect(result).not.toBeNull();
  });

  it("limits pending requests per channel", () => {
    // MAX_PENDING_PER_CHANNEL = 3
    store.createRequest("whatsapp", "user-a");
    store.createRequest("whatsapp", "user-b");
    store.createRequest("whatsapp", "user-c");
    store.createRequest("whatsapp", "user-d"); // should evict oldest
    const pending = store.listPending().filter((r) => r.channelId === "whatsapp");
    expect(pending.length).toBeLessThanOrEqual(3);
  });
});
