import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validatePluginId,
  installPluginFromFile,
  installPluginFromDir,
  installPluginFromPath,
} from "../../src/plugin/install.js";
import { recordPluginInstall } from "../../src/plugin/installs.js";
import type { TinyClawConfig } from "../../src/config/schema.js";

describe("validatePluginId", () => {
  it("rejects empty string", () => {
    expect(validatePluginId("")).toBe("invalid plugin name: missing");
  });

  it("rejects dot segments", () => {
    expect(validatePluginId(".")).toContain("reserved path segment");
    expect(validatePluginId("..")).toContain("reserved path segment");
  });

  it("rejects path separators", () => {
    expect(validatePluginId("foo/bar")).toContain("path separators");
    expect(validatePluginId("foo\\bar")).toContain("path separators");
  });

  it("rejects illegal chars", () => {
    expect(validatePluginId("foo<bar")).toContain("illegal characters");
  });

  it("accepts valid names", () => {
    expect(validatePluginId("my-plugin")).toBeNull();
    expect(validatePluginId("plugin_v2")).toBeNull();
    expect(validatePluginId("@scope__name")).toBeNull();
  });
});

describe("installPluginFromFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinyclaw-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies a single file", async () => {
    const srcFile = path.join(tmpDir, "my-plugin.ts");
    await fs.writeFile(srcFile, "export default function init() {}");
    const destDir = path.join(tmpDir, "plugins");

    const result = await installPluginFromFile({
      filePath: srcFile,
      extensionsDir: destDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginId).toBe("my-plugin");
      expect(fsSync.existsSync(result.targetDir)).toBe(true);
    }
  });

  it("rejects missing file", async () => {
    const result = await installPluginFromFile({
      filePath: path.join(tmpDir, "nonexistent.ts"),
      extensionsDir: path.join(tmpDir, "plugins"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  it("rejects duplicate install", async () => {
    const srcFile = path.join(tmpDir, "dup.ts");
    await fs.writeFile(srcFile, "export default function() {}");
    const destDir = path.join(tmpDir, "plugins");

    const first = await installPluginFromFile({ filePath: srcFile, extensionsDir: destDir });
    expect(first.ok).toBe(true);

    const second = await installPluginFromFile({ filePath: srcFile, extensionsDir: destDir });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already exists");
  });

  it("supports dry-run", async () => {
    const srcFile = path.join(tmpDir, "dry.ts");
    await fs.writeFile(srcFile, "export default function() {}");
    const destDir = path.join(tmpDir, "plugins");

    const result = await installPluginFromFile({
      filePath: srcFile,
      extensionsDir: destDir,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginId).toBe("dry");
      expect(fsSync.existsSync(result.targetDir)).toBe(false);
    }
  });
});

describe("installPluginFromDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinyclaw-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies a directory", async () => {
    const srcDir = path.join(tmpDir, "test-plugin");
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, "index.ts"), "export default function() {}");
    await fs.writeFile(path.join(srcDir, "package.json"), JSON.stringify({ name: "test-plugin", version: "1.0.0" }));
    const destDir = path.join(tmpDir, "plugins");

    const result = await installPluginFromDir({
      dirPath: srcDir,
      extensionsDir: destDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginId).toBe("test-plugin");
      expect(result.version).toBe("1.0.0");
      expect(fsSync.existsSync(path.join(result.targetDir, "index.ts"))).toBe(true);
    }
  });

  it("uses directory name if no package.json", async () => {
    const srcDir = path.join(tmpDir, "my-dir-plugin");
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, "init.js"), "module.exports = function() {}");
    const destDir = path.join(tmpDir, "plugins");

    const result = await installPluginFromDir({
      dirPath: srcDir,
      extensionsDir: destDir,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pluginId).toBe("my-dir-plugin");
  });
});

describe("installPluginFromPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tinyclaw-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("auto-detects file", async () => {
    const srcFile = path.join(tmpDir, "auto-plugin.ts");
    await fs.writeFile(srcFile, "export default function() {}");

    const result = await installPluginFromPath({
      path: srcFile,
      extensionsDir: path.join(tmpDir, "plugins"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pluginId).toBe("auto-plugin");
  });

  it("auto-detects directory", async () => {
    const srcDir = path.join(tmpDir, "dir-auto-plugin");
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, "index.ts"), "export default function() {}");

    const result = await installPluginFromPath({
      path: srcDir,
      extensionsDir: path.join(tmpDir, "plugins"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pluginId).toBe("dir-auto-plugin");
  });

  it("returns error for non-existent path", async () => {
    const result = await installPluginFromPath({
      path: "/nonexistent/path",
      extensionsDir: path.join(tmpDir, "plugins"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });
});

describe("recordPluginInstall", () => {
  it("records install info in config", () => {
    const cfg: TinyClawConfig = { agent: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", thinkingLevel: "off" } };
    const updated = recordPluginInstall(cfg, {
      pluginId: "my-plugin",
      source: "npm",
      spec: "my-plugin@1.0.0",
      installPath: "/path/to/plugin",
      version: "1.0.0",
    });
    expect(updated.plugins?.installs?.["my-plugin"]).toBeDefined();
    expect(updated.plugins?.installs?.["my-plugin"]?.source).toBe("npm");
    expect(updated.plugins?.installs?.["my-plugin"]?.version).toBe("1.0.0");
    expect(updated.plugins?.installs?.["my-plugin"]?.installedAt).toBeDefined();
  });

  it("preserves existing installs", () => {
    const cfg: TinyClawConfig = {
      agent: { provider: "anthropic", model: "test", thinkingLevel: "off" },
      plugins: { installs: { existing: { source: "path" as const, installPath: "/old", installedAt: "2025-01-01" } } },
    };
    const updated = recordPluginInstall(cfg, {
      pluginId: "new-plugin",
      source: "npm",
      installPath: "/new",
    });
    expect(updated.plugins?.installs?.["existing"]).toBeDefined();
    expect(updated.plugins?.installs?.["new-plugin"]).toBeDefined();
  });
});
