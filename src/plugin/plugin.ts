// Plugin System — API + discovery + loader + registry + runtime
// All in ONE file

import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { resolvePluginsDir, ensureDir } from "../config/paths.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Plugin Types ──
// ══════════════════════════════════════════════

export interface PluginMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
}

export interface PluginRegistration {
  tools?: AgentTool<any>[];
  hooks?: Array<{ event: string; handler: PluginHookHandler }>;
  channels?: PluginChannelDef[];
  providers?: PluginProviderDef[];
  gatewayMethods?: Array<{ method: string; handler: (params: any) => Promise<any> }>;
  httpHandlers?: Array<{ path: string; method: string; handler: (req: any, res: any) => void }>;
  httpRoutes?: Array<{ path: string; method: string; handler: (req: any, res: any) => void }>;
  cliCommands?: Array<{ name: string; handler: (args: string[]) => Promise<void> }>;
  services?: Array<{ name: string; start: () => Promise<void>; stop: () => Promise<void> }>;
  commands?: Array<{ name: string; handler: (ctx: any) => Promise<string> }>;
}

export type PluginHookHandler = (event: string, data: Record<string, unknown>) => Promise<void>;

export interface PluginChannelDef {
  id: string;
  meta: PluginMeta;
  capabilities: Record<string, boolean>;
  adapter: Record<string, (...args: any[]) => any>;
}

export interface PluginProviderDef {
  id: string;
  type: string;
  factory: () => any;
}

// ══════════════════════════════════════════════
// ── Plugin API (10 registration methods) ──
// ══════════════════════════════════════════════

export class TinyClawPluginApi {
  private reg: PluginRegistration = {};

  constructor(public readonly meta: PluginMeta) {}

  registerTool(tool: AgentTool<any>): void {
    (this.reg.tools ??= []).push(tool);
  }
  registerHook(event: string, handler: PluginHookHandler): void {
    (this.reg.hooks ??= []).push({ event, handler });
  }
  registerChannel(channel: PluginChannelDef): void {
    (this.reg.channels ??= []).push(channel);
  }
  registerProvider(provider: PluginProviderDef): void {
    (this.reg.providers ??= []).push(provider);
  }
  registerGatewayMethod(method: string, handler: (params: any) => Promise<any>): void {
    (this.reg.gatewayMethods ??= []).push({ method, handler });
  }
  registerHttpHandler(path: string, method: string, handler: (req: any, res: any) => void): void {
    (this.reg.httpHandlers ??= []).push({ path, method, handler });
  }
  registerHttpRoute(path: string, method: string, handler: (req: any, res: any) => void): void {
    (this.reg.httpRoutes ??= []).push({ path, method, handler });
  }
  registerCli(name: string, handler: (args: string[]) => Promise<void>): void {
    (this.reg.cliCommands ??= []).push({ name, handler });
  }
  registerService(name: string, start: () => Promise<void>, stop: () => Promise<void>): void {
    (this.reg.services ??= []).push({ name, start, stop });
  }
  registerCommand(name: string, handler: (ctx: any) => Promise<string>): void {
    (this.reg.commands ??= []).push({ name, handler });
  }

  getRegistration(): PluginRegistration { return this.reg; }
}

// ══════════════════════════════════════════════
// ── Plugin Registry ──
// ══════════════════════════════════════════════

export type PluginInitFn = (api: TinyClawPluginApi, config: TinyClawConfig) => void | Promise<void>;

