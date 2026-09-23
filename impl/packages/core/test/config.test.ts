import { describe, expect, it, vi } from "vitest";
import { BUYER_SPEC, CHAIN_SPEC, ConfigError, SELLER_SPEC, loadConfig } from "../src/config.js";

const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const VALIDATOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const chainEnv = {
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  ESCROW_ADDRESS: ESCROW,
  USDC_ADDRESS: USDC,
};

describe("config loading", () => {
  it("accepts a complete chain configuration and applies fallbacks", () => {
    const c = loadConfig(CHAIN_SPEC, { env: chainEnv });
    expect(c.CHAIN_ID).toBe("31337");
    expect(c.CONFIRMATIONS).toBe("1");
  });

  it("reports every problem at once rather than the first", () => {
    let err: unknown;
    try {
      loadConfig(CHAIN_SPEC, { env: { RPC_URL: "not a url", CHAIN_ID: "abc" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const problems = (err as ConfigError).problems;
    expect(problems).toHaveLength(4); // bad url, bad uint, 2 missing addresses
    expect(problems.join()).toContain("ESCROW_ADDRESS is required");
    expect(problems.join()).toContain("USDC_ADDRESS is required");
  });

  it("refuses a value that looks like a private key", () => {
    const env = { ...chainEnv, ESCROW_ADDRESS: "0x" + "ab".repeat(32) };
    expect(() => loadConfig(CHAIN_SPEC, { env })).toThrow(/looks like a private key/);
  });

  it("rejects an origin that carries a path or query", () => {
    const env = {
      ...chainEnv,
      SELLER_ORIGIN: "https://seller.test/v1",
      SELLER_AGENT_ID: "7",
      SELLER_KEYSTORE: "seller",
      ACCEPTED_VALIDATORS: VALIDATOR,
      VALIDATOR_URL: "http://127.0.0.1:8088",
    };
    expect(() => loadConfig(SELLER_SPEC, { env })).toThrow(/bare origin/);
  });

  it("validates every entry of an address list", () => {
    const env = { ...chainEnv, BUYER_KEYSTORE: "buyer", TRUSTED_CLIENTS: `${VALIDATOR},0xnope` };
    expect(() => loadConfig(BUYER_SPEC, { env })).toThrow(/non-addresses/);
  });

  it("warns, but does not fail, when the claim store sits on a Windows drive", () => {
    const warn = vi.fn();
    const env = {
      ...chainEnv,
      SELLER_ORIGIN: "https://seller.test",
      SELLER_AGENT_ID: "7",
      SELLER_KEYSTORE: "seller",
      ACCEPTED_VALIDATORS: VALIDATOR,
      VALIDATOR_URL: "http://127.0.0.1:8088",
      CLAIMS_DB_PATH: "/mnt/d/claims.sqlite",
    };
    const c = loadConfig(SELLER_SPEC, { env, warn });
    expect(c.CLAIMS_DB_PATH).toBe("/mnt/d/claims.sqlite");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/38x slower/);
  });

  it("defaults the replay policy to idempotent, the policy measurements use", () => {
    const env = {
      ...chainEnv,
      SELLER_ORIGIN: "https://seller.test",
      SELLER_AGENT_ID: "7",
      SELLER_KEYSTORE: "seller",
      ACCEPTED_VALIDATORS: VALIDATOR,
      VALIDATOR_URL: "http://127.0.0.1:8088",
    };
    expect(loadConfig(SELLER_SPEC, { env }).REPLAY_POLICY).toBe("idempotent");
  });
});
