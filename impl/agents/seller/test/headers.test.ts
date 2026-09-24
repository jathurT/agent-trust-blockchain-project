/**
 * API-007 — cache policy on every response, and one machine-readable log line per
 * request.
 *
 * The acceptance criterion is "every paid response carries no-store; every rejection
 * logs a machine-readable reason that the harness can count", so both halves are
 * asserted against the real app rather than against the helper in isolation.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/server.js";
import { VARY_ON, type AccessLogLine } from "../src/observability.js";
import { ERRORS } from "../src/errors.js";

describe("cache policy", () => {
  let app: Express;
  const lines: AccessLogLine[] = [];

  beforeAll(() => {
    app = createApp({
      origin: "http://127.0.0.1:4099",
      agentId: "7",
      gated: false,
      accessLog: { runId: "test-run", write: (l) => lines.push(l) },
    });
  });

  it("puts no-store and Vary on a paid route", async () => {
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .send({ text: "One. Two. Three." });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["vary"]).toBe(VARY_ON);
  });

  it("varies on the payment header, because that is what the response depends on", () => {
    // A cache keyed on the URL alone would hand one payer's bytes to another
    // (V-17 mitigation M5). The header name is what makes that impossible.
    expect(VARY_ON).toContain("PAYMENT-SIGNATURE");
  });

  it("puts them on the free routes too", async () => {
    for (const path of ["/health", "/.well-known/agent-card", "/"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"], path).toBe("no-store");
      expect(res.headers["vary"], path).toBe(VARY_ON);
    }
  });

  it("puts them on a rejection, where a cached error would be worst of all", async () => {
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["vary"]).toBe(VARY_ON);
  });
});

describe("the access log", () => {
  const lines: AccessLogLine[] = [];
  let app: Express;

  beforeAll(() => {
    app = createApp({
      origin: "http://127.0.0.1:4099",
      agentId: "7",
      gated: false,
      accessLog: { runId: "run-42", write: (l) => lines.push(l) },
    });
  });

  it("writes one line per request, carrying the run id", async () => {
    lines.length = 0;
    await request(app).get("/health");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", msg: "request", runId: "run-42", status: 200, path: "/health" });
    expect(lines[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(lines[0]!.at)).not.toBeNaN();
  });

  it("carries the SPEC-002 error code on a rejection, so the harness can count reasons", async () => {
    lines.length = 0;
    await request(app).get("/no-such-route");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.reason).toBe("not_found");
    expect(lines[0]!.reason! in ERRORS).toBe(true);
  });

  it("counts rejections by reason without parsing a sentence", async () => {
    lines.length = 0;
    await request(app).get("/no-such-route");
    await request(app).get("/also-missing");
    await request(app).post("/v1/summarise").set("Content-Type", "application/json").send({ text: "One." });

    const byReason = new Map<string, number>();
    for (const l of lines) if (l.reason) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + 1);
    expect(byReason.get("not_found")).toBe(2);
    expect(lines.filter((l) => l.status === 200)).toHaveLength(1);
  });

  it("is a single line of JSON, which is what NDJSON means", async () => {
    const written: string[] = [];
    const noisy = createApp({
      origin: "http://127.0.0.1:4099",
      agentId: "7",
      gated: false,
      accessLog: { runId: "run-43", write: (l) => written.push(JSON.stringify(l)) },
    });
    await request(noisy).get("/health");
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain("\n");
    expect(() => JSON.parse(written[0]!)).not.toThrow();
  });

  it("can be silenced, so a test suite is not buried in it", async () => {
    const quiet = createApp({ origin: "http://127.0.0.1:4099", agentId: "7", gated: false, accessLog: false });
    // No write function to assert against; the point is that building it does not throw
    // and the request still works.
    const res = await request(quiet).get("/health");
    expect(res.status).toBe(200);
  });
});
