/**
 * SEC-007 — A6: Sybil seller selection against the reputation gate.
 *
 * Source: arXiv 2605.11781 §4.5 (V-14), where five Sybils raised an LLM's selection
 * share to 60.2%. **That was a discovery-ranking experiment, not an escrow gate, so
 * our numbers are not comparable to theirs** and this file never presents them as
 * such. What is reproduced is the *structure* — a ring of cross-endorsing agents — not
 * the measurement.
 *
 * Three gate configurations are compared:
 *
 *  - **none** — no reputation check at all.
 *  - **v1** — the blueprint's rule: `score >= 6000`, `count >= 5`, `distinct >= 3`,
 *    computed over **every** client. It is evaluated here **off-chain, from on-chain
 *    data**, and that is not an implementation detail being glossed over: computing it
 *    on-chain would mean looping over `getClients`, which anyone can inflate, on top of
 *    a `getSummary` that already loops over every entry (DF-09, V-99). It is a
 *    comparison model, never the product.
 *  - **v2** — the implemented gate: `getSummary` against a **bounded list of clients
 *    the buyer named in advance**, enforced on-chain inside `fund()`.
 *
 * ## What is measured, and what is chosen
 *
 * The honest split matters more here than in A2 or A3, because a "capture share" can be
 * manufactured by choosing a selection rule:
 *
 *  - **Eligibility is measured and model-free.** How many honest sellers, Sybils and
 *    newcomers each configuration admits is a fact about the registry and the gate.
 *    For v2 it is confirmed the only way that counts: by sending `fund()` and recording
 *    whether it succeeded or reverted `ReputationTooLow`.
 *  - **Capture share depends on a rule this file chose**, so two rules are reported
 *    rather than one. `top-score` picks the highest-scoring eligible agent, which
 *    flatters the ring because it rates itself at the top of the scale. `weighted`
 *    picks proportionally to score, which is gentler. Neither is "the" answer, and the
 *    spread between them is the honest measure of how much the rule is doing.
 */
import {
  escrowAbi,
  reputationRegistryAbi,
  type ChainClient,
} from "@agenttrust/core";
import type { Address, Hex, WalletClient } from "viem";
import type { HDAccount } from "viem/accounts";
import type { AgentKind, AgentRecord, Population } from "../population.js";
import { seededRandom } from "../stats.js";

export type GateConfig = "none" | "v1" | "v2";
export type SelectionRule = "top-score" | "weighted";

/** The blueprint's thresholds, §9.2. Kept here so the comparison model is legible. */
export const GATE_V1 = { minScore: 6000, minCount: 5, minDistinct: 3 } as const;

export interface Eligibility {
  agentId: string;
  kind: AgentKind;
  /** Score as the registry reports it, in hundredths. Null when there is no feedback. */
  score: number | null;
  /** Entries and distinct clients over **all** feedback — what v1 reads. */
  totalCount: number;
  totalDistinct: number;
  /** Entries and distinct clients over the **trusted** list only — what v2 reads. */
  trustedCount: number;
  trustedDistinct: number;
  eligible: Record<GateConfig, boolean>;
}

export interface A6Result {
  spec: Population["spec"];
  populationLabel: string;
  eligibility: Eligibility[];
  /** Per configuration: how many of each kind are admitted. */
  admitted: Record<GateConfig, Record<AgentKind, number>>;
  /** Per configuration and rule: the share of selections landing on a Sybil. */
  captureShare: Record<GateConfig, Record<SelectionRule, { sybil: number; rounds: number }>>;
  /** Honest sellers wrongly refused, and newcomers refused, per configuration. */
  falseRefusals: Record<GateConfig, { newcomersRefused: number; newcomersTotal: number; honestRefused: number; honestTotal: number }>;
  /** `fund()` actually sent for gate v2 — the only configuration the chain can enforce. */
  onChain: { agentId: string; kind: AgentKind; funded: boolean; revert: string | null }[];
  honestThenDefect: HonestThenDefect | null;
  gasVsHistory: { entries: number; fundGas: string }[];
}

// ------------------------------------------------------------------ reading state

/**
 * Reads what each gate would see. `getSummary` is called twice per agent: once over
 * every client the registry knows, which is v1's view, and once over the buyer's
 * trusted list, which is v2's.
 */
