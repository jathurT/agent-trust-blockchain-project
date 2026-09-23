import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Chain-backed suites share accounts, and a transaction nonce is per account.
    // Parallel files collide and fail as a transaction error rather than as anything
    // about the code.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
