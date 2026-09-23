"""VAL-003 — recomputing the seller's deterministic output.

Written from the prose in `impl/agents/seller/src/routes/deterministic.ts`, not ported
from it. The seller's implementation is the one under scrutiny; an attestation produced
by running the seller's own code would attest to nothing.

If these two ever disagree the validator fails the job, which is the safe direction: a
seller whose output the validator cannot reproduce does not get paid.
"""

from __future__ import annotations

import json
import re
from typing import Any

_SENTENCE_END = {".", "!", "?"}
_WHITESPACE = re.compile(r"\s")
_NON_TOKEN = re.compile(r"[^a-z0-9]+")

KEYWORDS: dict[str, list[str]] = {
    "payments": ["payment", "pay", "escrow", "settle", "settlement", "invoice", "usdc", "token", "price"],
    "security": ["attack", "replay", "sybil", "exploit", "vulnerability", "signature", "authenticate", "reorg"],
    "agents": ["agent", "autonomous", "buyer", "seller", "validator", "registry", "reputation"],
}
DEFAULT_LABELS = ["payments", "security", "agents", "other"]


class RecomputeError(ValueError):
    """The request or route cannot be recomputed, so no attestation can be honest."""


def split_sentences(text: str) -> list[str]:
    """A sentence ends at ``.``/``!``/``?`` followed by whitespace or end-of-input."""
    out: list[str] = []
    start = 0
    for i, char in enumerate(text):
        if char not in _SENTENCE_END:
            continue
        nxt = text[i + 1] if i + 1 < len(text) else None
        if nxt is None or _WHITESPACE.match(nxt):
            sentence = text[start : i + 1].strip()
            if sentence:
                out.append(sentence)
            start = i + 1
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return out


def tokenise(text: str) -> list[str]:
    return [t for t in _NON_TOKEN.split(text.lower()) if t]


def summarise(request: dict[str, Any]) -> dict[str, Any]:
    text = request.get("text")
    if not isinstance(text, str):
        raise RecomputeError("text must be a string")
    n = request.get("sentences", 2)
    if not isinstance(n, int) or isinstance(n, bool) or not (1 <= n <= 20):
        raise RecomputeError("sentences must be an integer in 1..20")

    sentences = split_sentences(text)
    all_tokens = tokenise(text)
    frequency: dict[str, int] = {}
    for token in all_tokens:
        frequency[token] = frequency.get(token, 0) + 1

    scored = []
    for index, sentence in enumerate(sentences):
        tokens = tokenise(sentence)
        total = sum(frequency.get(t, 0) for t in tokens)
        # Integer arithmetic only: a float score would make the ordering depend on the
        # platform's rounding, and the two languages would have to match it exactly.
        score = 0 if not tokens else (total * 1000) // len(tokens)
        scored.append({"index": index, "sentence": sentence, "score": score})

    # Ties break towards the earlier sentence, so the result never depends on sort
    # stability, then the chosen sentences are returned in their original order.
    chosen = sorted(scored, key=lambda s: (-s["score"], s["index"]))[:n]
    chosen.sort(key=lambda s: s["index"])

    return {
        "summary": " ".join(str(c["sentence"]) for c in chosen),
        "sentences": len(sentences),
        "tokens": len(all_tokens),
    }


def classify(request: dict[str, Any]) -> dict[str, Any]:
    text = request.get("text")
    if not isinstance(text, str):
        raise RecomputeError("text must be a string")
    labels = request.get("labels", list(DEFAULT_LABELS))
    if not isinstance(labels, list) or not labels:
        raise RecomputeError("labels must be a non-empty array")
    if any(not isinstance(label, str) for label in labels):
        raise RecomputeError("labels must be strings")

    tokens = tokenise(text)
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1

    scores = {label: sum(counts.get(k, 0) for k in KEYWORDS.get(label, [])) for label in labels}

    # Ties break by label order, never by dict ordering.
    best = labels[0]
    best_score = scores.get(best, 0)
    for label in labels:
        if scores.get(label, 0) > best_score:
            best, best_score = label, scores.get(label, 0)

    return {"label": best, "scores": scores, "tokens": len(tokens)}


HANDLERS = {"/v1/summarise": summarise, "/v1/classify": classify}


def serialise(value: Any) -> bytes:
    """The exact bytes the seller sends: compact separators, keys sorted recursively.

    `json.dumps(..., sort_keys=True)` sorts every level, which matches the seller's
    replacer. The separators matter as much as the order: a space after ``:`` would
    change every byte and therefore every hash.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def recompute(path: str, raw_body: bytes) -> bytes:
    handler = HANDLERS.get(path)
    if handler is None:
        raise RecomputeError(f"no handler for {path}")
    try:
        request = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecomputeError(f"request body is not JSON: {exc}") from exc
    if not isinstance(request, dict):
        raise RecomputeError("request body is not a JSON object")
    return serialise(handler(request))
