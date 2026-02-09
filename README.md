# TinyClaw

A full-featured AI assistant platform in ~6,500 lines of TypeScript. Includes a CLI coding agent, gateway server with WebSocket + HTTP API, messaging channels (WhatsApp), plugin system, memory, browser automation, cron scheduling, TTS, and multi-agent orchestration.

## Features

- **CLI Agent** — Interactive REPL and single-shot mode with streaming output
- **Gateway Server** — HTTP + WebSocket server with JSON-RPC 2.0 protocol
- **OpenAI-Compatible API** — `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- **Message Pipeline** — Inbound debouncing, directives (`++think`, `++model`), slash commands, paragraph-aware chunking, delivery with typing indicators
- **WhatsApp Channel** — Full Cloud API integration (webhook, send/receive text/image/audio/video/document/sticker, reactions, media upload/download)
- **Plugin System** — 10 registration methods, 4-origin discovery (bundled, config, directory, install), 33 bundled plugins
- **Security** — 10-layer tool policy engine, SSRF guard, prompt injection detection, path traversal prevention
- **Memory** — SQLite + FTS5 full-text search with optional vector search (sqlite-vec)
- **Browser** — Chrome/CDP automation via playwright-core (navigate, click, type, screenshot, accessibility snapshot)
- **Cron** — Job scheduler with cron expressions, intervals, one-time jobs, catch-up on missed runs
- **TTS** — Three providers (Edge TTS, OpenAI, ElevenLabs) with auto-summarize
- **Media** — MIME detection, image processing (sharp), AI vision (Anthropic/OpenAI), audio format detection
- **Multi-Agent** — Session key routing, agent-channel bindings, subagent spawning, agent-to-agent messaging
- **Model Flexibility** — Anthropic, OpenAI, Google, custom providers, model aliases, fallback chains, multi-key rotation

## Quick Start

```bash
# Install
npm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Single-shot
npx tinyclaw "What is 2+2?"

# Interactive REPL
npx tinyclaw

# Start gateway server
npx tinyclaw serve
```

## CLI Usage

```bash
# Model override
tinyclaw -m anthropic/claude-opus-4-6 "Explain quantum computing"

# Named session
tinyclaw -s myproject "Add error handling to auth.ts"

# Thinking mode
tinyclaw --thinking high "Design a database schema for a blog"

# Ephemeral session (no persistence)
tinyclaw --ephemeral "Quick question"

# Custom working directory
tinyclaw --cwd /path/to/project "Fix the failing tests"

# JSON output
tinyclaw --json "List all TODO items"
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `/new` | Clear session, start fresh |
| `/compact` | Compact context to free token space |
| `/quit` | Exit REPL |

## Gateway Server

```bash
# Start with defaults (port 18789, localhost only)
tinyclaw serve

# Custom port
tinyclaw serve --port 3000

# With config file
tinyclaw serve --config ./tinyclaw.json
```

### WebSocket (JSON-RPC 2.0)

```javascript
const ws = new WebSocket("ws://localhost:18789");

// Send a message
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "chat.send",
  params: { message: "Hello!", sessionKey: "my-session" }
}));

// Stream responses
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "chat.stream",
  params: { message: "Write a poem" }
}));
```

### RPC Methods

| Method | Description |
|--------|-------------|
| `chat.send` | Send message, get complete response |
| `chat.stream` | Send message, stream chunks via events |
| `sessions.list` | List active sessions |
| `sessions.clear` | Clear a specific session |
| `sessions.clearAll` | Clear all sessions |
| `config.get` | Get current config (sanitized) |
| `config.reload` | Hot-reload config file |
| `health` | System health status |
| `channels.list` | List connected channels |
| `channels.send` | Send message via channel |
| `models.list` | List available models |
| `exec.pending` | List pending exec approvals |
| `exec.approve` | Approve a pending exec |
| `exec.deny` | Deny a pending exec |
| `system.shutdown` | Graceful shutdown |

### HTTP API (OpenAI-Compatible)

```bash
# Chat completions
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Streaming
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}], "stream": true}'

# List models
curl http://localhost:18789/v1/models

# Health check
curl http://localhost:18789/health
```

## Configuration

