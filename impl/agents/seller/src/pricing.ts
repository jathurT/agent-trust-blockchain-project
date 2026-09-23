/**
 * API-001 — the price table.
 *
 * Prices are configuration, in atomic units, and they are part of the hash the chain
 * computes: `resourceHash` covers `amount`, `token` and `chainId` alongside the request
 * (SPEC-001 §3.3). A seller that changed a price between quoting and verifying would
 * simply fail to recognise its own job.
 *
 * The two paid routes cost **exactly the same** on purpose. Equal price is what makes
 * the A3 substitution attack meaningful: with different prices a swapped resource could
 * be caught by the amount alone, and the test would prove nothing about whether the
 * request itself is bound (SPEC-002 §2, SEC-004).
 */
import { parseAtomic } from "@agenttrust/core";

export interface PricedRoute {
  path: string;
  /** Atomic units of the configured token. */
  price: bigint;
  description: string;
  mimeType: string;
}

export const TOKEN_DECIMALS = 6; // USDC (V-81)

/** The one price both paid routes share. */
export const UNIT_PRICE = parseAtomic("0.25", TOKEN_DECIMALS);

export const PAID_ROUTES: readonly PricedRoute[] = [
  {
    path: "/v1/summarise",
    price: UNIT_PRICE,
    description: "Deterministic extractive summary",
    mimeType: "application/json",
  },
  {
    path: "/v1/classify",
    price: UNIT_PRICE,
    description: "Deterministic keyword classification",
    mimeType: "application/json",
  },
] as const;

const BY_PATH = new Map(PAID_ROUTES.map((r) => [r.path, r]));

export const priceOf = (path: string): bigint | undefined => BY_PATH.get(path)?.price;
export const routeFor = (path: string): PricedRoute | undefined => BY_PATH.get(path);
export const isPaidRoute = (path: string): boolean => BY_PATH.has(path);
