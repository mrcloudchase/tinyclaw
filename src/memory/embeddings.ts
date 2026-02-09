// Embedding Generation — OpenAI text-embedding-3-small with caching

import { createHash } from "node:crypto";
import { log } from "../utils/logger.js";

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

// In-memory cache (SHA256 → embedding)
const embeddingCache = new Map<string, number[]>();

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function generateEmbeddings(
  texts: string[],
  options?: { model?: string; apiKey?: string },
): Promise<number[][]> {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.debug("No OPENAI_API_KEY, skipping embedding generation");
    return texts.map(() => []);
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const results: number[][] = new Array(texts.length);
  const uncached: Array<{ idx: number; text: string }> = [];

  // Check cache
  for (let i = 0; i < texts.length; i++) {
    const hash = textHash(texts[i]);
    const cached = embeddingCache.get(hash);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push({ idx: i, text: texts[i] });
    }
  }

  // Batch API calls for uncached
  for (let b = 0; b < uncached.length; b += BATCH_SIZE) {
    const batch = uncached.slice(b, b + BATCH_SIZE);
    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: batch.map((b) => b.text) }),
      });

      if (!response.ok) {
        log.warn(`Embedding API error: ${response.status} ${response.statusText}`);
        for (const item of batch) results[item.idx] = [];
        continue;
      }

      const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
      for (let i = 0; i < data.data.length; i++) {
        const embedding = data.data[i].embedding;
        const item = batch[i];
        results[item.idx] = embedding;
        embeddingCache.set(textHash(item.text), embedding);
      }

      log.debug(`Generated ${batch.length} embeddings`);
    } catch (err) {
      log.warn(`Embedding generation failed: ${err}`);
      for (const item of batch) results[item.idx] = [];
    }
  }

  // Cap cache size
  if (embeddingCache.size > 10000) {
    const keys = [...embeddingCache.keys()];
    for (let i = 0; i < 5000; i++) embeddingCache.delete(keys[i]);
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
