import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
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
import { purchase, nonceFor, type BuyerConfig, type PurchaseRequest } from "../src/buyer.js";
import { BuyerAbort } from "../src/errors.js";

/**
 * AGENT-002 — the buyer end to end against the real seller and the deployed escrow.
 *
 *   anvil --port 8545 --chain-id 31337 &
 *   bash impl/scripts/deploy.sh local
 */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";
const PORT = 8611;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const deployment = JSON.parse(
  readFileSync(new URL("../../../../deployments/31337.json", import.meta.url), "utf8"),
) as { chainId: number; escrow: Address; token: Address; identityRegistry: Address };

const accounts = {
  deployer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 }),
  buyer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }),
  seller: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 }),
  validator: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 }),
  trustedClient: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 4 }),
  lonelySeller: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 7 }),
};

const chainDef = {
  id: deployment.chainId,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const walletFor = (account: (typeof accounts)["buyer"]) =>
  createWalletClient({ account, chain: chainDef, transport: http(RPC) });

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

let chain: ChainClient;
let server: Server;
let claims: ClaimStore;
let dir: string;
let sellerAgentId: bigint;
let ungatedAgentId: bigint;
let reputationRegistry: Address;
let buyerConfig: BuyerConfig;

async function registerAgent(account: (typeof accounts)["seller"], uri: string): Promise<bigint> {
  const tx = await walletFor(account).writeContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash: tx });
  const logs = parseEventLogs({
    abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
    logs: receipt.logs,
  });
  const id = logs[0]?.args.agentId;
  if (id === undefined) throw new Error("no Registered event");
  return id;
}

beforeAll(async () => {
  chain = createChainClient({ rpcUrl: RPC, chainId: deployment.chainId, escrow: deployment.escrow, pollIntervalMs: 100 });
  await chain.verifyChainId();
  dir = mkdtempSync(join(tmpdir(), "agenttrust-buyer-"));

  sellerAgentId = await registerAgent(accounts.seller, `${ORIGIN}/.well-known/agent-card`);
  // A second agent with no reputation at all, for the gate test.
  ungatedAgentId = await registerAgent(accounts.lonelySeller, `${ORIGIN}/.well-known/agent-card`);

  reputationRegistry = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "reputationRegistry",
  })) as Address;
  const tag = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  const feedback = await walletFor(accounts.trustedClient).writeContract({
    address: reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [sellerAgentId, 9500n, 2, tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
  });
  await chain.client.waitForTransactionReceipt({ hash: feedback });

  await walletFor(accounts.deployer).writeContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts.buyer.address, 1_000_000_000n],
  });

  const payee = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "previewPayee",
    args: [sellerAgentId],
  })) as Address;

  claims = new ClaimStore({ path: join(dir, "claims.sqlite") });
  const app = createApp({
    origin: ORIGIN,
    agentId: sellerAgentId.toString(),
    gated: true,
    paymentGate: createPaymentGate({
      chain,
      config: {
        origin: ORIGIN,
        agentId: sellerAgentId,
        escrow: deployment.escrow,
        token: deployment.token,
        chainId: deployment.chainId,
        acceptedValidators: [accounts.validator.address],
        ttlSeconds: 900,
        minDeadlineMargin: 60,
        quoteTtlSeconds: 120,
      },
      verify: {
        config: {
          origin: ORIGIN,
          agentId: sellerAgentId,
          payee,
          token: deployment.token,
          chainId: deployment.chainId,
          escrow: deployment.escrow,
          acceptedValidators: [accounts.validator.address],
          minDeadlineMargin: 60,
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
    deliver: createDeliveryHandler({ claims, chainId: deployment.chainId, replayPolicy: "idempotent" }),
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });

  buyerConfig = {
    chain,
    wallet: walletFor(accounts.buyer),
    account: accounts.buyer,
    identityRegistry: deployment.identityRegistry,
    reputationRegistry,
    token: deployment.token,
    maxPrice: 1_000_000n,
    gate: {
      trustedClients: [accounts.trustedClient.address],
      minDistinct: 1,
      minCount: 1n,
      minAvgValue: 9000n,
    },
    confirmations: 0,
    ttlSeconds: 900,
    // The agent card is served by the seller itself, so no external fetch is needed.
    fetchJson: async (url: string) => {
      const res = await fetch(url);
      return res.json();
    },
  };
}, 120_000);

afterAll(async () => {
  claims?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const requestFor = (overrides: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  sellerAgentId,
  origin: ORIGIN,
  path: "/v1/summarise",
  body: `{"text":"Agents pay each other. Escrow protects the buyer. ${Math.random()}"}`,
  validator: accounts.validator.address,
  ...overrides,
});

describe("the happy path", () => {
  /** Acceptance (a). */
  it("discovers, quotes, gate-checks, funds, retries signed and verifies", async () => {
    const before = (await chain.client.readContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [accounts.buyer.address],
    })) as bigint;

    const result = await purchase(buyerConfig, requestFor());

    expect(result.disposition).toBe("executed");
    expect(JSON.parse(result.responseBody).summary).toBeTypeOf("string");

    // The buyer's own hash of the bytes matched what the seller reported.
    expect(result.responseHash).toMatch(/^0x[0-9a-f]{64}$/);

    const job = await chain.getJob(result.jobId);
    expect(job?.payer.toLowerCase()).toBe(accounts.buyer.address.toLowerCase());
    expect(job?.amount).toBe(250_000n);

    const after = (await chain.client.readContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [accounts.buyer.address],
    })) as bigint;
    expect(before - after).toBe(250_000n);
  }, 120_000);

  /** Acceptance (d). */
  it("a repeated purchase of the same request replays, without a second payment", async () => {
    const request = requestFor();
    const first = await purchase(buyerConfig, request);
    expect(first.disposition).toBe("executed");

    const balanceAfterFirst = (await chain.client.readContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [accounts.buyer.address],
    })) as bigint;

    // The nonce is derived from the request, so this is the same job by construction.
    const second = await purchase(buyerConfig, request);
    expect(second.jobId).toBe(first.jobId);
    expect(second.disposition).toBe("replayed");
    expect(second.responseBody).toBe(first.responseBody);

    const balanceAfterSecond = (await chain.client.readContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [accounts.buyer.address],
    })) as bigint;
    expect(balanceAfterSecond, "no second payment").toBe(balanceAfterFirst);
  }, 120_000);

  it("derives the same nonce for the same request, and a different one otherwise", () => {
    const a = requestFor({ body: '{"text":"x"}' });
    expect(nonceFor(a)).toBe(nonceFor({ ...a }));
    expect(nonceFor(a)).not.toBe(nonceFor({ ...a, body: '{"text":"y"}' }));
    expect(nonceFor(a)).not.toBe(nonceFor({ ...a, path: "/v1/classify" }));
  });
});

