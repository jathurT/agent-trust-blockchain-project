/**
 * API-008 — the labelled vulnerable baseline.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *  THIS SERVER IS BROKEN ON PURPOSE. It is a control target, not a product.
 *  It must never be deployed anywhere, never be pointed at a real token, and never
 *  be described as x402, as upstream, or as anyone else's implementation.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * What it reproduces, and why each one matters:
 *
 *  **A2 — replay without idempotency.** The authorization is verified off-chain and
 *  the resource is granted immediately, with no record of what has already been
 *  served. Replaying one authorization N times yields N grants. That is the published
 *  condition: 50 replays produced 50 grants, and the strongest round produced 248
 *  grants against a single settlement (V-13, V-24).
 *
 *  **A3 — no resource binding.** An EIP-3009 authorization names `from`, `to`, `value`
 *  and a nonce. It says nothing about *which resource* is being bought. A fixture that
 *  checks only the authorization will therefore accept an authorization minted for one
 *  resource against a different one of the same price — which is why AgentTrust's two
 *  paid routes cost the same, so the substitution cannot be caught by the amount.
 *
 * Settlement is deliberately **asynchronous and best-effort**: the grant does not wait
 * for it. That is what makes "grants" and "settlements" countable separately, which is
 * the whole shape of the published A2 result.
 */
import express, { type Express, type Request, type Response } from "express";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { serialise, summarise, classify, BadRequest } from "@agenttrust/seller/src/routes/deterministic.js";
import { rawBody, parseJsonBody, type RawRequest } from "@agenttrust/seller/src/rawBody.js";
import { FIXTURE_HEADER, fixtureBanner } from "./fixture-label.js";

export interface VulnerableAuthorization {
  from: Address;
  to: Address;
  /** Atomic units, as a decimal string. Note what is absent: any mention of a resource. */
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: Hex;
  signature: Hex;
}

export interface GrantRecord {
  at: number;
  path: string;
  authorizationNonce: Hex;
  responseHash: Hex;
  /** Index of this grant for this authorization: 1 is the first, 2 the first replay. */
  grantIndex: number;
}

export interface SettlementRecord {
  at: number;
  authorizationNonce: Hex;
  ok: boolean;
  detail: string;
}

/**
 * API-010 — which published condition this fixture reproduces.
 *
 * One mode per paper finding, rather than one fixture with every flaw at once: an
 * "insecure server" that is wrong in four ways cannot attribute a result to any one of
 * them. `replay` is the original and is unchanged — the frozen A2 and A3 runs depend on
 * it byte for byte.
 */
export type FixtureMode = "replay" | "check-then-act" | "upto" | "optimistic";

export interface VulnerableFixtureOptions {
  price: bigint;
  payTo: Address;
  /** Defaults to `replay`, the A2/A3 behaviour. */
  mode?: FixtureMode;
  /**
   * `check-then-act` only (A4). The gap between deciding a payment is unused and
   * recording that decision — in a real server, a facilitator `/verify` round trip.
   * Duplicate delivery is a function of this window, so it is a parameter and is
   * recorded in the result, never a constant buried in the code.
   */
  verifyWindowMs?: number;
  /**
   * `upto` only (A5). The total the buyer authorises across the burst. Delivery
   * happens first and the draw happens after, so once this is exhausted the seller has
   * delivered work it will never be paid for — which is the direction of loss the
   * published result found (V-26, DF-10).
   */
  allowance?: bigint;
  /**
   * Called for each grant, out of band. Left undefined in unit tests; wired to
   * MockUSDC's `transferWithAuthorization` by the harness so settlements can be
   * counted against grants.
   */
  settle?: (auth: VulnerableAuthorization) => Promise<{ ok: boolean; detail: string }>;
  log?: (line: Record<string, unknown>) => void;
}

/** One delivery under `upto`: what was served, and whether the draw afterwards worked. */
export interface DrawRecord {
  at: number;
  authorizationNonce: Hex;
  /** What the seller tried to draw for this request. */
  amount: string;
  /** False once the allowance is exhausted — delivered, never paid. */
  settled: boolean;
}

