import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TinyClawConfig } from "../../src/config/schema.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock paths
vi.mock("../../src/config/paths.js", () => ({
  resolveMediaDir: () => "/tmp/tinyclaw-test-media",
  ensureDir: vi.fn(),
}));

const { transcribeAudio, processAudioMessage } = await import("../../src/media/media.js");

function makeConfig(transcription?: {
  enabled?: boolean;
  provider?: "openai" | "groq";
  model?: string;
  language?: string;
}, maxBytes?: number): TinyClawConfig {
  return {
    media: {
      concurrency: 2,
      audio: {
        enabled: true,
        ...(maxBytes ? { maxBytes } : {}),
        ...(transcription ? { transcription } : {}),
      },
    },
  } as TinyClawConfig;
}

describe("transcribeAudio", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-123");
    vi.stubEnv("GROQ_API_KEY", "groq-key-456");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("throws when transcription is not enabled", async () => {
    const config = makeConfig();
    const buffer = Buffer.from("fake-audio");
    await expect(transcribeAudio(buffer, config)).rejects.toThrow("not enabled");
  });

  it("throws when transcription config has enabled: false", async () => {
    const config = makeConfig({ enabled: false });
    const buffer = Buffer.from("fake-audio");
    await expect(transcribeAudio(buffer, config)).rejects.toThrow("not enabled");
  });

  it("throws when OPENAI_API_KEY is missing for openai provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const config = makeConfig({ enabled: true, provider: "openai" });
    const buffer = Buffer.from("fake-audio");
    await expect(transcribeAudio(buffer, config)).rejects.toThrow("No OPENAI_API_KEY");
  });

  it("throws when GROQ_API_KEY is missing for groq provider", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const config = makeConfig({ enabled: true, provider: "groq" });
    const buffer = Buffer.from("fake-audio");
    await expect(transcribeAudio(buffer, config)).rejects.toThrow("No GROQ_API_KEY");
  });

  it("calls OpenAI transcription API with correct parameters", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: FormData | null = null;

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers ?? {})
      ) as Record<string, string>;
      capturedBody = init.body;
      return new Response(JSON.stringify({ text: "Hello world", language: "en", duration: 2.5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const config = makeConfig({ enabled: true, provider: "openai", model: "whisper-1", language: "en" });
    // MP3 header (ID3)
    const mp3Buffer = Buffer.from("ID3" + "\x00".repeat(100));
    const result = await transcribeAudio(mp3Buffer, config);

    expect(capturedUrl).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(capturedHeaders.Authorization).toBe("Bearer test-key-123");
    expect(result.text).toBe("Hello world");
    expect(result.language).toBe("en");
    expect(result.duration).toBe(2.5);
  });

  it("calls Groq transcription API when provider is groq", async () => {
    let capturedUrl = "";

    globalThis.fetch = vi.fn(async (url: any) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ text: "Groq transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const config = makeConfig({ enabled: true, provider: "groq", model: "whisper-large-v3" });
    const buffer = Buffer.from("fake-audio-data");
    const result = await transcribeAudio(buffer, config);

    expect(capturedUrl).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(result.text).toBe("Groq transcript");
  });

  it("throws on API error with status and body", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Rate limit exceeded", { status: 429 });
    }) as any;

    const config = makeConfig({ enabled: true });
    const buffer = Buffer.from("fake-audio");
    await expect(transcribeAudio(buffer, config)).rejects.toThrow("Transcription API 429");
  });
});

describe("processAudioMessage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-123");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("returns not-enabled message when transcription is disabled", async () => {
    const config = makeConfig();
    const buffer = Buffer.from("fake-audio");
    const result = await processAudioMessage(buffer, config);
    expect(result).toContain("transcription not enabled");
  });

  it("returns too-large message when buffer exceeds maxBytes", async () => {
    const config = makeConfig({ enabled: true }, 100);
    const buffer = Buffer.alloc(200);
    const result = await processAudioMessage(buffer, config);
    expect(result).toContain("Audio too large");
    expect(result).toContain("exceeds limit");
  });

  it("returns formatted transcript on success", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: "This is a test", duration: 5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const config = makeConfig({ enabled: true });
    const buffer = Buffer.from("fake-audio");
    const result = await processAudioMessage(buffer, config);
    expect(result).toContain("[Audio transcript");
    expect(result).toContain("5s");
    expect(result).toContain("This is a test");
  });

  it("returns empty-speech message on blank transcript", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: "  " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const config = makeConfig({ enabled: true });
    const buffer = Buffer.from("fake-audio");
    const result = await processAudioMessage(buffer, config);
    expect(result).toContain("no speech detected");
  });

  it("returns error message on transcription failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Server Error", { status: 500 });
    }) as any;

    const config = makeConfig({ enabled: true });
    const buffer = Buffer.from("fake-audio");
    const result = await processAudioMessage(buffer, config);
    expect(result).toContain("transcription failed");
    expect(result).toContain("500");
  });
});
