import { describe, expect, it } from "vitest";
import { captureVersions, captureChain, ManifestIncomplete } from "../src/manifest.js";
import { summarise, wilson, seededRandom } from "../src/stats.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("the manifest refuses to record an unknown", () => {
  it("captures every field the evidence standard requires", () => {
    const v = captureVersions(ROOT);
    for (const field of ["git", "node", "pnpm", "python", "foundry", "solc"] as const) {
      expect(v[field], field).toBeTruthy();
    }
    expect(v.git).toMatch(/^[0-9a-f]{40}$/);
    expect(v.solc).toBe("0.8.37");
    expect(Object.keys(v.packages).length).toBeGreaterThan(3);
  });

  it("aborts rather than writing a placeholder when a tool is missing", () => {
    // A manifest with "solc": "unknown" looks like evidence while being
    // unreproducible, which is worse than no manifest at all.
    expect(() => captureVersions("/nonexistent/path")).toThrow(ManifestIncomplete);
  });

  it("aborts when the chain cannot be read", async () => {
    await expect(captureChain("http://127.0.0.1:1")).rejects.toThrow(ManifestIncomplete);
  });

  it("records the block the run actually saw", async () => {
    const chain = await captureChain(process.env["RPC_URL"] ?? "http://127.0.0.1:8545");
    expect(chain.chainId).toBe(31337);
    expect(Number(chain.blockNumber)).toBeGreaterThan(0);
  });
});

describe("Wilson intervals", () => {
  it("stays finite at the extremes, where a normal approximation collapses", () => {
    // 0/100 and 100/100 are exactly what this evaluation expects to see, and a normal
    // interval would report +/- 0 and claim a certainty the data does not support.
    const none = wilson(0, 100);
    expect(none.lower).toBe(0);
    expect(none.upper).toBeGreaterThan(0);
    expect(none.upper).toBeLessThan(0.05);

    const all = wilson(100, 100);
    expect(all.upper).toBe(1);
    expect(all.lower).toBeLessThan(1);
    expect(all.lower).toBeGreaterThan(0.95);
  });

  it("matches a known value", () => {
    // 5/100 -> approximately [0.0216, 0.1118] by the Wilson score interval.
    const i = wilson(5, 100);
    expect(i.lower).toBeCloseTo(0.0216, 3);
    expect(i.upper).toBeCloseTo(0.1118, 3);
  });

  it("refuses a proportion with no trials", () => {
    expect(() => wilson(0, 0)).toThrow();
  });
});

describe("summaries and seeding", () => {
  it("reports median, IQR and range", () => {
    const s = summarise([1, 2, 3, 4, 100]);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.n).toBe(5);
  });

  it("is reproducible from a seed", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });
});
