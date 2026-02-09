import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { saveMediaFile } from "../media/media.js";
import { defineTool } from "./helper.js";

export function createImageTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "image_generate", description: "Generate an image using DALL-E. Returns path to the file.",
    parameters: { type: "object", properties: { prompt: { type: "string" }, size: { type: "string", enum: ["256x256", "512x512", "1024x1024"] } }, required: ["prompt"] },
    async execute(args: { prompt: string; size?: string }) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return "OPENAI_API_KEY not set.";
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "dall-e-3", prompt: args.prompt, size: args.size ?? "1024x1024", n: 1, response_format: "b64_json" }),
        });
        if (!res.ok) return `Failed: ${res.status}`;
        const data = await res.json() as any;
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) return "No image data.";
        const buf = Buffer.from(b64, "base64");
        return `Image: ${saveMediaFile(buf, `img_${Date.now()}.png`, config)}`;
      } catch (err) { return `Error: ${err instanceof Error ? err.message : err}`; }
    },
  });
}
