import { describe, it, expect } from "vitest";
import { chunkText } from "./memory.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    const result = chunkText("hello world", 512, 64);
    expect(result).toEqual(["hello world"]);
  });

  it("returns empty text as single chunk", () => {
    const result = chunkText("  hello  ");
    expect(result).toHaveLength(1);
  });

  it("chunks long text into multiple pieces", () => {
    const words = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(words, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should have roughly 100 words (except possibly the last)
    for (let i = 0; i < chunks.length - 1; i++) {
      const wordCount = chunks[i].split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(100);
    }
  });

  it("handles overlap correctly", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkText(words, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // With overlap of 10, consecutive chunks should share some words
    if (chunks.length >= 2) {
      const firstWords = chunks[0].split(/\s+/);
      const secondWords = chunks[1].split(/\s+/);
      // The second chunk should start with some words from the end of the first
      const lastWordsOfFirst = firstWords.slice(-10);
      const firstWordsOfSecond = secondWords.slice(0, 10);
      expect(lastWordsOfFirst.some((w) => firstWordsOfSecond.includes(w))).toBe(true);
    }
  });

  it("returns single chunk for empty string", () => {
    const result = chunkText("");
    // chunkText returns [''] for empty string due to trim() producing empty string
    expect(result).toEqual([""]);
  });

  it("uses default chunk size and overlap", () => {
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
