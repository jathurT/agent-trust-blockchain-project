/**
 * REG-009 — labelled, reproducible reputation fixtures.
 *
 * A6 needs a registry populated with three kinds of seller, and the whole experiment is
 * worthless if the population is not reproducible: "Sybils captured 60% of selections"
 * means nothing without knowing how many Sybils, how many honest sellers, and who
 * vouched for whom. Everything here is derived from a seed and recorded in the result.
 *
 * The three kinds:
 *
 *  - **honest** — registered, with feedback from addresses the buyer named in advance.
 *    This is what the gate is designed to admit.
 *  - **sybil** — a ring of agents with distinct owner addresses that endorse each other
 *    and nobody else. ERC-8004 permits this: any address except the agent's own owner
 *    or operator may leave feedback, with no proof that a transaction ever happened
 *    (V-93). The ring costs gas and nothing else.
 *  - **newcomer** — registered, honest, and with no history at all. This is the
 *    population the gate is expected to refuse *wrongly*, and measuring that cost is
 *    half the point of A6 (DF-09).
 *
 * Nothing here is a mock of reputation: the feedback is written to the registry with
 * the project's real tag and read back through the same `getSummary` the escrow calls.
 */
import {
  identityRegistryAbi,
  reputationRegistryAbi,
  type ChainClient,
} from "@agenttrust/core";
import { parseAbi, parseEventLogs, type Address, type Hex, type WalletClient } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { seededRandom } from "./stats.js";

export const TEST_MNEMONIC = "test test test test test test test test test test test junk";

/** Where each cohort's accounts start, so two cohorts can never share an address. */
const INDEX = { trustedClient: 100, honest: 200, sybil: 300, newcomer: 400, stranger: 500 } as const;

export type AgentKind = "honest" | "sybil" | "newcomer";

export interface AgentRecord {
  kind: AgentKind;
  agentId: bigint;
  owner: Address;
  /** Feedback value in hundredths, as written. Newcomers have none. */
  score: number | null;
  /** Who actually left feedback for this agent. */
  attesters: Address[];
}

export interface PopulationSpec {
  honest: number;
  sybils: number;
  newcomers: number;
  /** Addresses the buyer trusts. Honest sellers are endorsed by these and nobody else. */
  trustedClients: number;
  /** Inclusive range, in hundredths: 9500 is 95.00. */
  honestScore: [number, number];
  /** Sybils rate each other at the top of the scale, because nothing stops them. */
  sybilScore: number;
  /**
   * Entries each ring member leaves for each other member.
   *
   * This is not padding. The blueprint's gate requires `count >= 5`, and five Sybils
   * can only endorse each other four times apiece — the registry refuses feedback from
   * an agent's own owner. One entry each gives count = 4 and the ring *fails*. Two
   * gives count = 8, which is DF-09's arithmetic: `distinct = 4 >= 3` and
   * `count = 8 >= 5`, at a score the ring chooses for itself. ERC-8004 permits repeat
   * feedback from the same client, so this costs the ring nothing but gas.
   */
  sybilEntriesPerAttester: number;
  /**
   * Entries each trusted client leaves for each honest seller. Set so honest sellers
   * also clear `count >= 5`; otherwise the comparison would be measuring entry volume
   * rather than who the attesters are, and gate v1 would refuse honest sellers for the
   * wrong reason.
   */
  honestEntriesPerClient: number;
  seed: number;
}

export const DEFAULT_SPEC: PopulationSpec = {
  honest: 10,
  sybils: 5,
  newcomers: 10,
  trustedClients: 3,
  honestScore: [8000, 9800],
  sybilScore: 10_000,
  sybilEntriesPerAttester: 2,
  honestEntriesPerClient: 2,
  seed: 1,
};

export interface Population {
  spec: PopulationSpec;
  agents: AgentRecord[];
  trustedClients: Address[];
  /** Addresses that vouch for nobody the buyer trusts — the honest sellers' attesters. */
  label: string;
}

export const POPULATION_LABEL =
  "REG-009 seeded reputation fixture. The Sybil ring is constructed, not observed: " +
  "five agents with distinct owners endorsing one another, which ERC-8004 permits " +
  "because feedback needs no proof of interaction (V-93). Honest sellers carry feedback " +
  "only from the buyer's named trusted clients. Newcomers carry none.";

/** The fixture's account at a given HD index. Exported so SEC-007 can reach the
 *  trusted clients and its own extra agents without re-deriving the index map. */
export const fixtureAccount = (index: number): HDAccount =>
  mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index });

export const ACCOUNT_INDEX = INDEX;

const account = fixtureAccount;

/**
 * Give every fixture account gas.
 *
 * Anvil pre-funds only its first ten accounts, and this population uses indices 100+
 * so no cohort can ever collide with a role account. `anvil_setBalance` is used rather
 * than ~40 funding transfers: it is instant, and it keeps the setup out of the block
 * history so the gas measurements below are not diluted by fixture plumbing.
 *
 * **This is devnet-only by construction.** It is refused on any chain but 31337 — on a
 * real testnet these accounts would need faucet funding, which is ENV-007 and is not
 * something a fixture may assume.
 */