export interface VulnerableFixture {
  app: Express;
  mode: FixtureMode;
  grants: GrantRecord[];
  settlements: SettlementRecord[];
  /** `upto` only: one entry per delivery, settled or not. */
  draws: DrawRecord[];
  /** Grants per authorization nonce: the A2 number. */
  grantsByAuthorization(): Record<string, number>;
  settled(): Promise<void>;
}

const HANDLERS: Record<string, (body: unknown) => unknown> = {
  "/v1/summarise": (body) => summarise(body as never),
  "/v1/classify": (body) => classify(body as never),
};

function decodeAuthorization(header: string | undefined): VulnerableAuthorization | undefined {
  if (!header) return undefined;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as VulnerableAuthorization;
  } catch {
    return undefined;
  }
}

export function createVulnerableFixture(options: VulnerableFixtureOptions): VulnerableFixture {
  const log = options.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
  const mode: FixtureMode = options.mode ?? "replay";
  const grants: GrantRecord[] = [];
  const settlements: SettlementRecord[] = [];
  const draws: DrawRecord[] = [];
  const grantCounts = new Map<string, number>();
  const pending: Promise<void>[] = [];

  // `check-then-act` (A4): the seller *does* try to be idempotent. It checks whether
  // this authorization has been used, then does the work, then records it — and the
  // check and the record are not one atomic step. Two requests that arrive inside the
  // gap both see "unused" and both execute. This is the published shape: a race inside
  // the verify→settle window (V-25), not an absence of idempotency.
  const usedAuthorizations = new Set<string>();
  const verifyWindowMs = options.verifyWindowMs ?? 5;

  // `upto` (A5): one allowance shared across the burst, drawn *after* delivery.
  let allowanceRemaining = options.allowance ?? 0n;

  log({ level: "warn", msg: "starting the vulnerable fixture", ...fixtureBanner() });

  const app = express();
  app.disable("x-powered-by");
  app.use(rawBody());

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "AgentTrust vulnerable baseline fixture",
      ...fixtureBanner(),
      mode,
      reproduces: {
        replay: "A2 replay without idempotency (arXiv 2605.11781 §4.3) and A3 cross-resource substitution (arXiv 2605.30998 §4.1)",
        "check-then-act": "A4 duplicate delivery from a race inside the verify->settle window (arXiv 2605.30998 §4.2)",
        upto: "A5 resource leakage under `upto` pricing, where the seller bears the loss (arXiv 2605.30998 §4.4)",
        optimistic: "A1 granting before the payment is final, so a reorg removes it (arXiv 2605.11781 §3.1.1)",
      }[mode],
    });
  });

  app.get("/__fixture/metrics", (_req: Request, res: Response) => {
    res.json({
      ...fixtureBanner(),
      mode,
      grants: grants.length,
      settlements: settlements.length,
      draws: draws.length,
      drawsSettled: draws.filter((d) => d.settled).length,
      allowanceRemaining: allowanceRemaining.toString(),
      grantsByAuthorization: Object.fromEntries(grantCounts),
    });
  });

  for (const path of Object.keys(HANDLERS)) {
    app.post(path, async (req: Request, res: Response) => {
      const auth = decodeAuthorization(req.get("PAYMENT-SIGNATURE") ?? undefined);

      if (!auth) {
        // A quote, in roughly the shape a payment-required response takes. The point
        // of the fixture is what happens *after* this, so it is kept minimal.
        res.status(402).json({
          ...fixtureBanner(),
          error: "payment required",
          accepts: [{ amount: options.price.toString(), payTo: options.payTo }],
        });
        return;
      }

      // ── The vulnerability, stated plainly ──────────────────────────────────────
      // Off-chain checks only, and only about the *authorization*: is it the right
      // amount, to the right payee, within its validity window? Nothing here looks at
      // what has already been served (A2), and nothing ties the authorization to this
      // request (A3) — because an EIP-3009 authorization carries no resource field to
      // tie it to.
      const now = Math.floor(Date.now() / 1000);
      if (BigInt(auth.value) < options.price) {
        res.status(402).json({ ...fixtureBanner(), error: "amount too low" });
        return;
      }
      if (auth.to.toLowerCase() !== options.payTo.toLowerCase()) {
        res.status(402).json({ ...fixtureBanner(), error: "wrong payee" });
        return;
      }
      if (now <= auth.validAfter || now >= auth.validBefore) {
        res.status(402).json({ ...fixtureBanner(), error: "authorization outside its validity window" });
        return;
      }
      // ...and that is the whole check. Grant now, settle later.
      // ──────────────────────────────────────────────────────────────────────────

      if (mode === "check-then-act") {
        // The A4 race, written so it is obvious rather than accidental. A correct
        // implementation takes the claim atomically *before* yielding; this one
        // checks, yields, and only then records — so everything that arrives inside
        // the window has already passed the check.
        if (usedAuthorizations.has(auth.nonce)) {
          res.status(409).json({ ...fixtureBanner(), error: "authorization already used" });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, verifyWindowMs));
        usedAuthorizations.add(auth.nonce);
      }

      let body: Buffer;
      try {
        body = serialise(HANDLERS[path]!(parseJsonBody(req as RawRequest)));
      } catch (error) {
        const status = error instanceof BadRequest || error instanceof SyntaxError ? 400 : 500;
        res.status(status).json({ ...fixtureBanner(), error: (error as Error).message });
        return;
      }

      const grantIndex = (grantCounts.get(auth.nonce) ?? 0) + 1;
      grantCounts.set(auth.nonce, grantIndex);
      const responseHash = keccak256(body);
      grants.push({ at: Date.now(), path, authorizationNonce: auth.nonce, responseHash, grantIndex });

      log({
        level: "info",
        msg: "granted",
        ...fixtureBanner(),
        path,
        authorizationNonce: auth.nonce,
        grantIndex,
        note: grantIndex > 1 ? "this is a replay and was granted anyway (A2)" : undefined,
      });

      if (mode === "upto") {
        // The A5 direction of loss. The work is already done — `body` exists — and
        // only now does the seller try to draw for it. Once the buyer's allowance is
        // gone the draw fails, and the seller has delivered for nothing. `quotedMax`
        // would not help: the overdraft is not the buyer being charged too much, it is
        // the seller being paid too little (DF-10).
        const settledNow = allowanceRemaining >= options.price;
        if (settledNow) allowanceRemaining -= options.price;
        draws.push({
          at: Date.now(),
          authorizationNonce: auth.nonce,
          amount: options.price.toString(),
          settled: settledNow,
        });
        if (!settledNow) {
          log({
            level: "warn",
            msg: "delivered but could not draw — the seller ate this one (A5)",
            ...fixtureBanner(),
            authorizationNonce: auth.nonce,
          });
        }
      }

      // Settlement does not gate the grant. That separation is what makes grants and
      // settlements countable against each other.
      if (options.settle) {
        pending.push(
          options
            .settle(auth)
            .then((r) => {
              settlements.push({ at: Date.now(), authorizationNonce: auth.nonce, ...r });
            })
            .catch((e: unknown) => {
              settlements.push({
                at: Date.now(),
                authorizationNonce: auth.nonce,
                ok: false,
                detail: (e as Error)?.message ?? String(e),
              });
            }),
        );
      }

      res
        .status(200)
        .set("Content-Type", "application/json; charset=utf-8")
        .set("X-Fixture-Label", FIXTURE_HEADER)
        .set("Content-Length", String(body.length))
        .end(body);
    });
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ ...fixtureBanner(), error: "no such route" });
  });

  return {
    app,
    mode,
    grants,
    settlements,
    draws,
    grantsByAuthorization: () => Object.fromEntries(grantCounts),
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}
