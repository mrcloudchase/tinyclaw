<p align="center">
  <img src="logo.png" alt="TinyClaw" width="480">
</p>

<p align="center">
  A full-featured AI assistant platform in ~10K lines of TypeScript.
</p>

---

Includes a CLI coding agent, TUI mode, gateway server with WebSocket + HTTP API, messaging channels (WhatsApp, Telegram, Discord, Slack), plugin system, Docker sandboxing, DM pairing security, session durability with file locking and crash repair, auth resilience with persistent cooldowns, block streaming with per-channel limits, exec approval with auto-allowlist, SOUL.md personality, hybrid vector + BM25 memory search, full cron expressions, config hot-reload, hook transforms, skill commands, and multi-agent orchestration.

## Features

- **CLI Agent** — Interactive REPL and single-shot mode with streaming output
- **TUI Mode** — Rich terminal UI via pi-tui with markdown rendering and tool panels
- **Setup Wizard** — `tinyclaw init` interactive onboarding with provider, channel, and security setup
- **Gateway Server** — HTTP + WebSocket server with JSON-RPC 2.0 protocol, 21 RPC methods
- **OpenAI-Compatible API** — `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- **Message Pipeline** — Inbound debouncing, directives (`++think`, `++model`), slash commands, paragraph-aware chunking, delivery with typing indicators, envelope context
- **Block Streaming** — Coalescer with per-channel text limits (WhatsApp 1600, Telegram 4096, Discord 2000), code block awareness, dedup
- **Channels** — WhatsApp, Telegram, Discord, Slack with full adapter support (text, image, audio, video, documents, reactions, threads)
- **Docker Sandbox** — Isolated code execution in containers with configurable memory/CPU/network limits
- **DM Pairing** — Unknown sender security with pairing codes and allow-list management
- **Plugin System** — 10 registration methods, 4-origin discovery (bundled, config, directory, workspace), 33 bundled plugins
- **Security** — 10-layer tool policy engine, SSRF guard, prompt injection detection, path traversal prevention, pairing gate, exec approval with allowlist
- **Session Durability** — Advisory file locking, crash repair, tool result truncation, token/usage tracking, auto-reset policies (daily/idle/manual)
- **Auth Resilience** — Multi-key rotation with persistent cooldowns, failure classification (auth/rate_limit/billing/timeout), backoff persistence across restarts
- **Memory** — SQLite + FTS5 full-text search + vector search (sqlite-vec + OpenAI embeddings), hybrid scoring (0.7 cosine + 0.3 BM25)
- **Personality** — SOUL.md persona loading, agent identity (name/emoji/prefix), group chat context and style
- **Browser** — Chrome/CDP automation via playwright-core (navigate, click, type, screenshot, accessibility snapshot)
- **Cron** — Job scheduler with full 5-field cron expressions, intervals, one-time jobs, catch-up on missed runs
- **TTS** — Three providers (Edge TTS, OpenAI, ElevenLabs) with auto-summarize
- **Media** — MIME detection, image processing (sharp), AI vision (Anthropic/OpenAI), audio format detection
- **Multi-Agent** — Session key routing, agent-channel bindings, subagent spawning, agent-to-agent messaging
- **Model Flexibility** — Anthropic, OpenAI, Google, custom providers, model aliases, fallback chains, multi-key rotation
- **Config Hot-Reload** — Automatic config file watching with debounce, selective reload, restart warnings
- **Hook Transforms** — Hooks can transform data or abort pipeline, sequential execution with priority ordering
- **Skill Commands** — `/skillname args` dispatches to SKILL.md files with prompt-based or tool-based execution

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
| `/status` | Show session info, model, and token usage |
| `/model [name]` | Show or switch the current model |
| `/stop` | Stop current generation |
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

## Session Durability

Sessions are protected against corruption and data loss:

- **File Locking** — Advisory locks via exclusive file creation prevent concurrent writes to JSONL transcripts. Stale lock detection (>30min or dead PID) with exponential backoff retry.
- **Crash Repair** — On startup, unparseable JSONL lines are dropped and a backup is created. Sessions recover automatically from mid-write crashes.
- **Tool Result Truncation** — Oversized tool results (>30% of context window) are automatically truncated before causing permanent context overflow.
- **Token Tracking** — Input/output/cache tokens are tracked per session. View with `/status`.
- **Auto-Reset** — Sessions can reset automatically based on time policies.

```json
{
  "session": {
    "resetMode": "daily",
    "resetAtHour": 6
  }
}
```

Reset modes: `"manual"` (default), `"daily"` (resets at configured hour), `"idle"` (resets after N minutes of inactivity).

## Personality

TinyClaw supports persona customization via SOUL.md and config:

**SOUL.md** — Place a `SOUL.md` file in your workspace root to define the agent's personality and tone. It's loaded first and prepended to the system prompt.

**Agent Identity** — Set a custom name, emoji, and response prefix in config:

```json
{
  "agent": {
    "identity": { "name": "Jarvis", "emoji": "🤖" },
    "responsePrefix": "Sir, "
  }
}
```

**Group Chat** — When responding in group channels, the system prompt adapts with group context, natural writing style, and sender-specific addressing.

## Auth Resilience

Multi-key rotation with persistent cooldowns that survive process restarts:

- **Failure Classification** — Errors are classified as `auth`, `rate_limit`, `billing`, `timeout`, or `format` with per-reason retry behavior
- **Cooldown Persistence** — State saved to `~/.config/tinyclaw/auth-state.json`. Rate limits: 1min → 5min → 25min → 1hr. Billing: 5hr → 10hr → 20hr → 24hr
- **Smart Retry** — Rate limits backoff + rotate key. Timeouts retry same key. Auth/billing rotate key. Format errors don't retry

## Exec Approval

Control shell command execution from channel sessions:

```json
{
  "security": {
    "execApproval": "interactive"
  }
}
```

When set to `"interactive"`, bash commands from channel sessions require admin approval via the gateway:

```javascript
// List pending approvals
ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "exec.pending" }));

