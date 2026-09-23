import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createWalletClient, http, parseAbi, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  createChainClient,
  decodePaymentRequired,
  escrowAbi,
  identityRegistryAbi,
  HEADER_REQUIRED,
  selectRequirements,
  SCHEME,
  type ChainClient,
} from "@agenttrust/core";
import { createApp } from "../src/server.js";
import { createPaymentGate } from "../src/gate.js";
import { buildPaymentRequired, resolvePayee, type QuoteConfig } from "../src/quote.js";
import { UNIT_PRICE } from "../src/pricing.js";

/**
 * API-002 acceptance. `payTo` must equal the **registry-resolved** wallet, which cannot
 * be checked against a mock, so this drives the deployed escrow on a local Anvil:
 *   anvil --port 8545 --chain-id 31337 &
 *   bash impl/scripts/deploy.sh local
 */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const RPC = process.env["RPC_URL"] ?? "http://127.0.0.1:8545";
const ORIGIN = "https://seller.agenttrust.test";

const deployment = JSON.parse(
  readFileSync(new URL("../../../../deployments/31337.json", import.meta.url), "utf8"),
) as { chainId: number; escrow: Address; token: Address; identityRegistry: Address };

const seller = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 });
const validator = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 });
const newOwner = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 5 });

const chainDef = {
  id: deployment.chainId,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

let chain: ChainClient;
let config: QuoteConfig;
let app: ReturnType<typeof createApp>;
let agentId: bigint;

beforeAll(async () => {
  chain = createChainClient({ rpcUrl: RPC, chainId: deployment.chainId, escrow: deployment.escrow, pollIntervalMs: 100 });
  await chain.verifyChainId();

  // Register a fresh agent for this suite so it does not depend on what other suites
  // left behind.
  const tx = await createWalletClient({ account: seller, chain: chainDef, transport: http(RPC) }).writeContract({
    address: deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [`${ORIGIN}/.well-known/agent-card`],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash: tx });
  const registered = receipt.logs.find((l) => l.topics[0] !== undefined && l.topics.length >= 2);
  agentId = BigInt(registered?.topics[1] ?? "0x0");

  config = {
    origin: ORIGIN,
    agentId,
    escrow: deployment.escrow,
    token: deployment.token,
    chainId: deployment.chainId,
    acceptedValidators: [validator.address],
    ttlSeconds: 900,
    minDeadlineMargin: 180,
    quoteTtlSeconds: 120,
  };
  app = createApp({
    origin: ORIGIN,
    agentId: agentId.toString(),
    gated: true,
    paymentGate: createPaymentGate({ chain, config }),
  });
}, 60_000);

describe("402 quote", () => {
  it("answers an unpaid request with a decodable v2 PaymentRequired", async () => {
    const res = await request(app).post("/v1/summarise").send({ text: "hello" }).expect(402);

    const header = res.headers[HEADER_REQUIRED.toLowerCase()];
    expect(header, "PAYMENT-REQUIRED header").toBeTypeOf("string");

    const quote = decodePaymentRequired(header as string);
    expect(quote.x402Version).toBe(2);
    expect(quote.accepts).toHaveLength(1);
    // The header and the human-readable body must carry the same quote.
    expect(res.body).toEqual(quote);
  });

  it("offers the project scheme on the configured chain, in atomic units", async () => {
    const res = await request(app).post("/v1/summarise").send({ text: "hello" }).expect(402);
    const offer = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string).accepts[0]!;

    expect(offer.scheme).toBe(SCHEME);
    expect(offer.network).toBe(`eip155:${deployment.chainId}`);
    expect(offer.amount).toBe(UNIT_PRICE.toString());
    expect(offer.asset.toLowerCase()).toBe(deployment.token.toLowerCase());
    expect(offer.extra.paymentFlow).toBe("escrow");
    expect(offer.extra.escrow.toLowerCase()).toBe(deployment.escrow.toLowerCase());
    expect(offer.extra.canonicalVersion).toBe("canonical-v1");
    expect(offer.extra.minDeadlineMargin).toBe(180);
    expect(offer.extra.acceptedValidators.map((a) => a.toLowerCase())).toEqual([validator.address.toLowerCase()]);
  });

  it("a buyer's selector accepts the offer", async () => {
    const res = await request(app).post("/v1/classify").send({ text: "hello" }).expect(402);
    const quote = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string);
    const chosen = selectRequirements(quote, {
      chainId: deployment.chainId,
      asset: deployment.token,
      maxAmount: 1_000_000n,
    });
    expect(chosen.payTo).toBeTypeOf("string");
  });

  it("quotes both paid siblings at the same price", async () => {
    const amounts: string[] = [];
    for (const path of ["/v1/summarise", "/v1/classify"]) {
      const res = await request(app).post(path).send({ text: "x" }).expect(402);
      amounts.push(decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string).accepts[0]!.amount);
    }
    expect(new Set(amounts).size).toBe(1);
  });

  it("uses the configured origin in the resource url, never the Host header", async () => {
    const res = await request(app)
      .post("/v1/summarise")
      .set("Host", "evil.example")
      .send({ text: "x" })
      .expect(402);
    const quote = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string);
    // A Host an attacker controls must not steer what gets hashed (DF-04).
    expect(quote.resource.url).toBe(`${ORIGIN}/v1/summarise`);
    expect(quote.resource.url).not.toContain("evil.example");
  });

  it("sets no-store on the 402 as well as the 200", async () => {
    await request(app).post("/v1/summarise").send({ text: "x" }).expect(402).expect("Cache-Control", "no-store");
  });

  it("does not serve the resource with the 402", async () => {
    const res = await request(app).post("/v1/summarise").send({ text: "One. Two." }).expect(402);
    // The body is a quote and nothing else. (The word "summary" does appear, inside
    // the route *description* — so check the shape, not the text.)
    expect(Object.keys(res.body).sort()).toEqual(["accepts", "error", "extensions", "resource", "x402Version"]);
    expect(res.body.summary).toBeUndefined();
    expect(res.body.sentences).toBeUndefined();
  });
});

