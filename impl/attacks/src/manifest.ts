/**
 * SEC-002 — the run manifest.
 *
 * CLAUDE.md §12: a number appears in the docs or the slides only if it came from a
 * recorded run, and every measured run records its commit, tool versions, chain and
 * block, configuration, seed, run count and raw log paths.
 *
 * This module **aborts the run** when any of that cannot be captured. A manifest with
 * `"solc": "unknown"` is worse than no manifest: it looks like evidence while being
 * unreproducible, and nobody reading the results later would know which of the numbers
 * to distrust.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, http, type Address } from "viem";

/** Foundry installs per-user and is not on a non-login shell's PATH. */
const TOOL_ENV = { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env["PATH"] ?? ""}` };

export class ManifestIncomplete extends Error {
  constructor(what: string) {
    super(
      `cannot capture ${what}, so this run would not be reproducible. ` +
        `Refusing to produce results rather than recording an unknown (CLAUDE.md §12).`,
    );
    this.name = "ManifestIncomplete";
  }
}

function capture(what: string, command: string, args: string[], extract: (out: string) => string): string {
  let raw: string;
  try {
    raw = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: TOOL_ENV });
  } catch (error) {
    throw new ManifestIncomplete(`${what} (${command} ${args.join(" ")} failed: ${(error as Error).message})`);
  }
  const value = extract(raw).trim();
  if (!value) throw new ManifestIncomplete(`${what} (no version in the output)`);
  return value;
}

export interface Versions {
  git: string;
  dirty: boolean;
  node: string;
  pnpm: string;
  python: string;
  foundry: string;
  solc: string;
  packages: Record<string, string>;
}

export function captureVersions(root: string): Versions {
  const git = capture("the git commit", "git", ["-C", root, "rev-parse", "HEAD"], (s) => s);
  const status = capture("the git status", "git", ["-C", root, "status", "--porcelain"], (s) => s || "clean");

  const foundry = capture("the Foundry version", "forge", ["--version"], (s) => s.split("\n")[0] ?? "");
  const solcPinned = /solc\s*=\s*"([^"]+)"/.exec(readFileSync(`${root}/impl/contracts/foundry.toml`, "utf8"))?.[1];
  if (!solcPinned) throw new ManifestIncomplete("the pinned solc version from foundry.toml");

  const pkg = JSON.parse(readFileSync(`${root}/impl/attacks/package.json`, "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  return {
    git,
    dirty: status !== "clean",
    node: process.version,
    pnpm: capture("the pnpm version", "pnpm", ["--version"], (s) => s),
    python: capture("the Python version", "python3", ["--version"], (s) => s.replace("Python", "")),
    foundry,
    solc: solcPinned,
    packages: { ...pkg.dependencies, ...pkg.devDependencies },
  };
}

export interface ChainFacts {
  chainId: number;
  rpc: string;
  blockNumber: string;
  blockTimestamp: number;
}

export async function captureChain(rpc: string): Promise<ChainFacts> {
  const client = createPublicClient({ transport: http(rpc) });
  let chainId: number;
  let block: { number: bigint | null; timestamp: bigint };
  try {
    chainId = await client.getChainId();
    block = await client.getBlock({ blockTag: "latest" });
  } catch (error) {
    throw new ManifestIncomplete(`the chain state at ${rpc} (${(error as Error).message})`);
  }
  return {
    chainId,
    rpc,
    blockNumber: String(block.number ?? 0n),
    blockTimestamp: Number(block.timestamp),
  };
}

export interface Manifest {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  attackId: string;
  target: string;
  targetVersion: string;
  configName: string;
  gitCommit: string;
  dirty: boolean;
  env: ChainFacts & { mode: string; confirmations: number };
  versions: Versions;
  contracts: Record<string, Address | string>;
  params: Record<string, unknown>;
  notes: string[];
}

export async function buildManifest(input: {
  root: string;
  runId: string;
  attackId: string;
  target: string;
  targetVersion: string;
  configName: string;
  rpc: string;
  confirmations: number;
  contracts: Record<string, Address | string>;
  params: Record<string, unknown>;
  notes?: string[];
}): Promise<Manifest> {
  const versions = captureVersions(input.root);
  const chain = await captureChain(input.rpc);

  const notes = [...(input.notes ?? [])];
  if (versions.dirty) {
    // Not fatal — a dirty tree during development is normal — but it must be visible,
    // because the commit alone no longer identifies what ran.
    notes.push("WARNING: the working tree was dirty; the commit does not fully identify this build.");
  }
  if (chain.chainId === 31337) {
    notes.push(
      "Local Anvil (chain 31337). These are devnet measurements: latencies, gas and " +
        "confirmation behaviour do not transfer to Base Sepolia.",
    );
  }

  return {
    runId: input.runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    attackId: input.attackId,
    target: input.target,
    targetVersion: input.targetVersion,
    configName: input.configName,
    gitCommit: versions.git,
    dirty: versions.dirty,
    env: { ...chain, mode: chain.chainId === 31337 ? "anvil" : "testnet", confirmations: input.confirmations },
    versions,
    contracts: input.contracts,
    params: input.params,
    notes,
  };
}
