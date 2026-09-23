import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toFunctionSignature, toEventSignature, type Abi, type AbiFunction, type AbiEvent } from "viem";
import {
  escrowAbi,
  identityRegistryAbi,
  reputationRegistryAbi,
  validationRegistryAbi,
} from "../src/abi.js";

/**
 * The counterpart to REG-008, one layer up: `src/abi.ts` is hand-written so viem can
 * infer types from it, so something has to prove it still matches the contracts. These
 * tests compare it against `abi/*.abi.json`, which `impl/scripts/export-abi.sh`
 * regenerates from the compiled artifacts and from the pinned upstream ERC-8004 ABI.
 *
 * A signature that drifts fails here rather than at runtime against a live chain.
 */
const load = (name: string): Abi =>
  JSON.parse(readFileSync(new URL(`../abi/${name}.abi.json`, import.meta.url), "utf8")) as Abi;

function signatures(abi: Abi): { functions: Set<string>; events: Set<string> } {
  const functions = new Set<string>();
  const events = new Set<string>();
  for (const entry of abi) {
    if (entry.type === "function") functions.add(toFunctionSignature(entry as AbiFunction));
    if (entry.type === "event") events.add(toEventSignature(entry as AbiEvent));
  }
  return { functions, events };
}

function expectSubset(declared: Abi, exported: Abi, what: string) {
  const real = signatures(exported);
  const missingFns: string[] = [];
  const missingEvents: string[] = [];

  for (const entry of declared) {
    if (entry.type === "function") {
      const sig = toFunctionSignature(entry as AbiFunction);
      if (!real.functions.has(sig)) missingFns.push(sig);
    }
    if (entry.type === "event") {
      const sig = toEventSignature(entry as AbiEvent);
      if (!real.events.has(sig)) missingEvents.push(sig);
    }
  }
  expect(missingFns, `${what}: functions not present in the exported ABI`).toEqual([]);
  expect(missingEvents, `${what}: events not present in the exported ABI`).toEqual([]);
}

describe("declared ABI matches the exported artifacts", () => {
  it("escrow", () => expectSubset(escrowAbi, load("AgentTrustEscrow"), "escrow"));
  it("identity registry", () => expectSubset(identityRegistryAbi, load("IdentityRegistry"), "identity"));
  it("reputation registry", () => expectSubset(reputationRegistryAbi, load("ReputationRegistry"), "reputation"));
  it("validation registry", () => expectSubset(validationRegistryAbi, load("ValidationRegistry"), "validation"));
});

describe("return shapes the services depend on", () => {
  it("jobs() returns the struct in the field order src/abi.ts declares", () => {
    const exported = load("AgentTrustEscrow");
    const jobs = exported.find((e) => e.type === "function" && e.name === "jobs") as AbiFunction;
    const components = (jobs.outputs[0] as unknown as { components: readonly { name: string }[] }).components;
    expect(components.map((c) => c.name)).toEqual([
      "payer",
      "payee",
      "payeeAgentId",
      "validator",
      "token",
      "amount",
      "resourceHash",
      "requestHash",
      "fundedAt",
      "deadline",
      "grace",
      "state",
      "validationRecorded",
    ]);
  });

  it("the ERC-8004 ABIs are the pinned upstream ones, not the mocks", () => {
    // The mocks report "2.0.0-mock" and the Reputation one carries an extra
    // gate-v1 helper. Either appearing here would mean a service was bound to a
    // mock-shaped interface and would break against the live registries.
    for (const name of ["IdentityRegistry", "ReputationRegistry", "ValidationRegistry"]) {
      const sigs = signatures(load(name)).functions;
      expect(sigs.has("distinctClientsUnfiltered(uint256)"), `${name} carries a mock-only helper`).toBe(false);
    }
    expect(signatures(load("ReputationRegistry")).functions.has("readAllFeedback(uint256,address[],string,string,bool)")).toBe(true);
  });
});