TinyClaw looks for config at `~/.config/tinyclaw/config.json` (or `$XDG_CONFIG_HOME/tinyclaw/config.json`).

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "thinkingLevel": "off",
    "fallbacks": ["openai/gpt-4o"]
  },
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": { "mode": "token", "token": "my-secret" }
  },
  "channels": {
    "whatsapp": {
      "enabled": true,
      "webhookPath": "/webhook/whatsapp",
      "accounts": {
        "main": {
          "phoneNumberId": "123456789",
          "accessTokenEnv": "WHATSAPP_ACCESS_TOKEN",
          "verifyToken": "my-verify-token"
        }
      }
    }
  },
  "security": {
    "toolPolicy": "auto",
    "ssrfProtection": true,
    "execApproval": "auto",
    "maxToolCallsPerTurn": 50
  },
  "memory": {
    "backend": "builtin",
    "embeddingProvider": "openai"
  },
  "tts": {
    "enabled": false,
    "provider": "edge",
    "auto": "off"
  },
  "pipeline": {
    "inboundDebounceMs": 1500,
    "typingIndicator": true,
    "chunkSize": { "min": 800, "max": 1200 },
    "deliveryDelayMs": { "min": 800, "max": 2500 }
  },
  "plugins": {
    "enabled": true,
    "allow": [],
    "deny": []
  }
}
```

## Tools (17 built-in)

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `write` / `edit` / `read` | File operations |
| `glob` / `grep` | File search |
| `browser_navigate` / `browser_click` / `browser_type` / `browser_screenshot` / `browser_snapshot` | Browser automation |
| `web_search` | Web search (Brave/Perplexity) |
| `web_fetch` | Fetch and parse URLs |
| `memory_search` / `memory_store` | Persistent memory |
| `cron_list` / `cron_set` / `cron_delete` | Job scheduling |
| `tts_speak` | Text-to-speech |
| `message_send` / `message_react` / `message_typing` | Channel messaging |
| `image_generate` | DALL-E image generation |
| `apply_patch` | Git patch application |
| `session_list` / `session_history` / `session_send` / `session_spawn` | Session management |
| `session_status` | System status |
| `agents_list` | List configured agents |
| `canvas_*` | Canvas operations |
| `nodes_*` | Node management |
| `gateway_*` | Gateway control |

## Plugins

Place `.ts` or `.js` files in `~/.config/tinyclaw/plugins/` for auto-discovery.

```typescript
import type { TinyClawPluginApi } from "tinyclaw";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, { id: "my-plugin", name: "My Plugin" });

  api.registerTool(/* AgentTool */);
  api.registerHook("message_inbound", async (event, data) => { /* ... */ });
  api.registerChannel(/* ChannelDef */);
  api.registerHttpRoute("/my-endpoint", "POST", handler);
  api.registerService("my-service", startFn, stopFn);
}
```

### 33 Bundled Plugins

**Channels (18):** Telegram, Discord, Slack, Signal, iMessage, Instagram, Messenger, Twitter/X, Matrix, Teams, LINE, WeChat, Viber, Rocket.Chat, Zulip, Webex, Google Chat, Mattermost

**Non-channel (15):** Memory Core, Memory LanceDB, Copilot Proxy, TTS Manager, Canvas Renderer, Cron Scheduler, Media Processor, Browser Manager, Analytics, Rate Limiter, Audit Logger, Webhook Relay, Vector Search, Notification Hub, Backup Manager

## Architecture

```
src/
├── cli.ts                    CLI + REPL + serve command
├── index.ts                  Public API exports
├── config/                   Zod schemas, loader, paths
├── agent/                    Session, runner, tools, system prompt, compact
├── auth/keys.ts              Multi-key rotation with backoff
├── model/resolve.ts          Aliases, fallback chains, custom providers
├── exec/                     Shell execution
├── util/                     Logger, errors
├── security.ts               10-layer policy, SSRF, injection detection
├── plugin.ts                 Plugin API, registry, 4-origin loader
├── hooks.ts                  14 event types, hook runner, bundled hooks
├── skills.ts                 Skill discovery and formatting
├── pipeline.ts               Message dispatch, directives, commands, chunking, delivery
├── channel.ts                Channel adapter interface, registry, lifecycle
├── channel/whatsapp.ts       WhatsApp Cloud API implementation
├── gateway.ts                HTTP + WebSocket server
├── gateway-methods.ts        15 JSON-RPC handlers
├── gateway-http.ts           OpenAI-compatible HTTP endpoints
├── multi-agent.ts            Agent spawn, A2A messaging, bindings
├── memory.ts                 SQLite + FTS5 + vector search
├── browser.ts                Chrome/CDP automation
├── cron.ts                   Job scheduler
├── tts.ts                    Edge/OpenAI/ElevenLabs TTS
├── media.ts                  Image/audio processing, AI vision
├── tools/                    17 agent tool implementations
└── plugins/                  33 bundled plugin stubs
```

## Development

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit

# Build
npx tsdown

# Run from source
npx tsx src/cli.ts "Hello"
```

## Dependencies

- **Runtime:** `zod`, `commander`, `chalk`, `ws`
- **AI:** `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- **Optional:** `better-sqlite3` (memory), `playwright-core` (browser), `sharp` (images), `edge-tts` (TTS)

## License

MIT
