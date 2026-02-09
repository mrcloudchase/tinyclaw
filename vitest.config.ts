import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    include: ["src/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: [
        "src/config/schema.ts",
        "src/config/loader.ts",
        "src/config/paths.ts",
        "src/security.ts",
        "src/pipeline/coalescer.ts",
        "src/cron/cron.ts",
        "src/memory.ts",
        "src/hooks.ts",
        "src/auth/keys.ts",
        "src/agent/session.ts",
        "src/agent/runner.ts",
        "src/agent/tools.ts",
        "src/pairing.ts",
        "src/model/resolve.ts",
        "src/skills/skills.ts",
        "src/multi-agent.ts",
        "src/tools/web.ts",
        "src/media/media.ts",
        "src/utils/errors.ts",
      ],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 70,
        statements: 55,
      },
    },
  },
});
