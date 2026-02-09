// backup-manager — periodic state backup service
import type { TinyClawPluginApi } from "../../plugin.js";

export default function init(api: TinyClawPluginApi) {
  Object.assign(api.meta, {
    id: "backup-manager",
    name: "Backup Manager",
    version: "0.1.0",
    description: "Periodic state and data backup service",
  });

  api.registerService(
    "backup",
    async () => { /* start backup scheduler */ },
    async () => { /* stop backup scheduler */ },
  );
}
