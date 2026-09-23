/**
 * SEC-002 — the two targets, behind one interface.
 *
 * The comparison is only meaningful if both sides are brought up the same way, paid the
 * same amount, asked for the same resource and measured by the same counters. The
 * differences that matter are in the *defences*, not in the harness.
 *
 * Counters come from the claim store, the chain and the fixture's own record — never
 * from watching HTTP status codes and inferring. A 200 tells you the caller got bytes;
 * it does not tell you whether the work was done again, which is the entire question.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import {
  createChainClient,
  escrowAbi,
  identityRegistryAbi,
  reputationRegistryAbi,
  domain as eip712Domain,
  EIP712_TYPES,
  encodeHeader,
  type ChainClient,
} from "@agenttrust/core";
import { createApp } from "@agenttrust/seller/src/server.js";
import { createPaymentGate } from "@agenttrust/seller/src/gate.js";
import { createDeliveryHandler } from "@agenttrust/seller/src/deliver.js";
import { ClaimStore } from "@agenttrust/seller/src/claims.js";
import {
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { createVulnerableFixture, type VulnerableAuthorization } from "./vulnerable-server.js";
import { FIXTURE_ID, FIXTURE_LABEL } from "./fixture-label.js";

export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const PRICE = 250_000n;

export const accounts = {
  deployer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 0 }),
  buyer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }),
  seller: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 }),
  validator: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 3 }),
  trustedClient: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 4 }),
  attacker: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 8 }),
};

export interface Deployment {
  chainId: number;
  escrow: Address;
  token: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  validationRegistry: Address;
}

/** What a single paid interaction produced, however it was obtained. */
export interface PaymentTicket {
  /** What the attacker replays: the exact header a legitimate buyer would send. */
  header: string;
  /** Present only for AgentTrust. */
  jobId?: Hex;
  /** A key the harness can use to read counters back. */
  counterKey: string;
}

export interface Target {
  readonly name: "fixture" | "agenttrust";
  readonly version: string;
  readonly label: string | null;
  readonly origin: string;
  /** Obtain one legitimately paid-for request. */
  pay(path: string, body: string): Promise<PaymentTicket>;
  /** Fire a request with a given header; returns the HTTP status and the body. */
  request(path: string, body: string, header: string | undefined): Promise<{ status: number; text: string }>;
  /** Counters read from the system's own records, not inferred from responses. */
  counters(ticket: PaymentTicket): Promise<Counters>;
  stop(): Promise<void>;
}

export interface Counters {
  executions_completed: number;
  distinct_results: number;
  http_2xx: number;
  replays_served: number;
  settlements: number;
}

const chainDef = (chainId: number, rpc: string) =>
  ({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  }) as const;

const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

// ---------------------------------------------------------------- the fixture

/**
 * The labelled vulnerable baseline. Settlement is real: the authorization is a genuine
 * EIP-3009 signature against MockUSDC, submitted out of band, so "grants" and
 * "settlements" are two separately countable things — which is the shape of the
 * published A2 result (248 grants, 1 settlement).
 */
