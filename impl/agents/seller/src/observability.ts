/**
 * API-007 — the two things that make a paid response safe to cache never, and a run
 * measurable afterwards.
 *
 * **`Vary`.** `Cache-Control: no-store` is the instruction; `Vary` is the fallback for
 * anything that ignores it. A paid response is a function of the payment header, so a
 * cache keyed on the URL alone could hand one payer's bytes to another — the
 * HTTP/proxy cache-confusion class the audit calls out (V-17, mitigation M5). Both
 * headers go on every paid route, and on the 402 quote too: a quote names a payee and
 * a deadline, and a cached one is a stale payee.
 *
 * **The access log.** One NDJSON line per request, on stdout, with the run id, the job
 * id where there is one, the outcome and how long it took. The harness reads these to
 * count rejections by reason, which is why the reason is a code from the SPEC-002
 * table rather than a sentence: a sentence cannot be counted.
 */
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

/** Everything a paid response varies on. `Accept-Encoding` is there because a shared
 *  cache that normalises encodings would otherwise key two different bodies together. */
export const VARY_ON = "PAYMENT-SIGNATURE, Accept-Encoding";

/** Applied to every response the seller sends, paid or not. */
export function applyCachePolicy(res: Response): void {
  res.set("Cache-Control", "no-store").set("Vary", VARY_ON);
}

export interface AccessLogLine {
  level: "info";
  msg: "request";
  runId: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  /** The SPEC-002 error code, when the request was refused. */
  reason?: string;
  jobId?: string;
  disposition?: string;
  durationMs: number;
  at: string;
}

export interface AccessLogOptions {
  /** Identifies this process across every line it writes. */
  runId?: string;
  write?: (line: AccessLogLine) => void;
}

/** Fields a handler can attach for the log line; read once, at the end of the request. */
export interface Logged {
  logJobId?: string;
  logReason?: string;
  logDisposition?: string;
}

export function accessLog(options: AccessLogOptions = {}) {
  const runId = options.runId ?? process.env["RUN_ID"] ?? randomUUID();
  const write = options.write ?? ((line: AccessLogLine) => process.stdout.write(JSON.stringify(line) + "\n"));

  return function logger(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    // `finish` rather than `close`: it fires once the response has actually been
    // written, so the status and the duration are the ones the client saw.
    res.once("finish", () => {
      const tagged = res.locals as Logged;
      write({
        level: "info",
        msg: "request",
        runId,
        requestId: (req as Request & { id?: string }).id ?? randomUUID(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ...(tagged.logReason ? { reason: tagged.logReason } : {}),
        ...(tagged.logJobId ? { jobId: tagged.logJobId } : {}),
        ...(tagged.logDisposition ? { disposition: tagged.logDisposition } : {}),
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        at: new Date().toISOString(),
      });
    });
    next();
  };
}

/** Attach a field to the line this request will write. Never throws: a log that breaks
 *  a delivery would be worse than a log with a missing field. */
export function tag(res: Response, fields: Logged): void {
  try {
    Object.assign(res.locals as Logged, fields);
  } catch {
    /* locals is always an object on Express 5; belt and braces */
  }
}