// Approve
ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "exec.approve", params: { id: "approval_..." } }));
```

After 3 approvals of the same command pattern, it's auto-allowed. The allowlist persists at `~/.config/tinyclaw/exec-allowlist.json`.

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

### RPC Methods (21)

| Method | Description |
|--------|-------------|
| `chat.send` | Send message, get complete response |
| `chat.stream` | Send message, stream chunks via events |
| `sessions.list` | List active sessions |
| `sessions.get` | Get session details |
| `sessions.clear` | Clear a specific session |
| `sessions.clearAll` | Clear all sessions |
| `config.get` | Get current config (sanitized) |
| `config.reload` | Hot-reload config file |
| `health` | System health status |
| `channels.list` | List connected channels |
| `channels.send` | Send message via channel |
| `models.list` | List available models |
| `memory.search` | Query long-term memory |
| `memory.store` | Add a memory entry |
| `cron.list` | List scheduled jobs |
| `cron.add` | Create a scheduled job |
| `cron.remove` | Delete a scheduled job |
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
    "fallbacks": ["openai/gpt-4o"],
    "identity": { "name": "MyBot", "emoji": "🤖" },
    "responsePrefix": ""
  },
  "session": {
    "resetMode": "manual",
    "resetAtHour": 0,
    "idleMinutes": 120
  },
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "auth": { "mode": "token", "token": "my-secret" },
    "reload": { "mode": "auto", "debounceMs": 2000 }
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
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small"
  },
  "tts": {
    "enabled": false,
    "provider": "edge",
    "auto": "off"
  },
  "pipeline": {
    "inboundDebounceMs": 1500,
    "typingIndicator": true,
    "envelope": true,
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

Place `.ts` or `.js` files in `~/.config/tinyclaw/plugins/` or `.tinyclaw/plugins/` (workspace-local) for auto-discovery.

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

## Skills

Place `.md` files in `~/.config/tinyclaw/skills/` to create custom slash commands. Each file becomes a `/command`:

```markdown
---
description: Summarize a pull request
tags: [git, review]
---

Review the pull request and provide:
1. A one-paragraph summary
2. Key changes
3. Potential issues
```

Usage: `/summarize-pr #123` — The skill content is injected as context for the agent.

## Hook Transforms

Hooks can now transform pipeline data or abort message processing:

```typescript
api.registerHook("message_inbound", async (event, data) => {
  // Transform: modify data for downstream hooks
  return { transform: { body: data.body.toUpperCase() } };

  // Or abort: stop pipeline entirely
  return { abort: true, abortMessage: "Message blocked" };
});
```

Hooks execute sequentially by priority. Each hook sees transforms from previous hooks.

## Config Hot-Reload

When the gateway is running, config file changes are detected automatically:

```json
{
  "gateway": {
    "reload": { "mode": "auto", "debounceMs": 2000 }
  }
}
```

Changes to channels, hooks, and cron are applied immediately. Changes to `gateway.*` or `plugins.*` log a restart warning. Connected WebSocket clients receive a `config.reload` event.

## Architecture

```
src/
├── cli.ts                    CLI + REPL + serve + init + pair commands
├── index.ts                  Public API exports
├── tui.ts                    TUI mode via pi-tui
├── init.ts                   Interactive setup wizard
├── config/                   Zod schemas, loader, paths, watcher
├── agent/                    Session (locking, repair), runner, tools, system prompt, compact, pruning
├── auth/keys.ts              Multi-key rotation with backoff + persistent cooldowns
├── model/resolve.ts          Aliases, fallback chains, custom providers
├── exec/                     Shell execution (with sandbox routing)
├── util/                     Logger, errors
├── security.ts               10-layer policy, SSRF, injection detection, exec allowlist
├── sandbox.ts                Docker container management
├── pairing.ts                DM pairing store and allow-list
├── plugin.ts                 Plugin API, registry, 4-origin loader
├── hooks.ts                  14 event types, hook runner with transform/abort, bundled hooks
├── skills.ts                 Skill discovery, formatting, and command execution
├── pipeline.ts               Message dispatch, directives, commands, chunking, delivery, session reset
├── pipeline/
│   └── coalescer.ts          Block streaming coalescer with code block awareness
├── memory/
│   └── embeddings.ts         OpenAI embedding generation with caching
├── channel.ts                Channel adapter interface, registry, lifecycle
├── channel/
│   ├── whatsapp.ts           WhatsApp Cloud API
│   ├── telegram.ts           Telegram via grammY
│   ├── discord.ts            Discord via discord.js
│   └── slack.ts              Slack via @slack/bolt
├── gateway.ts                HTTP + WebSocket server
├── gateway-methods.ts        21 JSON-RPC handlers
├── gateway-http.ts           OpenAI-compatible HTTP endpoints
├── multi-agent.ts            Agent spawn, A2A messaging, bindings
├── memory.ts                 SQLite + FTS5 + vector search
├── browser.ts                Chrome/CDP automation
├── cron.ts                   Job scheduler with 5-field cron expression parser
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
