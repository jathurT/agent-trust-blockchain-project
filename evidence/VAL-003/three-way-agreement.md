# Three-way agreement on canonical-v1

The point of writing the validator in Python is that `impl/validator/src/agenttrust_validator/canonical.py`
was written **from `docs/specs/canonical-hash.md`**, not ported from
`impl/packages/core/src/canonical.ts`. Two implementations written independently from one
specification agreeing is evidence that the specification is unambiguous; a port agreeing
would only show that copying works.

| Implementation | Language | Written from | Result |
|---|---|---|---|
| `impl/scripts/gen-vectors.py` → `canonical-v1.json` | Rust (`cast`) | the spec | generated the expected values |
| `impl/contracts/src/CanonicalHash.sol` | Solidity | the spec | 4 tests, all vectors |
| `impl/packages/core/src/canonical.ts` | TypeScript | the spec | 45 tests, all vectors |
| `impl/validator/src/agenttrust_validator/canonical.py` | **Python** | the spec | **34 tests, all vectors, passing on the first run** |

All 21 canonicalisation cases, 9 hashing cases and the three type hashes agree across all
four.

## And the deterministic output, which is the substantive claim

The hashes agreeing is necessary but not sufficient: the validator also has to reproduce
the *result* the seller served, or its attestation is about nothing (DF-08).
`agenttrust_validator/deterministic.py` was written from the prose description in
`impl/agents/seller/src/routes/deterministic.ts`, not from its code — an attestation
produced by running the seller's own implementation would attest to nothing.

`tests/test_recompute.py` checks the Python output **byte for byte** against a fixture
emitted by the TypeScript seller itself, including a Unicode case. Byte-identical, not
merely equivalent: the attestation is over `keccak256(bytes)`, so a space after a colon
would fail an honest seller.

Two things had to match exactly and are worth naming, because either would have been easy
to get subtly wrong:

- **Compact separators and recursive key sorting.** `json.dumps(..., sort_keys=True,
  separators=(",", ":"))` matches the seller's sorted replacer; the default separators
  would change every byte.
- **Integer scoring.** The sentence score is `(total * 1000) // len(tokens)` in both. A
  float score would make the ordering depend on each platform's rounding, and the two
  languages would then have to reproduce that rounding rather than the rule.
