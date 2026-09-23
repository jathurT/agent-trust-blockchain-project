/**
 * Shared fixture for the seller's chain-backed tests: a live Anvil with the deployed
 * escrow, a registered agent, a trusted attester and a funded buyer.
 *
 *   anvil --port 8545 --chain-id 31337 &
 *   bash impl/scripts/deploy.sh local
 */
import { readFileSync } from "node:fs";
import { createWalletClient, http, keccak256, parseAbi, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import {
  canonicalUri,
  createChainClient,
  escrowAbi,
  identityRegistryAbi,
  reputationRegistryAbi,
  domain as eip712Domain,
  EIP712_TYPES,
  type ChainClient,
} from "@agenttrust/core";
import { UNIT_PRICE } from "../../src/pricing.js";
import type { VerifyConfig } from "../../src/verify.js";
import type { QuoteConfig } from "../../src/quote.js";

// The public Anvil test mnemonic: valueless, never funded, allowlisted in the
// secret-scan hook so it can appear in a test.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";
export const ORIGIN = "https://seller.agenttrust.test";

export const deployment = JSON.parse(
  readFileSync(new URL("../../../../../deployments/31337.json", import.meta.url), "utf8"),
) as { chainId: number; escrow: Address; token: Address; identityRegistry: Address };

export const accounts = {
  deployer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 }),
  buyer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }),
  seller: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 }),
  validator: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 }),
  trustedClient: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 4 }),
  stranger: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 6 }),
};

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
]);

export interface World {
  chain: ChainClient;
  agentId: bigint;
  quoteConfig: QuoteConfig;
  verifyConfig: VerifyConfig;
}

const nonceSeed = BigInt(Date.now()) * 1000n;
let counter = 0n;
/** Payer nonces are burned on use, so they must be unique per run. */
export const nextNonce = (): Hex => `0x${(nonceSeed + counter++).toString(16).padStart(64, "0")}`;

export async function buildWorld(): Promise<World> {
  const chain = createChainClient({
    rpcUrl: RPC,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    pollIntervalMs: 100,
  });
  await chain.verifyChainId();

  const registerTx = await wallet(accounts.seller).writeContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [`${ORIGIN}/.well-known/agent-card`],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash: registerTx });
  // Decode by event signature, not by log position. `register()` emits ERC-721
  // `Transfer` first, and its topics[1] is `from` = address(0) -- so picking the first
  // log with two topics silently yields agentId 0 for every registration. Every suite
  // was doing that and passing, because they all endorsed agent 0 as well.
  const registeredLogs = parseEventLogs({
    abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
    logs: receipt.logs,
  });
  const agentId = registeredLogs[0]?.args.agentId;
  if (agentId === undefined) throw new Error("register() emitted no Registered event");

  // The deployment pins minDistinctFloor = 1, so the agent needs one endorsement from
  // an address the buyer trusts before anything can be funded for it.
  const reputationRegistry = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "reputationRegistry",
  })) as Address;
  const tag = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  const feedback = await wallet(accounts.trustedClient).writeContract({
    address: reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [agentId, 9500n, 2, tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
  });
  await chain.client.waitForTransactionReceipt({ hash: feedback });

  await wallet(accounts.deployer).writeContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts.buyer.address, UNIT_PRICE * 1000n],
  });
  const approve = await wallet(accounts.buyer).writeContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [deployment.escrow, UNIT_PRICE * 1000n],
  });
  await chain.client.waitForTransactionReceipt({ hash: approve });

  const payee = (await chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "previewPayee",
    args: [agentId],
  })) as Address;

  return {
    chain,
    agentId,
    quoteConfig: {
      origin: ORIGIN,
      agentId,
      escrow: deployment.escrow,
      token: deployment.token,
      chainId: deployment.chainId,
      acceptedValidators: [accounts.validator.address],
      ttlSeconds: 900,
      minDeadlineMargin: 180,
      quoteTtlSeconds: 120,
    },
    verifyConfig: {
      origin: ORIGIN,
      agentId,
      payee,
      token: deployment.token,
      chainId: deployment.chainId,
      escrow: deployment.escrow,
      acceptedValidators: [accounts.validator.address],
      minDeadlineMargin: 180,
      confirmations: 0,
    },
  };
}

export function resourceRef(path: string, body: string) {
  const url = new URL(ORIGIN);
  return {
    methodHash: keccak256(toHex("POST")),
    uriHash: keccak256(toHex(canonicalUri({ scheme: "https", host: url.hostname, path }))),
    bodyHash: keccak256(toHex(body)),
  };
}

export interface FundedJob {
  jobId: Hex;
  txHash: Hex;
  nonce: Hex;
}

export async function fundJob(
  world: World,
  path: string,
  body: string,
  opts: { ttlSeconds?: number } = {},
): Promise<FundedJob> {
  const ref = resourceRef(path, body);
  const nonce = nextNonce();
  const txHash = await wallet(accounts.buyer).writeContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "fund",
    args: [
      world.agentId,
      deployment.token,
      UNIT_PRICE,
      ref,
      nonce,
      BigInt(opts.ttlSeconds ?? 900),
      accounts.validator.address,
      { trustedClients: [accounts.trustedClient.address], minDistinct: 1, minCount: 1n, minAvgValue: 9000n },
    ],
  });
  await world.chain.client.waitForTransactionReceipt({ hash: txHash });

  const resourceHash = (await world.chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "previewResourceHash",
    args: [ref, UNIT_PRICE, deployment.token],
  })) as Hex;
  const jobId = (await world.chain.client.readContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "previewJobId",
    args: [accounts.buyer.address, world.verifyConfig.payee, resourceHash, nonce],
  })) as Hex;

  return { jobId, txHash, nonce };
}

/** Build the PAYMENT-SIGNATURE header a buyer would send. */
export async function signedHeader(
  world: World,
  job: FundedJob,
  path: string,
  body: string,
  overrides: {
    signer?: HDAccount;
    sellerOrigin?: string;
    expiry?: number;
    clientNonce?: Hex;
    resourceHash?: Hex;
  } = {},
): Promise<string> {
  const signer = overrides.signer ?? accounts.buyer;
  const ref = resourceRef(path, body);
  const resourceHash =
    overrides.resourceHash ??
    ((await world.chain.client.readContract({
      address: deployment.escrow,
      abi: escrowAbi,
      functionName: "previewResourceHash",
      args: [ref, UNIT_PRICE, deployment.token],
    })) as Hex);

  const expiry = overrides.expiry ?? Math.floor(Date.now() / 1000) + 300;
  const clientNonce = overrides.clientNonce ?? nextNonce();
  const signature = await signer.signTypedData({
    domain: eip712Domain({ chainId: deployment.chainId, verifyingContract: deployment.escrow }),
    types: { DeliveryRequest: EIP712_TYPES.DeliveryRequest },
    primaryType: "DeliveryRequest",
    message: {
      jobId: job.jobId,
      resourceHash,
      sellerOrigin: overrides.sellerOrigin ?? ORIGIN,
      expiry: BigInt(expiry),
      clientNonce,
    },
  });

  const envelope = {
    x402Version: 2,
    resource: { url: `${ORIGIN}${path}` },
    accepted: {
      scheme: "agenttrust-escrow",
      network: `eip155:${deployment.chainId}`,
      amount: UNIT_PRICE.toString(),
      asset: deployment.token,
      payTo: world.verifyConfig.payee,
      maxTimeoutSeconds: 900,
      extra: {},
    },
    payload: { jobId: job.jobId, fundTxHash: job.txHash, deliveryRequest: { expiry, clientNonce }, signature },
    extensions: {},
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}
