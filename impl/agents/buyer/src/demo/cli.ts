/**
 * AGENT-006 — the buyer CLI.
 *
 *   npx tsx src/demo/cli.ts buy    --resource /v1/summarise --amount 250000
 *   npx tsx src/demo/cli.ts status --job 0x...
 *   npx tsx src/demo/cli.ts refund --job 0x...
 *
 * It talks to a seller that `npm run target:agenttrust` already started, so the demo
 * is two terminals rather than one script that hides the interesting part.
 *
 * What the output has to make unambiguous is the distinction the whole evaluation
 * rests on: **a 2xx is not an execution**. A replayed request gets 200 and the stored
 * bytes; only the first one runs the work. The CLI prints the disposition
 * (`executed` / `replayed`) next to the status code for exactly that reason, and
 * `status` reads the counters from the seller's own record rather than inferring them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createChainClient, escrowAbi, JobState, formatAtomic } from "@agenttrust/core";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { purchase, nonceFor, type PurchaseRequest } from "../buyer.js";
import { BuyerAbort } from "../errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");

// The public Anvil test mnemonic: valueless, never funded, allowlisted in the
// secret-scan hook. A testnet or mainnet run would take a key from the environment,
// which is ENV-005; this CLI is a local-devnet demo tool and says so if asked to be
// anything else.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const accounts = {
  buyer: mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }),
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

export type Command =
  | { name: "buy"; resource: string; amount: bigint; origin: string; body: string; rpc: string }
  | { name: "status"; job: Hex; origin: string; rpc: string }
  | { name: "refund"; job: Hex; origin: string; rpc: string };

export const USAGE = `agenttrust buyer (AGENT-006) — local devnet demo client

  buy    --resource <path> --amount <atomic> [--body <json>] [--origin <url>]
  status --job <0x...>
  refund --job <0x...>

Amounts are atomic units of the escrow token (6 decimals), never a decimal price:
250000 is 0.25 USDC. --origin defaults to the seller started by
\`npm run target:agenttrust\`.`;

export function parseCommand(argv: string[]): Command {
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1 || argv[i + 1] === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`--${name} is required`);
    }
    return argv[i + 1]!;
  };
  const origin = () => get("origin", process.env["SELLER_ORIGIN"] ?? "http://127.0.0.1:4022");
  const rpc = () => get("rpc", process.env["RPC_URL"] ?? "http://127.0.0.1:8545");
  const job = (): Hex => {
    const value = get("job");
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`--job must be a 32-byte hex id, got ${value}`);
    return value as Hex;
  };

  switch (argv[0]) {
    case "buy": {
      // Atomic units only. A decimal here is a class of bug this project refuses to
      // make representable: `--amount 0.25` would silently become 0.
      const raw = get("amount");
      if (!/^[0-9]+$/.test(raw)) {
        throw new Error(`--amount must be atomic units (an integer), got ${raw}. 0.25 USDC is 250000.`);
      }
      const resource = get("resource");
      if (!resource.startsWith("/")) throw new Error(`--resource must be a path, got ${resource}`);
      return {
        name: "buy",
        resource,
        amount: BigInt(raw),
        origin: origin(),
        body: get("body", JSON.stringify({ text: "AgentTrust binds one payment to one request." })),
        rpc: rpc(),
      };
    }
    case "status":
      return { name: "status", job: job(), origin: origin(), rpc: rpc() };
    case "refund":
      return { name: "refund", job: job(), origin: origin(), rpc: rpc() };
    default:
      throw new Error(`unknown command: ${argv[0] ?? "(none)"}\n\n${USAGE}`);
  }
}

const STATE_NAMES: Record<number, string> = {
  [JobState.None]: "None",
  [JobState.Funded]: "Funded",
  [JobState.Released]: "Released",
  [JobState.Refunded]: "Refunded",
};

function loadDeployment(): Deployment {
  return JSON.parse(readFileSync(join(ROOT, "deployments", "31337.json"), "utf8")) as Deployment;
}

/**
 * The seller publishes its agent id on its card. Reading it from the origin is a
 * bootstrap shortcut for the demo, not the trust decision: `purchase()` then resolves
 * that id through the Identity registry and refuses to continue unless the registered
 * agentURI's origin is the one being called (SPEC-002 §3).
 */
