/**
 * AGENT-002 — the reasons a buyer stops.
 *
 * Every abort names what it checked and what it saw. A buyer that fails with "payment
 * failed" is useless for an evaluation: SEC-003/004 need to know whether the seller was
 * refused, the origin did not match, or the gate would have rejected the seller before
 * a single wei moved.
 */
export type AbortReason =
  | "origin_mismatch"
  | "payee_mismatch"
  | "price_too_high"
  | "no_acceptable_offer"
  | "gate_would_refuse"
  | "quote_invalid"
  | "funding_failed"
  | "delivery_refused"
  | "response_mismatch";

export class BuyerAbort extends Error {
  constructor(
    readonly reason: AbortReason,
    message: string,
    /** True when the buyer stopped **before** any money moved. */
    readonly beforeFunding: boolean,
  ) {
    super(message);
    this.name = "BuyerAbort";
  }
}
