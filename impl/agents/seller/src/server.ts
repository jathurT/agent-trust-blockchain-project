/**
 * API-001 — the seller's HTTP surface.
 *
 * This file builds the app and wires the free routes and the deterministic handlers.
 * The paid routes are *not* yet gated: API-002 adds the 402 quote, API-003 the funded-job
 * verification, API-004 the payer signature and API-005 the delivery claim. Until those
 * land, a paid route serves anyone who asks — `createApp` therefore refuses to build in
 * `gated` mode until the gate exists, so an ungated server cannot be started by accident.
 *
 * Order matters: `rawBody()` is mounted first, because `bodyHash` covers the bytes on
 * the wire and Express 5's parser consumes the stream (SPEC-001 §2.3).
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { SellerError, sendError } from "./errors.js";
import { PayloadTooLarge, parseJsonBody, rawBody, type RawRequest } from "./rawBody.js";
import { PAID_ROUTES, TOKEN_DECIMALS, routeFor } from "./pricing.js";
import { BadRequest, classify, serialise, summarise } from "./routes/deterministic.js";
import type { RequestHandler } from "express";
import { formatAtomic } from "@agenttrust/core";

export interface SellerAppOptions {
  /** The canonical origin this seller hashes with — never the `Host` header (DF-04). */
  origin: string;
  /** The ERC-8004 agent id this seller publishes. */
  agentId: string;
  /** Largest request body accepted, in bytes. */
  maxBodyBytes?: number;
  /**
   * `false` while the payment path is being built (API-002..005). `true` requires a
   * gate to have been installed; building a gated app without one throws.
   */
  gated: boolean;
  /** Installed by API-002..005. Runs before any paid handler. */
  paymentGate?: (req: RawRequest, res: Response, next: NextFunction) => void;
  /**
   * API-005's delivery handler. When present it replaces the ungated handlers, so the
   * claim store is the only path to the resource and "one execution per job" cannot be
   * bypassed by a route that forgot to use it.
   */
  deliver?: RequestHandler;
}

export const INTEROPERABILITY_NOTE =
  "AgentTrust uses the x402 v2 wire format with a project-specific scheme, " +
  "agenttrust-escrow. It is NOT interoperable with stock x402 clients, servers or " +
  "facilitators: a client that does not implement this scheme cannot pay an AgentTrust " +
  "seller, and an AgentTrust buyer cannot pay a stock x402 server. Nothing here should " +
  "be described as x402-compliant.";

export function createApp(options: SellerAppOptions): Express {
  if (options.gated && !options.paymentGate) {
    throw new Error(
      "gated: true requires a paymentGate. Without one every paid route would serve " +
        "anyone who asked — build with gated: false only in tests of the handlers.",
    );
  }

  const app = express();
  app.disable("x-powered-by");
  // Trailing slashes and case are part of the canonical URI, so Express must not
  // quietly fold "/v1/Summarise/" onto "/v1/summarise" and change what gets hashed.
  app.set("strict routing", true);
  app.set("case sensitive routing", true);

  // Before any parser. See rawBody.ts.
  app.use(rawBody({ maxBytes: options.maxBodyBytes }));

  // ------------------------------------------------------------------ free routes

  app.get("/health", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store").json({ status: "ok", origin: options.origin });
  });

  app.get("/.well-known/agent-card", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store").json({
      name: "AgentTrust demo seller",
      agentId: options.agentId,
      endpoint: options.origin,
      protocol: { name: "x402", version: 2, scheme: "agenttrust-escrow" },
      services: PAID_ROUTES.map((r) => ({
        path: r.path,
        description: r.description,
        price: { atomic: r.price.toString(), display: formatAtomic(r.price, TOKEN_DECIMALS), decimals: TOKEN_DECIMALS },
      })),
      interoperability: INTEROPERABILITY_NOTE,
    });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store").json({
      service: "AgentTrust seller",
      origin: options.origin,
      paidRoutes: PAID_ROUTES.map((r) => r.path),
      interoperability: INTEROPERABILITY_NOTE,
    });
  });

  // ------------------------------------------------------------------ paid routes

  if (options.paymentGate) {
    for (const route of PAID_ROUTES) app.post(route.path, options.paymentGate);
  }

  if (options.deliver) {
    // One path to the resource, and it goes through the claim store.
    for (const route of PAID_ROUTES) app.post(route.path, options.deliver);
  } else {
    app.post("/v1/summarise", (req: Request, res: Response, next: NextFunction) => {
      try {
        sendDeterministic(res, summarise(parseJsonBody(req as RawRequest)));
      } catch (error) {
        next(error);
      }
    });

    app.post("/v1/classify", (req: Request, res: Response, next: NextFunction) => {
      try {
        sendDeterministic(res, classify(parseJsonBody(req as RawRequest)));
      } catch (error) {
        next(error);
      }
    });
  }

  // --------------------------------------------------------------------- fallback

  app.use((req: Request, res: Response) => {
    if (routeFor(req.path)) {
      // A paid path reached with the wrong method: say so rather than 404, which would
      // suggest the route does not exist.
      res.set("Allow", "POST");
      sendError(res, new SellerError("not_found", `use POST ${req.path}`));
      return;
    }
    sendError(res, new SellerError("not_found"));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SellerError) return sendError(res, error);
    if (error instanceof PayloadTooLarge) return sendError(res, new SellerError("payload_too_large", error.message));
    if (error instanceof BadRequest) return sendError(res, new SellerError("bad_request", error.message));
    if (error instanceof SyntaxError) return sendError(res, new SellerError("bad_request", "body is not valid JSON"));
    return sendError(res, new SellerError("execution_failed"));
  });

  return app;
}

/**
 * Send the exact bytes the validator will hash. `res.json` would re-serialise and could
 * differ from what was measured, so the body is built once and written as a buffer.
 */
function sendDeterministic(res: Response, value: unknown): void {
  const bytes = serialise(value);
  res
    .status(200)
    .set("Content-Type", "application/json; charset=utf-8")
    .set("Cache-Control", "no-store")
    .set("Content-Length", String(bytes.length))
    .end(bytes);
}
