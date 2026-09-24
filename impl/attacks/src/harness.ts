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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

interface Args {
  id: "a2_replay" | "a3_cross_resource";
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
  if (id !== "a2_replay" && id !== "a3_cross_resource") throw new Error(`unknown attack: ${id}`);
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

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
