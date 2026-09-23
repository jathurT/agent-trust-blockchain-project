/**
 * AGENT-001 — chain access for the buyer, the seller and the harness.
 *
 * Two rules shape this module.
 *
 * **Polling, never subscriptions.** The public Base Sepolia RPC is HTTP-only (V-83), so
 * `eth_subscribe` is not available. viem would happily fall back to polling on an HTTP
 * transport, but a watcher written against a WebSocket assumption would work locally
 * against Anvil and fail on the testnet, so the polling is explicit here.
 *
 * **Fail closed.** Every read that the seller's decision depends on either answers or
 * throws `ChainUnavailable`, which SPEC-002 §8 maps to `503`. There is no path where an
 * unreachable node produces "no job found" and therefore "no payment required".
 */
import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { escrowAbi, JobState } from "./abi.js";

export class ChainUnavailable extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChainUnavailable";
  }
}

export interface Job {
  payer: Address;
  payee: Address;
  payeeAgentId: bigint;
  validator: Address;
  token: Address;
  amount: bigint;
  resourceHash: Hex;
  requestHash: Hex;
  fundedAt: bigint;
  deadline: bigint;
  grace: bigint;
  state: JobState;
  validationRecorded: boolean;
}

export interface ChainOptions {
  rpcUrl: string;
  chainId: number;
  escrow: Address;
  /** Milliseconds between polls. */
  pollIntervalMs?: number;
  /** Give up on a single RPC call after this long. */
  timeoutMs?: number;
}

export interface ChainClient {
  readonly client: PublicClient;
  readonly escrow: Address;
  readonly chainId: number;
  readonly pollIntervalMs: number;
  blockNumber(): Promise<bigint>;
  /** The latest block's timestamp, in unix seconds. */
  blockTimestamp(): Promise<number>;
  getJob(jobId: Hex): Promise<Job | undefined>;
  confirmations(txHash: Hex): Promise<number>;
  waitForConfirmations(txHash: Hex, want: number, opts?: { timeoutMs?: number }): Promise<number>;
  verifyChainId(): Promise<void>;
}

const minimalChain = (chainId: number, rpcUrl: string): Chain => ({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

/** Wrap anything the transport throws so callers never have to guess the shape. */
async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new ChainUnavailable(`${what} failed: ${(error as Error)?.message ?? String(error)}`, error);
  }
}

export function createChainClient(options: ChainOptions): ChainClient {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const client = createPublicClient({
    chain: minimalChain(options.chainId, options.rpcUrl),
    transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000, retryCount: 2 }),
    pollingInterval: pollIntervalMs,
  }) as PublicClient;

  const escrow = options.escrow;

  return {
    client,
    escrow,
    chainId: options.chainId,
    pollIntervalMs,

    blockNumber: () => guarded("eth_blockNumber", () => client.getBlockNumber({ cacheTime: 0 })),

    /**
     * Chain time, not the local clock. A deadline written by a contract is measured in
     * `block.timestamp`, and the two can differ — on a devnet by hours after a time
     * warp, on a real chain by seconds. Comparing a chain deadline against a local
     * clock is simply the wrong subtraction, and it fails open: a seller whose clock
     * lags the chain would think there was more time left than there is.
     */
    blockTimestamp: async () => {
      const block = await guarded("eth_getBlockByNumber", () =>
        client.getBlock({ blockTag: "latest", includeTransactions: false }),
      );
      return Number(block.timestamp);
    },

    /**
     * Returns `undefined` only when the chain positively says the job does not exist.
     * `jobs()` reverts `UnknownJob` for an absent id, which is a real answer; anything
     * else is an unreachable node and throws.
     */
    async getJob(jobId: Hex): Promise<Job | undefined> {
      try {
        const job = (await client.readContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "jobs",
          args: [jobId],
        })) as unknown as Job;
        return { ...job, state: Number(job.state) as JobState };
      } catch (error) {
        const message = (error as Error)?.message ?? "";
        if (/UnknownJob/.test(message)) return undefined;
        throw new ChainUnavailable(`jobs(${jobId}) failed: ${message}`, error);
      }
    },

    /**
     * Blocks mined on top of the one containing `txHash`, counting that block as the
     * first confirmation. A transaction the node has not seen yet is 0, not an error:
     * the caller is expected to wait, and SPEC-002 maps that to `425`.
     */
    async confirmations(txHash: Hex): Promise<number> {
      const receipt = await guarded("eth_getTransactionReceipt", async () => {
        try {
          return await client.getTransactionReceipt({ hash: txHash });
        } catch (error) {
          if (/not be found|not found/i.test((error as Error)?.message ?? "")) return undefined;
          throw error;
        }
      });
      if (!receipt) return 0;
      if (receipt.status !== "success") {
        throw new ChainUnavailable(`funding transaction ${txHash} reverted`);
      }
      const head = await guarded("eth_blockNumber", () => client.getBlockNumber({ cacheTime: 0 }));
      if (head < receipt.blockNumber) return 0;
      return Number(head - receipt.blockNumber) + 1;
    },

    /** Polls until `want` confirmations exist or the deadline passes. */
    async waitForConfirmations(txHash, want, opts): Promise<number> {
      const deadline = Date.now() + (opts?.timeoutMs ?? 120_000);
      for (;;) {
        const have = await this.confirmations(txHash);
        if (have >= want) return have;
        if (Date.now() >= deadline) {
          throw new ChainUnavailable(
            `${txHash} reached ${have} of ${want} confirmations before the timeout`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },

    /**
     * A configured chain id that does not match the node is the kind of mistake that
     * produces a demo against the wrong network, so services check it at startup.
     */
    async verifyChainId(): Promise<void> {
      const actual = await guarded("eth_chainId", () => client.getChainId());
      if (actual !== options.chainId) {
        throw new ChainUnavailable(`configured chain ${options.chainId} but the node reports ${actual}`);
      }
    },
  };
}

/**
 * Poll for `JobFunded` logs in a block range. Used by the harness and the buyer;
 * deliberately a plain range query rather than a subscription, and chunked so a wide
 * range does not become one enormous request a public node will refuse.
 */
export async function getJobFundedLogs(
  chain: ChainClient,
  fromBlock: bigint,
  toBlock: bigint,
  chunk = 500n,
): Promise<{ jobId: Hex; payer: Address; payee: Address; amount: bigint; blockNumber: bigint }[]> {
  const event = escrowAbi.find((e) => e.type === "event" && e.name === "JobFunded");
  if (!event) throw new Error("JobFunded is not in the escrow ABI");

  const out: { jobId: Hex; payer: Address; payee: Address; amount: bigint; blockNumber: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    const logs = await guarded("eth_getLogs", () =>
      chain.client.getLogs({
        address: chain.escrow,
        event: event as never,
        fromBlock: start,
        toBlock: end,
      }),
    );
    for (const log of logs as unknown as { args: Record<string, unknown>; blockNumber: bigint | null }[]) {
      out.push({
        jobId: log.args["jobId"] as Hex,
        payer: log.args["payer"] as Address,
        payee: log.args["payee"] as Address,
        amount: log.args["amount"] as bigint,
        blockNumber: log.blockNumber ?? 0n,
      });
    }
  }
  return out;
}
