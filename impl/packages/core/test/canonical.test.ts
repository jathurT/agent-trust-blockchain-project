/**
 * SPEC-001 conformance for the TypeScript implementation.
 * Every case in impl/vectors/canonical-v1.json must reproduce exactly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOB_TYPEHASH,
  RESOURCE_TYPEHASH,
  VALIDATION_TYPEHASH,
  bodyHash,
  canonicalMethod,
  canonicalUri,
  jobId,
  methodHash,
  requestHash,
  resourceHash,
  typedDataDigest,
  uriHash,
} from "../src/canonical.js";
import type { Address, Hex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "../../../vectors/canonical-v1.json"), "utf8"));

describe("vector file", () => {
  it("is canonical-v1 and non-empty", () => {
    expect(vectors.version).toBe("canonical-v1");
    expect(vectors.counts.canonicalisation).toBeGreaterThan(0);
    expect(vectors.counts.hashing).toBeGreaterThan(0);
  });

  it("agrees on the three type hashes", () => {
    expect(RESOURCE_TYPEHASH).toBe(vectors.typeHashes.RESOURCE_TYPEHASH);
    expect(JOB_TYPEHASH).toBe(vectors.typeHashes.JOB_TYPEHASH);
    expect(VALIDATION_TYPEHASH).toBe(vectors.typeHashes.VALIDATION_TYPEHASH);
  });
});

describe("layer A — canonicalisation", () => {
  for (const c of vectors.canonicalisation) {
    it(`${c.name}: ${c.why}`, () => {
      const method = canonicalMethod(c.input.method);
      expect(method).toBe(c.expected.canonicalMethod);

      const uri = canonicalUri({
        scheme: c.input.scheme,
        host: c.input.host,
        port: c.input.port ?? null,
        path: c.input.path ?? "",
        query: c.input.query ?? "",
        fragment: c.input.fragment ?? null,
      });
      expect(uri).toBe(c.expected.canonicalUri);

      expect(methodHash(method)).toBe(c.expected.methodHash);
      expect(uriHash(uri)).toBe(c.expected.uriHash);
      expect(bodyHash(c.body.hex as Hex)).toBe(c.expected.bodyHash);
    });
  }

  it("orderings that must collide, do", () => {
    const byName = Object.fromEntries(vectors.canonicalisation.map((c: any) => [c.name, c]));
    const collisions: [string, string][] = [
      ["query_sorted_distinct_keys", "query_sorted_distinct_keys_other_order"],
      ["query_duplicate_keys", "query_duplicate_keys_other_order"],
    ];
    for (const [a, b] of collisions) {
      expect(byName[a]!.expected.uriHash).toBe(byName[b]!.expected.uriHash);
    }
  });

  it("a trailing slash is a different resource", () => {
    const byName = Object.fromEntries(vectors.canonicalisation.map((c: any) => [c.name, c]));
    expect(byName["trailing_slash_is_significant"]!.expected.uriHash).not.toBe(
      byName["post_json_body"]!.expected.uriHash,
    );
  });

  it("rejects an unusable method and scheme instead of guessing", () => {
    expect(() => canonicalMethod("GE T")).toThrow();
    expect(() => canonicalUri({ scheme: "ftp", host: "h.test", path: "/" })).toThrow();
  });
});

describe("layer B — hashing", () => {
  for (const c of vectors.hashing) {
    it(`${c.name}: ${c.why}`, () => {
      const rh = resourceHash({
        methodHash: c.input.methodHash as Hex,
        uriHash: c.input.uriHash as Hex,
        bodyHash: c.input.bodyHash as Hex,
        amount: BigInt(c.input.amount),
        token: c.input.token as Address,
        chainId: BigInt(c.input.chainId),
      });
      expect(rh).toBe(c.expected.resourceHash);

      const jid = jobId({
        chainId: BigInt(c.input.chainId),
        escrow: c.input.escrow as Address,
        payer: c.input.payer as Address,
        payee: c.input.payee as Address,
        resourceHash: rh,
        nonce: c.input.nonce as Hex,
      });
      expect(jid).toBe(c.expected.jobId);

      expect(
        requestHash({
          chainId: BigInt(c.input.chainId),
          escrow: c.input.escrow as Address,
          jobId: jid,
          resourceHash: rh,
          salt: c.input.salt as Hex,
        }),
      ).toBe(c.expected.requestHash);
    });
  }
});

describe("EIP-712 typed data", () => {
  const d = {
    chainId: vectors.typedData.domain.chainId as number,
    verifyingContract: vectors.typedData.domain.verifyingContract as Address,
  };
  for (const m of vectors.typedData.messages) {
    it(`${m.primaryType} digest (signed by the ${m.signer})`, () => {
      expect(typedDataDigest(d, m.primaryType, m.message)).toBe(m.expected.digest);
    });
  }
});
