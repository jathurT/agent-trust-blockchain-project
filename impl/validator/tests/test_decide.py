"""VAL-003 — the independent decision, and VAL-004 — attest then release immediately."""

from __future__ import annotations

import time

import pytest
from eth_utils import keccak

from agenttrust_validator.chain import STATE_FUNDED, STATE_RELEASED
from agenttrust_validator.decide import EvidenceStore, Receipt, accept_evidence, attest, decide
from agenttrust_validator.deterministic import recompute

from conftest import ACCOUNTS, bind_validation, fund_job, sign_receipt

BODY = b'{"text":"Agents pay each other. Escrow protects the buyer. An attack can replay a payment."}'
PATH = "/v1/summarise"


@pytest.fixture
def store(tmp_path) -> EvidenceStore:
    return EvidenceStore(str(tmp_path / "evidence"))


def deposit(chain, store, world, job, *, response: bytes, salt: bytes, path: str = PATH, request_body: bytes = BODY):
    fields = {
        "jobId": job["jobId"],
        "resourceHash": job["resourceHash"],
        "responseHash": keccak(response),
        "sellerAgentId": world["agentId"],
        "servedAt": int(time.time()),
        "salt": salt,
    }
    signature = sign_receipt(
        ACCOUNTS["seller"], chain_id=chain.chain_id, escrow=chain.escrow_address, receipt_fields=fields
    )
    return accept_evidence(
        chain=chain,
        store=store,
        receipt=Receipt(
            job_id=fields["jobId"],
            resource_hash=fields["resourceHash"],
            response_hash=fields["responseHash"],
            seller_agent_id=fields["sellerAgentId"],
            served_at=fields["servedAt"],
            salt=fields["salt"],
        ),
        signature=signature,
        request_body=request_body,
        response_body=response,
        path=path,
    )


class TestDecide:
    def test_passes_when_the_recomputed_output_matches(self, w3, world, deployment, chain, store):
        job = fund_job(w3, world, deployment, PATH, BODY)
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=keccak(b"s1"))

        decision = decide(chain=chain, evidence=evidence)
        assert decision.passed, decision.reason
        assert "matches" in decision.reason

    def test_fails_when_a_single_byte_of_the_response_is_tampered(self, w3, world, deployment, chain, store):
        job = fund_job(w3, world, deployment, PATH, BODY)
        tampered = recompute(PATH, BODY).replace(b"Escrow", b"3scrow")
        evidence = deposit(chain, store, world, job, response=tampered, salt=keccak(b"s2"))

        decision = decide(chain=chain, evidence=evidence)
        assert not decision.passed
        assert "not what this request deterministically produces" in decision.reason

    def test_fails_when_the_seller_answers_a_different_request(self, w3, world, deployment, chain, store):
        # The response is a valid output -- for some other input. The validator
        # recomputes from the request bytes, so it catches the substitution.
        job = fund_job(w3, world, deployment, PATH, BODY)
        other = recompute(PATH, b'{"text":"Completely different text here."}')
        evidence = deposit(chain, store, world, job, response=other, salt=keccak(b"s3"))
        assert not decide(chain=chain, evidence=evidence).passed

    def test_fails_when_the_job_names_another_validator(self, w3, world, deployment, chain, store, monkeypatch):
        job = fund_job(w3, world, deployment, PATH, BODY)
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=keccak(b"s4"))
        monkeypatch.setattr(type(chain), "address", property(lambda self: ACCOUNTS["stranger"].address))
        decision = decide(chain=chain, evidence=evidence)
        assert not decision.passed
        assert "another validator" in decision.reason


