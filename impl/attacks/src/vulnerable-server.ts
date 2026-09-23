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

export interface VulnerableFixtureOptions {
  price: bigint;
  payTo: Address;
  /**
   * Called for each grant, out of band. Left undefined in unit tests; wired to
   * MockUSDC's `transferWithAuthorization` by the harness so settlements can be
   * counted against grants.
   */
  settle?: (auth: VulnerableAuthorization) => Promise<{ ok: boolean; detail: string }>;
  log?: (line: Record<string, unknown>) => void;
}

export interface VulnerableFixture {
  app: Express;
  grants: GrantRecord[];
  settlements: SettlementRecord[];
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
  const grants: GrantRecord[] = [];
  const settlements: SettlementRecord[] = [];
  const grantCounts = new Map<string, number>();
  const pending: Promise<void>[] = [];

  log({ level: "warn", msg: "starting the vulnerable fixture", ...fixtureBanner() });

  const app = express();
  app.disable("x-powered-by");
  app.use(rawBody());

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "AgentTrust vulnerable baseline fixture",
      ...fixtureBanner(),
      reproduces: {
        A2: "replay without idempotency (arXiv 2605.11781 §4.3)",
        A3: "cross-resource substitution (arXiv 2605.30998 §4.1)",
      },
    });
  });

  app.get("/__fixture/metrics", (_req: Request, res: Response) => {
    res.json({
      ...fixtureBanner(),
      grants: grants.length,
      settlements: settlements.length,
      grantsByAuthorization: Object.fromEntries(grantCounts),
    });
  });

  for (const path of Object.keys(HANDLERS)) {
    app.post(path, (req: Request, res: Response) => {
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
    grants,
    settlements,
    grantsByAuthorization: () => Object.fromEntries(grantCounts),
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}
