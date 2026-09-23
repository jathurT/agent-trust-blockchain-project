import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { createChainClient, ChainUnavailable, getJobFundedLogs, type ChainClient } from "../src/chain.js";
import { escrowAbi, identityRegistryAbi, reputationRegistryAbi, JobState } from "../src/abi.js";
import { canonicalUri, resourceHash } from "../src/canonical.js";
import { keccak256, toHex } from "viem";

/**
 * AGENT-001 acceptance: the watchers work over an HTTP-only RPC. That cannot be shown
 * with a mock, so this suite drives a real node.
 *
 * It needs an Anvil with a deployment:
 *   anvil --port 8545 --chain-id 31337 &
 *   bash impl/scripts/deploy.sh local
 *
 * If either is missing the suite **fails** rather than skipping. A silently skipped
 * integration test is how a suite comes to prove nothing (CLAUDE.md §12).
 */

// The public Anvil/Hardhat test mnemonic. Valueless, never funded, and allowlisted in
// the secret-scan hook precisely so it can appear here.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";

const deployment = JSON.parse(
  readFileSync(new URL("../../../../deployments/31337.json", import.meta.url), "utf8"),
) as { chainId: number; escrow: Address; token: Address; identityRegistry: Address };

const deployer = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 });
const buyer = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 });
const seller = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 });
const validator = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 });
/** Someone the buyer has dealt with before, whose opinion of the seller it accepts. */
const trustedClient = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 4 });

const chainDef = {
  id: deployment.chainId,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const wallet = (account: typeof buyer) =>
  createWalletClient({ account, chain: chainDef, transport: http(RPC) });

const mockUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

let chain: ChainClient;
let sellerAgentId: bigint;

const ORIGIN = "https://seller.agenttrust.test";
const PRICE = 250_000n;
const TTL = 900;

beforeAll(async () => {
  chain = createChainClient({
    rpcUrl: RPC,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    pollIntervalMs: 100,
  });
  await chain.verifyChainId();

  const deployerWallet = wallet(deployer);
  await deployerWallet.writeContract({
    address: deployment.token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [buyer.address, PRICE * 100n],
  });
  const approveTx = await wallet(buyer).writeContract({
    address: deployment.token,
    abi: mockUsdcAbi,
    functionName: "approve",
    args: [deployment.escrow, PRICE * 100n],
  });
  await chain.client.waitForTransactionReceipt({ hash: approveTx });

  const registerTx = await wallet(seller).writeContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [`${ORIGIN}/.well-known/agent-card`],
  });
  const registerReceipt = await chain.client.waitForTransactionReceipt({ hash: registerTx });
  // Decode by signature: `register()` emits ERC-721 `Transfer` first, whose topics[1]
  // is `from` = address(0), so reading the first log's second topic silently yields 0
  // for every registration. (The first agent on a fresh registry genuinely is id 0 --
  // V-141 -- which is exactly why that bug hid.)
  const registered = parseEventLogs({
    abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
    logs: registerReceipt.logs,
  });
  const decoded = registered[0]?.args.agentId;
  if (decoded === undefined) throw new Error("register() emitted no Registered event");
  sellerAgentId = decoded;

  // The deployment sets minDistinctFloor = 1 and minCountFloor = 1, so an empty policy
  // is refused — that is the gate working, and it is what the security review's
  // finding #8 put there. Give the seller one endorsement from an address the buyer
  // trusts, which is the flow a real buyer would have.
  const reputationRegistry = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "reputationRegistry",
  })) as Address;
  const feedbackTag = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  const feedbackTx = await wallet(trustedClient).writeContract({
    address: reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [sellerAgentId, 9500n, 2, feedbackTag, "", "", "", `0x${"00".repeat(32)}` as Hex],
  });
  await chain.client.waitForTransactionReceipt({ hash: feedbackTx });
}, 60_000);

const GATE = () => ({
  trustedClients: [trustedClient.address],
  minDistinct: 1,
  minCount: 1n,
  minAvgValue: 9000n,
});

function resource(path: string, body: string) {
  return {
    methodHash: keccak256(toHex("POST")),
    uriHash: keccak256(toHex(canonicalUri({ scheme: "https", host: "seller.agenttrust.test", path }))),
    bodyHash: keccak256(toHex(body)),
  };
}

/**
 * Nonces are payer-scoped and burned on use, so a fixed set would let this suite pass
 * exactly once against a node that outlives it. Seeding from the clock keeps it
 * re-runnable against the same Anvil, which is how it is actually used.
 */
const nonceSeed = BigInt(Date.now()) * 1000n;
let nonceCounter = 0n;
const nextNonce = (): Hex => `0x${(nonceSeed + nonceCounter++).toString(16).padStart(64, "0")}`;

