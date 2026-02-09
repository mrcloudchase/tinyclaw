<p align="center">
  <img src="logo.png" alt="TinyClaw" width="480">
</p>

<p align="center">
  A full-featured AI assistant platform in ~15K lines of TypeScript.
</p>

---

Includes a CLI coding agent, TUI mode, gateway server with WebSocket + HTTP API, messaging channels (WhatsApp, Telegram, Discord, Slack), plugin system, Docker sandboxing, DM pairing security, memory, browser automation, cron scheduling, TTS, and multi-agent orchestration.

## Features

- **CLI Agent** — Interactive REPL and single-shot mode with streaming output
- **TUI Mode** — Rich terminal UI via pi-tui with markdown rendering and tool panels
- **Setup Wizard** — `tinyclaw init` interactive onboarding with provider, channel, and security setup
- **Gateway Server** — HTTP + WebSocket server with JSON-RPC 2.0 protocol
- **OpenAI-Compatible API** — `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- **Message Pipeline** — Inbound debouncing, directives (`++think`, `++model`), slash commands, paragraph-aware chunking, delivery with typing indicators
- **Channels** — WhatsApp, Telegram, Discord, Slack with full adapter support (text, image, audio, video, documents, reactions, threads)
- **Docker Sandbox** — Isolated code execution in containers with configurable memory/CPU/network limits
- **DM Pairing** — Unknown sender security with pairing codes and allow-list management
- **Plugin System** — 10 registration methods, 4-origin discovery (bundled, config, directory, install), 33 bundled plugins
- **Security** — 10-layer tool policy engine, SSRF guard, prompt injection detection, path traversal prevention, pairing gate
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

# Interactive setup wizard
npx tinyclaw init

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Single-shot
npx tinyclaw "What is 2+2?"

# Interactive REPL (tries TUI first, falls back to bare REPL)
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

# Disable TUI, use bare REPL
tinyclaw --no-tui
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `/new` | Clear session, start fresh |
| `/compact` | Compact context to free token space |
| `/quit` | Exit REPL |

### Subcommands

| Command | Description |
|---------|-------------|
| `tinyclaw init` | Interactive setup wizard |
| `tinyclaw serve` | Start the gateway server |
| `tinyclaw pair list` | Show pending pairing requests and allowed senders |
| `tinyclaw pair approve <code>` | Approve a pairing code |
| `tinyclaw pair revoke <channelId/peerId>` | Revoke access for a sender |

## Channels

### WhatsApp

Full Cloud API integration with webhook verification, signature validation, and all message types.

```json
{
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
  }
}
```

### Telegram

grammY-based bot with long-polling (default) or webhook mode. Supports forum topics, media, and inline editing.

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botTokenEnv": "TELEGRAM_BOT_TOKEN",
      "mode": "polling"
    }
  }
}
```

### Discord

discord.js client with guild mentions, DM support, and thread awareness.

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "botTokenEnv": "DISCORD_BOT_TOKEN",
      "mentionOnly": true,
      "dmEnabled": true
    }
  }
}
```

### Slack

Bolt framework with Socket Mode. Thread replies, file uploads, and mention gating.

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botTokenEnv": "SLACK_BOT_TOKEN",
      "appTokenEnv": "SLACK_APP_TOKEN",
      "mentionOnly": true,
      "threadReplies": true
    }
  }
}
```

## Docker Sandbox

Isolate code execution in Docker containers for channel sessions.

```bash
# Build the sandbox image
docker build -f Dockerfile.sandbox -t tinyclaw-sandbox .
```

```json
{
  "sandbox": {
    "enabled": true,
    "image": "tinyclaw-sandbox",
    "scope": "session",
    "memoryLimit": "512m",
    "cpuLimit": "1",
    "networkMode": "none"
  }
}
```

When enabled, all `bash` tool calls from channel sessions execute inside isolated containers with configurable memory, CPU, and network restrictions.

## DM Pairing

Require unknown senders to be approved before they can interact with the agent.

```json
{
  "security": {
    "pairingRequired": true
  }
}
```

When an unknown sender messages the bot, they receive a pairing code. The admin approves it:

```bash
tinyclaw pair list              # See pending requests
tinyclaw pair approve ABCD1234  # Approve a code
tinyclaw pair revoke telegram:default/12345  # Revoke access
```

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

TinyClaw looks for config at `~/.config/tinyclaw/config.json5` (or `$XDG_CONFIG_HOME/tinyclaw/config.json5`).

Run `tinyclaw init` for an interactive setup wizard, or create the file manually:

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
    "defaults": {
      "groupIsolation": "per-group"
    },
    "whatsapp": {
      "enabled": true,
      "accounts": {
        "main": {
          "phoneNumberId": "123456789",
          "accessTokenEnv": "WHATSAPP_ACCESS_TOKEN"
        }
      }
    },
    "telegram": { "enabled": true, "botTokenEnv": "TELEGRAM_BOT_TOKEN" },
    "discord": { "enabled": true, "botTokenEnv": "DISCORD_BOT_TOKEN" },
    "slack": { "enabled": true, "botTokenEnv": "SLACK_BOT_TOKEN", "appTokenEnv": "SLACK_APP_TOKEN" }
  },
  "sandbox": {
    "enabled": false,
    "image": "tinyclaw-sandbox",
    "networkMode": "none"
  },
  "security": {
    "toolPolicy": "auto",
    "ssrfProtection": true,
    "execApproval": "auto",
    "pairingRequired": false,
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
    "enabled": true
  }
}
```

## Tools (17 built-in)

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands (sandboxed when enabled) |
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
├── cli.ts                    CLI + REPL + serve + init + pair commands
├── index.ts                  Public API exports
├── tui.ts                    TUI mode via pi-tui
├── init.ts                   Interactive setup wizard
├── config/                   Zod schemas, loader, paths
├── agent/                    Session, runner, tools, system prompt, compact
├── auth/keys.ts              Multi-key rotation with backoff
├── model/resolve.ts          Aliases, fallback chains, custom providers
├── exec/                     Shell execution (with sandbox routing)
├── util/                     Logger, errors
├── security.ts               10-layer policy, SSRF, injection detection
├── sandbox.ts                Docker container management
├── pairing.ts                DM pairing store and allow-list
├── plugin.ts                 Plugin API, registry, 4-origin loader
├── hooks.ts                  14 event types, hook runner, bundled hooks
├── skills.ts                 Skill discovery and formatting
├── pipeline.ts               Message dispatch, directives, commands, chunking, delivery
├── channel.ts                Channel adapter interface, registry, lifecycle
├── channel/
│   ├── whatsapp.ts           WhatsApp Cloud API
│   ├── telegram.ts           Telegram via grammY
│   ├── discord.ts            Discord via discord.js
│   └── slack.ts              Slack via @slack/bolt
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
npm run typecheck

# Build
npm run build

# Run from source
npx tsx src/cli.ts "Hello"
```

## Dependencies

- **Runtime:** `zod`, `commander`, `chalk`, `ws`, `json5`
- **AI:** `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- **Channels:** `grammy` (Telegram), `discord.js` (Discord), `@slack/bolt` + `@slack/web-api` (Slack)
- **UI:** `@inquirer/prompts` (init wizard), `@mariozechner/pi-tui` (TUI mode)
- **Optional:** `better-sqlite3` (memory), `playwright-core` (browser), `sharp` (images), `edge-tts` (TTS)

## License

MIT
