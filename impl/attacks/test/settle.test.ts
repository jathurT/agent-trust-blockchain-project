import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixture, accounts, type Deployment } from "../src/targets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

it("settles one authorization against MockUSDC", async () => {
  const deployment = JSON.parse(readFileSync(join(ROOT, "deployments", "31337.json"), "utf8")) as Deployment;
  const target = await startFixture({ rpc: "http://127.0.0.1:8545", deployment, port: 8799 });
  try {
    const ticket = await target.pay("/v1/summarise", '{"text":"One. Two."}');
    const res = await target.request("/v1/summarise", '{"text":"One. Two."}', ticket.header);
    expect(res.status).toBe(200);
    const counters = await target.counters(ticket);
    if (counters.settlements !== 1) throw new Error(`settlements = ${counters.settlements}; the settle path is broken`);
  } finally {
    await target.stop();
  }
}, 60_000);
