/**
 * AGENT-006 — the CLI's argument surface and its output contract.
 *
 * The acceptance criterion this suite exists for is "output distinguishes executions
 * from 2xx responses", so the counter line is asserted character by character rather
 * than eyeballed: it is what the video crops to, and a silently reworded line would
 * make the shot say something the evaluation does not.
 */
import { describe, it, expect } from "vitest";
import { parseCommand, USAGE } from "../src/demo/cli.js";
import { counterLine, parseServeArgs } from "../src/demo/serve.js";

describe("buy", () => {
  it("takes a resource path and an atomic amount", () => {
    const cmd = parseCommand(["buy", "--resource", "/v1/summarise", "--amount", "250000"]);
    expect(cmd).toMatchObject({ name: "buy", resource: "/v1/summarise", amount: 250_000n });
  });

  it("refuses a decimal amount rather than truncating it", () => {
    expect(() => parseCommand(["buy", "--resource", "/v1/summarise", "--amount", "0.25"])).toThrow(
      /atomic units/,
    );
  });

  it("refuses a resource that is not a path", () => {
    expect(() =>
      parseCommand(["buy", "--resource", "http://elsewhere/v1/summarise", "--amount", "250000"]),
    ).toThrow(/must be a path/);
  });

  it("defaults to the origin the AgentTrust target listens on", () => {
    const cmd = parseCommand(["buy", "--resource", "/v1/classify", "--amount", "250000"]);
    expect(cmd.origin).toBe("http://127.0.0.1:4022");
  });
});

describe("status and refund", () => {
  it("take a 32-byte job id", () => {
    const job = `0x${"ab".repeat(32)}`;
    expect(parseCommand(["status", "--job", job])).toMatchObject({ name: "status", job });
    expect(parseCommand(["refund", "--job", job])).toMatchObject({ name: "refund", job });
  });

  it("refuse a short id instead of querying a zero-padded one", () => {
    expect(() => parseCommand(["status", "--job", "0xdead"])).toThrow(/32-byte hex id/);
  });
});

describe("usage", () => {
  it("names the three §18 commands", () => {
    for (const name of ["buy", "status", "refund"]) expect(USAGE).toContain(name);
  });

  it("says amounts are atomic, because that is the bug class it prevents", () => {
    expect(USAGE).toContain("250000 is 0.25 USDC");
  });

  it("rejects an unknown command and shows the usage", () => {
    expect(() => parseCommand(["settle"])).toThrow(/unknown command: settle/);
  });
});

describe("the counter line the video crops to", () => {
  it("separates executions from 2xx responses", () => {
    const line = counterLine(1, 50, 49);
    expect(line).toContain("executions:   1");
    expect(line).toContain("2xx:  50");
    expect(line).toContain("replays served:  49");
  });

  it("keeps a fixed width so the numbers do not jitter on screen", () => {
    expect(counterLine(1, 1, 0).length).toBe(counterLine(999, 999, 999).length);
  });
});

describe("serve arguments", () => {
  it("defaults the seller and validator ports the demo documents", () => {
    expect(parseServeArgs([])).toEqual({ sellerPort: 4022, validatorPort: 8099 });
  });

  it("takes overrides", () => {
    expect(parseServeArgs(["--port", "5000", "--validator-port", "5001"])).toEqual({
      sellerPort: 5000,
      validatorPort: 5001,
    });
  });
});
