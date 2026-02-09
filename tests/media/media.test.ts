import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("../../src/config/paths.js", () => ({
  resolveMediaDir: () => "/mock/.config/tinyclaw/media",
  ensureDir: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { detectMime, isImage, isAudio, isVideo, detectAudioFormat } from "../../src/media/media.js";

describe("detectMime", () => {
  it("detects image types", () => {
    expect(detectMime("photo.jpg")).toBe("image/jpeg");
    expect(detectMime("photo.jpeg")).toBe("image/jpeg");
    expect(detectMime("image.png")).toBe("image/png");
    expect(detectMime("anim.gif")).toBe("image/gif");
    expect(detectMime("modern.webp")).toBe("image/webp");
    expect(detectMime("vector.svg")).toBe("image/svg+xml");
  });

  it("detects audio types", () => {
    expect(detectMime("song.mp3")).toBe("audio/mpeg");
    expect(detectMime("sound.wav")).toBe("audio/wav");
    expect(detectMime("track.ogg")).toBe("audio/ogg");
    expect(detectMime("music.flac")).toBe("audio/flac");
    expect(detectMime("voice.m4a")).toBe("audio/mp4");
  });

  it("detects video types", () => {
    expect(detectMime("clip.mp4")).toBe("video/mp4");
    expect(detectMime("stream.webm")).toBe("video/webm");
  });

  it("detects document types", () => {
    expect(detectMime("doc.pdf")).toBe("application/pdf");
    expect(detectMime("data.json")).toBe("application/json");
  });

  it("returns octet-stream for unknown", () => {
    expect(detectMime("file.xyz")).toBe("application/octet-stream");
    expect(detectMime("noext")).toBe("application/octet-stream");
  });

  it("handles uppercase extensions", () => {
    expect(detectMime("PHOTO.JPG")).toBe("image/jpeg");
    expect(detectMime("VIDEO.MP4")).toBe("video/mp4");
  });
});

describe("isImage / isAudio / isVideo", () => {
  it("isImage returns true for image MIME types", () => {
    expect(isImage("image/jpeg")).toBe(true);
    expect(isImage("image/png")).toBe(true);
    expect(isImage("audio/mpeg")).toBe(false);
  });

  it("isAudio returns true for audio MIME types", () => {
    expect(isAudio("audio/mpeg")).toBe(true);
    expect(isAudio("audio/wav")).toBe(true);
    expect(isAudio("image/png")).toBe(false);
  });

  it("isVideo returns true for video MIME types", () => {
    expect(isVideo("video/mp4")).toBe(true);
    expect(isVideo("video/webm")).toBe(true);
    expect(isVideo("audio/mp4")).toBe(false);
  });
});

describe("detectAudioFormat", () => {
  it("detects MP3 with sync bytes", () => {
    const buf = Buffer.from([0xFF, 0xFB, 0x90, 0x00]);
    expect(detectAudioFormat(buf)).toBe("mp3");
  });

  it("detects MP3 with ID3 header", () => {
    const buf = Buffer.from("ID3\x04\x00\x00\x00\x00", "ascii");
    expect(detectAudioFormat(buf)).toBe("mp3");
  });

  it("detects WAV (RIFF header)", () => {
    const buf = Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt ", "ascii");
    expect(detectAudioFormat(buf)).toBe("wav");
  });

  it("detects OGG", () => {
    const buf = Buffer.from("OggS\x00\x02\x00\x00", "ascii");
    expect(detectAudioFormat(buf)).toBe("ogg");
  });

  it("detects FLAC", () => {
    const buf = Buffer.from("fLaC\x00\x00\x00\x22", "ascii");
    expect(detectAudioFormat(buf)).toBe("flac");
  });

  it("detects M4A (ftyp at offset 4)", () => {
    const buf = Buffer.alloc(12);
    buf.write("ftyp", 4, "ascii");
    expect(detectAudioFormat(buf)).toBe("m4a");
  });

  it("returns undefined for unknown format", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(detectAudioFormat(buf)).toBeUndefined();
  });

  it("returns undefined for too-short buffer", () => {
    const buf = Buffer.from([0xFF, 0xFB]);
    expect(detectAudioFormat(buf)).toBeUndefined();
  });
});