interface LoadedPlugin {
  meta: PluginMeta;
  registration: PluginRegistration;
  origin: "bundled" | "config" | "directory" | "install";
}

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();

  register(meta: PluginMeta, registration: PluginRegistration, origin: LoadedPlugin["origin"]): void {
    if (this.plugins.has(meta.id)) {
      log.warn(`Plugin ${meta.id} already registered, skipping duplicate`);
      return;
    }
    this.plugins.set(meta.id, { meta, registration, origin });
    log.debug(`Registered plugin: ${meta.id} (${origin})`);
  }

  get(id: string): LoadedPlugin | undefined { return this.plugins.get(id); }
  getAll(): LoadedPlugin[] { return [...this.plugins.values()]; }

  getAllTools(): AgentTool<any>[] {
    return this.getAll().flatMap((p) => p.registration.tools ?? []);
  }
  getAllHooks(): Array<{ pluginId: string; event: string; handler: PluginHookHandler }> {
    return this.getAll().flatMap((p) =>
      (p.registration.hooks ?? []).map((h) => ({ pluginId: p.meta.id, ...h })),
    );
  }
  getAllChannels(): PluginChannelDef[] {
    return this.getAll().flatMap((p) => p.registration.channels ?? []);
  }
  getAllGatewayMethods(): Array<{ pluginId: string; method: string; handler: (params: any) => Promise<any> }> {
    return this.getAll().flatMap((p) =>
      (p.registration.gatewayMethods ?? []).map((m) => ({ pluginId: p.meta.id, ...m })),
    );
  }
  getAllHttpHandlers(): Array<{ pluginId: string; path: string; method: string; handler: (req: any, res: any) => void }> {
    return this.getAll().flatMap((p) =>
      [...(p.registration.httpHandlers ?? []), ...(p.registration.httpRoutes ?? [])].map((h) => ({ pluginId: p.meta.id, ...h })),
    );
  }
  getAllServices(): Array<{ pluginId: string; name: string; start: () => Promise<void>; stop: () => Promise<void> }> {
    return this.getAll().flatMap((p) =>
      (p.registration.services ?? []).map((s) => ({ pluginId: p.meta.id, ...s })),
    );
  }
}

// ══════════════════════════════════════════════
// ── 4-Origin Plugin Discovery & Loading ──
// ══════════════════════════════════════════════

export async function discoverAndLoadPlugins(config: TinyClawConfig): Promise<PluginRegistry> {
  const registry = new PluginRegistry();
  const pluginConfig = config.plugins;
  if (pluginConfig?.enabled === false) return registry;

  const allow = pluginConfig?.allow ? new Set(pluginConfig.allow) : undefined;
  const deny = new Set(pluginConfig?.deny ?? []);

  const shouldLoad = (id: string) => {
    if (deny.has(id)) return false;
    if (allow && !allow.has(id)) return false;
    const entry = pluginConfig?.entries?.[id];
    if (entry?.enabled === false) return false;
    return true;
  };

  // Origin 1: Bundled plugins
  try {
    const { getBundledPlugins } = await import("./index.js");
    for (const init of getBundledPlugins()) {
      const api = new TinyClawPluginApi({ id: "pending", name: "pending" });
      await init(api, config);
      const meta = api.meta;
      if (shouldLoad(meta.id)) {
        registry.register(meta, api.getRegistration(), "bundled");
      }
    }
  } catch {
    log.debug("No bundled plugins found (plugins/ not built yet)");
  }

  // Origin 2: Config-specified paths
  const configPaths = pluginConfig?.load?.paths ?? [];
  for (const p of configPaths) {
    await loadPluginFromPath(p, config, registry, "config", shouldLoad);
  }

  // Origin 3: Plugin directory (~/.config/tinyclaw/plugins/)
  const pluginsDir = resolvePluginsDir();
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"));
    for (const entry of entries) {
      await loadPluginFromPath(path.join(pluginsDir, entry), config, registry, "directory", shouldLoad);
    }
  }

  // Origin 4: Workspace plugins (.tinyclaw/plugins/)
  const workspaceDir = config.workspace?.dir ?? process.cwd();
  const wsPluginsDir = path.join(workspaceDir, ".tinyclaw", "plugins");
  if (fs.existsSync(wsPluginsDir)) {
    const entries = fs.readdirSync(wsPluginsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"));
    for (const entry of entries) {
      await loadPluginFromPath(path.join(wsPluginsDir, entry), config, registry, "directory", shouldLoad);
    }
  }

  log.info(`Loaded ${registry.getAll().length} plugins`);
  return registry;
}

async function loadPluginFromPath(
  filePath: string,
  config: TinyClawConfig,
  registry: PluginRegistry,
  origin: LoadedPlugin["origin"],
  shouldLoad: (id: string) => boolean,
): Promise<void> {
  try {
    const mod = await import(filePath);
    const initFn: PluginInitFn = mod.default ?? mod.init ?? mod.register;
    if (typeof initFn !== "function") {
      log.warn(`Plugin at ${filePath} has no init function`);
      return;
    }
    const api = new TinyClawPluginApi({ id: path.basename(filePath, path.extname(filePath)), name: filePath });
    await initFn(api, config);
    if (shouldLoad(api.meta.id)) {
      registry.register(api.meta, api.getRegistration(), origin);
    }
  } catch (err) {
    log.warn(`Failed to load plugin from ${filePath}: ${err}`);
  }
}
