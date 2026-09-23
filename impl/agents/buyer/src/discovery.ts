/**
 * AGENT-002 step 1 — discovery.
 *
 * The buyer resolves the seller through the Identity registry rather than trusting the
 * host it happens to be talking to: `agentURI` → agent card → endpoint origin, and the
 * origin in the card must match the host being called.
 *
 * Without this check the whole chain of trust starts at "whatever DNS returned". With
 * it, a seller that has been impersonated fails before any money moves, because the
 * impostor cannot change what the registry says about the agent.
 */
import { identityRegistryAbi, type ChainClient } from "@agenttrust/core";
import type { Address } from "viem";
import { BuyerAbort } from "./errors.js";

export interface AgentCard {
  agentId?: string;
  endpoint?: string;
  name?: string;
  [key: string]: unknown;
}

export interface Discovered {
  agentId: bigint;
  /** The payee the escrow will snapshot: `getAgentWallet`, falling back to `ownerOf`. */
  payee: Address;
  agentURI: string;
  origin: string;
  card: AgentCard;
}

export interface DiscoveryDeps {
  chain: ChainClient;
  identityRegistry: Address;
  /** Injected so tests need no network; defaults to global fetch. */
  fetchJson?: (url: string) => Promise<unknown>;
}

const defaultFetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export async function discover(deps: DiscoveryDeps, agentId: bigint, callingOrigin: string): Promise<Discovered> {
  const read = <T,>(functionName: "tokenURI" | "getAgentWallet" | "ownerOf") =>
    deps.chain.client.readContract({
      address: deps.identityRegistry,
      abi: identityRegistryAbi,
      functionName,
      args: [agentId],
    }) as Promise<T>;

  const agentURI = await read<string>("tokenURI");
  if (!agentURI) {
    throw new BuyerAbort("quote_invalid", `agent ${agentId} publishes no agentURI`, true);
  }

  // Same resolution the escrow performs at funding time (DF-12), so the buyer knows
  // who will actually be paid rather than who the seller claims will be.
  let payee = await read<Address>("getAgentWallet");
  if (payee === "0x0000000000000000000000000000000000000000") {
    payee = await read<Address>("ownerOf");
  }

  const card = (await (deps.fetchJson ?? defaultFetchJson)(agentURI)) as AgentCard;
  const declared = typeof card.endpoint === "string" ? card.endpoint : originOf(agentURI);
  const cardOrigin = originOf(declared);

  if (cardOrigin !== originOf(callingOrigin)) {
    throw new BuyerAbort(
      "origin_mismatch",
      `the registry says agent ${agentId} serves ${cardOrigin}, but this request is going to ${originOf(callingOrigin)}`,
      true,
    );
  }

  return { agentId, payee, agentURI, origin: cardOrigin, card };
}
