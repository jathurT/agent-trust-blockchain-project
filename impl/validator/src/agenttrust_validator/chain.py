"""VAL-001/004 — chain access for the validator.

Polling only: the public Base Sepolia RPC is HTTP-only, so `eth_subscribe` is not
available (V-83). Transactions are built, signed locally with the validator's own key
and sent raw, because the key never leaves this process.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from eth_account import Account
from web3 import Web3

_ABI_DIR = Path(__file__).resolve().parents[3] / "packages" / "core" / "abi"


def _load_abi(name: str) -> list[dict[str, Any]]:
    """The ABIs exported by `impl/scripts/export-abi.sh`, so all three services bind to
    the same interface and a contract change cannot leave one of them behind."""
    return json.loads((_ABI_DIR / f"{name}.abi.json").read_text())


class ChainUnavailable(RuntimeError):
    """The chain could not be read. Never confused with "no such job"."""


@dataclass(frozen=True)
class Job:
    payer: str
    payee: str
    payee_agent_id: int
    validator: str
    token: str
    amount: int
    resource_hash: bytes
    request_hash: bytes
    funded_at: int
    deadline: int
    grace: int
    state: int
    validation_recorded: bool


STATE_NONE, STATE_FUNDED, STATE_RELEASED, STATE_REFUNDED = 0, 1, 2, 3


class ChainClient:
    def __init__(self, *, rpc_url: str, chain_id: int, escrow: str, validation_registry: str, private_key: str):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 15}))
        self.chain_id = chain_id
        self.account = Account.from_key(private_key)
        self.escrow_address = Web3.to_checksum_address(escrow)
        self.escrow = self.w3.eth.contract(address=self.escrow_address, abi=_load_abi("AgentTrustEscrow"))
        self.validation = self.w3.eth.contract(
            address=Web3.to_checksum_address(validation_registry), abi=_load_abi("ValidationRegistry")
        )
        self.identity_address: str | None = None

    @property
    def address(self) -> str:
        return self.account.address

    def connected(self) -> bool:
        try:
            return self.w3.is_connected()
        except Exception:  # noqa: BLE001 - any transport failure means "not connected"
            return False

    def verify_chain_id(self) -> None:
        try:
            actual = self.w3.eth.chain_id
        except Exception as exc:  # noqa: BLE001
            raise ChainUnavailable(f"eth_chainId failed: {exc}") from exc
        if actual != self.chain_id:
            raise ChainUnavailable(f"configured chain {self.chain_id} but the node reports {actual}")

    def get_job(self, job_id: bytes) -> Job | None:
        """None only when the chain positively says the job does not exist."""
        try:
            raw = self.escrow.functions.jobs(job_id).call()
        except Exception as exc:  # noqa: BLE001
            if "UnknownJob" in str(exc) or "0xe498a481" in str(exc):
                return None
            raise ChainUnavailable(f"jobs({job_id.hex()}) failed: {exc}") from exc
        return Job(
            payer=raw[0],
            payee=raw[1],
            payee_agent_id=int(raw[2]),
            validator=raw[3],
            token=raw[4],
            amount=int(raw[5]),
            resource_hash=bytes(raw[6]),
            request_hash=bytes(raw[7]),
            funded_at=int(raw[8]),
            deadline=int(raw[9]),
            grace=int(raw[10]),
            state=int(raw[11]),
            validation_recorded=bool(raw[12]),
        )

    def validation_status(self, request_hash: bytes) -> tuple[str, int, int, bytes, str, int] | None:
        """None when the registry says the hash was never filed ("unknown")."""
        try:
            raw = self.validation.functions.getValidationStatus(request_hash).call()
        except Exception as exc:  # noqa: BLE001
            if "unknown" in str(exc).lower():
                return None
            raise ChainUnavailable(f"getValidationStatus failed: {exc}") from exc
        return (raw[0], int(raw[1]), int(raw[2]), bytes(raw[3]), raw[4], int(raw[5]))

    def _send(self, function: Any) -> str:
        try:
            tx = function.build_transaction(
                {
                    "from": self.address,
                    "nonce": self.w3.eth.get_transaction_count(self.address),
                    "chainId": self.chain_id,
                }
            )
            signed = self.w3.eth.account.sign_transaction(tx, private_key=self.account.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        except Exception as exc:  # noqa: BLE001
            raise ChainUnavailable(f"transaction failed: {exc}") from exc
        if receipt["status"] != 1:
            raise ChainUnavailable(f"transaction reverted: {tx_hash.hex()}")
        return tx_hash.hex()

    def post_validation_response(
        self, *, request_hash: bytes, response: int, response_uri: str, response_hash: bytes, tag: str
    ) -> str:
        return self._send(
            self.validation.functions.validationResponse(
                request_hash, response, response_uri, response_hash, tag
            )
        )

    def release(self, job_id: bytes) -> str:
        return self._send(self.escrow.functions.release(job_id))

    def wait_for_binding(
        self, *, job_id: bytes, expected: bytes, timeout_seconds: float, poll_seconds: float, deadline_unix: int
    ) -> bool:
        """Poll `jobs(jobId).requestHash` until it equals the hash we derived.

        This is what proves the payee both **filed** the validation request and **bound**
        it to this job. Attesting before the binding exists would attest to a hash the
        escrow will never look at, and the seller would go unpaid while the registry
        showed a pass (DF-06).
        """
        stop_at = time.monotonic() + timeout_seconds
        while True:
            job = self.get_job(job_id)
            if job is not None and job.request_hash == expected:
                return True
            if time.time() > deadline_unix:
                return False
            if time.monotonic() >= stop_at:
                return False
            time.sleep(poll_seconds)
