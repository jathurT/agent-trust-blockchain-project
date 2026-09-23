"""VAL-002 — evidence intake, authenticated before any attestation is contemplated."""

from __future__ import annotations

import base64

import pytest
from eth_utils import keccak
from web3 import Web3

from agenttrust_validator import canonical as c
from agenttrust_validator.decide import EvidenceRejected, EvidenceStore, Receipt, accept_evidence
from agenttrust_validator.deterministic import recompute

from conftest import ACCOUNTS, fund_job, sign_receipt

BODY = b'{"text":"One. Two. Three."}'
PATH = "/v1/summarise"
SALT = keccak(b"seller salt")


def make_receipt(job, response: bytes, *, salt: bytes = SALT, **overrides):
    fields = {
        "jobId": job["jobId"],
        "resourceHash": job["resourceHash"],
        "responseHash": keccak(response),
        "sellerAgentId": overrides.get("sellerAgentId"),
        "servedAt": 1_790_000_000,
        "salt": salt,
    }
    fields.update({k: v for k, v in overrides.items() if k in fields})
    return fields


def submit(chain, store, world, job, *, signer=None, response: bytes | None = None, **overrides):
    response = response if response is not None else recompute(PATH, BODY)
    fields = {
        "jobId": job["jobId"],
        "resourceHash": overrides.get("resourceHash", job["resourceHash"]),
        "responseHash": overrides.get("responseHash", keccak(response)),
        "sellerAgentId": overrides.get("sellerAgentId", world["agentId"]),
        "servedAt": 1_790_000_000,
        "salt": overrides.get("salt", SALT),
    }
    signature = sign_receipt(
        signer or ACCOUNTS["seller"], chain_id=chain.chain_id, escrow=chain.escrow_address, receipt_fields=fields
    )
    receipt = Receipt(
        job_id=fields["jobId"],
        resource_hash=fields["resourceHash"],
        response_hash=fields["responseHash"],
        seller_agent_id=fields["sellerAgentId"],
        served_at=fields["servedAt"],
        salt=fields["salt"],
    )
    return accept_evidence(
        chain=chain,
        store=store,
        receipt=receipt,
        signature=signature,
        request_body=BODY,
        response_body=response,
        path=PATH,
    )


@pytest.fixture
def store(tmp_path) -> EvidenceStore:
    return EvidenceStore(str(tmp_path / "evidence"))


def test_accepts_a_receipt_signed_by_the_payee(w3, world, deployment, chain, store):
    job = fund_job(w3, world, deployment, PATH, BODY)
    evidence = submit(chain, store, world, job)

    assert evidence.receipt.job_id == job["jobId"]
    # The validator derives the requestHash itself, from the salt in the receipt --
    # it is never told which hash to watch for.
    expected = c.request_hash(
        chain_id=chain.chain_id,
        escrow=chain.escrow_address,
        job_id_=job["jobId"],
        resource_hash_=job["resourceHash"],
        salt=SALT,
    )
    assert evidence.request_hash == expected
    assert store.by_job(job["jobId"]) is evidence


def test_rejects_a_receipt_signed_by_anyone_but_the_payee(w3, world, deployment, chain, store):
    job = fund_job(w3, world, deployment, PATH, BODY)
    with pytest.raises(EvidenceRejected, match="receipt signed by"):
        submit(chain, store, world, job, signer=ACCOUNTS["stranger"])


def test_rejects_response_bytes_that_do_not_hash_to_the_receipt(w3, world, deployment, chain, store):
    job = fund_job(w3, world, deployment, PATH, BODY)
    with pytest.raises(EvidenceRejected, match="do not hash"):
        submit(chain, store, world, job, responseHash=keccak(b"something else"))


def test_rejects_a_receipt_naming_a_different_resource_or_agent(w3, world, deployment, chain, store):
    job = fund_job(w3, world, deployment, PATH, BODY)
    with pytest.raises(EvidenceRejected, match="different resource"):
        submit(chain, store, world, job, resourceHash=keccak(b"other"))
    with pytest.raises(EvidenceRejected, match="different agent"):
        submit(chain, store, world, job, sellerAgentId=world["agentId"] + 999)


def test_rejects_an_unknown_job(chain, store, world):
    fake = {"jobId": keccak(b"never funded"), "resourceHash": keccak(b"r")}
    with pytest.raises(EvidenceRejected, match="no such job"):
        submit(chain, store, world, fake)


def test_stores_the_bytes_and_their_hash(w3, world, deployment, chain, store, tmp_path):
    job = fund_job(w3, world, deployment, PATH, BODY)
    response = recompute(PATH, BODY)
    evidence = submit(chain, store, world, job, response=response)

    stored = (tmp_path / "evidence" / f"{evidence.evidence_id}.response").read_bytes()
    assert stored == response
    assert keccak(stored) == evidence.receipt.response_hash
