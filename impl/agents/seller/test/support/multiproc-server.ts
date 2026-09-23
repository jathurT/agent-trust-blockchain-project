/**
 * One seller process for the cross-process claim test. Started twice, on two ports,
 * sharing one CLAIMS_DB_PATH — which is the arrangement that actually exercises
 * SQLite's cross-process write lock. A single process proves only that the code is
 * correct within one event loop.
 *
 * Not part of the shipped service; used by impl/scripts/claim-multiproc.sh.
 */
import { createApp } from "../../src/server.js";
import { createPaymentGate } from "../../src/gate.js";
import { createDeliveryHandler } from "../../src/deliver.js";
import { ClaimStore } from "../../src/claims.js";
import { createChainClient } from "@agenttrust/core";
import type { Address, Hex } from "viem";

const port = Number(process.env["PORT"]);
const dbPath = process.env["CLAIMS_DB_PATH"]!;
const config = JSON.parse(process.env["SELLER_CONFIG"]!) as {
  origin: string;
  agentId: string;
  payee: Address;
  token: Address;
  chainId: number;
  escrow: Address;
  validator: Address;
  rpcUrl: string;
};

const claims = new ClaimStore({ path: dbPath });
const chain = createChainClient({
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  escrow: config.escrow,
  pollIntervalMs: 100,
});

const verifyConfig = {
  origin: config.origin,
  agentId: BigInt(config.agentId),
  payee: config.payee,
  token: config.token,
  chainId: config.chainId,
  escrow: config.escrow,
  acceptedValidators: [config.validator],
  minDeadlineMargin: 60,
  confirmations: 0,
};

const app = createApp({
  origin: config.origin,
  agentId: config.agentId,
  gated: true,
  paymentGate: createPaymentGate({
    chain,
    config: {
      origin: config.origin,
      agentId: BigInt(config.agentId),
      escrow: config.escrow,
      token: config.token,
      chainId: config.chainId,
      acceptedValidators: [config.validator],
      ttlSeconds: 900,
      minDeadlineMargin: 60,
      quoteTtlSeconds: 120,
    },
    verify: {
      config: verifyConfig,
      nonces: {
        seen: (jobId: Hex, nonce: Hex) => claims.seenNonce(jobId, nonce),
        remember: (jobId: Hex, nonce: Hex) => {
          claims.claimNonce(jobId, nonce);
        },
      },
    },
  }),
  deliver: createDeliveryHandler({ claims, chainId: config.chainId, replayPolicy: "idempotent" }),
});

app.listen(port, () => {
  process.stdout.write(`ready:${port}\n`);
});
