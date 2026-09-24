/**
 * INT-001/002 — the end-to-end runner.
 *
 * Every service is the real one: the deployed escrow and ERC-8004 mocks on Anvil, the
 * Express seller with its claim store, the **Python** validator in its own process, and
 * the deterministic buyer. Nothing here is stubbed, because the point of an end-to-end
 * run is to catch the things that only appear when the real pieces meet — the agent id
 * decoding bug and the cross-process nonce collision both surfaced that way.
 *
 * Per-stage timestamps go to `timings.ndjson` (EVAL-006). They are latency measurements
 * of a **local devnet**, and must never be quoted as testnet numbers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import {
  createChainClient,
  escrowAbi,
  identityRegistryAbi,
  reputationRegistryAbi,
  type ChainClient,
} from "@agenttrust/core";
import { createApp } from "@agenttrust/seller/src/server.js";
import { createPaymentGate } from "@agenttrust/seller/src/gate.js";
import { createDeliveryHandler } from "@agenttrust/seller/src/deliver.js";
import { ClaimStore } from "@agenttrust/seller/src/claims.js";
import {
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..", "..", "..");

// The public Anvil test mnemonic: valueless, never funded, allowlisted in the
// secret-scan hook so it can appear here.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";

export const accounts = {
  deployer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 }),
  buyer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }),
  seller: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 }),
  validator: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 }),
  trustedClient: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 4 }),
};

export interface Deployment {
  chainId: number;
  escrow: Address;
  token: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  validationRegistry: Address;
}

export const deployment: Deployment = JSON.parse(
  readFileSync(join(ROOT, "deployments", "31337.json"), "utf8"),
) as Deployment;

export const chainDef = {
  id: deployment.chainId,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

export const wallet = (account: HDAccount) =>
  createWalletClient({ account, chain: chainDef, transport: http(RPC) });

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

// ------------------------------------------------------------------------ timings

export class Timeline {
  private readonly path: string;
  private readonly started = Date.now();
  readonly stages: { stage: string; atMs: number; sinceStartMs: number; detail?: unknown }[] = [];

  constructor(dir: string, readonly runId: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "timings.ndjson");
    writeFileSync(this.path, "");
  }

  mark(stage: string, detail?: unknown): void {
    const now = Date.now();
    const record = { runId: this.runId, stage, atMs: now, sinceStartMs: now - this.started, detail };
    this.stages.push(record);
    appendFileSync(this.path, JSON.stringify(record) + "\n");
  }

  durations(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 1; i < this.stages.length; i++) {
      out[`${this.stages[i - 1]!.stage}->${this.stages[i]!.stage}`] =
        this.stages[i]!.atMs - this.stages[i - 1]!.atMs;
    }
    out["total"] = (this.stages.at(-1)?.atMs ?? this.started) - this.started;
    return out;
  }
}

// ------------------------------------------------------------------- the services

export interface Stack {
  chain: ChainClient;
  agentId: bigint;
  payee: Address;
  sellerServer: Server;
  sellerOrigin: string;
  claims: ClaimStore;
  validator?: ChildProcess;
  validatorUrl: string;
  dir: string;
  stop(): Promise<void>;
}

async function waitForHealth(url: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${url} never became healthy`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export interface StackOptions {
  sellerPort: number;
  validatorPort: number;
  /** INT-002 case 1: run without a validator at all. */
  startValidator?: boolean;
  /** Seconds. Short TTLs let the refund path run without waiting. */
  ttlSeconds?: number;
  minDeadlineMargin?: number;
}

export async function startStack(options: StackOptions): Promise<Stack> {
  const dir = mkdtempSync(join(tmpdir(), "agenttrust-e2e-"));
  const sellerOrigin = `http://127.0.0.1:${options.sellerPort}`;
  const validatorUrl = `http://127.0.0.1:${options.validatorPort}`;

  const chain = createChainClient({
    rpcUrl: RPC,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    pollIntervalMs: 200,
  });
  await chain.verifyChainId();

  // A fresh agent per run, so a run never depends on what a previous one left behind.
  const registerTx = await wallet(accounts.seller).writeContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [`${sellerOrigin}/.well-known/agent-card`],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash: registerTx });
  const registered = parseEventLogs({
    abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
    logs: receipt.logs,
  });
  const agentId = registered[0]!.args.agentId;

  // One endorsement from an address the buyer trusts, so the gate can pass.
  const tag = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  const feedbackTx = await wallet(accounts.trustedClient).writeContract({
    address: deployment.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [agentId, 9500n, 2, tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
  });
  await chain.client.waitForTransactionReceipt({ hash: feedbackTx });

  await wallet(accounts.deployer).writeContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts.buyer.address, 1_000_000_000n],
  });

  const payee = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "previewPayee",
    args: [agentId],
  })) as Address;

  // REG-006 step 4. Three roles must be the same key: the agent **owner** (who may call
  // `validationRequest`), the **agentWallet** the escrow snapshots as payee (who must
  // call `bindValidation`), and the key the seller signs and sends with. They are the
  // same here because they are the same account — but "because they happen to be" is
  // not a property, and on Base Sepolia three keys means three keys to fund
  // (ENV-006/007). Asserted at setup so a fixture change cannot quietly split them.
  const owner = (await chain.client.readContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [agentId],
  })) as Address;
  const sellerKey = accounts.seller.address;
  if (owner.toLowerCase() !== sellerKey.toLowerCase() || payee.toLowerCase() !== sellerKey.toLowerCase()) {
    throw new Error(
      `REG-006: owner (${owner}), agentWallet/payee (${payee}) and the seller key ` +
        `(${sellerKey}) must be one address. Split, validationRequest and bindValidation ` +
        `come from different keys and both need funding.`,
    );
  }

  // The Python validator, in its own process, with its own key.
  let validator: ChildProcess | undefined;
  if (options.startValidator !== false) {
    validator = spawn(
      "uv",
      ["run", "uvicorn", "agenttrust_validator.main:app", "--host", "127.0.0.1", "--port", String(options.validatorPort)],
      {
        cwd: join(ROOT, "impl", "validator"),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          RPC_URL: RPC,
          CHAIN_ID: String(deployment.chainId),
          ESCROW_ADDRESS: deployment.escrow,
          VALIDATION_REGISTRY: deployment.validationRegistry,
          IDENTITY_REGISTRY: deployment.identityRegistry,
          VALIDATOR_PRIVATE_KEY: accounts.validator.getHdKey().privateKey
            ? `0x${Buffer.from(accounts.validator.getHdKey().privateKey!).toString("hex")}`
            : "",
          EVIDENCE_DIR: join(dir, "evidence-store"),
          BINDING_TIMEOUT_SECONDS: "30",
          POLL_INTERVAL_SECONDS: "0.2",
        },
      },
    );
    // Everything the validator says goes to a file; a background attestation that
    // fails silently is exactly the failure mode this has to make visible.
    const validatorLog = join(dir, "validator.log");
    writeFileSync(validatorLog, "");
    const capture = (c: Buffer) => appendFileSync(validatorLog, c.toString());
    validator.stderr?.on("data", capture);
    validator.stdout?.on("data", capture);
    (validator as ChildProcess & { logPath?: string }).logPath = validatorLog;
    await waitForHealth(validatorUrl);
  }

  const claims = new ClaimStore({ path: join(dir, "claims.sqlite") });
  const app = createApp({
    // API-007's per-request line is real output, but a measurement harness that
    // prints one per replay buries the counter the run is about. The real server
    // (`main.ts`) leaves it on.
    accessLog: false,
    origin: sellerOrigin,
    agentId: agentId.toString(),
    gated: true,
    acceptedValidators: [accounts.validator.address],
    paymentGate: createPaymentGate({
      chain,
      config: {
        origin: sellerOrigin,
        agentId,
        escrow: deployment.escrow,
        token: deployment.token,
        chainId: deployment.chainId,
        acceptedValidators: [accounts.validator.address],
        ttlSeconds: options.ttlSeconds ?? 900,
        minDeadlineMargin: options.minDeadlineMargin ?? 60,
        quoteTtlSeconds: 120,
      },
      verify: {
        config: {
          origin: sellerOrigin,
          agentId,
          payee,
          token: deployment.token,
          chainId: deployment.chainId,
          escrow: deployment.escrow,
          acceptedValidators: [accounts.validator.address],
          minDeadlineMargin: options.minDeadlineMargin ?? 60,
          confirmations: 0,
        },
        nonces: {
          seen: (jobId: Hex, nonce: Hex) => claims.seenNonce(jobId, nonce),
          remember: (jobId: Hex, nonce: Hex) => {
            claims.claimNonce(jobId, nonce);
          },
        },
      },
    }),
    deliver: createDeliveryHandler({
      claims,
      chainId: deployment.chainId,
      replayPolicy: "idempotent",
      evidence: {
        chain,
        wallet: wallet(accounts.seller),
        account: accounts.seller,
        validationRegistry: deployment.validationRegistry,
        validatorUrl,
        agentId,
        retryBudget: 3,
      },
    }),
  });

  const sellerServer = await new Promise<Server>((resolve) => {
    const s = app.listen(options.sellerPort, () => resolve(s));
  });

  return {
    chain,
    agentId,
    payee,
    sellerServer,
    sellerOrigin,
    claims,
    validator,
    validatorUrl,
    dir,
    async stop() {
      claims.close();
      await new Promise<void>((resolve) => sellerServer.close(() => resolve()));
      if (validator?.pid !== undefined) {
        // Stop capturing first: the listeners write into `dir`, and a chunk arriving
        // after the directory is gone crashes the runner on the way out.
        validator.stdout?.removeAllListeners("data");
        validator.stderr?.removeAllListeners("data");
        try {
          process.kill(-validator.pid, "SIGTERM");
        } catch {
          validator.kill("SIGTERM");
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function balanceOf(chain: ChainClient, who: Address): Promise<bigint> {
  return (await chain.client.readContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [who],
  })) as bigint;
}
