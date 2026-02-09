// Gateway HTTP Endpoints — OpenAI-compatible API
// All in ONE file

import type http from "node:http";
import type { TinyClawConfig } from "./config/schema.js";
import type { GatewayContext } from "./gateway.js";
import { dispatch } from "./pipeline.js";

// ══════════════════════════════════════════════
// ── HTTP Request Handler ──
// ══════════════════════════════════════════════

export async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
  ctx: GatewayContext,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const method = req.method?.toUpperCase();

  // Health check
  if (url.pathname === "/health" && method === "GET") {
    json(res, 200, { status: "ok", uptime: Math.round(process.uptime()) });
    return;
  }

  // OpenAI-compatible: POST /v1/chat/completions
  if (url.pathname === "/v1/chat/completions" && method === "POST") {
    if (config.gateway?.http?.chatCompletions === false) {
      json(res, 404, { error: "Endpoint disabled" });
      return;
    }
    await handleChatCompletions(req, res, config);
    return;
  }

  // OpenAI-compatible: POST /v1/responses
  if (url.pathname === "/v1/responses" && method === "POST") {
    if (config.gateway?.http?.responses === false) {
      json(res, 404, { error: "Endpoint disabled" });
      return;
    }
    await handleResponses(req, res, config);
    return;
  }

  // OpenAI-compatible: GET /v1/models
  if (url.pathname === "/v1/models" && method === "GET") {
    if (config.gateway?.http?.models === false) {
      json(res, 404, { error: "Endpoint disabled" });
      return;
    }
    handleModels(res, config);
    return;
  }

  // Not found
  json(res, 404, { error: "Not found", path: url.pathname });
}

// ══════════════════════════════════════════════
// ── POST /v1/chat/completions ──
// ══════════════════════════════════════════════

async function handleChatCompletions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body) { json(res, 400, { error: "Invalid JSON body" }); return; }

  const messages = body.messages as Array<{ role: string; content: string }>;
  if (!messages?.length) { json(res, 400, { error: "Missing messages" }); return; }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) { json(res, 400, { error: "No user message" }); return; }

  const stream = body.stream === true;
  const sessionKey = body.session_key ?? body.user ?? "http";

  if (stream) {
    // SSE streaming
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const result = await dispatch({
      source: "gateway",
      body: lastUserMsg.content,
      config,
      peerId: sessionKey,
      onChunk: (chunk) => {
        const data = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      },
    });

    // Final chunk
    const finalData = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    // Non-streaming
    const result = await dispatch({
      source: "gateway",
      body: lastUserMsg.content,
      config,
      peerId: sessionKey,
    });

    json(res, 200, {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: `${config.agent?.provider}/${config.agent?.model}`,
      choices: [{
        index: 0,
        message: { role: "assistant", content: result.reply ?? result.error ?? "" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

// ══════════════════════════════════════════════
// ── POST /v1/responses ──
// ══════════════════════════════════════════════

async function handleResponses(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: TinyClawConfig,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body) { json(res, 400, { error: "Invalid JSON body" }); return; }

  const input = body.input as string ?? (body.messages as any[])?.[0]?.content;
  if (!input) { json(res, 400, { error: "Missing input" }); return; }

  const result = await dispatch({
    source: "gateway",
    body: typeof input === "string" ? input : JSON.stringify(input),
    config,
    peerId: body.user ?? "http",
  });

  json(res, 200, {
    id: `resp-${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: `${config.agent?.provider}/${config.agent?.model}`,
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: result.reply ?? result.error ?? "" }],
    }],
    status: "completed",
  });
}

// ══════════════════════════════════════════════
// ── GET /v1/models ──
// ══════════════════════════════════════════════

function handleModels(res: http.ServerResponse, config: TinyClawConfig): void {
  const models = [
    {
      id: `${config.agent?.provider}/${config.agent?.model}`,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: config.agent?.provider ?? "anthropic",
    },
  ];

  if (config.models?.providers) {
    for (const [providerId, providerConfig] of Object.entries(config.models.providers)) {
      for (const model of providerConfig.models ?? []) {
        models.push({
          id: `${providerId}/${model.id}`,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: providerId,
        });
      }
    }
  }

  json(res, 200, { object: "list", data: models });
}

// ══════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}