async function agentIdOf(origin: string): Promise<bigint> {
  const res = await fetch(`${origin}/.well-known/agent-card`);
  if (!res.ok) throw new Error(`no agent card at ${origin} (is \`npm run target:agenttrust\` running?)`);
  const card = (await res.json()) as { agentId?: string | number };
  if (card.agentId === undefined) throw new Error(`the agent card at ${origin} has no agentId`);
  return BigInt(card.agentId);
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const deployment = loadDeployment();
  const chain = createChainClient({
    rpcUrl: command.rpc,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    pollIntervalMs: 200,
  });
  await chain.verifyChainId();

  const chainDef = {
    id: deployment.chainId,
    name: `chain-${deployment.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [command.rpc] } },
  } as const;
  const wallet = createWalletClient({ account: accounts.buyer, chain: chainDef, transport: http(command.rpc) });

  if (command.name === "buy") {
    const sellerAgentId = await agentIdOf(command.origin);
    const request: PurchaseRequest = {
      sellerAgentId,
      origin: command.origin,
      path: command.resource,
      body: command.body,
      validator: accounts.validator.address,
    };
    console.log(`buy  ${command.resource}  up to ${command.amount} atomic (${formatAtomic(command.amount, 6)} USDC)`);
    console.log(`     seller agent ${sellerAgentId} at ${command.origin}`);
    console.log(`     payer nonce  ${nonceFor(request)}  (derived from the request, so a retry is the same job)`);

    const started = Date.now();
    const result = await purchase(
      {
        chain,
        wallet,
        account: accounts.buyer,
        identityRegistry: deployment.identityRegistry,
        reputationRegistry: deployment.reputationRegistry,
        token: deployment.token,
        maxPrice: command.amount,
        gate: {
          trustedClients: [accounts.trustedClient.address],
          minDistinct: 1,
          minCount: 1n,
          minAvgValue: 9000n,
        },
        confirmations: 0,
        ttlSeconds: 900,
        fetchJson: async (url: string) => (await fetch(url)).json(),
      },
      request,
    );

    console.log("");
    console.log(`     job          ${result.jobId}`);
    console.log(`     fund tx      ${result.fundTxHash}`);
    console.log(`     HTTP         200  ·  disposition: ${result.disposition}`);
    console.log(
      result.disposition === "executed"
        ? "                  the seller ran the work once for this payment"
        : "                  the stored result was re-served; the work did NOT run again",
    );
    console.log(`     response     ${result.responseHash}  (hashed by the buyer, matched against PAYMENT-RESPONSE)`);
    console.log(`     elapsed      ${Date.now() - started} ms  (local devnet, not a testnet figure)`);
    console.log("");
    console.log(`     status with: npm run status -- --job ${result.jobId}`);
    return;
  }

  const job = await chain.getJob(command.job);
  if (job === undefined || Number(job.state) === JobState.None) {
    console.log(`job ${command.job}: unknown to the escrow at ${deployment.escrow}`);
    process.exitCode = 1;
    return;
  }
  const state = Number(job.state);
  const now = await chain.blockTimestamp();

  if (command.name === "status") {
    console.log(`job        ${command.job}`);
    console.log(`state      ${STATE_NAMES[state] ?? state}`);
    console.log(`amount     ${job.amount} atomic (${formatAtomic(job.amount, 6)} USDC)`);
    console.log(`payer      ${job.payer}`);
    console.log(`payee      ${job.payee}`);
    console.log(`validator  ${job.validator}`);
    console.log(`deadline   ${job.deadline}  (chain now ${now}, ${Number(job.deadline) - now}s remaining)`);
    console.log(`grace      ${job.grace}s, snapshotted at funding`);
    console.log(
      state === JobState.Funded
        ? `refundable after ${Number(job.deadline) + Number(job.grace)} (deadline + grace) if no pass is recorded`
        : "settled",
    );
    return;
  }

  // refund
  if (state !== JobState.Funded) {
    console.log(`job ${command.job} is ${STATE_NAMES[state] ?? state}; only a Funded job can be refunded`);
    process.exitCode = 1;
    return;
  }
  const refundableAt = Number(job.deadline) + Number(job.grace);
  if (now < refundableAt) {
    console.log(
      `not yet: refunds open at ${refundableAt} (deadline + grace), chain time is ${now}, ` +
        `${refundableAt - now}s to go. There is no early refund on a failing attestation, ` +
        `because a pending validation request is indistinguishable from a response of 0 (DF-05).`,
    );
    process.exitCode = 1;
    return;
  }
  const hash = await wallet.writeContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "refund",
    args: [command.job],
  });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  console.log(`refund     ${hash}  (${receipt.status})`);
  console.log(`returned   ${job.amount} atomic to ${job.payer}`);
}

// `file://${process.argv[1]}` does not round-trip: this repository lives under
// "8th Sem", and `import.meta.url` percent-encodes the space while the argv path does
// not, so the string compare silently failed and the server started, printed nothing
// and served nothing. `pathToFileURL` is the encoding-correct form.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof BuyerAbort) {
      console.error(`aborted: ${error.message}`);
      console.error(
        error.beforeFunding
          ? "           nothing was paid: the buyer stopped before funding"
          : "           the payer-scoped nonce is derived from the request, so re-running " +
            "the same `buy` after the job settled cannot fund a second job for it. " +
            "Change --body to buy a different request.",
      );
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exit(1);
  });
}
