import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    include: ["src/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 55,
      },
      exclude: [
        "src/plugins/**",
        "src/cli.ts",
        "src/tui.ts",
        "src/init.ts",
        "src/webchat.ts",
        "src/gateway.ts",
        "src/gateway-http.ts",
        "src/gateway-methods.ts",
        "src/channel/**",
        "src/channel.ts",
        "src/browser.ts",
        "src/tts.ts",
        "src/sandbox.ts",
        "dist/**",
        "node_modules/**",
      ],
    },
  },
});
