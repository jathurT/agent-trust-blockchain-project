/**
 * AGENT-001 — atomic amounts.
 *
 * Every amount in this project is a `bigint` in the token's smallest unit. USDC has
 * six decimals, so 0.25 USDC is `250000n`. No amount is ever a `number`: 2^53 is not
 * far away in 6-decimal units, and floating point cannot represent tenths exactly, so
 * a single `parseFloat` anywhere in the path would eventually settle the wrong sum.
 *
 * The two functions below are the only bridge between atomic units and human text, and
 * `formatAtomic` is **display only** — its output must never be parsed back and used as
 * an amount.
 */

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Parse a decimal string such as "0.25" into atomic units. Rejects anything it cannot
 * represent exactly rather than rounding: a quote the seller cannot express is a
 * configuration error, not something to silently truncate.
 */
export function parseAtomic(decimal: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new AmountError(`decimals out of range: ${decimals}`);
  }
  const trimmed = decimal.trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) throw new AmountError(`not a decimal number: ${decimal}`);

  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new AmountError(
      `${decimal} needs ${fraction.length} decimal places but the token has ${decimals}`,
    );
  }
  const padded = fraction.padEnd(decimals, "0");
  const value = BigInt(`${whole}${padded}`);
  return sign === "-" ? -value : value;
}

/** Atomic units to a decimal string. **Display only** — never parse this back. */
export function formatAtomic(atomic: bigint, decimals: number): string {
  const negative = atomic < 0n;
  const digits = (negative ? -atomic : atomic).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Read an amount that arrived over the wire. x402 v2 sends amounts as decimal strings
 * of atomic units — "250000", not "0.25" — so this is a plain integer parse, and it
 * refuses anything else rather than guessing which convention the sender meant.
 */
export function atomicFromWire(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) {
    throw new AmountError(`wire amounts are decimal strings of atomic units: got ${value}`);
  }
  return BigInt(value.trim());
}

/** The inverse, for building a quote. */
export function atomicToWire(atomic: bigint): string {
  if (atomic < 0n) throw new AmountError(`amount cannot be negative: ${atomic}`);
  return atomic.toString();
}