describe("payTo comes from the registry, not from configuration", () => {
  it("equals previewPayee, which is what the escrow will snapshot", async () => {
    const res = await request(app).post("/v1/summarise").send({ text: "x" }).expect(402);
    const offer = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string).accepts[0]!;

    const fromChain = (await chain.client.readContract({
      address: deployment.escrow,
      abi: escrowAbi,
      functionName: "previewPayee",
      args: [agentId],
    })) as Address;
    expect(offer.payTo.toLowerCase()).toBe(fromChain.toLowerCase());
  });

  it("follows the agent when the NFT is transferred, because agentWallet is cleared", async () => {
    // DF-12: transferring the agent clears agentWallet, so previewPayee falls back to
    // ownerOf. A payTo cached from configuration would now be wrong, and the escrow
    // would pay someone the quote never named.
    const before = await resolvePayee(chain, agentId);
    expect(before.toLowerCase()).toBe(seller.address.toLowerCase());

    const tx = await createWalletClient({ account: seller, chain: chainDef, transport: http(RPC) }).writeContract({
      address: deployment.identityRegistry,
      abi: parseAbi(["function transferFrom(address from, address to, uint256 tokenId)"]),
      functionName: "transferFrom",
      args: [seller.address, newOwner.address, agentId],
    });
    await chain.client.waitForTransactionReceipt({ hash: tx });

    const res = await request(app).post("/v1/summarise").send({ text: "x" }).expect(402);
    const offer = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string).accepts[0]!;
    expect(offer.payTo.toLowerCase()).toBe(newOwner.address.toLowerCase());

    // Put it back so the suite can be re-run.
    const back = await createWalletClient({ account: newOwner, chain: chainDef, transport: http(RPC) }).writeContract({
      address: deployment.identityRegistry,
      abi: parseAbi(["function transferFrom(address from, address to, uint256 tokenId)"]),
      functionName: "transferFrom",
      args: [newOwner.address, seller.address, agentId],
    });
    await chain.client.waitForTransactionReceipt({ hash: back });
  }, 30_000);
});

describe("no settlement is reachable from the request path", () => {
  it("presents a payment and is refused, not served, until API-003..005 exist", async () => {
    const res = await request(app)
      .post("/v1/summarise")
      .set("PAYMENT-SIGNATURE", "e30=")
      .send({ text: "One. Two." });
    expect(res.status).toBe(503);
    expect(res.body.summary).toBeUndefined();
    expect(res.body.error.code).toBe("chain_unavailable");
  });

  it("carries no x402 settlement dependency at all", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // @x402/express performs its own settlement; mounted alongside the escrow it would
    // charge the buyer twice (DF-03). It must not be reachable from the seller at all.
    for (const name of Object.keys(pkg.dependencies)) {
      expect(name.startsWith("@x402/"), `${name} must not be a seller dependency`).toBe(false);
    }
  });
});

describe("quote identifier", () => {
  it("differs between the two paid routes, and over time", () => {
    const base = { path: "/v1/summarise", payee: seller.address, now: 1_790_000_000 };
    const a = buildPaymentRequired(config, base);
    const b = buildPaymentRequired(config, { ...base, path: "/v1/classify" });
    const c = buildPaymentRequired(config, { ...base, now: base.now + 1 });

    expect(a.accepts[0]!.extra.quoteId).not.toBe(b.accepts[0]!.extra.quoteId);
    expect(a.accepts[0]!.extra.quoteId).not.toBe(c.accepts[0]!.extra.quoteId);
    expect(a.accepts[0]!.extra.expiry).toBe(base.now + config.quoteTtlSeconds);
  });
});
