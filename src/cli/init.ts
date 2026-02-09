// tinyclaw init — Interactive onboarding wizard
// Multi-step setup: provider, channels, security, gateway

import { select, input, password, confirm, checkbox } from "@inquirer/prompts";
import fs from "node:fs";
import JSON5 from "json5";
import chalk from "chalk";
import { resolveConfigDir, resolveConfigFilePath } from "../config/paths.js";
import { ensureDir } from "../config/paths.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

interface InitOptions {
  force?: boolean;
}

interface WizardState {
  provider: string;
  apiKey: string;
  model: string;
  channels: string[];
  channelCredentials: Record<string, Record<string, string>>;
  toolPolicy: string;
  sandboxEnabled: boolean;
  gatewayEnabled: boolean;
  gatewayPort: number;
  gatewayAuth: string;
}

// ══════════════════════════════════════════════
// ── Provider Defaults ──
// ══════════════════════════════════════════════

const PROVIDERS: Record<string, { envVar: string; models: string[]; defaultModel: string }> = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-5-20250929", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-5-20250929",
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    defaultModel: "gpt-4o",
  },
  google: {
    envVar: "GOOGLE_API_KEY",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
  },
};

// ══════════════════════════════════════════════
// ── Wizard Steps ──
// ══════════════════════════════════════════════

async function stepWelcome(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  ╔══════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║       TinyClaw Setup Wizard      ║"));
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════╝"));
  console.log();
  console.log(chalk.dim("  This wizard will help you configure TinyClaw."));
  console.log(chalk.dim("  TinyClaw gives an AI agent access to a shell."));
  console.log(chalk.yellow("  ⚠ Only run in environments you trust."));
  console.log();

  await confirm({ message: "Continue with setup?", default: true });
}

async function stepProvider(state: WizardState): Promise<void> {
  state.provider = await select({
    message: "AI provider:",
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI (GPT)", value: "openai" },
      { name: "Google (Gemini)", value: "google" },
      { name: "Custom (OpenAI-compatible)", value: "custom" },
    ],
  });

  const providerDef = PROVIDERS[state.provider];

  // Check if API key is already in env
  if (providerDef) {
    const envKey = process.env[providerDef.envVar];
    if (envKey) {
      console.log(chalk.green(`  ✓ Found ${providerDef.envVar} in environment`));
      state.apiKey = "";
    } else {
      state.apiKey = await password({
        message: `${providerDef.envVar}:`,
        mask: "•",
      });
    }
  } else {
    state.apiKey = await password({
      message: "API key:",
      mask: "•",
    });
  }

  // Model selection
  if (providerDef) {
    state.model = await select({
      message: "Default model:",
      choices: providerDef.models.map((m, i) => ({
        name: i === 0 ? `${m} (recommended)` : m,
        value: m,
      })),
    });
  } else {
    state.model = await input({
      message: "Model ID:",
      default: "gpt-4o",
    });
  }
}

async function stepChannels(state: WizardState): Promise<void> {
  state.channels = await checkbox({
    message: "Enable messaging channels:",
    choices: [
      { name: "Telegram", value: "telegram" },
      { name: "Discord", value: "discord" },
      { name: "Slack", value: "slack" },
      { name: "WhatsApp", value: "whatsapp" },
    ],
  });

  state.channelCredentials = {};

  for (const ch of state.channels) {
    console.log(chalk.dim(`\n  Configuring ${ch}...`));
    const creds: Record<string, string> = {};

    switch (ch) {
      case "telegram": {
        const envToken = process.env.TELEGRAM_BOT_TOKEN;
        if (envToken) {
          console.log(chalk.green("  ✓ Found TELEGRAM_BOT_TOKEN in environment"));
          creds.botTokenEnv = "TELEGRAM_BOT_TOKEN";
        } else {
          creds.botToken = await password({ message: "Telegram bot token:", mask: "•" });
        }
        break;
      }
      case "discord": {
        const envToken = process.env.DISCORD_BOT_TOKEN;
        if (envToken) {
          console.log(chalk.green("  ✓ Found DISCORD_BOT_TOKEN in environment"));
          creds.botTokenEnv = "DISCORD_BOT_TOKEN";
        } else {
          creds.botToken = await password({ message: "Discord bot token:", mask: "•" });
        }
        break;
      }
      case "slack": {
        const envBot = process.env.SLACK_BOT_TOKEN;
        const envApp = process.env.SLACK_APP_TOKEN;
        if (envBot) {
          console.log(chalk.green("  ✓ Found SLACK_BOT_TOKEN in environment"));
          creds.botTokenEnv = "SLACK_BOT_TOKEN";
        } else {
          creds.botToken = await password({ message: "Slack bot token (xoxb-*):", mask: "•" });
        }
        if (envApp) {
          console.log(chalk.green("  ✓ Found SLACK_APP_TOKEN in environment"));
          creds.appTokenEnv = "SLACK_APP_TOKEN";
        } else {
          creds.appToken = await password({ message: "Slack app token (xapp-*):", mask: "•" });
        }
        break;
      }
      case "whatsapp": {
        creds.phoneNumberId = await input({ message: "WhatsApp phone number ID:" });
        const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
        if (envToken) {
          console.log(chalk.green("  ✓ Found WHATSAPP_ACCESS_TOKEN in environment"));
          creds.accessTokenEnv = "WHATSAPP_ACCESS_TOKEN";
        } else {
          creds.accessToken = await password({ message: "WhatsApp access token:", mask: "•" });
        }
        break;
      }
    }

    state.channelCredentials[ch] = creds;
  }
}

