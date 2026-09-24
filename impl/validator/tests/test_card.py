"""REG-006 — the validator's agent card.

The buyer picks the validator, and the escrow snapshots that choice at funding (DF-06),
so the decision is made before any money moves and cannot be changed afterwards. The
card is what the buyer reads to make it.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from agenttrust_validator.app import create_app


def test_the_card_names_the_address_that_will_sign(settings, chain):
    res = TestClient(create_app(settings, chain)).get("/.well-known/agent-card")
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "validator"
    assert body["address"] == chain.address
    assert body["protocol"]["registry"] == settings.VALIDATION_REGISTRY


def test_the_policy_states_the_pass_value_the_escrow_requires(settings, chain):
    body = TestClient(create_app(settings, chain)).get("/.well-known/agent-card").json()
    # The escrow's PASS_THRESHOLD is 100; a validator advertising anything lower would
    # be advertising attestations that can never release a job (SPEC-003 §3).
    assert body["policy"]["passResponse"] == settings.PASS_RESPONSE == 100
    assert body["policy"]["feedbackTag"] == settings.FEEDBACK_TAG


def test_the_policy_says_what_it_does_not_check(settings, chain):
    # DF-08: this is not a judgement of quality, and the card must not let anyone read
    # it as one.
    body = TestClient(create_app(settings, chain)).get("/.well-known/agent-card").json()
    assert "recomputed" in body["policy"]["checks"]
    assert "useful" in body["policy"]["doesNotCheck"]
    assert "worth the price" in body["policy"]["doesNotCheck"]


def test_the_card_says_the_address_binds_not_the_url(settings, chain):
    body = TestClient(create_app(settings, chain)).get("/.well-known/agent-card").json()
    assert "address is what binds" in body["originRule"]


def test_the_card_never_contains_the_key(settings, chain):
    key = settings.VALIDATOR_PRIVATE_KEY
    body = TestClient(create_app(settings, chain)).get("/.well-known/agent-card").json()
    assert key not in json.dumps(body)
    assert key[2:] not in json.dumps(body)
