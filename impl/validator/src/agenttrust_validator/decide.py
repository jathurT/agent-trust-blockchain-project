"""VAL-002/003/004 — intake, the independent decision, and the attestation.

The decision is made from things the validator derives for itself. Nothing the seller
asserts is taken on trust except the bytes it delivered, and those are checked against a
hash the validator recomputes.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

from . import canonical as c
from .chain import ChainClient, ChainUnavailable, STATE_FUNDED, Job
from .deterministic import RecomputeError, recompute


class EvidenceRejected(ValueError):
    """The bundle is not usable, and no attestation will be attempted for it."""


@dataclass(frozen=True)
class Receipt:
    job_id: bytes
    resource_hash: bytes
    response_hash: bytes
    seller_agent_id: int
    served_at: int
    salt: bytes


@dataclass
class Decision:
    passed: bool
    reason: str
    request_hash: bytes
    response_hash: bytes
    #: Filled in by `attest` once transactions land.
    response_tx: str | None = None
    release_tx: str | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "reason": self.reason,
            "requestHash": "0x" + self.request_hash.hex(),
            "responseHash": "0x" + self.response_hash.hex(),
            "responseTx": self.response_tx,
            "releaseTx": self.release_tx,
        }


def recover_receipt_signer(*, chain_id: int, escrow: str, receipt: Receipt, signature: bytes) -> str:
    """Recover the DeliveryReceipt signer using the validator's own struct encoding."""
    message = encode_typed_data(
        full_message={
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "DeliveryReceipt": [
                    {"name": "jobId", "type": "bytes32"},
                    {"name": "resourceHash", "type": "bytes32"},
                    {"name": "responseHash", "type": "bytes32"},
                    {"name": "sellerAgentId", "type": "uint256"},
                    {"name": "servedAt", "type": "uint64"},
                    {"name": "salt", "type": "bytes32"},
                ],
            },
            "primaryType": "DeliveryReceipt",
            "domain": {
                "name": "AgentTrust",
                "version": "1",
                "chainId": chain_id,
                "verifyingContract": escrow,
            },
            "message": {
                "jobId": receipt.job_id,
                "resourceHash": receipt.resource_hash,
                "responseHash": receipt.response_hash,
                "sellerAgentId": receipt.seller_agent_id,
                "servedAt": receipt.served_at,
                "salt": receipt.salt,
            },
        }
    )
    return Account.recover_message(message, signature=signature)


@dataclass
class Evidence:
    evidence_id: str
    receipt: Receipt
    request_body: bytes
    response_body: bytes
    path: str
    job: Job
    request_hash: bytes


class EvidenceStore:
    """Content-addressed by `responseHash`, so the same bytes are stored once."""

    def __init__(self, directory: str):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._by_job: dict[bytes, Evidence] = {}

    def put(self, evidence: Evidence) -> None:
        self._by_job[evidence.receipt.job_id] = evidence
        record = {
            "evidenceId": evidence.evidence_id,
            "jobId": "0x" + evidence.receipt.job_id.hex(),
            "path": evidence.path,
            "requestHash": "0x" + evidence.request_hash.hex(),
            "responseHash": "0x" + evidence.receipt.response_hash.hex(),
            "servedAt": evidence.receipt.served_at,
        }
        (self.dir / f"{evidence.evidence_id}.json").write_text(json.dumps(record, indent=2))
        (self.dir / f"{evidence.evidence_id}.response").write_bytes(evidence.response_body)
        (self.dir / f"{evidence.evidence_id}.request").write_bytes(evidence.request_body)

    def by_job(self, job_id: bytes) -> Evidence | None:
        return self._by_job.get(job_id)


