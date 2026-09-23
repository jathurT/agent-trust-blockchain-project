"""VAL-001 — configuration and `/health`."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from agenttrust_validator.app import create_app
from agenttrust_validator.config import Settings

from conftest import ACCOUNTS


def test_refuses_to_start_without_a_complete_configuration():
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_refuses_a_malformed_address_or_key(settings):
    base = settings.model_dump()
    with pytest.raises(ValidationError):
        Settings(**{**base, "ESCROW_ADDRESS": "not-an-address"})
    with pytest.raises(ValidationError):
        Settings(**{**base, "VALIDATOR_PRIVATE_KEY": "0xdeadbeef"})


def test_the_key_never_appears_in_any_representation(settings):
    key = settings.VALIDATOR_PRIVATE_KEY
    assert len(key) == 66  # it really is loaded

    # repr, str and the public view are the three ways it could leak by accident.
    assert key not in repr(settings)
    assert key not in str(settings)
    assert "<redacted>" in repr(settings)
    assert key not in json.dumps(settings.public_view())
    assert key[2:] not in json.dumps(settings.public_view())


def test_health_reports_the_expected_chain_and_never_the_key(settings, chain):
    client = TestClient(create_app(settings, chain))
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()

    assert body["status"] == "ok"
    assert body["chainId"] == settings.CHAIN_ID
    assert body["chainConnected"] is True
    assert body["escrow"].lower() == settings.ESCROW_ADDRESS.lower()
    assert body["validator"].lower() == ACCOUNTS["validator"].address.lower()
    assert body["blockNumber"] > 0

    raw = json.dumps(body)
    assert settings.VALIDATOR_PRIVATE_KEY not in raw
    assert settings.VALIDATOR_PRIVATE_KEY[2:] not in raw


def test_health_degrades_rather_than_lying_when_the_chain_is_unreachable(settings):
    from agenttrust_validator.chain import ChainClient

    offline = ChainClient(
        rpc_url="http://127.0.0.1:1",
        chain_id=settings.CHAIN_ID,
        escrow=settings.ESCROW_ADDRESS,
        validation_registry=settings.VALIDATION_REGISTRY,
        private_key=settings.VALIDATOR_PRIVATE_KEY,
    )
    body = TestClient(create_app(settings, offline)).get("/health").json()
    # A validator that reported "ok" with no chain would be worse than one that is down.
    assert body["status"] == "degraded"
    assert body["chainConnected"] is False