describe("aborting before any money moves", () => {
  /** Acceptance (b). */
  it("refuses when the registry names a different origin", async () => {
    // The registry says this agent serves 127.0.0.1:8611; the buyer is being pointed
    // somewhere else. Without this check the trust chain starts at whatever DNS said.
    const error = await purchase(buyerConfig, requestFor({ origin: "http://127.0.0.1:9999" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuyerAbort);
    expect((error as BuyerAbort).reason).toBe("origin_mismatch");
    expect((error as BuyerAbort).beforeFunding).toBe(true);
  }, 60_000);

  /** Acceptance (c). */
  it("a gated seller never receives a funding transaction", async () => {
    // This buyer trusts nobody who has rated this seller. The seller is perfectly real
    // and would be served by a buyer with a different trust anchor — which is the
    // point of a trust-anchored gate, and the cost DOC-004 has to state (DF-09).
    const wary = {
      ...buyerConfig,
      gate: { ...buyerConfig.gate, trustedClients: [accounts.deployer.address] },
    };
    const blockBefore = await chain.blockNumber();

    const error = await purchase(wary, requestFor()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuyerAbort);
    expect((error as BuyerAbort).reason).toBe("gate_would_refuse");
    expect((error as BuyerAbort).beforeFunding).toBe(true);
    expect((error as BuyerAbort).message).toContain("no funding transaction was sent");

    // Nothing was mined, so nothing was sent.
    expect(await chain.blockNumber()).toBe(blockBefore);
  }, 60_000);

  it("refuses when the quote pays someone other than the agent the registry names", async () => {
    // The seller server belongs to sellerAgentId, so asking it for a different agent's
    // resource produces a quote that pays the wrong party. The buyer catches that
    // before funding rather than escrowing to an address the quote never named.
    const error = await purchase(buyerConfig, requestFor({ sellerAgentId: ungatedAgentId })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuyerAbort);
    expect((error as BuyerAbort).reason).toBe("payee_mismatch");
    expect((error as BuyerAbort).beforeFunding).toBe(true);
  }, 60_000);

  it("refuses a quote priced above the buyer's limit", async () => {
    const cheapskate = { ...buyerConfig, maxPrice: 1n };
    const error = await purchase(cheapskate, requestFor()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuyerAbort);
    expect((error as BuyerAbort).reason).toBe("price_too_high");
    expect((error as BuyerAbort).beforeFunding).toBe(true);
  }, 60_000);

  it("refuses a quote in a token it did not ask for", async () => {
    const other = { ...buyerConfig, token: "0x0000000000000000000000000000000000000dEaD" as Address };
    const error = await purchase(other, requestFor()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuyerAbort);
    expect((error as BuyerAbort).reason).toBe("no_acceptable_offer");
  }, 60_000);
});