def accept_evidence(
    *,
    chain: ChainClient,
    store: EvidenceStore,
    receipt: Receipt,
    signature: bytes,
    request_body: bytes,
    response_body: bytes,
    path: str,
) -> Evidence:
    """VAL-002. Authenticate the bundle before any attestation is contemplated."""
    job = chain.get_job(receipt.job_id)
    if job is None:
        raise EvidenceRejected("no such job")
    if job.state != STATE_FUNDED:
        raise EvidenceRejected(f"job is in state {job.state}, not Funded")

    # The receipt must be signed by the wallet the escrow snapshotted as the payee.
    # Anyone else signing it is not the party that will be paid.
    signer = recover_receipt_signer(
        chain_id=chain.chain_id, escrow=chain.escrow_address, receipt=receipt, signature=signature
    )
    if signer.lower() != job.payee.lower():
        raise EvidenceRejected(f"receipt signed by {signer}, but the job pays {job.payee}")

    if receipt.resource_hash != job.resource_hash:
        raise EvidenceRejected("the receipt names a different resource than the job")
    if receipt.seller_agent_id != job.payee_agent_id:
        raise EvidenceRejected("the receipt names a different agent than the job")
    if keccak(response_body) != receipt.response_hash:
        raise EvidenceRejected("the response bytes do not hash to the receipt's responseHash")

    # Derived here, from the salt in the receipt, so the validator never has to be told
    # which requestHash to watch for (the DF-06 fix recorded in task.md §14).
    request_hash = c.request_hash(
        chain_id=chain.chain_id,
        escrow=chain.escrow_address,
        job_id_=receipt.job_id,
        resource_hash_=job.resource_hash,
        salt=receipt.salt,
    )

    evidence = Evidence(
        evidence_id=receipt.response_hash.hex(),
        receipt=receipt,
        request_body=request_body,
        response_body=response_body,
        path=path,
        job=job,
        request_hash=request_hash,
    )
    store.put(evidence)
    return evidence


def decide(*, chain: ChainClient, evidence: Evidence) -> Decision:
    """VAL-003. Re-derive everything; the seller's word is checked, never accepted."""
    job = chain.get_job(evidence.receipt.job_id)
    if job is None or job.state != STATE_FUNDED:
        return Decision(False, "job is no longer funded", evidence.request_hash, evidence.receipt.response_hash)

    if job.validator.lower() != chain.address.lower():
        return Decision(
            False, "this job names another validator", evidence.request_hash, evidence.receipt.response_hash
        )

    # The request bytes must be the ones the job was funded for. The validator does not
    # know the seller's origin or price, so it checks what it can: that the body the
    # seller says it served hashes into the job's resourceHash given the seller's own
    # method and URI hashes is *not* checkable here -- what is checkable is that the
    # recomputed output matches, which is the substantive claim (DF-08).
    try:
        recomputed = recompute(evidence.path, evidence.request_body)
    except RecomputeError as exc:
        return Decision(False, f"cannot recompute: {exc}", evidence.request_hash, evidence.receipt.response_hash)

    if keccak(recomputed) != evidence.receipt.response_hash:
        return Decision(
            False,
            "the delivered bytes are not what this request deterministically produces",
            evidence.request_hash,
            evidence.receipt.response_hash,
        )

    return Decision(True, "recomputed output matches the delivered bytes", evidence.request_hash, evidence.receipt.response_hash)


def attest(
    *,
    chain: ChainClient,
    evidence: Evidence,
    decision: Decision,
    settings: Any,
    now: float | None = None,
) -> Decision:
    """VAL-004. One response per job, never after the deadline, release immediately.

    The release matters as much as the response. The seller cannot snapshot its own
    pass, and `confirmValidation` is an extra transaction it would have to race, so
    until someone calls one of them a validator that changed its mind would erase the
    pass (DF-05, sharpened by the CONTRACT-007 security review). Releasing here is what
    makes that window small rather than open-ended.
    """
    job = evidence.job
    clock = now if now is not None else time.time()

    # Wait for the payee to bind the hash we derived. Without the binding the escrow is
    # not looking at this requestHash at all.
    bound = chain.wait_for_binding(
        job_id=evidence.receipt.job_id,
        expected=evidence.request_hash,
        timeout_seconds=settings.BINDING_TIMEOUT_SECONDS,
        poll_seconds=settings.POLL_INTERVAL_SECONDS,
        deadline_unix=job.deadline,
    )
    if not bound:
        decision.reason = "binding_timeout: the payee never bound this requestHash"
        decision.passed = False
        return decision

    # Read before writing: a response already posted is left alone, so a retried intake
    # cannot produce a second attestation.
    existing = chain.validation_status(evidence.request_hash)
    if existing is not None and existing[2] != 0:
        decision.reason = f"already attested with response {existing[2]}"
        return decision

    if clock > job.deadline:
        decision.passed = False
        decision.reason = "deadline passed before an attestation could be posted"
        return decision

    response = settings.PASS_RESPONSE if decision.passed else settings.FAIL_RESPONSE
    decision.response_tx = chain.post_validation_response(
        request_hash=evidence.request_hash,
        response=response,
        response_uri=f"evidence://{evidence.evidence_id}",
        response_hash=evidence.receipt.response_hash,
        tag=settings.FEEDBACK_TAG,
    )

    if decision.passed:
        # Immediately, in the same run.
        decision.release_tx = chain.release(evidence.receipt.job_id)

    return decision
