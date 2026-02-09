import { z } from "zod";

const AuthProfileSchema = z.object({
  provider: z.string(),
  apiKey: z.string().optional(),
  envVar: z.string().optional(),
});

const AuthSchema = z.object({
  profiles: z.record(z.string(), AuthProfileSchema).optional(),
  defaultProfile: z.string().optional(),
});

const AgentSchema = z.object({
  provider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-5-20250929"),
  thinkingLevel: z
    .enum(["off", "low", "medium", "high"])
    .default("off"),
  contextWindow: z.number().positive().optional(),
  maxTokens: z.number().positive().optional(),
});

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
  api: z
    .enum([
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ])
    .optional(),
  models: z.array(CustomModelSchema).optional(),
});

const ModelsSchema = z.object({
  providers: z.record(z.string(), CustomProviderSchema).optional(),
});

const WorkspaceSchema = z.object({
  dir: z.string().optional(),
  bootstrapFiles: z.array(z.string()).optional(),
});

const ExecSchema = z.object({
  timeoutSec: z.number().positive().default(1800),
  backgroundMs: z.number().positive().default(10000),
  maxOutput: z.number().positive().default(200_000),
});

export const TinyClawConfigSchema = z.object({
  auth: AuthSchema.optional(),
  agent: AgentSchema.optional(),
  models: ModelsSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  exec: ExecSchema.optional(),
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
