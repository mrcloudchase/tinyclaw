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
        "src/security/security.ts",
        "src/security/pairing.ts",
        "src/pipeline/coalescer.ts",
        "src/cron/cron.ts",
        "src/memory/memory.ts",
        "src/hooks/hooks.ts",
        "src/auth/keys.ts",
        "src/agent/session.ts",
        "src/agent/runner.ts",
        "src/agent/tools.ts",
        "src/agent/multi-agent.ts",
        "src/model/resolve.ts",
        "src/skills/skills.ts",
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