export async function fundForGas(rpcUrl: string, chainId: number, addresses: Address[]): Promise<void> {
  if (chainId !== 31337) {
    throw new Error(
      `REG-009 populates accounts with anvil_setBalance, which only exists on a local ` +
        `devnet; refusing to run against chain ${chainId}`,
    );
  }
  for (const address of addresses) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setBalance",
        params: [address, "0xDE0B6B3A7640000"], // 1 ETH
      }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    if (body.error) throw new Error(`anvil_setBalance failed for ${address}: ${body.error.message}`);
  }
}

export interface BuildDeps {
  chain: ChainClient;
  wallet: (account: HDAccount) => WalletClient;
  /** Needed for the devnet-only `anvil_setBalance` that gives fixture accounts gas. */
  rpcUrl: string;
  chainId: number;
  identityRegistry: Address;
  reputationRegistry: Address;
  /** The escrow's FEEDBACK_TAG, read from the contract rather than hard-coded. */
  tag: string;
  /** Feedback value decimals the escrow expects (FEEDBACK_DECIMALS = 2). */
  decimals: number;
}

const registeredEvent = parseAbi([
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

async function register(deps: BuildDeps, owner: HDAccount, uri: string): Promise<bigint> {
  const hash = await deps.wallet(owner).writeContract({
    address: deps.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
    account: owner,
    chain: null,
  });
  const receipt = await deps.chain.client.waitForTransactionReceipt({ hash });
  // By signature, never by log position: `register` emits ERC-721 Transfer first, and
  // reading its topics[1] yields `from` = address(0), which silently returns agent 0.
  const logs = parseEventLogs({ abi: registeredEvent, logs: receipt.logs });
  const id = logs[0]?.args.agentId;
  if (id === undefined) throw new Error("register() emitted no Registered event");
  return id;
}

async function rate(
  deps: BuildDeps,
  client: HDAccount,
  agentId: bigint,
  value: number,
): Promise<void> {
  const hash = await deps.wallet(client).writeContract({
    address: deps.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [agentId, BigInt(value), deps.decimals, deps.tag, "", "", "", `0x${"00".repeat(32)}` as Hex],
    account: client,
    chain: null,
  });
  await deps.chain.client.waitForTransactionReceipt({ hash });
}

/**
 * Registers the whole population and writes its feedback. Sequential on purpose: these
 * accounts send many transactions and parallel sends collide on nonces, which fails as
 * "transaction creation failed" and looks like a contract problem.
 */
export async function buildPopulation(deps: BuildDeps, spec: PopulationSpec): Promise<Population> {
  const random = seededRandom(spec.seed);
  const agents: AgentRecord[] = [];

  const trustedAccounts = Array.from({ length: spec.trustedClients }, (_, i) => account(INDEX.trustedClient + i));
  const trustedClients = trustedAccounts.map((a) => a.address);

  // Every account that will send a transaction, funded before any of them tries.
  const sellerAccounts = [
    ...Array.from({ length: spec.honest }, (_, i) => account(INDEX.honest + i)),
    ...Array.from({ length: spec.sybils }, (_, i) => account(INDEX.sybil + i)),
    ...Array.from({ length: spec.newcomers }, (_, i) => account(INDEX.newcomer + i)),
  ];
  await fundForGas(deps.rpcUrl, deps.chainId, [...trustedAccounts, ...sellerAccounts].map((a) => a.address));

  // ---- honest sellers: endorsed by the buyer's trusted clients, and only by them
  for (let i = 0; i < spec.honest; i++) {
    const owner = account(INDEX.honest + i);
    const agentId = await register(deps, owner, `https://honest-${i}.invalid/.well-known/agent-card`);
    const [lo, hi] = spec.honestScore;
    const score = lo + Math.floor(random() * (hi - lo + 1));
    for (const client of trustedAccounts) {
      for (let e = 0; e < spec.honestEntriesPerClient; e++) await rate(deps, client, agentId, score);
    }
    agents.push({ kind: "honest", agentId, owner: owner.address, score, attesters: trustedClients });
  }

  // ---- the Sybil ring: each endorses every other, at the top of the scale
  const sybilOwners = Array.from({ length: spec.sybils }, (_, i) => account(INDEX.sybil + i));
  const sybilIds: bigint[] = [];
  for (let i = 0; i < spec.sybils; i++) {
    sybilIds.push(await register(deps, sybilOwners[i]!, `https://sybil-${i}.invalid/.well-known/agent-card`));
  }
  for (let i = 0; i < spec.sybils; i++) {
    const attesters: Address[] = [];
    for (let j = 0; j < spec.sybils; j++) {
      // Not itself: the registry rejects feedback from the agent's own owner or
      // operator (isAuthorizedOrOwner), which is the one limit the ring has to respect.
      if (i === j) continue;
      for (let e = 0; e < spec.sybilEntriesPerAttester; e++) {
        await rate(deps, sybilOwners[j]!, sybilIds[i]!, spec.sybilScore);
      }
      attesters.push(sybilOwners[j]!.address);
    }
    agents.push({
      kind: "sybil",
      agentId: sybilIds[i]!,
      owner: sybilOwners[i]!.address,
      score: spec.sybilScore,
      attesters,
    });
  }

  // ---- newcomers: registered, honest, no history
  for (let i = 0; i < spec.newcomers; i++) {
    const owner = account(INDEX.newcomer + i);
    const agentId = await register(deps, owner, `https://newcomer-${i}.invalid/.well-known/agent-card`);
    agents.push({ kind: "newcomer", agentId, owner: owner.address, score: null, attesters: [] });
  }

  return { spec, agents, trustedClients, label: POPULATION_LABEL };
}
