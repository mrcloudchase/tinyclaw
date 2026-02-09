# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Build & Development Commands

```bash
npm run build        # Build with tsdown → dist/ (ESM, node22 target, generates .d.ts)
npm run typecheck    # Type check without emitting (tsc --noEmit)
npm run dev          # Run CLI from source via tsx
npm start            # Run compiled CLI from dist/
```

### Testing

```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage with v8 provider
```

- Tests are collocated: `src/**/*.test.ts`
- Pool: `forks` (isolates module-level singletons)
- Coverage thresholds: 70% lines/functions/branches, 55% statements
- Mocking: `vi.mock()` for fs, paths, logger; `vi.stubEnv()` for env vars

## Architecture

TinyClaw is a ~11K line AI assistant platform extracted from OpenClaw. Two entry points: `src/cli.ts` (executable with subcommands: serve, init, pair, config, status, doctor, cron, logs, sessions) and `src/index.ts` (library API with 60+ exports).

### Core Flow

**CLI/Channel message → Pipeline (`pipeline.ts`) → Agent Runner (`agent/runner.ts`) → AI Provider**

- `pipeline.ts` is the central hub: message dispatch, message deduplication (60s TTL), queue/collect mode (batching rapid messages), REPL directives (`/status`, `/model`, `/compact`), session freshness evaluation, typing control, envelope context for channel messages, and delivery with response prefix
- `agent/runner.ts` handles the retry loop: context overflow → truncate tool results → compact → retry; auth/rate-limit errors → classify via `classifyFailoverReason()` → rotate keys or backoff; thinking level errors → auto-downgrade
- `agent/session.ts` manages session lifecycle with advisory file locking (`O_CREAT | O_EXCL`), JSONL crash repair, and token usage accumulation

### Config System

- JSON5 config at `~/.config/tinyclaw/config.json5` (or `$TINYCLAW_HOME`, `$TINYCLAW_CONFIG`)
- Schema defined with Zod in `config/schema.ts` — all config types are inferred from the schema
- `config/loader.ts` merges env vars (`TINYCLAW_MODEL`, `TINYCLAW_WORKSPACE`, `TINYCLAW_PORT`) over file config
- `config/watcher.ts` provides hot-reload via `fs.watch` with debounce and restart-required detection

### Key Subsystems

| Subsystem | File(s) | Notes |
|-----------|---------|-------|
| Security | `security.ts` | 10-layer policy evaluation, SSRF guard, exec allowlist with auto-approve |
| Channels | `channel.ts` + `channel/*.ts` | WhatsApp, Telegram (grammY), Discord (discord.js), Slack (Bolt) |
| Gateway | `gateway.ts`, `gateway-http.ts`, `gateway-methods.ts`, `webchat.ts` | HTTP + WebSocket, JSON-RPC 2.0, 23 RPC methods, OpenAI-compatible endpoints, WebChat UI, webhook endpoint, presence system |
| Plugins | `plugin.ts` | 10 registration methods, 4-origin discovery (bundled, config, user dir, workspace `.tinyclaw/plugins/`). Note: plugin slots in `src/plugins/` are TODO stubs; working channels live in `src/channel/` |
| Skills | `skills.ts`, `skills/bundled/*.md` | YAML frontmatter .md files, 6 bundled + user dirs |
| Hooks | `hooks.ts` | 14 event types, hooks can return `{ abort, transform }` to control pipeline |
| Memory | `memory.ts`, `memory/embeddings.ts` | SQLite + FTS5 + optional sqlite-vec, hybrid search (0.7 cosine + 0.3 BM25) |
| Auth | `auth/keys.ts` | Multi-key rotation, persistent cooldowns at `~/.config/tinyclaw/auth-state.json`, failure classification |
| Streaming | `pipeline/coalescer.ts` | Per-channel text limits (WhatsApp 1600, Telegram 4096, Discord 2000), code block fence tracking |
| Web Tools | `tools/web.ts` | Brave Search API (`web_search`) and URL fetching with HTML→text (`web_fetch`) |
| Model Resolve | `model/resolve.ts` | Aliases, fallback chains, local provider auto-detection (Ollama, LM Studio, vLLM, LiteLLM) |

### Design Patterns

- **Monolithic files**: Each subsystem is self-contained in one file (types, implementation, exports). Don't split files unless they exceed ~400 lines.
- **Lazy imports**: Heavy dependencies (gateway, channels, TUI, plugins) use `await import()` so the CLI stays fast.
- **Config-driven**: Nearly all behavior is configurable via Zod-validated config. Add new config options to `config/schema.ts` using Zod schemas, never raw types.
- **XDG paths**: All persistent state lives under `~/.config/tinyclaw/` via helpers in `config/paths.ts`.

### Dependencies to Know

- `@mariozechner/pi-agent-core` / `pi-coding-agent` / `pi-ai` / `pi-tui` — Core agent framework (session management, tool execution, TUI). Types like `AgentSession`, `AgentTool`, `ThinkingLevel` come from here.
- `better-sqlite3` — Used in memory system, loaded via `require()` (not ESM import) for bundler compatibility.
- `zod` — All config validation. Schema types are exported and used throughout.

**Optional dependencies** (lazy-loaded via `require()` with graceful fallback):
- `playwright-core` — Browser automation (`src/browser.ts`)
- `sharp` — Image processing (`src/media.ts`)
- `edge-tts` — Edge TTS provider (`src/tts.ts`)
- `sqlite-vec` — Vector search extension (`src/memory.ts`)

## Key Conventions

- TypeScript strict mode, ES2024 target, NodeNext module resolution
- ESM only (`"type": "module"` in package.json) — all local imports use `.js` extension
- Node.js >=22.12.0 required
- `src/index.ts` is the public API surface — update it when adding new exports
- Tool parameter normalization in `agent/tools.ts` maps alternate names (`file_path` → `path`, `old_string` → `oldText`)
- Error classification in `auth/keys.ts` determines retry strategy — `format` never retries, `rate_limit` backs off and rotates, `timeout` retries same key
- Bootstrap files in `agent/system-prompt.ts` — candidates searched in order: SOUL.md, IDENTITY.md, USER.md, TOOLS.md, TINYCLAW.md, CLAUDE.md, AGENTS.md, BOOTSTRAP.md, .tinyclaw, .claude
- Message dedup in `pipeline.ts` uses `channelId:messageId` key with 60s TTL to prevent double-processing
- Collect/queue mode in `pipeline.ts` batches rapid messages within a configurable window before dispatching
- Presence system in `gateway.ts` tracks connected clients with 5min TTL and 60s heartbeat broadcasts
- WebChat UI in `webchat.ts` returns self-contained HTML served at `/` and `/chat` by `gateway-http.ts`
- Web tools in `tools/web.ts` provide `web_search` (Brave API) and `web_fetch` (URL→text) as AgentTool implementations
- Local model providers (ollama, lmstudio, vllm, litellm) auto-resolve in `model/resolve.ts` with default base URLs
