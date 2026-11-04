import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "engine/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 30_000,
  },
});
