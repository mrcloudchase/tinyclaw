import { z } from "zod";

// ── Auth ──
const AuthProfileSchema = z.object({
  provider: z.string(),
  apiKey: z.string().optional(),
  envVar: z.string().optional(),
});
const AuthSchema = z.object({
  profiles: z.record(z.string(), AuthProfileSchema).optional(),
  defaultProfile: z.string().optional(),
});

// ── Agent ──
const AgentModelSchema = z.object({
  primary: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
});
const AgentIdentitySchema = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
});
const AgentSchema = z.object({
  provider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-5-20250929"),
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).default("off"),
  contextWindow: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
  fallbacks: z.array(z.string()).optional(),
  identity: AgentIdentitySchema.optional(),
  responsePrefix: z.string().optional(),
});

// ── Custom Models ──
const CustomModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
});
const CustomProviderSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  envVar: z.string().optional(),
  api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]).optional(),
  models: z.array(CustomModelSchema).optional(),
});
const ModelsSchema = z.object({
  providers: z.record(z.string(), CustomProviderSchema).optional(),
});

// ── Workspace & Exec ──
const WorkspaceSchema = z.object({
  dir: z.string().optional(),
  bootstrapFiles: z.array(z.string()).optional(),
});
const ExecSchema = z.object({
  timeoutSec: z.number().positive().default(1800),
  backgroundMs: z.number().positive().default(10000),
  maxOutput: z.number().positive().default(200_000),
});

// ── Gateway ──
const GatewayAuthSchema = z.object({
  mode: z.enum(["token", "password", "none"]).default("token"),
  token: z.string().optional(),
  password: z.string().optional(),
});
const GatewayHttpSchema = z.object({
  chatCompletions: z.boolean().default(true),
  responses: z.boolean().default(true),
  models: z.boolean().default(true),
});
const WebhookSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().default("/webhook"),
  token: z.string().optional(),
  tokenEnv: z.string().optional(),
});
const GatewaySchema = z.object({
  port: z.number().default(18789),
  mode: z.enum(["local", "remote"]).default("local"),
  bind: z.enum(["auto", "lan", "loopback", "custom"]).default("loopback"),
  customBindHost: z.string().optional(),
  auth: GatewayAuthSchema.optional(),
  http: GatewayHttpSchema.optional(),
  webhook: WebhookSchema.optional(),
  tls: z.object({
    enabled: z.boolean().default(false),
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
  }).optional(),
  trustedProxies: z.array(z.string()).optional(),
  reload: z.object({
    mode: z.enum(["auto", "manual"]).default("auto"),
    debounceMs: z.number().default(2000),
  }).optional(),
});

// ── Channels ──
const WhatsAppAccountSchema = z.object({
  phoneNumberId: z.string(),
  accessToken: z.string().optional(),
  accessTokenEnv: z.string().optional(),
  verifyToken: z.string().optional(),
  businessAccountId: z.string().optional(),
});
const ChannelsSchema = z.object({
  defaults: z.object({
    groupPolicy: z.enum(["reply-all", "mention-only", "off"]).default("mention-only"),
    groupIsolation: z.enum(["per-group", "per-thread", "shared"]).default("per-group"),
    heartbeatMs: z.number().optional(),
  }).optional(),
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    webhookPath: z.string().default("/webhook/whatsapp"),
    appSecret: z.string().optional(),
    appSecretEnv: z.string().optional(),
    accounts: z.record(z.string(), WhatsAppAccountSchema).optional(),
  }).optional(),
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),
    botTokenEnv: z.string().optional(),
    mode: z.enum(["polling", "webhook"]).default("polling"),
    webhookUrl: z.string().optional(),
    webhookPath: z.string().default("/webhook/telegram"),
    webhookSecret: z.string().optional(),
  }).optional(),
  discord: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),
    botTokenEnv: z.string().optional(),
    mentionOnly: z.boolean().default(true),
    dmEnabled: z.boolean().default(true),
  }).optional(),
  slack: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),
    botTokenEnv: z.string().optional(),
    appToken: z.string().optional(),
    appTokenEnv: z.string().optional(),
    mentionOnly: z.boolean().default(true),
    threadReplies: z.boolean().default(true),
  }).optional(),
});