export async function readEligibility(
  chain: ChainClient,
  reputationRegistry: Address,
  tag: string,
  population: Population,
): Promise<Eligibility[]> {
  const out: Eligibility[] = [];

  for (const agent of population.agents) {
    const allClients = (await chain.client.readContract({
      address: reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [agent.agentId],
    })) as Address[];

    const summarise = async (clients: Address[]) => {
      if (clients.length === 0) return { count: 0, value: 0, decimals: 2 };
      const [count, value, decimals] = (await chain.client.readContract({
        address: reputationRegistry,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [agent.agentId, clients, tag, ""],
      })) as [bigint, bigint, number];
      return { count: Number(count), value: Number(value), decimals: Number(decimals) };
    };

    const all = await summarise(allClients);
    const trustedPresent = allClients.filter((c) =>
      population.trustedClients.some((t) => t.toLowerCase() === c.toLowerCase()),
    );
    const trusted = await summarise(trustedPresent);

    // getSummary returns the entry-weighted average already; normalise to hundredths.
    const score = all.count === 0 ? null : Math.round(all.value / 10 ** (all.decimals - 2));

    const eligible: Record<GateConfig, boolean> = {
      none: true,
      v1:
        all.count >= GATE_V1.minCount &&
        allClients.length >= GATE_V1.minDistinct &&
        (score ?? -1) >= GATE_V1.minScore,
      // v2 as the contract enforces it with the floors deployed here: at least one
      // trusted attester and at least one entry. The on-chain check below is what
      // actually decides; this mirrors it so the two can be compared.
      v2: trusted.count >= 1 && trustedPresent.length >= 1,
    };

    out.push({
      agentId: agent.agentId.toString(),
      kind: agent.kind,
      score,
      totalCount: all.count,
      totalDistinct: allClients.length,
      trustedCount: trusted.count,
      trustedDistinct: trustedPresent.length,
      eligible,
    });
  }
  return out;
}

// ------------------------------------------------------------------- selection

/**
 * One buyer choosing one seller. The candidate set is everything the configuration
 * admits; the rule decides which of those is picked.
 */
