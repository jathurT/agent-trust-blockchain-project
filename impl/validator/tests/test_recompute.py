"""VAL-003 — the validator's recompute must be byte-identical to the seller's output.

The fixture is emitted by the **TypeScript seller itself**
(`impl/validator/tests/fixtures/cross-language-outputs.json`), and this suite checks
that the Python implementation -- written from the seller's prose description, not
ported from its code -- produces the same bytes.

Byte-identical, not merely equivalent: the attestation is over `keccak256(bytes)`, so a
space after a colon or a different key order is a failed validation for an honest
seller.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from eth_utils import keccak

from agenttrust_validator.deterministic import RecomputeError, recompute, serialise

CASES = json.loads((Path(__file__).parent / "fixtures" / "cross-language-outputs.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['path']}:{c['bodyBytes'][:40]}")
def test_python_matches_the_typescript_seller(case):
    produced = recompute(case["path"], case["bodyBytes"].encode("utf-8"))
    assert produced.decode("utf-8") == case["output"]
    # And the hash, which is what is actually attested to.
    assert keccak(produced) == keccak(case["output"].encode("utf-8"))


def test_the_fixture_is_not_empty():
    assert len(CASES) >= 5


def test_serialisation_sorts_keys_at_every_level_and_uses_compact_separators():
    assert serialise({"b": 1, "a": {"d": 2, "c": 3}}) == b'{"a":{"c":3,"d":2},"b":1}'


def test_a_tampered_byte_changes_the_hash():
    good = recompute("/v1/summarise", b'{"text":"One. Two."}')
    assert keccak(good) != keccak(good.replace(b"One", b"0ne"))


def test_an_unknown_route_or_malformed_body_refuses_rather_than_guessing():
    with pytest.raises(RecomputeError):
        recompute("/v1/nope", b"{}")
    with pytest.raises(RecomputeError):
        recompute("/v1/summarise", b"{not json")
    with pytest.raises(RecomputeError):
        recompute("/v1/summarise", b'{"text":42}')
    with pytest.raises(RecomputeError):
        recompute("/v1/summarise", b'{"text":"x","sentences":0}')
