#!/usr/bin/env python3
"""Generate impl/vectors/canonical-v1.json (SPEC-001).

Expected values are computed with `cast` (Foundry), deliberately *not* with the
TypeScript or Python implementations that later have to reproduce them.

This script does NOT canonicalise anything: canonical method/URI strings are
stated by hand from the rules in docs/specs/canonical-hash.md, so the generator
never becomes a third implementation that the others could merely agree with.

    python3 impl/scripts/gen-vectors.py           # write the file
    python3 impl/scripts/gen-vectors.py --check   # fail if the file is stale
"""
from __future__ import annotations
import json, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "impl" / "vectors" / "canonical-v1.json"
VERSION = "canonical-v1"


def cast(*args: str) -> str:
    r = subprocess.run(["cast", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"cast {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def keccak_utf8(s: str) -> str:
    return cast("keccak", s) if s != "" else cast("keccak", "")


def keccak_hex(h: str) -> str:
    return cast("keccak", h)


def enc(types: str, *vals) -> str:
    return cast("abi-encode", f"x({types})", *[str(v) for v in vals])


def hash_enc(types: str, *vals) -> str:
    return keccak_hex(enc(types, *vals))


# ---------------------------------------------------------------- type hashes
RESOURCE_TYPE = ("AgentTrustResource(bytes32 methodHash,bytes32 uriHash,bytes32 bodyHash,"
                 "uint256 amount,address token,uint256 chainId)")
JOB_TYPE = ("AgentTrustJob(uint256 chainId,address escrow,address payer,address payee,"
            "bytes32 resourceHash,bytes32 nonce)")
VALIDATION_TYPE = ("AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,"
                   "bytes32 resourceHash,bytes32 salt)")
DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
DELIVERY_REQUEST_TYPE = ("DeliveryRequest(bytes32 jobId,bytes32 resourceHash,string sellerOrigin,"
                         "uint64 expiry,bytes32 clientNonce)")
DELIVERY_RECEIPT_TYPE = ("DeliveryReceipt(bytes32 jobId,bytes32 resourceHash,bytes32 responseHash,"
                         "uint256 sellerAgentId,uint64 servedAt,bytes32 salt)")
EVIDENCE_ACCESS_TYPE = "EvidenceAccess(bytes32 jobId,uint64 expiry,bytes32 clientNonce)"

# ------------------------------------------------------------ fixed test data
USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"      # Base Sepolia (V-81)
ALT_TOKEN = "0x1111111111111111111111111111111111111111"
ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3"     # deterministic Anvil deploy #1
PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"      # Anvil account 1
PAYEE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"      # Anvil account 2
NONCE = "0x" + "11" * 32
SALT = "0x" + "22" * 32
CLIENT_NONCE = "0x" + "33" * 32
RESPONSE_HASH = "0x" + "44" * 32
ORIGIN = "https://seller.agenttrust.test"

# ------------------------------------------------- layer A: canonicalisation
# canonicalUri / canonicalMethod are stated by hand from the §2 rules.
CANON = [
    dict(name="simple_get", why="baseline GET, default port omitted",
         method="get", scheme="HTTPS", host="Seller.AgentTrust.test", port=443,
         path="/v1/summarise", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="post_json_body", why="the normal paid call",
         method="POST", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="", body_utf8='{"text":"hello world"}',
         canonical_method="POST", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="empty_body", why="empty body hashes keccak256('')",
         method="POST", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="", body_utf8="",
         canonical_method="POST", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="binary_body", why="body is raw bytes, not text",
         method="POST", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="", body_hex="0x00ff10fe8081",
         canonical_method="POST", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="unicode_path", why="UTF-8 path bytes hashed as received after normalisation",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/na%C3%AFve", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/na%C3%AFve"),
    dict(name="percent_case_normalised", why="%2f -> %2F, hex digits uppercased",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/a%2fb", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/a%2Fb"),
    dict(name="unreserved_decoded", why="%7E is unreserved, so it decodes to ~",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/%7Euser", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/~user"),
    dict(name="query_sorted_distinct_keys", why="?b=2&a=1 sorts to a=1&b=2",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="b=2&a=1", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?a=1&b=2"),
    dict(name="query_sorted_distinct_keys_other_order", why="must hash identically to the previous case",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="a=1&b=2", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?a=1&b=2"),
    dict(name="query_duplicate_keys", why="duplicates sort by value; input order is NOT preserved",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="k=2&k=1", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?k=1&k=2"),
    dict(name="query_duplicate_keys_other_order", why="must hash identically to the previous case",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="k=1&k=2", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?k=1&k=2"),
    dict(name="query_plus_is_literal", why="'+' is a literal plus, not a space; it re-encodes to %2B",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="q=a+b", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?q=a%2Bb"),
    dict(name="query_empty_value", why="a key with an empty value keeps its '='",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="flag=", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise?flag="),
    dict(name="explicit_non_default_port", why="non-default port is kept",
         method="GET", scheme="http", host="localhost", port=8080,
         path="/v1/summarise", query="", body_utf8="",
         canonical_method="GET", canonical_uri="http://localhost:8080/v1/summarise"),
    dict(name="default_http_port_omitted", why="port 80 on http is dropped",
         method="GET", scheme="http", host="localhost", port=80,
         path="/v1/summarise", query="", body_utf8="",
         canonical_method="GET", canonical_uri="http://localhost/v1/summarise"),
    dict(name="trailing_slash_is_significant", why="/v1/summarise/ differs from /v1/summarise",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise/", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise/"),
    dict(name="dot_segments_resolved", why="/v1/x/../summarise resolves before hashing",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/x/../summarise", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="empty_path_becomes_root", why="an empty path is '/'",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="", query="", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/"),
    dict(name="fragment_stripped", why="fragments never reach the server",
         method="GET", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="", fragment="section-2", body_utf8="",
         canonical_method="GET", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="large_body", why="4 KiB body, no truncation anywhere",
         method="POST", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/summarise", query="", body_utf8="x" * 4096,
         canonical_method="POST", canonical_uri="https://seller.agenttrust.test/v1/summarise"),
    dict(name="sibling_resource_classify", why="the equal-priced A3 sibling of /v1/summarise",
         method="POST", scheme="https", host="seller.agenttrust.test", port=None,
         path="/v1/classify", query="", body_utf8='{"text":"hello world"}',
         canonical_method="POST", canonical_uri="https://seller.agenttrust.test/v1/classify"),
]

# --------------------------------------------------------------- layer B: hashing
# (resource case name, amount, token, chainId) — drawn from the canonicalisation cases
HASH_CASES = [
    ("post_json_body", 250000, USDC, 84532, "baseline paid call, 0.25 USDC on Base Sepolia"),
    ("sibling_resource_classify", 250000, USDC, 84532, "same price, different resource -> different hash (A3)"),
    ("post_json_body", 250001, USDC, 84532, "one atomic unit more -> different hash"),
    ("post_json_body", 250000, ALT_TOKEN, 84532, "different token -> different hash"),
    ("post_json_body", 250000, USDC, 31337, "different chain -> different hash"),
    ("empty_body", 1, USDC, 31337, "minimum amount, empty body, local chain"),
    ("simple_get", 250000, USDC, 84532, "GET with no body"),
    ("query_duplicate_keys", 250000, USDC, 84532, "duplicate query keys after sorting"),
    ("large_body", 999999999999, USDC, 84532, "large body and large amount"),
]


def main() -> None:
    check = "--check" in sys.argv
    canon_out, by_name = [], {}

    for c in CANON:
        body_hex = c.get("body_hex")
        if body_hex is None:
            b = c["body_utf8"].encode()
            body_hex = "0x" + b.hex()
        body_hash = keccak_hex(body_hex) if body_hex != "0x" else cast("keccak", "")
        method_hash = keccak_utf8(c["canonical_method"])
        uri_hash = keccak_utf8(c["canonical_uri"])
        entry = {
            "name": c["name"], "why": c["why"],
            "input": {k: c.get(k) for k in ("method", "scheme", "host", "port", "path", "query", "fragment")
                      if c.get(k) is not None or k in ("query", "path")},
            "body": {"hex": body_hex, "utf8": c.get("body_utf8")} if "body_utf8" in c else {"hex": body_hex},
            "expected": {"canonicalMethod": c["canonical_method"], "canonicalUri": c["canonical_uri"],
                         "methodHash": method_hash, "uriHash": uri_hash, "bodyHash": body_hash},
        }
        canon_out.append(entry)
        by_name[c["name"]] = entry["expected"]

    hashing_out = []
    for name, amount, token, chain_id, why in HASH_CASES:
        e = by_name[name]
        rt = keccak_utf8(RESOURCE_TYPE)
        resource_hash = hash_enc("bytes32,bytes32,bytes32,bytes32,uint256,address,uint256",
                                 rt, e["methodHash"], e["uriHash"], e["bodyHash"], amount, token, chain_id)
        jt = keccak_utf8(JOB_TYPE)
        job_id = hash_enc("bytes32,uint256,address,address,address,bytes32,bytes32",
                          jt, chain_id, ESCROW, PAYER, PAYEE, resource_hash, NONCE)
        vt = keccak_utf8(VALIDATION_TYPE)
        request_hash = hash_enc("bytes32,uint256,address,bytes32,bytes32,bytes32",
                                vt, chain_id, ESCROW, job_id, resource_hash, SALT)
        hashing_out.append({
            "name": f"{name}__amount{amount}__chain{chain_id}", "why": why, "resourceCase": name,
            "input": {"methodHash": e["methodHash"], "uriHash": e["uriHash"], "bodyHash": e["bodyHash"],
                      "amount": amount, "token": token, "chainId": chain_id,
                      "escrow": ESCROW, "payer": PAYER, "payee": PAYEE, "nonce": NONCE, "salt": SALT},
            "expected": {"resourceHash": resource_hash, "jobId": job_id, "requestHash": request_hash},
        })

    # EIP-712 digests, built on the baseline case
    base = hashing_out[0]
    chain_id, job_id = 84532, base["expected"]["jobId"]
    resource_hash = base["expected"]["resourceHash"]
    ds = hash_enc("bytes32,bytes32,bytes32,uint256,address",
                  keccak_utf8(DOMAIN_TYPE), keccak_utf8("AgentTrust"), keccak_utf8("1"), chain_id, ESCROW)
    expiry, served_at, agent_id = 1790000000, 1789999000, 7

    def digest(struct_hash: str) -> str:
        return keccak_hex(cast("concat-hex", "0x1901", ds, struct_hash))

    dr = hash_enc("bytes32,bytes32,bytes32,bytes32,uint64,bytes32",
                  keccak_utf8(DELIVERY_REQUEST_TYPE), job_id, resource_hash,
                  keccak_utf8(ORIGIN), expiry, CLIENT_NONCE)
    rc = hash_enc("bytes32,bytes32,bytes32,bytes32,uint256,uint64,bytes32",
                  keccak_utf8(DELIVERY_RECEIPT_TYPE), job_id, resource_hash, RESPONSE_HASH,
                  agent_id, served_at, SALT)
    ea = hash_enc("bytes32,bytes32,uint64,bytes32",
                  keccak_utf8(EVIDENCE_ACCESS_TYPE), job_id, expiry, CLIENT_NONCE)

    typed = {
        "domain": {"name": "AgentTrust", "version": "1", "chainId": chain_id, "verifyingContract": ESCROW,
                   "domainSeparator": ds},
        "messages": [
            {"primaryType": "DeliveryRequest", "signer": "payer",
             "message": {"jobId": job_id, "resourceHash": resource_hash, "sellerOrigin": ORIGIN,
                         "expiry": expiry, "clientNonce": CLIENT_NONCE},
             "expected": {"structHash": dr, "digest": digest(dr)}},
            {"primaryType": "DeliveryReceipt", "signer": "seller payee wallet",
             "message": {"jobId": job_id, "resourceHash": resource_hash, "responseHash": RESPONSE_HASH,
                         "sellerAgentId": agent_id, "servedAt": served_at, "salt": SALT},
             "expected": {"structHash": rc, "digest": digest(rc)}},
            {"primaryType": "EvidenceAccess", "signer": "payer",
             "message": {"jobId": job_id, "expiry": expiry, "clientNonce": CLIENT_NONCE},
             "expected": {"structHash": ea, "digest": digest(ea)}},
        ],
    }

    doc = {
        "version": VERSION,
        "spec": "docs/specs/canonical-hash.md",
        "generatedBy": "impl/scripts/gen-vectors.py using cast (Foundry)",
        "note": ("Expected values come from cast, not from the implementations that must reproduce them. "
                 "Canonical method/URI strings are stated by hand from the §2 rules."),
        "typeStrings": {
            "resource": RESOURCE_TYPE, "job": JOB_TYPE, "validation": VALIDATION_TYPE,
            "eip712Domain": DOMAIN_TYPE, "deliveryRequest": DELIVERY_REQUEST_TYPE,
            "deliveryReceipt": DELIVERY_RECEIPT_TYPE, "evidenceAccess": EVIDENCE_ACCESS_TYPE,
        },
        "typeHashes": {
            "RESOURCE_TYPEHASH": keccak_utf8(RESOURCE_TYPE), "JOB_TYPEHASH": keccak_utf8(JOB_TYPE),
            "VALIDATION_TYPEHASH": keccak_utf8(VALIDATION_TYPE),
        },
        "counts": {"canonicalisation": len(canon_out), "hashing": len(hashing_out), "typedData": 3},
        "canonicalisation": canon_out,
        "hashing": hashing_out,
        "typedData": typed,
    }
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"

    if check:
        if not OUT.exists():
            sys.exit("vectors file missing")
        if OUT.read_text() != text:
            sys.exit("vectors are stale: re-run impl/scripts/gen-vectors.py")
        print(f"ok: {OUT.relative_to(ROOT)} is up to date "
              f"({len(canon_out)} canonicalisation, {len(hashing_out)} hashing, 3 typed-data cases)")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(canon_out)} canonicalisation cases, "
          f"{len(hashing_out)} hashing cases, 3 typed-data messages")


if __name__ == "__main__":
    main()
