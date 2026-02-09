// TTS System — Edge + OpenAI + ElevenLabs providers, talk modes, auto-summarize
// All in ONE file

import type { TinyClawConfig } from "../config/schema.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface TtsResult {
  audio: Buffer;
  format: string;
  duration?: number;
  provider: string;
}

export type TtsProvider = "edge" | "openai" | "elevenlabs";

// ══════════════════════════════════════════════
// ── Provider Implementations ──
// ══════════════════════════════════════════════

async function synthesizeEdge(text: string, config: TinyClawConfig): Promise<TtsResult> {
  try {
    const edgeTts = require("edge-tts");
    const voice = config.tts?.edge?.voice ?? "en-US-AriaNeural";
    const format = config.tts?.edge?.outputFormat ?? "audio-24khz-48kbitrate-mono-mp3";
    const communicate = new edgeTts.Communicate(text, voice);
    const chunks: Buffer[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === "audio") chunks.push(chunk.data);
    }
    return { audio: Buffer.concat(chunks), format: "mp3", provider: "edge" };
  } catch (err) {
    throw new Error(`Edge TTS failed: ${err}. Install with: npm install edge-tts`);
  }
}

async function synthesizeOpenAI(text: string, config: TinyClawConfig): Promise<TtsResult> {
  const apiKey = config.tts?.openai?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI TTS requires OPENAI_API_KEY");
  const model = config.tts?.openai?.model ?? "tts-1";
  const voice = config.tts?.openai?.voice ?? "alloy";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS error: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { audio: buffer, format: "mp3", provider: "openai" };
}

async function synthesizeElevenLabs(text: string, config: TinyClawConfig): Promise<TtsResult> {
  const apiKey = config.tts?.elevenlabs?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ElevenLabs TTS requires ELEVENLABS_API_KEY");
  const voiceId = config.tts?.elevenlabs?.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
  const modelId = config.tts?.elevenlabs?.modelId ?? "eleven_monolingual_v1";

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS error: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { audio: buffer, format: "mp3", provider: "elevenlabs" };
}

// ══════════════════════════════════════════════
// ── Main TTS Function ──
// ══════════════════════════════════════════════

export async function synthesize(text: string, config: TinyClawConfig): Promise<TtsResult> {
  const maxLen = config.tts?.maxTextLength ?? 4096;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  const provider = config.tts?.provider ?? "edge";
  const timeoutMs = config.tts?.timeoutMs ?? 30000;

  log.debug(`TTS: synthesizing ${truncated.length} chars via ${provider}`);

  const promise = provider === "openai" ? synthesizeOpenAI(truncated, config)
    : provider === "elevenlabs" ? synthesizeElevenLabs(truncated, config)
    : synthesizeEdge(truncated, config);

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`TTS timeout (${timeoutMs}ms)`)), timeoutMs)),
  ]);
}

// ══════════════════════════════════════════════
// ── Auto-Summarize for TTS ──
// ══════════════════════════════════════════════

export function shouldAutoTts(config: TinyClawConfig, isInbound: boolean): boolean {
  const auto = config.tts?.auto ?? "off";
  if (auto === "always") return true;
  if (auto === "inbound" && isInbound) return true;
  return false;
}

export function summarizeForTts(text: string, maxLen = 1000): string {
  if (text.length <= maxLen) return text;
  // Take first paragraph or first N characters
  const firstPara = text.split(/\n\n/)[0];
  if (firstPara && firstPara.length <= maxLen) return firstPara;
  return text.slice(0, maxLen) + "...";
}