class TestAttest:
    def test_a_pass_is_followed_by_a_release_in_the_same_run(self, w3, world, deployment, chain, store, settings):
        """Acceptance (c). The seller is paid without anyone else having to act."""
        job = fund_job(w3, world, deployment, PATH, BODY)
        salt = keccak(b"release-salt")
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=salt)
        bind_validation(w3, world, chain, job["jobId"], salt, evidence.request_hash)

        payee_before = world["token"].functions.balanceOf(world["payee"]).call()
        decision = attest(chain=chain, evidence=evidence, decision=decide(chain=chain, evidence=evidence), settings=settings)

        assert decision.passed, decision.reason
        assert decision.response_tx is not None
        assert decision.release_tx is not None, "a pass must release immediately (DF-05/DF-15)"

        on_chain = world["escrow"].functions.jobs(job["jobId"]).call()
        assert on_chain[11] == STATE_RELEASED
        assert world["token"].functions.balanceOf(world["payee"]).call() == payee_before + 250_000

    def test_exactly_one_response_even_if_the_intake_is_retried(self, w3, world, deployment, chain, store, settings):
        """Acceptance (a). Read before write: a second run finds the response and stops."""
        job = fund_job(w3, world, deployment, PATH, BODY)
        salt = keccak(b"retry-salt")
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=salt)
        bind_validation(w3, world, chain, job["jobId"], salt, evidence.request_hash)

        first = attest(chain=chain, evidence=evidence, decision=decide(chain=chain, evidence=evidence), settings=settings)
        assert first.response_tx is not None

        second = attest(chain=chain, evidence=evidence, decision=decide(chain=chain, evidence=evidence), settings=settings)
        assert second.response_tx is None, "a retried intake must not post a second attestation"
        assert "already attested" in second.reason

    def test_a_fail_posts_a_response_and_no_release(self, w3, world, deployment, chain, store, settings):
        """Acceptance (d)."""
        job = fund_job(w3, world, deployment, PATH, BODY)
        salt = keccak(b"fail-salt")
        tampered = recompute(PATH, BODY).replace(b"Escrow", b"3scrow")
        evidence = deposit(chain, store, world, job, response=tampered, salt=salt)
        bind_validation(w3, world, chain, job["jobId"], salt, evidence.request_hash)

        decision = attest(chain=chain, evidence=evidence, decision=decide(chain=chain, evidence=evidence), settings=settings)
        assert not decision.passed
        assert decision.response_tx is not None
        assert decision.release_tx is None

        # The job stays funded, so the buyer can refund after deadline + grace.
        assert world["escrow"].functions.jobs(job["jobId"]).call()[11] == STATE_FUNDED
        assert world["escrow"].functions.isReleasable(job["jobId"]).call() is False

    def test_no_response_is_sent_after_the_deadline(self, w3, world, deployment, chain, store, settings):
        """Acceptance (b). Late work is not attested, however good it is."""
        job = fund_job(w3, world, deployment, PATH, BODY)
        salt = keccak(b"late-salt")
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=salt)
        bind_validation(w3, world, chain, job["jobId"], salt, evidence.request_hash)

        past_deadline = evidence.job.deadline + 1
        decision = attest(
            chain=chain,
            evidence=evidence,
            decision=decide(chain=chain, evidence=evidence),
            settings=settings,
            now=past_deadline,
        )
        assert not decision.passed
        assert decision.response_tx is None
        assert "deadline passed" in decision.reason

    def test_evidence_whose_binding_never_appears_times_out_without_responding(
        self, w3, world, deployment, chain, store, settings
    ):
        """Acceptance (e). No binding means the escrow is not watching this hash at all."""
        job = fund_job(w3, world, deployment, PATH, BODY)
        # Deliberately never filed or bound.
        evidence = deposit(chain, store, world, job, response=recompute(PATH, BODY), salt=keccak(b"unbound"))

        short = settings.model_copy(update={"BINDING_TIMEOUT_SECONDS": 1, "POLL_INTERVAL_SECONDS": 0.1})
        decision = attest(chain=chain, evidence=evidence, decision=decide(chain=chain, evidence=evidence), settings=short)

        assert not decision.passed
        assert decision.response_tx is None
        assert decision.reason.startswith("binding_timeout")
        assert world["escrow"].functions.jobs(job["jobId"]).call()[11] == STATE_FUNDED
