import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { log } from "../utils/logger.js";
import { defineTool } from "./helper.js";

const startTime = Date.now();

export function createGatewayTool(config: TinyClawConfig): AgentTool<any> {
  return defineTool({
    name: "gateway_control",
    description: "Control the gateway server: get status with connected channels and memory stats, reload config, or restart.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "reload", "restart"],
          description: "Action to perform: 'status' for detailed info, 'reload' to refresh config, 'restart' to restart gateway",
        },
      },
      required: ["action"],
    },
    async execute(args: { action: string }) {
      switch (args.action) {
        case "status": {
          const uptimeSec = Math.round((Date.now() - startTime) / 1000);
          const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
          const model = `${config.agent?.provider ?? "anthropic"}/${config.agent?.model ?? "unknown"}`;
          const port = config.gateway?.port ?? 18789;
          const mode = config.gateway?.mode ?? "local";

          // Lazy-load channel registry for connected channels
          let channels: Array<{ id: string; name: string }> = [];
          try {
            const { getChannelRegistry } = await import("../channel/channel.js");
            const registry = getChannelRegistry();
            channels = registry.list().map((ch) => ({ id: ch.id, name: ch.name }));
          } catch { /* registry not initialized */ }

          // Get active session count
          let sessions = 0;
          try {
            const { getActiveSessionCount } = await import("../pipeline/pipeline.js");
            sessions = getActiveSessionCount();
          } catch { /* pipeline not imported */ }

          return JSON.stringify({
            running: true,
            uptime: uptimeSec,
            port,
            mode,
            model,
            heap: heapMb,
            rss,
            sessions,
            channels,
            nodeVersion: process.version,
            platform: process.platform,
          }, null, 2);
        }

        case "reload": {
          log.info("Config reload requested via gateway_control tool");
          try {
            const { loadConfig } = await import("../config/loader.js");
            const freshConfig = loadConfig();
            const { runHooks } = await import("../hooks/hooks.js");
            await runHooks("config_reload", { model: freshConfig.agent?.model });
            return "Config reloaded successfully. New settings will take effect on next request.";
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `Config reload failed: ${msg}`;
          }
        }

        case "restart": {
          log.info("Restart requested via gateway_control tool");
          try {
            const { shutdownChannels, getChannelRegistry } = await import("../channel/channel.js");
            const registry = getChannelRegistry();
            await shutdownChannels(registry);
          } catch { /* channels may not be active */ }

          // Note: stopGateway requires a GatewayContext which we don't have access to here.
          // The process manager should handle the actual restart.

          return "Shutdown initiated. Use your process manager (systemd, pm2, docker) to restart, or the gateway will restart automatically if configured.";
        }

        default:
          return `Unknown action: ${args.action}. Valid actions: status, reload, restart`;
      }
    },
  });
}
