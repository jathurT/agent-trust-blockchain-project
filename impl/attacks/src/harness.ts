/**
 * SEC-002 — the harness.
 *
 *   npx tsx src/harness.ts --id a2_replay --target fixture --runs 10 --replays 50
 *   npx tsx src/harness.ts --id a3_cross_resource --target agenttrust --rounds 100
 *
 * Writes `impl/attacks/results/<runId>/{manifest.json,results.json,raw.ndjson}`. It
 * refuses to write anything at all if the manifest cannot be completed, because a
 * result without a reproducible provenance is not evidence (CLAUDE.md §12).
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, ManifestIncomplete } from "./manifest.js";
import { startAgentTrust, startFixture, type Deployment, type Target } from "./targets.js";
import { runA2, summariseA2, type A2RunResult, type Variant } from "./attacks/a2-replay.js";
import { runA3Round, summariseA3, type A3RoundResult } from "./attacks/a3-cross-resource.js";
import { FIXTURE_LABEL, VANILLA_CORRECTION } from "./fixture-label.js";
import { seededRandom } from "./stats.js";
import {
  ACCOUNT_INDEX,
  buildPopulation,
  DEFAULT_SPEC,
  fixtureAccount,
  fundForGas as fundPopulationGas,
  TEST_MNEMONIC,
} from "./population.js";
import { runA6 } from "./attacks/a6-sybil.js";
import { createChainClient, escrowAbi, identityRegistryAbi, reputationRegistryAbi } from "@agenttrust/core";
import { createWalletClient, http, keccak256, parseAbi, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

interface Args {
  id: "a2_replay" | "a3_cross_resource" | "a6_sybil";
  target: "fixture" | "agenttrust";
  runs: number;
  replays: number;
  rounds: number;
  concurrency: number;
  seed: number;
  variant: Variant;
  rpc: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1 || argv[i + 1] === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`--${name} is required`);
    }
    return argv[i + 1]!;
  };
  const id = get("id") as Args["id"];
  if (id !== "a2_replay" && id !== "a3_cross_resource" && id !== "a6_sybil") {
    throw new Error(`unknown attack: ${id}`);
  }
  // A6 is not a two-target comparison: it compares gate *configurations* against one
  // populated registry, so there is no fixture to stand opposite AgentTrust. The
  // target is fixed rather than required, so `--target` is not asked for.
  if (id === "a6_sybil") {
    return {
      id,
      target: "agenttrust",
      runs: Number(get("runs", "10")),
      replays: 0,
      rounds: Number(get("rounds", "1000")),
      concurrency: 1,
      seed: Number(get("seed", "1")),
      variant: "original" as Variant,
      rpc: get("rpc", process.env["RPC_URL"] ?? "http://127.0.0.1:8545"),
    };
  }

  // Blueprint §18 spells the baseline `vanilla`. The spelling is accepted so the
  // documented commands run, but it is corrected on the way in and never reaches a
  // manifest or a result file: nothing upstream runs here (CLAUDE.md §12).
  let target = get("target") as Args["target"] | "vanilla";
  if (target === "vanilla") {
    console.warn(`\n${VANILLA_CORRECTION}\n`);
    target = "fixture";
  }
  if (target !== "fixture" && target !== "agenttrust") throw new Error(`unknown target: ${target}`);

  return {
    id,
    target,
    runs: Number(get("runs", "10")),
    replays: Number(get("replays", "50")),
    rounds: Number(get("rounds", "100")),
    concurrency: Number(get("concurrency", "1")),
    seed: Number(get("seed", "1")),
    variant: get("variant", "original") as Variant,
    rpc: get("rpc", process.env["RPC_URL"] ?? "http://127.0.0.1:8545"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const deployment = JSON.parse(readFileSync(join(ROOT, "deployments", "31337.json"), "utf8")) as Deployment;

  const configName =
    args.id === "a2_replay"
      ? `${args.variant}-${args.replays}x${args.concurrency}`
      : args.id === "a6_sybil"
        ? `ring5-${args.rounds}`
        : `siblings-${args.rounds}`;
  const runId = `${args.id}-${args.target}-${configName}-${Date.now()}`;
  const outDir = join(ROOT, "impl", "attacks", "results", runId);

  // Build the manifest **before** running anything: a run that cannot be described
  // should not be performed, let alone reported.
  let manifest;
  try {
    manifest = await buildManifest({
      root: ROOT,
      runId,
      attackId: args.id,
      target: args.target,
      targetVersion: args.target === "fixture" ? "vulnerable-fixture-v1" : "escrow+claimstore",
      configName,
      rpc: args.rpc,
      confirmations: 0,
      contracts: {
        escrow: deployment.escrow,
        token: deployment.token,
        identity: deployment.identityRegistry,
        reputation: deployment.reputationRegistry,
        validation: deployment.validationRegistry,
      },
      params: {
        runs: args.runs,
        replays: args.replays,
        rounds: args.rounds,
        concurrency: args.concurrency,
        seed: args.seed,
        variant: args.variant,
        replayPolicy: "idempotent",
        sellerProcesses: args.target === "agenttrust" ? 2 : 1,
      },
      notes:
        args.target === "fixture"
          ? [FIXTURE_LABEL]
          : ["AgentTrust with the escrow, the reputation gate and the atomic claim store."],
    });
  } catch (error) {
    if (error instanceof ManifestIncomplete) {
      process.stderr.write(`${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  mkdirSync(outDir, { recursive: true });

  if (args.id === "a6_sybil") {
    const results = await runA6Experiment(args, deployment, outDir);
    manifest.finishedAt = new Date().toISOString();
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(outDir, "results.json"),
      JSON.stringify(
        {
          runId,
          attackId: args.id,
          target: "agenttrust",
          targetLabel: null,
          config: configName,
          metrics: results,
          outcome: null,
          hypothesis: "H-A6-1..5",
          hypothesisHeld: null,
          rawLogs: ["raw.ndjson"],
        },
        null,
        2,
      ),
    );
    process.stdout.write(JSON.stringify({ runId, outDir, metrics: results }, null, 2) + "\n");
    return;
  }

  const rawPath = join(outDir, "raw.ndjson");
  writeFileSync(rawPath, "");
  const raw = (record: unknown) => appendFileSync(rawPath, JSON.stringify(record) + "\n");

  // Seeded, so `--seed` genuinely reproduces a run rather than merely being recorded.
  const random = seededRandom(args.seed);
  const body = `{"text":"One. Two. Three. Escrow protects the buyer. seed=${args.seed} r=${random().toFixed(6)}"}`;

  const target: Target =
    args.target === "fixture"
      ? await startFixture({ rpc: args.rpc, deployment, port: 8701 })
      : await startAgentTrust({ rpc: args.rpc, deployment, sellerPorts: [8711, 8712], root: ROOT });

  let results: Record<string, unknown>;
  try {
    if (args.id === "a2_replay") {
      const runResults: A2RunResult[] = [];
      for (let run = 1; run <= args.runs; run++) {
        const r = await runA2(
          target,
          { replays: args.replays, concurrency: args.concurrency, variant: args.variant, path: "/v1/summarise", body },
          { chainId: deployment.chainId, escrow: deployment.escrow },
          run,
        );
        raw(r);
        runResults.push(r);
        process.stderr.write(
          `  run ${run}/${args.runs}: executions=${r.counters.executions_completed} ` +
            `distinct=${r.counters.distinct_results} unauthorized2xx=${r.unauthorized_2xx}\n`,
        );
      }
      results = summariseA2(runResults, args.replays) as unknown as Record<string, unknown>;
    } else {
      const rounds: A3RoundResult[] = [];
      for (let round = 1; round <= args.rounds; round++) {
        const r = await runA3Round(
          target,
          { rounds: args.rounds, paidPath: "/v1/summarise", substitutePath: "/v1/classify", body },
          round,
        );
        raw(r);
        rounds.push(r);
        if (round % 20 === 0) process.stderr.write(`  round ${round}/${args.rounds}\n`);
      }
      results = summariseA3(rounds) as unknown as Record<string, unknown>;
    }
  } finally {
    await target.stop();
  }

  manifest.finishedAt = new Date().toISOString();
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const record = {
    runId,
    attackId: args.id,
    target: args.target,
    targetLabel: target.label,
    config: configName,
    metrics: results,
    // Deliberately left null here. The category is a judgement about what the numbers
    // mean, and it is assigned in EVAL-004 from the aggregate, not guessed per run.
    outcome: null,
    hypothesis: args.id === "a2_replay" ? (args.target === "fixture" ? "H-A2-1" : "H-A2-2") : args.target === "fixture" ? "H-A3-1" : "H-A3-2",
    hypothesisHeld: null,
    rawLogs: ["raw.ndjson"],
  };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(record, null, 2));

  process.stdout.write(JSON.stringify({ runId, outDir, metrics: results }, null, 2) + "\n");
}

/**
 * SEC-007 — build a populated registry, then ask each gate configuration who it admits.
 *
 * Everything here runs against the same chain and the same escrow the other attacks
 * use. Gate v2's verdict is taken from a real `fund()` transaction rather than from the
 * mirror in `readEligibility`, so the reported number is the contract's own answer.
 */
