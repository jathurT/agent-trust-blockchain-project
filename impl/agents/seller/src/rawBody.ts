/**
 * API-001 — raw body capture.
 *
 * `bodyHash` is `keccak256` of the **exact bytes on the wire**, taken before anything
 * parses them (SPEC-001 §2.3). That is not fussiness: `JSON.parse` followed by
 * `JSON.stringify` reorders keys, drops insignificant whitespace and normalises escapes
 * and number formatting, so a seller that hashed a re-serialised body would compute a
 * different hash from the buyer for a request neither of them altered.
 *
 * This middleware must be mounted **before** `express.json()`. Express 5 consumes the
 * stream in its parser, so a capture added afterwards reads nothing.
 */
import type { NextFunction, Request, Response } from "express";

/**
 * A request that has been through `rawBody()`. Declared explicitly rather than by
 * global module augmentation, so it is visible in a handler's signature which ones
 * actually depend on the capture having run.
 */
export interface RawRequest extends Request {
  /** The exact bytes received, or an empty buffer for a body-less request. */
  rawBody?: Buffer;
}

export interface RawBodyOptions {
  /** Refuse anything larger, before buffering it. */
  maxBytes?: number;
}

export class PayloadTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "PayloadTooLarge";
  }
}

export function rawBody(options: RawBodyOptions = {}) {
  const maxBytes = options.maxBytes ?? 1024 * 256;

  return function captureRawBody(req: Request, _res: Response, next: NextFunction): void {
    const request = req as RawRequest;
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;

    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      next(error);
    };

    function onData(chunk: Buffer) {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop reading rather than buffering an unbounded body from an
        // unauthenticated caller.
        req.pause();
        fail(new PayloadTooLarge(maxBytes));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (finished) return;
      finished = true;
      request.rawBody = Buffer.concat(chunks);
      next();
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", fail);
  };
}

/**
 * Parse the captured bytes as JSON. Used instead of `express.json()` so there is
 * exactly one place where bytes become an object, and it is always the same bytes the
 * hash covered.
 */
export function parseJsonBody<T>(req: RawRequest): T {
  const raw = req.rawBody;
  if (!raw || raw.length === 0) return {} as T;
  return JSON.parse(raw.toString("utf8")) as T;
}