export async function startFixture(opts: {
  rpc: string;
  deployment: Deployment;
  port: number;
}): Promise<Target> {
  const wallet = createWalletClient({
    account: accounts.deployer,
    chain: chainDef(opts.deployment.chainId, opts.rpc),
    transport: http(opts.rpc),
  });
  const chain = createChainClient({
    rpcUrl: opts.rpc,
    chainId: opts.deployment.chainId,
    escrow: opts.deployment.escrow,
    pollIntervalMs: 200,
  });

  await wallet.writeContract({
    address: opts.deployment.token,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts.buyer.address, PRICE * 10_000n],
  });

  const settlementResults: boolean[] = [];
  const fixture = createVulnerableFixture({
    price: PRICE,
    payTo: accounts.seller.address,
    log: () => {},
    settle: async (auth: VulnerableAuthorization) => {
      // A real transfer against MockUSDC. The second use of an authorization reverts
      // at the token, which is exactly why the fixture's grants outnumber its
      // settlements rather than its payments.
      try {
        const sig = auth.signature.slice(2);
        const tx = await wallet.writeContract({
          address: opts.deployment.token,
          abi: tokenAbi,
          functionName: "transferWithAuthorization",
          args: [
            auth.from,
            auth.to,
            BigInt(auth.value),
            BigInt(auth.validAfter),
            BigInt(auth.validBefore),
            auth.nonce,
            Number.parseInt(sig.slice(128, 130), 16),
            `0x${sig.slice(0, 64)}` as Hex,
            `0x${sig.slice(64, 128)}` as Hex,
          ],
        });
        await chain.client.waitForTransactionReceipt({ hash: tx });
        settlementResults.push(true);
        return { ok: true, detail: tx };
      } catch (error) {
        settlementResults.push(false);
        const detail = (error as Error).message;
        if (process.env["HARNESS_DEBUG"]) process.stderr.write(`[settle] ${detail}\n`);
        return { ok: false, detail: detail.slice(0, 200) };
      }
    },
  });

  const server: Server = await new Promise((resolve) => {
    const s = fixture.app.listen(opts.port, () => resolve(s));
  });
  const origin = `http://127.0.0.1:${opts.port}`;

  return {
    name: "fixture",
    version: FIXTURE_ID,
    label: FIXTURE_LABEL,
    origin,

    async pay(): Promise<PaymentTicket> {
      // One EIP-3009 authorization, signed by the buyer. This is the artefact the
      // attacker replays -- and nothing in it names a resource, which is A3.
      const nonce = keccak256(toHex(`auth-${Date.now()}-${Math.random()}`));
      // Chain time, not the local clock. MockUSDC evaluates this window against
      // `block.timestamp`, and on a devnet the two can be hours apart after an
      // `evm_increaseTime` -- an authorization built from the wall clock then reverts
      // `AuthorizationExpired` and every settlement silently fails to zero.
      const chainNow = await chain.blockTimestamp();
      const validBefore = BigInt(chainNow + 3600);
      const signature = await accounts.buyer.signTypedData({
        domain: {
          // MockUSDC is `ERC20("USD Coin","USDC")` but `EIP712("USDC","2")`: the
          // token's *name* and its EIP-712 *domain name* differ, and the real Base
          // Sepolia USDC does the same (V-81). Signing with "USD Coin" produces a
          // signature that recovers to the wrong address and every settlement fails.
          name: "USDC",
          version: "2",
          chainId: opts.deployment.chainId,
          verifyingContract: opts.deployment.token,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: accounts.buyer.address,
          to: accounts.seller.address,
          value: PRICE,
          validAfter: 0n,
          validBefore,
          nonce,
        },
      });

      const auth: VulnerableAuthorization = {
        from: accounts.buyer.address,
        to: accounts.seller.address,
        value: PRICE.toString(),
        validAfter: 0,
        validBefore: Number(validBefore),
        nonce,
        signature,
      };
      return {
        header: Buffer.from(JSON.stringify(auth), "utf8").toString("base64"),
        counterKey: nonce,
      };
    },

    async request(path, body, header) {
      const res = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(header ? { "PAYMENT-SIGNATURE": header } : {}),
        },
        body,
      });
      return { status: res.status, text: await res.text() };
    },

    async counters(ticket) {
      await fixture.settled();
      const grants = fixture.grants.filter((g) => g.authorizationNonce === ticket.counterKey);
      const distinct = new Set(grants.map((g) => g.responseHash)).size;
      const settled = fixture.settlements.filter(
        (s) => s.authorizationNonce === ticket.counterKey && s.ok,
      ).length;
      return {
        // Every grant is an execution here: the fixture has no claim store, so it
        // recomputes the answer each time.
        executions_completed: grants.length,
        distinct_results: distinct,
        http_2xx: grants.length,
        replays_served: 0,
        settlements: settled,
      };
    },

    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// -------------------------------------------------------------- AgentTrust

