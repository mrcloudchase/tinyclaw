import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { synthesize } from "../tts/tts.js";
import { saveMediaFile } from "../media/media.js";
import { defineTool } from "./helper.js";

export function createTtsTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "tts", description: "Convert text to speech audio. Returns path to the generated audio file.",
    parameters: { type: "object", properties: { text: { type: "string" }, provider: { type: "string", enum: ["edge", "openai", "elevenlabs"] } }, required: ["text"] },
    async execute(args: { text: string; provider?: string }) {
      const cfg = args.provider ? { ...config, tts: { ...config.tts, enabled: true, auto: "off" as const, mode: "final" as const, provider: args.provider as "edge" | "openai" | "elevenlabs", maxTextLength: config.tts?.maxTextLength ?? 4096, timeoutMs: config.tts?.timeoutMs ?? 30000 } } : config;
      const result = await synthesize(args.text, cfg);
      const filePath = saveMediaFile(result.audio, `tts_${Date.now()}.${result.format}`, config);
      return `Audio: ${filePath} (${result.provider}, ${result.audio.length} bytes)`;
    },
  });
}
