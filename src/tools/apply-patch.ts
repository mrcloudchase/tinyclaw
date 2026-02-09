import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import fs from "node:fs";
import path from "node:path";
import { defineTool } from "./helper.js";

export function createApplyPatchTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "apply_patch", description: "Apply a unified diff patch to files in the workspace.",
    parameters: { type: "object", properties: { patch: { type: "string" }, cwd: { type: "string" } }, required: ["patch"] },
    async execute(args: { patch: string; cwd?: string }) {
      const workDir = args.cwd ?? config.workspace?.dir ?? process.cwd();
      const patchFile = path.join(workDir, `.tinyclaw_patch_${Date.now()}.diff`);
      fs.writeFileSync(patchFile, args.patch);
      try {
        const { execSync } = require("node:child_process");
        execSync(`git apply --verbose "${patchFile}"`, { cwd: workDir, encoding: "utf-8" });
        fs.unlinkSync(patchFile);
        return "Patch applied successfully.";
      } catch (err) {
        fs.unlinkSync(patchFile);
        return `Patch failed: ${err instanceof Error ? err.message : err}`;
      }
    },
  });
}