export async function startAgentTrust(opts: {
  rpc: string;
  deployment: Deployment;
  sellerPorts: number[];
  root: string;
}): Promise<Target> {
  const dir = mkdtempSync(join(tmpdir(), "agenttrust-harness-"));
  const chain = createChainClient({
    rpcUrl: opts.rpc,
    chainId: opts.deployment.chainId,
    escrow: opts.deployment.escrow,
    pollIntervalMs: 200,
  });
  const wallet = (account: HDAccount) =>
    createWalletClient({ account, chain: chainDef(opts.deployment.chainId, opts.rpc), transport: http(opts.rpc) });

  const origin = `http://127.0.0.1:${opts.sellerPorts[0]}`;

  const registerTx = await wallet(accounts.seller).writeContract({
    address: opts.deployment.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [`${origin}/.well-known/agent-card`],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash: registerTx });
  const agentId = parseEventLogs({
    abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
    logs: receipt.logs,
  })[0]!.args.agentId;

  const tag = (await chain.client.readContract({
    address: opts.deployment.escrow,
    abi: escrowAbi,
    functionName: "FEEDBACK_TAG",
  })) as string;
  const feedbackTx = await wallet(accounts.trustedClient).writeContract({
    address: opts.deployment.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [agentId, 9500n, 2, tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
  });
  await chain.client.waitForTransactionReceipt({ hash: feedbackTx });

  await wallet(accounts.deployer).writeContract({
    address: opts.deployment.token,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts.buyer.address, PRICE * 10_000n],
  });
  const approveTx = await wallet(accounts.buyer).writeContract({
    address: opts.deployment.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [opts.deployment.escrow, PRICE * 10_000n],
  });
  await chain.client.waitForTransactionReceipt({ hash: approveTx });

  const payee = (await chain.client.readContract({
    address: opts.deployment.escrow,
    abi: escrowAbi,
    functionName: "previewPayee",
    args: [agentId],
  })) as Address;

  // One shared claim store across every seller process, which is what makes "one
  // execution" hold for more than one process.
  const claims = new ClaimStore({ path: join(dir, "claims.sqlite") });
  const servers: Server[] = [];

  for (const port of opts.sellerPorts) {
    const app = createApp({
      origin,
      agentId: agentId.toString(),
      gated: true,
      paymentGate: createPaymentGate({
        chain,
        config: {
          origin,
          agentId,
          escrow: opts.deployment.escrow,
          token: opts.deployment.token,
          chainId: opts.deployment.chainId,
          acceptedValidators: [accounts.validator.address],
          ttlSeconds: 900,
          minDeadlineMargin: 60,
          quoteTtlSeconds: 120,
        },
        verify: {
          config: {
            origin,
            agentId,
            payee,
            token: opts.deployment.token,
            chainId: opts.deployment.chainId,
            escrow: opts.deployment.escrow,
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
      // No evidence deposit in the harness: A2 and A3 are about whether the resource is
      // handed over twice or for the wrong request, and the validator round trip adds
      // two transactions per run without bearing on either. INT-001 covers that path.
      deliver: createDeliveryHandler({
        claims,
        chainId: opts.deployment.chainId,
        replayPolicy: "idempotent",
      }),
    });
    servers.push(await new Promise<Server>((resolve) => {
      const s = app.listen(port, () => resolve(s));
    }));
  }

  let nonceCounter = BigInt(Date.now()) * 1000n;

  return {
    name: "agenttrust",
    version: "escrow+claimstore",
    label: null,
    origin,

    async pay(path, body): Promise<PaymentTicket> {
      const url = new URL(origin);
      const ref = {
        methodHash: keccak256(toHex("POST")),
        uriHash: keccak256(
          toHex(`http://${url.hostname}:${url.port}${path}`),
        ),
        bodyHash: keccak256(toHex(body)),
      };
      const nonce = `0x${(nonceCounter++).toString(16).padStart(64, "0")}` as Hex;

      const fundTx = await wallet(accounts.buyer).writeContract({
        address: opts.deployment.escrow,
        abi: escrowAbi,
        functionName: "fund",
        args: [
          agentId,
          opts.deployment.token,
          PRICE,
          ref,
          nonce,
          900n,
          accounts.validator.address,
          { trustedClients: [accounts.trustedClient.address], minDistinct: 1, minCount: 1n, minAvgValue: 9000n },
        ],
      });
      await chain.client.waitForTransactionReceipt({ hash: fundTx });

      const resourceHash = (await chain.client.readContract({
        address: opts.deployment.escrow,
        abi: escrowAbi,
        functionName: "previewResourceHash",
        args: [ref, PRICE, opts.deployment.token],
      })) as Hex;
      const jobId = (await chain.client.readContract({
        address: opts.deployment.escrow,
        abi: escrowAbi,
        functionName: "previewJobId",
        args: [accounts.buyer.address, payee, resourceHash, nonce],
      })) as Hex;

      const header = await signDelivery(jobId, resourceHash, fundTx);
      return {
        header,
        jobId,
        counterKey: `${opts.deployment.chainId}:${opts.deployment.escrow.toLowerCase()}:${jobId.toLowerCase()}`,
      };
    },

    async request(path, body, header) {
      const port = opts.sellerPorts[Math.floor(Math.random() * opts.sellerPorts.length)]!;
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(header ? { "PAYMENT-SIGNATURE": header } : {}),
        },
        body,
      });
      return { status: res.status, text: await res.text() };
    },

    async counters(ticket) {
      const m = claims.metrics(ticket.counterKey);
      return {
        executions_completed: m.executions_completed,
        distinct_results: m.distinct_results,
        http_2xx: m.http_2xx,
        replays_served: m.replays_served,
        // The escrow *is* the settlement: one fund() per job, enforced by the nonce.
        settlements: 1,
      };
    },

    async stop() {
      claims.close();
      for (const s of servers) await new Promise<void>((resolve) => s.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };

  async function signDelivery(jobId: Hex, resourceHash: Hex, fundTxHash: Hex): Promise<string> {
    const job = await chain.getJob(jobId);
    const expiry = Number(job!.deadline);
    const clientNonce = keccak256(toHex(`cn-${jobId}-${Date.now()}-${Math.random()}`));
    const signature = await accounts.buyer.signTypedData({
      domain: eip712Domain({ chainId: opts.deployment.chainId, verifyingContract: opts.deployment.escrow }),
      types: { DeliveryRequest: EIP712_TYPES.DeliveryRequest },
      primaryType: "DeliveryRequest",
      message: { jobId, resourceHash, sellerOrigin: origin, expiry: BigInt(expiry), clientNonce },
    });
    return encodeHeader({
      x402Version: 2,
      resource: { url: origin },
      accepted: {
        scheme: "agenttrust-escrow",
        network: `eip155:${opts.deployment.chainId}`,
        amount: PRICE.toString(),
        asset: opts.deployment.token,
        payTo: payee,
        maxTimeoutSeconds: 900,
        extra: {},
      },
      payload: { jobId, fundTxHash, deliveryRequest: { expiry, clientNonce }, signature },
      extensions: {},
    });
  }
}
