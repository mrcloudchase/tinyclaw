import { describe, it, expect, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createCodingTools: vi.fn(() => [
    { name: "read" },
    { name: "write" },
    { name: "edit" },
    { name: "bash" },
    { name: "grep" },
    { name: "glob" },
  ]),
}));

vi.mock("../exec/exec-tool.js", () => ({
  createExecTool: vi.fn(() => ({ name: "bash", execute: vi.fn() })),
}));

vi.mock("../tools/web.js", () => ({
  createWebSearchTool: vi.fn(() => ({ name: "web_search" })),
  createWebFetchTool: vi.fn(() => ({ name: "web_fetch" })),
}));

vi.mock("../utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { normalizeToolParams, checkToolLimit } from "./tools.js";
import type { TinyClawConfig } from "../config/schema.js";

describe("normalizeToolParams", () => {
  it("maps file_path to path for read", () => {
    const result = normalizeToolParams("read", { file_path: "/test/file.ts" });
    expect(result.path).toBe("/test/file.ts");
    expect(result.file_path).toBeUndefined();
  });

  it("maps filePath to path for write", () => {
    const result = normalizeToolParams("write", { filePath: "/test/file.ts", content: "hello" });
    expect(result.path).toBe("/test/file.ts");
    expect(result.filePath).toBeUndefined();
  });

  it("maps old_string/new_string for edit", () => {
    const result = normalizeToolParams("edit", {
      file_path: "/test.ts",
      old_string: "foo",
      new_string: "bar",
    });
    expect(result.path).toBe("/test.ts");
    expect(result.oldText).toBe("foo");
    expect(result.newText).toBe("bar");
  });

  it("maps oldString/newString for edit", () => {
    const result = normalizeToolParams("edit", {
      filePath: "/test.ts",
      oldString: "foo",
      newString: "bar",
    });
    expect(result.path).toBe("/test.ts");
    expect(result.oldText).toBe("foo");
    expect(result.newText).toBe("bar");
  });

  it("does not overwrite existing canonical param", () => {
    const result = normalizeToolParams("read", {
      path: "/canonical",
      file_path: "/alias",
    });
    expect(result.path).toBe("/canonical");
  });

  it("returns params unchanged for unknown tools", () => {
    const params = { custom: "value" };
    expect(normalizeToolParams("custom_tool", params)).toEqual(params);
  });
});

describe("checkToolLimit", () => {
  it("returns true when under limit", () => {
    const config: TinyClawConfig = {
      security: {
        maxToolCallsPerTurn: 10,
        toolPolicy: "auto",
        ssrfProtection: true,
        execApproval: "auto",
        pairingRequired: false,
      },
    };
    expect(checkToolLimit(5, config)).toBe(true);
  });

  it("returns false when at limit", () => {
    const config: TinyClawConfig = {
      security: {
        maxToolCallsPerTurn: 10,
        toolPolicy: "auto",
        ssrfProtection: true,
        execApproval: "auto",
        pairingRequired: false,
      },
    };
    expect(checkToolLimit(10, config)).toBe(false);
  });

  it("uses default limit of 50", () => {
    const config: TinyClawConfig = {};
    expect(checkToolLimit(49, config)).toBe(true);
    expect(checkToolLimit(50, config)).toBe(false);
  });
});
