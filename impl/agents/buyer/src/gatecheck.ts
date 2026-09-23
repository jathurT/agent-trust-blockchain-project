/**
 * AGENT-002 step 3 — pre-check the reputation gate off-chain.
 *
 * The escrow enforces the gate in `fund()`, so this changes no security property. What
 * it changes is the buyer's experience and the evaluation's clarity: a seller the gate
 * would refuse is refused **here**, for a stated reason, with no transaction sent and
 * no gas spent. Acceptance (c) is exactly that — "a gated seller never receives a
 * funding transaction".
 *
 * It reads through the same `getSummary` the escrow reads, per trusted client, so a
 * disagreement between this answer and the chain's would be a bug rather than a race —
 * except at the boundary, where feedback can land between the check and the
 * transaction. The escrow is authoritative; this is advisory and says so.
 */
import { escrowAbi, reputationRegistryAbi, type ChainClient } from "@agenttrust/core";
import type { Address } from "viem";

export interface GatePolicy {
  trustedClients: Address[];
  minDistinct: number;
  minCount: bigint;
  minAvgValue: bigint;
}

export interface GateVerdict {
  passes: boolean;
  distinct: number;
  count: bigint;
  /** Entry-weighted average in the project's two-decimal units, or null with no data. */
  average: bigint | null;
  /** Which requirement failed first, for a message a human can act on. */
  failed?: "distinct" | "count" | "average";
  /** Floors read from the escrow, which a buyer cannot go below. */
  floors: { minDistinct: number; minCount: bigint; minAvgValue: bigint };
}

const WAD = 18;
const FEEDBACK_DECIMALS = 2;

export async function precheckGate(
  chain: ChainClient,
  reputationRegistry: Address,
  agentId: bigint,
  policy: GatePolicy,
): Promise<GateVerdict> {
  const [tag, floorDistinct, floorCount, floorAvg] = (await Promise.all([
    chain.client.readContract({ address: chain.escrow, abi: escrowAbi, functionName: "FEEDBACK_TAG" }),
    chain.client.readContract({ address: chain.escrow, abi: escrowAbi, functionName: "minDistinctFloor" }),
    chain.client.readContract({ address: chain.escrow, abi: escrowAbi, functionName: "minCountFloor" }),
    chain.client.readContract({ address: chain.escrow, abi: escrowAbi, functionName: "minAvgValueFloor" }),
  ])) as [string, number, bigint, bigint];

  let distinct = 0;
  let count = 0n;
  let weightedWad = 0n;

  for (const client of policy.trustedClients) {
    let summary: readonly [bigint, bigint, number];
    try {
      summary = (await chain.client.readContract({
        address: reputationRegistry,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [agentId, [client], tag, ""],
      })) as readonly [bigint, bigint, number];
    } catch {
      // The escrow treats an unreadable client as contributing nothing; so does this.
      continue;
    }
    const [entryCount, value, decimals] = summary;
    if (entryCount === 0n) continue;
    distinct += 1;
    count += entryCount;
    weightedWad += value * 10n ** BigInt(WAD - decimals) * entryCount;
  }

  // A buyer may be stricter than the owner's floors, never weaker (CONTRACT-005).
  const floors = { minDistinct: floorDistinct, minCount: floorCount, minAvgValue: floorAvg };
  const requiredDistinct = Math.max(policy.minDistinct, floorDistinct);
  const requiredCount = policy.minCount > floorCount ? policy.minCount : floorCount;
  const requiredAvg = policy.minAvgValue > floorAvg ? policy.minAvgValue : floorAvg;

  const average =
    count === 0n ? null : weightedWad / count / 10n ** BigInt(WAD - FEEDBACK_DECIMALS);

  if (distinct < requiredDistinct) return { passes: false, distinct, count, average, failed: "distinct", floors };
  if (count < requiredCount) return { passes: false, distinct, count, average, failed: "count", floors };
  if (average !== null && average < requiredAvg) {
    return { passes: false, distinct, count, average, failed: "average", floors };
  }
  if (average === null && requiredAvg > 0n) {
    return { passes: false, distinct, count, average, failed: "average", floors };
  }
  return { passes: true, distinct, count, average, floors };
}