export function select(
  eligible: Eligibility[],
  rule: SelectionRule,
  random: () => number,
): Eligibility | null {
  if (eligible.length === 0) return null;
  if (rule === "top-score") {
    const best = Math.max(...eligible.map((e) => e.score ?? 0));
    const tied = eligible.filter((e) => (e.score ?? 0) === best);
    return tied[Math.floor(random() * tied.length)]!;
  }
  const weights = eligible.map((e) => Math.max(1, e.score ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let point = random() * total;
  for (let i = 0; i < eligible.length; i++) {
    point -= weights[i]!;
    if (point <= 0) return eligible[i]!;
  }
  return eligible[eligible.length - 1]!;
}

// --------------------------------------------------------------- the experiment

export interface HonestThenDefect {
  agentId: string;
  /** Admitted once it had genuinely earned trusted feedback. */
  admittedAfterEarning: boolean;
  /** Still admitted after it starts behaving badly — the gate cannot see conduct. */
  admittedAfterDefection: boolean;
  /** Refused only once a trusted client withdrew its feedback. */
  admittedAfterRevocation: boolean;
  /** How many entries had to be withdrawn to get there. */
  entriesRevoked: number;
  note: string;
}

export interface A6Deps {
  chain: ChainClient;
  wallet: (account: HDAccount) => WalletClient;
  escrow: Address;
  reputationRegistry: Address;
  token: Address;
  tag: string;
  buyer: HDAccount;
  validator: Address;
  /** Funds one job against a named agent; resolves to a revert string on refusal. */
  tryFund: (agentId: bigint, trustedClients: Address[]) => Promise<{ funded: boolean; revert: string | null }>;
  /** Registers one agent and returns its id. */
  registerAgent: (uri: string, ownerIndex: number) => Promise<bigint>;
  /** Writes one feedback entry from a trusted client. */
  rateFromTrusted: (agentId: bigint, clientIndex: number, value: number) => Promise<void>;
  /**
   * Withdraws every entry a trusted client wrote for this agent.
   *
   * Takes a client rather than an index because ERC-8004's feedback indices are
   * **1-based and per (agent, client)** — `revokeFeedback` requires `index > 0` and
   * `index <= getLastIndex(agentId, client)`. Passing a position from a loop counter
   * reverts, which is how this was found.
   */
  revokeAllFromTrusted: (agentId: bigint, clientIndex: number) => Promise<number>;
  /** Funds one job and reports the gas the transaction used. */
  fundForGas: (agentId: bigint, trustedClients: Address[]) => Promise<bigint>;
}

/**
 * H-A6-5 — a Sybil that behaves well long enough to be trusted.
 *
 * This is the case the gate is *expected to fail*, and saying so plainly is the point
 * of running it. The gate is a **pre-transaction filter**: it reads reputation before
 * money moves and has no view of what the seller does afterwards. An attacker patient
 * enough to earn genuine feedback from a buyer's trusted clients is admitted on the
 * same evidence an honest seller is, because at the moment of the check the two are
 * indistinguishable.
 *
 * The only remedy is retrospective, and it is measured here rather than asserted: a
 * trusted client revokes, and the next `fund()` is refused. Everything that agent was
 * paid for before the revocation stays paid.
 */
async function runHonestThenDefect(
  deps: A6Deps,
  population: Population,
): Promise<HonestThenDefect> {
  // Index far from every cohort so it cannot collide with the population.
  const agentId = await deps.registerAgent("https://patient-sybil.invalid/.well-known/agent-card", 900);

  // Earn it: genuine feedback from the buyer's own trusted clients, exactly as an
  // honest seller accumulates it. Two entries from each of two clients.
  for (const clientIndex of [0, 1]) {
    await deps.rateFromTrusted(agentId, clientIndex, 9600);
    await deps.rateFromTrusted(agentId, clientIndex, 9600);
  }
  const earned = await deps.tryFund(agentId, population.trustedClients);

  // Defect. Nothing on-chain changes: misbehaviour is off-chain conduct, and the gate
  // reads reputation, not conduct. The second fund is the measurement.
  const afterDefection = await deps.tryFund(agentId, population.trustedClients);

  // The remedy. Both trusted clients withdraw everything they wrote: one alone would
  // leave the other's entries standing, which the deployed floors still admit.
  let revoked = 0;
  for (const clientIndex of [0, 1]) revoked += await deps.revokeAllFromTrusted(agentId, clientIndex);
  const afterRevocation = await deps.tryFund(agentId, population.trustedClients);

  return {
    agentId: agentId.toString(),
    admittedAfterEarning: earned.funded,
    admittedAfterDefection: afterDefection.funded,
    admittedAfterRevocation: afterRevocation.funded,
    entriesRevoked: revoked,
    note:
      "The gate is a pre-transaction filter over reputation, not conduct. An agent that " +
      "earns genuine trusted feedback is admitted on the same evidence an honest seller " +
      "is, and defection changes nothing the gate can read. The only remedy is a trusted " +
      "client revoking, which is retrospective: whatever the agent was paid before that " +
      "stays paid. This is a limitation of the mechanism, not a defect in it.",
  };
}

/**
 * `fund()` gas as an agent's feedback history grows.
 *
 * `getSummary` loops over every entry an agent has, so the gate's cost is a function of
 * history the *seller* controls (V-99). The escrow bounds this with a per-read gas
 * ceiling and a `gasleft()` pre-check, so the failure mode is a clean revert rather
 * than a skipped gate — but the cost still climbs, and a number is worth more than the
 * assurance.
 */
async function measureGasVsHistory(
  deps: A6Deps,
  population: Population,
  checkpoints: number[],
): Promise<{ entries: number; fundGas: string }[]> {
  const agentId = await deps.registerAgent("https://history.invalid/.well-known/agent-card", 901);
  const out: { entries: number; fundGas: string }[] = [];
  let written = 0;

  for (const target of checkpoints) {
    while (written < target) {
      await deps.rateFromTrusted(agentId, 0, 9000);
      written += 1;
    }
    const gas = await deps.fundForGas(agentId, population.trustedClients);
    out.push({ entries: written, fundGas: gas.toString() });
  }
  return out;
}

export async function runA6(
  deps: A6Deps,
  population: Population,
  options: { rounds: number; seed: number },
): Promise<A6Result> {
  const eligibility = await readEligibility(deps.chain, deps.reputationRegistry, deps.tag, population);
  const configs: GateConfig[] = ["none", "v1", "v2"];
  const rules: SelectionRule[] = ["top-score", "weighted"];

  const admitted = {} as A6Result["admitted"];
  const captureShare = {} as A6Result["captureShare"];
  const falseRefusals = {} as A6Result["falseRefusals"];

  for (const config of configs) {
    const pool = eligibility.filter((e) => e.eligible[config]);
    admitted[config] = {
      honest: pool.filter((e) => e.kind === "honest").length,
      sybil: pool.filter((e) => e.kind === "sybil").length,
      newcomer: pool.filter((e) => e.kind === "newcomer").length,
    };

    captureShare[config] = {} as Record<SelectionRule, { sybil: number; rounds: number }>;
    for (const rule of rules) {
      // A fresh seeded stream per (config, rule) so one cell cannot shift another.
      const random = seededRandom(options.seed + config.length + rule.length);
      let sybil = 0;
      for (let r = 0; r < options.rounds; r++) {
        const picked = select(pool, rule, random);
        if (picked?.kind === "sybil") sybil += 1;
      }
      captureShare[config][rule] = { sybil, rounds: options.rounds };
    }

    const newcomersTotal = eligibility.filter((e) => e.kind === "newcomer").length;
    const honestTotal = eligibility.filter((e) => e.kind === "honest").length;
    falseRefusals[config] = {
      newcomersTotal,
      newcomersRefused: newcomersTotal - admitted[config].newcomer,
      honestTotal,
      honestRefused: honestTotal - admitted[config].honest,
    };
  }

  // ---- gate v2, as the chain actually enforces it
  const onChain: A6Result["onChain"] = [];
  const sample = [
    eligibility.find((e) => e.kind === "honest"),
    eligibility.find((e) => e.kind === "sybil"),
    eligibility.find((e) => e.kind === "newcomer"),
  ].filter((e): e is Eligibility => e !== undefined);

  for (const candidate of sample) {
    const { funded, revert } = await deps.tryFund(BigInt(candidate.agentId), population.trustedClients);
    onChain.push({ agentId: candidate.agentId, kind: candidate.kind, funded, revert });
  }

  return {
    spec: population.spec,
    populationLabel: population.label,
    eligibility,
    admitted,
    captureShare,
    falseRefusals,
    onChain,
    honestThenDefect: await runHonestThenDefect(deps, population),
    gasVsHistory: await measureGasVsHistory(deps, population, [1, 5, 20, 50, 100]),
  };
}