async function fund(nonce: Hex, path = "/v1/summarise", body = '{"text":"hello"}'): Promise<Hex> {
  const ref = resource(path, body);
  const tx = await wallet(buyer).writeContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "fund",
    args: [
      sellerAgentId,
      deployment.token,
      PRICE,
      ref,
      nonce,
      BigInt(TTL),
      validator.address,
      GATE(),
    ],
  });
  await chain.client.waitForTransactionReceipt({ hash: tx });
  return tx;
}

describe("chain client against a live node", () => {
  it("verifies the configured chain id and refuses a mismatch", async () => {
    await expect(chain.verifyChainId()).resolves.toBeUndefined();
    const wrong = createChainClient({ rpcUrl: RPC, chainId: 1, escrow: deployment.escrow });
    await expect(wrong.verifyChainId()).rejects.toThrow(ChainUnavailable);
  });

  it("reads a funded job back with every field typed as a bigint or address", async () => {
    const nonce = nextNonce();
    const txHash = await fund(nonce);
    const jobId = await chain.client.readContract({
      address: deployment.escrow,
      abi: escrowAbi,
      functionName: "previewJobId",
      args: [
        buyer.address,
        seller.address,
        await chain.client.readContract({
          address: deployment.escrow,
          abi: escrowAbi,
          functionName: "previewResourceHash",
          args: [resource("/v1/summarise", '{"text":"hello"}'), PRICE, deployment.token],
        }),
        nonce,
      ],
    });

    const job = await chain.getJob(jobId);
    expect(job).toBeDefined();
    expect(job!.payer.toLowerCase()).toBe(buyer.address.toLowerCase());
    expect(job!.payee.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(job!.amount).toBe(PRICE);
    expect(typeof job!.amount).toBe("bigint");
    expect(job!.state).toBe(JobState.Funded);
    expect(job!.validationRecorded).toBe(false);
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns undefined for a job that does not exist, rather than throwing", async () => {
    // The distinction matters: "no such job" is a decision, an unreachable node is not.
    await expect(chain.getJob(keccak256(toHex("nope")))).resolves.toBeUndefined();
  });

  it("throws ChainUnavailable when the node is unreachable", async () => {
    const dead = createChainClient({
      rpcUrl: "http://127.0.0.1:1",
      chainId: deployment.chainId,
      escrow: deployment.escrow,
      timeoutMs: 500,
    });
    // Fail closed: this is what SPEC-002 maps to 503, and it must never look like
    // "no job found".
    await expect(dead.getJob(keccak256(toHex("x")))).rejects.toThrow(ChainUnavailable);
    await expect(dead.blockNumber()).rejects.toThrow(ChainUnavailable);
  });

  it("counts confirmations by polling and waits for more", async () => {
    const txHash = await fund(nextNonce());
    expect(await chain.confirmations(txHash)).toBeGreaterThanOrEqual(1);

    // Mine two blocks the slow way a real chain would.
    for (let i = 0; i < 2; i++) await fund(nextNonce());
    expect(await chain.confirmations(txHash)).toBeGreaterThanOrEqual(3);

    const reached = await chain.waitForConfirmations(txHash, 3, { timeoutMs: 5_000 });
    expect(reached).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("reports zero confirmations for a transaction the node has never seen", async () => {
    expect(await chain.confirmations(keccak256(toHex("never sent")))).toBe(0);
  });

  it("times out rather than waiting forever for confirmations that will not come", async () => {
    await expect(
      chain.waitForConfirmations(keccak256(toHex("never sent")), 3, { timeoutMs: 400 }),
    ).rejects.toThrow(ChainUnavailable);
  });

  it("finds JobFunded logs by polling a block range", async () => {
    const before = await chain.blockNumber();
    const txHash = await fund(nextNonce());
    const receipt = await chain.client.getTransactionReceipt({ hash: txHash });

    const logs = await getJobFundedLogs(chain, before, receipt.blockNumber);
    expect(logs.length).toBeGreaterThan(0);
    const mine = logs.find((l) => l.blockNumber === receipt.blockNumber);
    expect(mine?.payer.toLowerCase()).toBe(buyer.address.toLowerCase());
    expect(mine?.amount).toBe(PRICE);
  }, 30_000);

  it("chunks a wide range instead of asking for it all at once", async () => {
    const head = await chain.blockNumber();
    // A range far wider than the chain, with a tiny chunk, must still complete.
    const logs = await getJobFundedLogs(chain, 0n, head, 2n);
    expect(logs.length).toBeGreaterThan(0);
  }, 30_000);
});
