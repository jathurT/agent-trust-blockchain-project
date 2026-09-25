"""VAL-004 — the gas limit the validator signs into its transactions.

Found by AGENT-006: an attestation failed silently on Anvil because `build_transaction`
filled `gas` straight from `eth_estimateGas`, which returns the *minimum* that worked
against the pending state. `validationResponse` writes `lastUpdate = block.timestamp`,
so the cost of that one SSTORE depends on when the estimate is taken relative to the
value already stored: a no-op write costs 100 gas, a reset costs 2,900. Estimate in the
same second and the limit is exactly too small a second later.

The failure mode is the expensive one — the seller delivered, the work was done, and
the payment stayed locked until the refund window opened — so the buffer is pinned here
rather than left to a comment.
"""

from __future__ import annotations

from typing import Any

import pytest

from agenttrust_validator.chain import GAS_ESTIMATE_BUFFER, ChainClient


class _Receipt(dict[str, Any]):
    pass


class _Function:
    """Records the transaction dict it was asked to build."""

    def __init__(self, estimate: int) -> None:
        self._estimate = estimate
        self.built: dict[str, Any] | None = None

    def estimate_gas(self, params: dict[str, Any]) -> int:
        assert params["from"], "the estimate must be made as the sender"
        return self._estimate

    def build_transaction(self, params: dict[str, Any]) -> dict[str, Any]:
        self.built = dict(params)
        return dict(params)


class _Eth:
    def __init__(self, status: int) -> None:
        self._status = status
        self.account = self

    def get_transaction_count(self, _address: str) -> int:
        return 7

    def sign_transaction(self, _tx: dict[str, Any], private_key: Any) -> Any:  # noqa: ANN401
        return type("Signed", (), {"raw_transaction": b"\x01"})()

    def send_raw_transaction(self, _raw: bytes) -> bytes:
        return bytes.fromhex("ab" * 32)

    def wait_for_transaction_receipt(self, _hash: bytes, timeout: int) -> _Receipt:
        return _Receipt(status=self._status)


class _W3:
    def __init__(self, status: int = 1) -> None:
        self.eth = _Eth(status)


def _client(status: int = 1) -> ChainClient:
    # `address` is a read-only property over `account`, so the account is what the
    # fake supplies. Built without __init__ so the test never opens an HTTP provider.
    client = ChainClient.__new__(ChainClient)
    client.w3 = _W3(status)  # type: ignore[attr-defined]
    client.chain_id = 31337  # type: ignore[attr-defined]
    client.account = type(  # type: ignore[attr-defined]
        "A", (), {"key": b"\x02" * 32, "address": "0x0000000000000000000000000000000000000001"}
    )()
    return client


def test_the_signed_limit_is_above_the_estimate() -> None:
    function = _Function(estimate=125_849)
    _client()._send(function)
    assert function.built is not None
    assert function.built["gas"] == int(125_849 * GAS_ESTIMATE_BUFFER)
    assert function.built["gas"] > 125_849


def test_the_buffer_covers_the_sstore_swing_that_caused_the_failure() -> None:
    # The observed shortfall was one SSTORE: 100 gas for a no-op write during the
    # estimate against 2,900 for a reset during execution. Anything at or below the
    # estimate reproduces the bug, so the margin has to exceed that difference by a
    # comfortable factor rather than by exactly 2,800.
    function = _Function(estimate=125_849)
    _client()._send(function)
    assert function.built is not None
    assert function.built["gas"] - 125_849 > 2_900


def test_a_reverted_receipt_is_still_an_error() -> None:
    # The buffer must not turn a genuine revert into a success.
    from agenttrust_validator.chain import ChainUnavailable

    with pytest.raises(ChainUnavailable, match="transaction reverted"):
        _client(status=0)._send(_Function(estimate=50_000))


def test_the_nonce_and_chain_id_still_travel() -> None:
    function = _Function(estimate=21_000)
    _client()._send(function)
    assert function.built is not None
    assert function.built["nonce"] == 7
    assert function.built["chainId"] == 31337


class TestChainClock:
    """VAL-004 — the validator reasons in chain time, never the wall clock.

    Found on 2026-09-25 by a devnet whose chain ran **1070 seconds behind** wall time
    after the A1 reorg runs. `decide.attest` compared `time.time()` against
    `job.deadline`, which is a *chain* timestamp the escrow set from `block.timestamp`,
    and `release()` compares the attestation's `lastUpdate` against that same chain
    clock. Two clocks that are only incidentally related.

    It fails in both directions and the seller pays either way. Chain behind wall time:
    the validator refuses to attest inside a window that is still open, and delivered
    work goes unpaid. Chain ahead: it posts an attestation the escrow rejects as late,
    and the work still goes unpaid. The seller had exactly this bug and it was fixed
    there first.
    """

    def test_the_clock_comes_from_the_chain(self) -> None:
        from agenttrust_validator.chain import ChainClient

        class _Block(dict):
            pass

        class _Eth:
            def get_block(self, which: str) -> _Block:
                assert which == "latest"
                return _Block(timestamp=1_790_000_000)

        client = ChainClient.__new__(ChainClient)
        client.w3 = type("W3", (), {"eth": _Eth()})()  # type: ignore[attr-defined]
        assert client.block_timestamp() == 1_790_000_000

    def test_a_chain_read_failure_is_not_silently_zero(self) -> None:
        from agenttrust_validator.chain import ChainClient, ChainUnavailable

        class _Eth:
            def get_block(self, _which: str) -> dict[str, int]:
                raise RuntimeError("rpc down")

        client = ChainClient.__new__(ChainClient)
        client.w3 = type("W3", (), {"eth": _Eth()})()  # type: ignore[attr-defined]
        # Returning 0 would read as "epoch", making every deadline look passed.
        with pytest.raises(ChainUnavailable, match="chain clock"):
            client.block_timestamp()

    def test_decide_does_not_reach_for_the_wall_clock(self) -> None:
        import inspect

        from agenttrust_validator import decide

        source = inspect.getsource(decide.attest)
        assert "time.time()" not in source, "attest() must not compare a chain deadline to wall time"
        assert "chain.block_timestamp()" in source