async function runA6Experiment(
  args: Args,
  deployment: Deployment,
  outDir: string,
): Promise<Record<string, unknown>> {
  const rawPath = join(outDir, "raw.ndjson");
  writeFileSync(rawPath, "");
  const raw = (record: unknown) => appendFileSync(rawPath, JSON.stringify(record) + "\n");

  const chain = createChainClient({
    rpcUrl: args.rpc,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    pollIntervalMs: 200,
  });
  const chainDef = {
    id: deployment.chainId,
    name: `chain-${deployment.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [args.rpc] } },
  } as const;
  const wallet = (account: HDAccount) =>
    createWalletClient({ account, chain: chainDef, transport: http(args.rpc) });

  const tag = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  // FEEDBACK_DECIMALS is `internal constant` in the escrow, so there is no accessor to
  // read it from. 2 is the value fixed by SPEC-003 §1 — feedback is in hundredths, so
  // 9500 is 95.00 — and the gate normalises whatever decimals the registry reports
  // before comparing, so a mismatch here would show up as a wrong score rather than
  // silently passing.
  const decimals = 2;

  const buyer = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 });
  const validator = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 }).address;
  const deployer = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 });

  const spec = { ...DEFAULT_SPEC, seed: args.seed };
  process.stderr.write(
    `  building population: ${spec.honest} honest, ${spec.sybils} sybils, ${spec.newcomers} newcomers\n`,
  );
  const population = await buildPopulation(
    {
      chain,
      wallet,
      rpcUrl: args.rpc,
      chainId: deployment.chainId,
      identityRegistry: deployment.identityRegistry,
      reputationRegistry: deployment.reputationRegistry,
      tag,
      decimals,
    },
    spec,
  );
  raw({ stage: "population", agents: population.agents.map((a) => ({ ...a, agentId: a.agentId.toString() })) });

  // Fund the buyer generously: every `fund()` below locks the price, and the refused
  // ones lock nothing, so this only has to cover the successes.
  const tokenAbi = parseAbi([
    "function mint(address to, uint256 amount)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  for (const call of [
    { account: deployer, fn: "mint" as const, args: [buyer.address, 10_000_000_000n] as const },
  ]) {
    const hash = await wallet(call.account).writeContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: call.fn,
      args: call.args,
      account: call.account,
      chain: null,
    });
    await chain.client.waitForTransactionReceipt({ hash });
  }
  const approveHash = await wallet(buyer).writeContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [deployment.escrow, 10_000_000_000n],
    account: buyer,
    chain: null,
  });
  await chain.client.waitForTransactionReceipt({ hash: approveHash });

  let nonceCounter = BigInt(Date.now()) * 1000n;
  const tryFund = async (agentId: bigint, trustedClients: Address[]) => {
    const ref = {
      methodHash: keccak256(toHex("POST")),
      uriHash: keccak256(toHex(`https://a6.invalid/v1/summarise?agent=${agentId}`)),
      bodyHash: keccak256(toHex('{"text":"A6"}')),
    };
    const nonce = `0x${(nonceCounter++).toString(16).padStart(64, "0")}` as Hex;
    try {
      const hash = await wallet(buyer).writeContract({
        address: deployment.escrow,
        abi: escrowAbi,
        functionName: "fund",
        args: [
          agentId,
          deployment.token,
          250_000n,
          ref,
          nonce,
          900n,
          validator,
          // The floors as deployed; the buyer asks for nothing stricter, so the only
          // thing under test is whether a trusted client vouched for this agent.
          { trustedClients, minDistinct: 1, minCount: 1n, minAvgValue: 0n },
        ],
        account: buyer,
        chain: null,
      });
      await chain.client.waitForTransactionReceipt({ hash });
      return { funded: true, revert: null };
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      const named = /(\w*ReputationTooLow\w*|\w*Error\w*)\s*\(/.exec(message);
      return { funded: false, revert: named?.[1] ?? message.split("\n")[0] ?? "reverted" };
    }
  };

  // The two extra agents SEC-007 registers for itself, funded like the population.
  await fundPopulationGas(args.rpc, deployment.chainId, [
    fixtureAccount(900).address,
    fixtureAccount(901).address,
  ]);

  const registerAgent = async (uri: string, ownerIndex: number): Promise<bigint> => {
    const owner = fixtureAccount(ownerIndex);
    const hash = await wallet(owner).writeContract({
      address: deployment.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [uri],
      account: owner,
      chain: null,
    });
    const receipt = await chain.client.waitForTransactionReceipt({ hash });
    const logs = parseEventLogs({
      abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
      logs: receipt.logs,
    });
    const id = logs[0]?.args.agentId;
    if (id === undefined) throw new Error("register() emitted no Registered event");
    return id;
  };

  const rateFromTrusted = async (agentId: bigint, clientIndex: number, value: number): Promise<void> => {
    const client = fixtureAccount(ACCOUNT_INDEX.trustedClient + clientIndex);
    const hash = await wallet(client).writeContract({
      address: deployment.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [agentId, BigInt(value), decimals, tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
      account: client,
      chain: null,
    });
    await chain.client.waitForTransactionReceipt({ hash });
  };

  const revokeFromTrusted = async (agentId: bigint, clientIndex: number, feedbackIndex: number): Promise<void> => {
    const client = fixtureAccount(ACCOUNT_INDEX.trustedClient + clientIndex);
    const hash = await wallet(client).writeContract({
      address: deployment.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "revokeFeedback",
      args: [agentId, BigInt(feedbackIndex)],
      account: client,
      chain: null,
    });
    await chain.client.waitForTransactionReceipt({ hash });
  };

  const fundGasOf = async (agentId: bigint, trustedClients: Address[]): Promise<bigint> => {
    const ref = {
      methodHash: keccak256(toHex("POST")),
      uriHash: keccak256(toHex(`https://a6.invalid/v1/summarise?gas=${agentId}-${nonceCounter}`)),
      bodyHash: keccak256(toHex('{"text":"A6"}')),
    };
    const nonce = `0x${(nonceCounter++).toString(16).padStart(64, "0")}` as Hex;
    const hash = await wallet(buyer).writeContract({
      address: deployment.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [
        agentId,
        deployment.token,
        250_000n,
        ref,
        nonce,
        900n,
        validator,
        { trustedClients, minDistinct: 1, minCount: 1n, minAvgValue: 0n },
      ],
      account: buyer,
      chain: null,
    });
    const receipt = await chain.client.waitForTransactionReceipt({ hash });
    return receipt.gasUsed;
  };

  process.stderr.write(`  running ${args.rounds} selection rounds per configuration\n`);
  const result = await runA6(
    {
      chain,
      wallet,
      escrow: deployment.escrow,
      reputationRegistry: deployment.reputationRegistry,
      token: deployment.token,
      tag,
      buyer,
      validator,
      tryFund,
      registerAgent,
      rateFromTrusted,
      revokeFromTrusted,
      fundForGas: fundGasOf,
    },
    population,
    { rounds: args.rounds, seed: args.seed },
  );
  raw({ stage: "result", result: JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });

  return JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Record<
    string,
    unknown
  >;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
