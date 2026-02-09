import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { defineTool } from "./helper.js";

let canvasContent = "";
let canvasTitle = "";

export function createCanvasTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "canvas", description: "Create or update a canvas (shared document/note).",
    parameters: { type: "object", properties: { action: { type: "string", enum: ["create", "update", "append", "clear", "get"] }, title: { type: "string" }, content: { type: "string" } }, required: ["action"] },
    async execute(args: { action: string; title?: string; content?: string }) {
      switch (args.action) {
        case "create": canvasTitle = args.title ?? "Untitled"; canvasContent = args.content ?? ""; return `Canvas "${canvasTitle}" created.`;
        case "update": canvasContent = args.content ?? canvasContent; if (args.title) canvasTitle = args.title; return "Canvas updated.";
        case "append": canvasContent += (args.content ?? ""); return "Appended.";
        case "clear": canvasContent = ""; return "Cleared.";
        case "get": return canvasContent ? `# ${canvasTitle}\n\n${canvasContent}` : "Canvas is empty.";
        default: return "Unknown action.";
      }
    },
  });
}
