"""VAL-003 — the shared vectors, run against the independent Python implementation.

`impl/vectors/canonical-v1.json` was generated with `cast` (Rust), and is already
checked by Solidity and TypeScript. This suite is the third, written from the spec
rather than ported. Three independent implementations agreeing is evidence that the
specification says what it means; a port agreeing would only mean copying works.

A mismatch here is a **specification defect first** (R-05): fix SPEC-001, then all
three implementations.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenttrust_validator import canonical as c

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "impl" / "vectors" / "canonical-v1.json").read_text()
)


def hexstr(raw: bytes) -> str:
    return "0x" + raw.hex()


def test_vector_file_is_the_expected_version():
    assert VECTORS["version"] == c.CANONICAL_VERSION


def test_type_strings_and_hashes_match():
    assert VECTORS["typeStrings"]["resource"] == c.RESOURCE_TYPE_STRING
    assert VECTORS["typeStrings"]["job"] == c.JOB_TYPE_STRING
    assert VECTORS["typeStrings"]["validation"] == c.VALIDATION_TYPE_STRING
    assert VECTORS["typeHashes"]["RESOURCE_TYPEHASH"] == hexstr(c.RESOURCE_TYPEHASH)
    assert VECTORS["typeHashes"]["JOB_TYPEHASH"] == hexstr(c.JOB_TYPEHASH)
    assert VECTORS["typeHashes"]["VALIDATION_TYPEHASH"] == hexstr(c.VALIDATION_TYPEHASH)

    # The EIP-712 type strings too, since VAL-002 recovers a DeliveryReceipt signature
    # against them and a drift there would reject every honest seller.
    assert VECTORS["typeStrings"]["deliveryReceipt"] == c.DELIVERY_RECEIPT_TYPE_STRING
    assert VECTORS["typeStrings"]["deliveryRequest"] == c.DELIVERY_REQUEST_TYPE_STRING
    assert VECTORS["typeStrings"]["evidenceAccess"] == c.EVIDENCE_ACCESS_TYPE_STRING
    assert VECTORS["typeStrings"]["eip712Domain"] == c.DOMAIN_TYPE_STRING


@pytest.mark.parametrize("case", VECTORS["canonicalisation"], ids=lambda x: x["name"])
def test_canonicalisation(case):
    got = c.canonical_uri(
        scheme=case["input"]["scheme"],
        host=case["input"]["host"],
        port=case["input"].get("port"),
        path=case["input"].get("path", "/"),
        query=case["input"].get("query"),
    )
    assert got == case["expected"]["canonicalUri"], case.get("why", "")
    assert hexstr(c.uri_hash(got)) == case["expected"]["uriHash"]
    if "method" in case["input"]:
        assert c.canonical_method(case["input"]["method"]) == case["expected"]["canonicalMethod"]


@pytest.mark.parametrize("case", VECTORS["hashing"], ids=lambda x: x["name"])
def test_hashing(case):
    i, expected = case["input"], case["expected"]
    rh = c.resource_hash(
        method_hash_=c.to_bytes32(i["methodHash"]),
        uri_hash_=c.to_bytes32(i["uriHash"]),
        body_hash_=c.to_bytes32(i["bodyHash"]),
        amount=int(i["amount"]),
        token=i["token"],
        chain_id=int(i["chainId"]),
    )
    assert hexstr(rh) == expected["resourceHash"]

    jid = c.job_id(
        chain_id=int(i["chainId"]),
        escrow=i["escrow"],
        payer=i["payer"],
        payee=i["payee"],
        resource_hash_=rh,
        nonce=c.to_bytes32(i["nonce"]),
    )
    assert hexstr(jid) == expected["jobId"]

    req = c.request_hash(
        chain_id=int(i["chainId"]),
        escrow=i["escrow"],
        job_id_=jid,
        resource_hash_=rh,
        salt=c.to_bytes32(i["salt"]),
    )
    assert hexstr(req) == expected["requestHash"]


def test_every_vector_ran():
    # A parametrised suite that silently collected nothing would pass. The counts block
    # in the vector file is the guard against that.
    assert len(VECTORS["canonicalisation"]) == VECTORS["counts"]["canonicalisation"]
    assert len(VECTORS["hashing"]) == VECTORS["counts"]["hashing"]
    assert VECTORS["counts"]["canonicalisation"] > 0 and VECTORS["counts"]["hashing"] > 0


def test_empty_body_hash_matches_the_spec():
    assert hexstr(c.body_hash(b"")) == (
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )
