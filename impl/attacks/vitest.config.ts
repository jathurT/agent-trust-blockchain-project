import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These suites drive a real chain from the same accounts, and a transaction's
    // nonce is per account. Running files in parallel makes two suites pick the same
    // nonce and one of them fails with "transaction creation failed" — a collision
    // between the tests, not a defect in the code under test. Serial files keep the
    // failures meaningful.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
