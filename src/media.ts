// Media System — Image processing + MIME detection + audio format + AI vision
// All in ONE file

import fs from "node:fs";
import path from "node:path";
import type { TinyClawConfig } from "./config/schema.js";
import { resolveMediaDir, ensureDir } from "./config/paths.js";
import { log } from "./util/logger.js";

// ══════════════════════════════════════════════
// ── MIME Detection ──
// ══════════════════════════════════════════════

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".opus": "audio/opus",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".pdf": "application/pdf", ".json": "application/json",
  ".txt": "text/plain", ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
};

export function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export function isImage(mime: string): boolean { return mime.startsWith("image/"); }
export function isAudio(mime: string): boolean { return mime.startsWith("audio/"); }
export function isVideo(mime: string): boolean { return mime.startsWith("video/"); }

// ══════════════════════════════════════════════
// ── Audio Format Detection ──
// ══════════════════════════════════════════════

export function detectAudioFormat(buffer: Buffer): string | undefined {
  if (buffer.length < 4) return undefined;
  // MP3: starts with 0xFF 0xFB or ID3
  if ((buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) || buffer.toString("ascii", 0, 3) === "ID3") return "mp3";
  // WAV: RIFF header
  if (buffer.toString("ascii", 0, 4) === "RIFF") return "wav";
  // OGG
  if (buffer.toString("ascii", 0, 4) === "OggS") return "ogg";
  // FLAC
  if (buffer.toString("ascii", 0, 4) === "fLaC") return "flac";
  // M4A/MP4
  if (buffer.toString("ascii", 4, 8) === "ftyp") return "m4a";
  return undefined;
}

// ══════════════════════════════════════════════
// ── Image Processing (via sharp) ──
// ══════════════════════════════════════════════

export interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "jpeg" | "png" | "webp";
}

export async function processImage(
  input: Buffer,
  opts: ImageProcessOptions = {},
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
  try {
    const sharp = require("sharp");
    let pipeline = sharp(input);
    const meta = await pipeline.metadata();

    const maxW = opts.maxWidth ?? 2048;
    const maxH = opts.maxHeight ?? 2048;
    if ((meta.width && meta.width > maxW) || (meta.height && meta.height > maxH)) {
      pipeline = pipeline.resize(maxW, maxH, { fit: "inside" });
    }

    const format = opts.format ?? "jpeg";
    const quality = opts.quality ?? 85;
    pipeline = format === "png" ? pipeline.png() : format === "webp" ? pipeline.webp({ quality }) : pipeline.jpeg({ quality });

    const buffer = await pipeline.toBuffer();
    const outMeta = await sharp(buffer).metadata();
    return { buffer, width: outMeta.width ?? 0, height: outMeta.height ?? 0, format };
  } catch (err) {
    log.warn(`sharp not available, returning raw image: ${err}`);
    return { buffer: input, width: 0, height: 0, format: "unknown" };
  }
}

// ══════════════════════════════════════════════
// ── AI Vision Cascade ──
// ══════════════════════════════════════════════

export async function describeImage(
  imageBuffer: Buffer,
  config: TinyClawConfig,
  prompt = "Describe this image concisely.",
): Promise<string> {
  const models = config.media?.image?.models ?? ["anthropic/claude-sonnet-4-5-20250929"];

  for (const modelSpec of models) {
    try {
      const [provider] = modelSpec.split("/");
      if (provider === "anthropic") {
        return await describeWithAnthropic(imageBuffer, modelSpec, prompt);
      }
      if (provider === "openai") {
        return await describeWithOpenAI(imageBuffer, modelSpec, prompt);
      }
    } catch (err) {
      log.warn(`Vision model ${modelSpec} failed: ${err}`);
    }
  }
  return "[Image description unavailable]";
}

async function describeWithAnthropic(image: Buffer, model: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No ANTHROPIC_API_KEY");
  const modelId = model.split("/").slice(1).join("/");
  const b64 = image.toString("base64");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: modelId, max_tokens: 300,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic vision: ${res.status}`);
  const data = await res.json() as any;
  return data.content?.[0]?.text ?? "";
}

async function describeWithOpenAI(image: Buffer, model: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OPENAI_API_KEY");
  const modelId = model.split("/").slice(1).join("/");
  const b64 = image.toString("base64");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId, max_tokens: 300,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI vision: ${res.status}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ══════════════════════════════════════════════
// ── Media Storage ──
// ══════════════════════════════════════════════

export function saveMediaFile(buffer: Buffer, filename: string, config: TinyClawConfig): string {
  const mediaDir = resolveMediaDir();
  ensureDir(mediaDir);
  const filePath = path.join(mediaDir, `${Date.now()}_${filename}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