// ── Plugins ──
const PluginsSchema = z.object({
  enabled: z.boolean().default(true),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  load: z.object({ paths: z.array(z.string()).optional() }).optional(),
  slots: z.object({ memory: z.string().optional() }).optional(),
  entries: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

// ── Hooks ──
const HookMappingSchema = z.object({
  match: z.string().optional(),
  action: z.string().optional(),
  channel: z.string().optional(),
  model: z.string().optional(),
  transform: z.string().optional(),
});
const HooksSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().optional(),
  token: z.string().optional(),
  maxBodyBytes: z.number().optional(),
  presets: z.array(z.string()).optional(),
  mappings: z.array(HookMappingSchema).optional(),
  internal: z.object({
    enabled: z.boolean().default(true),
    handlers: z.array(z.string()).optional(),
    load: z.object({ paths: z.array(z.string()).optional() }).optional(),
  }).optional(),
});

// ── Skills ──
const SkillsSchema = z.object({
  allowBundled: z.array(z.string()).optional(),
  load: z.object({
    extraDirs: z.array(z.string()).optional(),
    watch: z.boolean().default(false),
    watchDebounceMs: z.number().default(1000),
  }).optional(),
  entries: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    apiKey: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

// ── Memory ──
const MemorySchema = z.object({
  backend: z.enum(["builtin", "plugin"]).default("builtin"),
  dbPath: z.string().optional(),
  embeddingProvider: z.enum(["openai", "local"]).default("openai"),
  embeddingModel: z.string().default("text-embedding-3-small"),
  chunkSize: z.number().default(512),
  chunkOverlap: z.number().default(64),
  maxResults: z.number().default(10),
  citations: z.enum(["auto", "on", "off"]).default("auto"),
});

// ── Browser ──
const BrowserSchema = z.object({
  enabled: z.boolean().default(true),
  headless: z.boolean().default(true),
  cdpUrl: z.string().optional(),
  executablePath: z.string().optional(),
  noSandbox: z.boolean().default(false),
  evaluateEnabled: z.boolean().default(true),
  defaultProfile: z.string().default("chrome"),
  profiles: z.record(z.string(), z.object({
    executablePath: z.string().optional(),
    userDataDir: z.string().optional(),
    args: z.array(z.string()).optional(),
  })).optional(),
});

// ── Cron ──
const CronSchema = z.object({
  enabled: z.boolean().default(true),
  store: z.string().optional(),
  maxConcurrentRuns: z.number().default(3),
});

// ── TTS ──
const TtsSchema = z.object({
  enabled: z.boolean().default(false),
  auto: z.enum(["off", "always", "inbound", "tagged"]).default("off"),
  mode: z.enum(["final", "all"]).default("final"),
  provider: z.enum(["edge", "openai", "elevenlabs"]).default("edge"),
  maxTextLength: z.number().default(4096),
  timeoutMs: z.number().default(30000),
  edge: z.object({ voice: z.string().default("en-US-AriaNeural"), outputFormat: z.string().default("audio-24khz-48kbitrate-mono-mp3") }).optional(),
  openai: z.object({ apiKey: z.string().optional(), model: z.string().default("tts-1"), voice: z.string().default("alloy") }).optional(),
  elevenlabs: z.object({ apiKey: z.string().optional(), voiceId: z.string().optional(), modelId: z.string().default("eleven_monolingual_v1") }).optional(),
});

// ── Media ──
const MediaUnderstandingSchema = z.object({
  enabled: z.boolean().default(true),
  maxBytes: z.number().optional(),
  models: z.array(z.string()).optional(),
});
const MediaSchema = z.object({
  concurrency: z.number().default(2),
  image: MediaUnderstandingSchema.optional(),
  audio: MediaUnderstandingSchema.optional(),
  video: MediaUnderstandingSchema.optional(),
});

// ── Security ──
const SecuritySchema = z.object({
  toolPolicy: z.enum(["auto", "interactive", "strict"]).default("auto"),
  ssrfProtection: z.boolean().default(true),
  execApproval: z.enum(["auto", "interactive", "deny"]).default("auto"),
  maxToolCallsPerTurn: z.number().default(50),
  deniedTools: z.array(z.string()).optional(),
  elevatedTools: z.array(z.string()).optional(),
  pairingRequired: z.boolean().default(false),
});

// ── Multi-Agent ──
const AgentBindingSchema = z.object({
  agentId: z.string(),
  match: z.object({
    channel: z.string().optional(),
    accountId: z.string().optional(),
    peer: z.string().optional(),
  }).optional(),
});
const MultiAgentSchema = z.object({
  enabled: z.boolean().default(false),
  agents: z.array(z.object({
    id: z.string(),
    model: z.union([z.string(), AgentModelSchema]).optional(),
    systemPrompt: z.string().optional(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  bindings: z.array(AgentBindingSchema).optional(),
  defaults: z.object({
    model: z.string().optional(),
    thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
  }).optional(),
});

// ── Session ──
const SessionSchema = z.object({
  resetMode: z.enum(["daily", "idle", "manual"]).default("manual"),
  resetAtHour: z.number().min(0).max(23).default(0),
  idleMinutes: z.number().positive().default(120),
});

// ── Pipeline ──
const PipelineSchema = z.object({
  inboundDebounceMs: z.number().default(1500),
  collectMode: z.enum(["off", "collect"]).default("off"),
  collectWindowMs: z.number().default(3000),
  maxQueueSize: z.number().default(100),
  chunkSize: z.object({
    min: z.number().default(800),
    max: z.number().default(1200),
  }).optional(),
  deliveryDelayMs: z.object({
    min: z.number().default(800),
    max: z.number().default(2500),
  }).optional(),
  typingIndicator: z.boolean().default(true),
  envelope: z.boolean().default(true),
});

// ── Sandbox ──
const SandboxSchema = z.object({
  enabled: z.boolean().default(false),
  image: z.string().default("tinyclaw-sandbox"),
  scope: z.enum(["session", "shared"]).default("session"),
  memoryLimit: z.string().default("512m"),
  cpuLimit: z.string().default("1"),
  networkMode: z.enum(["none", "bridge"]).default("none"),
  mountWorkspace: z.boolean().default(false),
  timeoutSec: z.number().default(300),
});

// ══════════════════════════════════════════════
// ── Root Config ──
// ══════════════════════════════════════════════
export const TinyClawConfigSchema = z.object({
  auth: AuthSchema.optional(),
  agent: AgentSchema.optional(),
  models: ModelsSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  exec: ExecSchema.optional(),
  gateway: GatewaySchema.optional(),
  channels: ChannelsSchema.optional(),
  plugins: PluginsSchema.optional(),
  hooks: HooksSchema.optional(),
  skills: SkillsSchema.optional(),
  memory: MemorySchema.optional(),
  browser: BrowserSchema.optional(),
  cron: CronSchema.optional(),
  tts: TtsSchema.optional(),
  media: MediaSchema.optional(),
  security: SecuritySchema.optional(),
  sandbox: SandboxSchema.optional(),
  multiAgent: MultiAgentSchema.optional(),
  pipeline: PipelineSchema.optional(),
  session: SessionSchema.optional(),
});

export type TinyClawConfig = z.infer<typeof TinyClawConfigSchema>;

export const DEFAULT_CONFIG: TinyClawConfig = {
  agent: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    thinkingLevel: "off",
  },
  exec: {
    timeoutSec: 1800,
    backgroundMs: 10000,
    maxOutput: 200_000,
  },
};
