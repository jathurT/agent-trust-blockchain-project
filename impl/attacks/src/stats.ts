/**
 * SEC-002 — the statistics the evaluation plan requires.
 *
 * Proportions get a **Wilson 95% interval**, not a normal approximation: at 0/100 or
 * 100/100 — exactly the results this evaluation expects — the normal interval collapses
 * to a point and claims a certainty the data does not support. Wilson stays finite
 * there, which is the whole reason the plan names it (§6).
 */

export interface Interval {
  metric: string;
  n: number;
  successes: number;
  proportion: number;
  lower: number;
  upper: number;
  method: "wilson-95";
}

export function wilson(successes: number, n: number, metric = "proportion"): Interval {
  if (n <= 0) throw new Error("a proportion needs at least one trial");
  const z = 1.959963984540054; // 95%
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  // At p = 0 the bound is exactly 0 in real arithmetic but ~3e-18 in floating point,
  // and a results file reporting a lower bound of 3.34e-18 is reporting noise.
  const clamp = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - 1) < 1e-12 ? 1 : x);
  return {
    metric,
    n,
    successes,
    proportion: p,
    lower: clamp(Math.max(0, (centre - spread) / denominator)),
    upper: clamp(Math.min(1, (centre + spread) / denominator)),
    method: "wilson-95",
  };
}

export interface Summary {
  n: number;
  median: number;
  iqr: [number, number];
  min: number;
  max: number;
  mean: number;
}

export function summarise(values: number[]): Summary {
  if (values.length === 0) throw new Error("no values to summarise");
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    const index = (sorted.length - 1) * q;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return low === high ? sorted[low]! : sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low);
  };
  return {
    n: sorted.length,
    median: at(0.5),
    iqr: [at(0.25), at(0.75)],
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

/** Deterministic PRNG so `--seed` actually reproduces a run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}
