"""Shared fixtures: a live Anvil with the deployed escrow, and a funded job.

    anvil --port 8545 --chain-id 31337 &
    bash impl/scripts/deploy.sh local
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak
from web3 import Web3
from web3.logs import DISCARD

from agenttrust_validator import canonical as c
from agenttrust_validator.chain import ChainClient, _load_abi
from agenttrust_validator.config import Settings

ROOT = Path(__file__).resolve().parents[3]
RPC = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
ORIGIN = "https://seller.agenttrust.test"
PRICE = 250_000

# The public Anvil test mnemonic. Valueless, never funded, allowlisted in the
# secret-scan hook so it can appear here.
Account.enable_unaudited_hdwallet_features()
MNEMONIC = "test test test test test test test test test test test junk"


def account(index: int):
    return Account.from_mnemonic(MNEMONIC, account_path=f"m/44'/60'/0'/0/{index}")


ACCOUNTS = {
    "deployer": account(0),
    "buyer": account(1),
    "seller": account(2),
    "validator": account(3),
    "trusted": account(4),
    "stranger": account(6),
}


@pytest.fixture(scope="session")
def deployment() -> dict[str, Any]:
    return json.loads((ROOT / "deployments" / "31337.json").read_text())


@pytest.fixture(scope="session")
def w3() -> Web3:
    client = Web3(Web3.HTTPProvider(RPC))
    if not client.is_connected():
        pytest.fail(
            f"no chain at {RPC}. Start one:\n"
            "  anvil --port 8545 --chain-id 31337 &\n"
            "  bash impl/scripts/deploy.sh local"
        )
    return client


@pytest.fixture(scope="session")
def settings(deployment) -> Settings:
    return Settings(
        RPC_URL=RPC,
        CHAIN_ID=deployment["chainId"],
        ESCROW_ADDRESS=deployment["escrow"],
        VALIDATION_REGISTRY=deployment["validationRegistry"],
        IDENTITY_REGISTRY=deployment["identityRegistry"],
        VALIDATOR_PRIVATE_KEY="0x" + ACCOUNTS["validator"].key.hex(),
        EVIDENCE_DIR="/tmp/agenttrust-validator-evidence",
        BINDING_TIMEOUT_SECONDS=20,
        POLL_INTERVAL_SECONDS=0.2,
    )


@pytest.fixture(scope="session")
def chain(settings) -> ChainClient:
    client = ChainClient(
        rpc_url=settings.RPC_URL,
        chain_id=settings.CHAIN_ID,
        escrow=settings.ESCROW_ADDRESS,
        validation_registry=settings.VALIDATION_REGISTRY,
        private_key=settings.VALIDATOR_PRIVATE_KEY,
    )
    client.verify_chain_id()
    return client


def send(w3: Web3, acct, function) -> Any:
    tx = function.build_transaction(
        {"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "chainId": w3.eth.chain_id}
    )
    signed = w3.eth.account.sign_transaction(tx, private_key=acct.key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    assert receipt["status"] == 1, f"transaction reverted: {tx_hash.hex()}"
    return receipt


@pytest.fixture(scope="session")
def world(w3, deployment, chain) -> dict[str, Any]:
    """A registered, endorsed seller agent with a funded buyer."""
    identity = w3.eth.contract(
        address=Web3.to_checksum_address(deployment["identityRegistry"]), abi=_load_abi("IdentityRegistry")
    )
    escrow = w3.eth.contract(
        address=Web3.to_checksum_address(deployment["escrow"]), abi=_load_abi("AgentTrustEscrow")
    )
    token = w3.eth.contract(address=Web3.to_checksum_address(deployment["token"]), abi=_load_abi("MockUSDC"))

    receipt = send(w3, ACCOUNTS["seller"], identity.functions.register(f"{ORIGIN}/.well-known/agent-card"))
    # Decode by event signature: register() emits ERC-721 Transfer first, whose
    # topics[1] is `from` = address(0).
    registered = identity.events.Registered().process_receipt(receipt, errors=DISCARD)
    agent_id = registered[0]["args"]["agentId"]

    reputation = w3.eth.contract(
        address=escrow.functions.reputationRegistry().call(), abi=_load_abi("ReputationRegistry")
    )
    tag = escrow.functions.FEEDBACK_TAG().call()
    send(
        w3,
        ACCOUNTS["trusted"],
        reputation.functions.giveFeedback(agent_id, 9500, 2, tag, "", "", "", b"\x00" * 32),
    )

    send(w3, ACCOUNTS["deployer"], token.functions.mint(ACCOUNTS["buyer"].address, PRICE * 1000))
    send(w3, ACCOUNTS["buyer"], token.functions.approve(deployment["escrow"], PRICE * 1000))

    payee = escrow.functions.previewPayee(agent_id).call()
    return {
        "agentId": agent_id,
        "payee": payee,
        "escrow": escrow,
        "identity": identity,
        "token": token,
        "validation": w3.eth.contract(
            address=Web3.to_checksum_address(deployment["validationRegistry"]),
            abi=_load_abi("ValidationRegistry"),
        ),
    }


_nonce_counter = [int(time.time()) * 1000]


def next_nonce() -> bytes:
    _nonce_counter[0] += 1
    return _nonce_counter[0].to_bytes(32, "big")


def resource_ref(path: str, body: bytes) -> tuple[bytes, bytes, bytes]:
    return (
        c.method_hash("POST"),
        c.uri_hash(c.canonical_uri(scheme="https", host="seller.agenttrust.test", path=path)),
        c.body_hash(body),
    )


def fund_job(w3, world, deployment, path: str, body: bytes, ttl: int = 900) -> dict[str, Any]:
    ref = resource_ref(path, body)
    nonce = next_nonce()
    send(
        w3,
        ACCOUNTS["buyer"],
        world["escrow"].functions.fund(
            world["agentId"],
            Web3.to_checksum_address(deployment["token"]),
            PRICE,
            ref,
            nonce,
            ttl,
            ACCOUNTS["validator"].address,
            ([ACCOUNTS["trusted"].address], 1, 1, 9000),
        ),
    )
    resource_hash = world["escrow"].functions.previewResourceHash(ref, PRICE, deployment["token"]).call()
    job_id = world["escrow"].functions.previewJobId(
        ACCOUNTS["buyer"].address, world["payee"], resource_hash, nonce
    ).call()
    return {"jobId": bytes(job_id), "resourceHash": bytes(resource_hash), "nonce": nonce}


def sign_receipt(signer, *, chain_id: int, escrow: str, receipt_fields: dict[str, Any]) -> bytes:
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
                "verifyingContract": Web3.to_checksum_address(escrow),
            },
            "message": receipt_fields,
        }
    )
    return signer.sign_message(message).signature


def bind_validation(w3, world, chain, job_id: bytes, salt: bytes, request_hash: bytes) -> None:
    """What the seller does: file the request, then bind it to the job."""
    send(
        w3,
        ACCOUNTS["seller"],
        world["validation"].functions.validationRequest(
            ACCOUNTS["validator"].address, world["agentId"], "https://seller.example/evidence", request_hash
        ),
    )
    send(w3, ACCOUNTS["seller"], world["escrow"].functions.bindValidation(job_id, salt))