async function stepSecurity(state: WizardState): Promise<void> {
  state.toolPolicy = await select({
    message: "Tool execution policy:",
    choices: [
      { name: "Auto — agent runs tools freely (recommended for personal use)", value: "auto" },
      { name: "Interactive — prompt before risky tools", value: "interactive" },
      { name: "Strict — deny all exec unless explicitly allowed", value: "strict" },
    ],
  });

  state.sandboxEnabled = await confirm({
    message: "Enable Docker sandbox for code execution?",
    default: false,
  });
}

async function stepGateway(state: WizardState): Promise<void> {
  state.gatewayEnabled = await confirm({
    message: "Enable gateway server (for channels and remote access)?",
    default: state.channels.length > 0,
  });

  if (state.gatewayEnabled) {
    const portStr = await input({ message: "Gateway port:", default: "18789" });
    state.gatewayPort = parseInt(portStr, 10) || 18789;

    state.gatewayAuth = await select({
      message: "Gateway authentication:",
      choices: [
        { name: "Token-based (recommended)", value: "token" },
        { name: "Password", value: "password" },
        { name: "None (local only)", value: "none" },
      ],
    });
  }
}

// ══════════════════════════════════════════════
// ── Config Generation ──
// ══════════════════════════════════════════════

function buildConfig(state: WizardState): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // Auth
  if (state.apiKey) {
    config.auth = {
      profiles: {
        default: {
          provider: state.provider,
          apiKey: state.apiKey,
        },
      },
      defaultProfile: "default",
    };
  }

  // Agent
  config.agent = {
    provider: state.provider,
    model: state.model,
    thinkingLevel: "off",
  };

  // Security
  config.security = {
    toolPolicy: state.toolPolicy,
  };

  // Sandbox
  if (state.sandboxEnabled) {
    (config as any).sandbox = {
      enabled: true,
      image: "tinyclaw-sandbox",
      scope: "session",
      networkMode: "none",
    };
  }

  // Channels
  if (state.channels.length > 0) {
    const channels: Record<string, unknown> = {};
    for (const ch of state.channels) {
      const creds = state.channelCredentials[ch] ?? {};
      channels[ch] = { enabled: true, ...creds };
    }
    config.channels = channels;
  }

  // Gateway
  if (state.gatewayEnabled) {
    config.gateway = {
      port: state.gatewayPort,
      mode: "local",
      bind: "loopback",
      auth: { mode: state.gatewayAuth },
    };
  }

  return config;
}

// ══════════════════════════════════════════════
// ── Main Wizard ──
// ══════════════════════════════════════════════

export async function runInitWizard(opts: InitOptions = {}): Promise<void> {
  const configPath = resolveConfigFilePath();

  // Check existing config
  if (!opts.force && fs.existsSync(configPath)) {
    const overwrite = await confirm({
      message: `Config already exists at ${configPath}. Overwrite?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.dim("  Aborted."));
      return;
    }
  }

  const state: WizardState = {
    provider: "anthropic",
    apiKey: "",
    model: "claude-sonnet-4-5-20250929",
    channels: [],
    channelCredentials: {},
    toolPolicy: "auto",
    sandboxEnabled: false,
    gatewayEnabled: false,
    gatewayPort: 18789,
    gatewayAuth: "token",
  };

  try {
    await stepWelcome();
    await stepProvider(state);
    await stepChannels(state);
    await stepSecurity(state);
    await stepGateway(state);
  } catch {
    // User cancelled (Ctrl+C)
    console.log(chalk.dim("\n  Setup cancelled."));
    return;
  }

  // Generate config
  const config = buildConfig(state);
  const configStr = JSON5.stringify(config, null, 2);

  // Write config
  ensureDir(resolveConfigDir());
  fs.writeFileSync(configPath, configStr, "utf-8");

  // Summary
  console.log();
  console.log(chalk.green.bold("  ✓ Configuration saved!"));
  console.log(chalk.dim(`  → ${configPath}`));
  console.log();
  console.log(chalk.dim("  Next steps:"));
  console.log(chalk.dim(`    tinyclaw "hello"           — Send a message`));
  console.log(chalk.dim(`    tinyclaw                   — Start interactive mode`));
  if (state.gatewayEnabled || state.channels.length > 0) {
    console.log(chalk.dim(`    tinyclaw serve             — Start the gateway`));
  }
  if (state.sandboxEnabled) {
    console.log(chalk.dim(`    docker build -f Dockerfile.sandbox -t tinyclaw-sandbox .`));
  }
  console.log();
}
