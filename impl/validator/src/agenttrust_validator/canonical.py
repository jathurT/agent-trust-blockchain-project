"""SPEC-001 canonicalisation and hashing, implemented in Python.

This is deliberately **not** a port of `impl/packages/core/src/canonical.ts`. It was
written from `docs/specs/canonical-hash.md`, and that is the entire point of the
validator being a different language: if two implementations written independently from
one specification agree on the shared vectors, the agreement is evidence that the
specification is unambiguous. A port would only prove that copying works.

Where this file and `impl/vectors/canonical-v1.json` disagree, the vectors win, and a
disagreement between the two languages is a **specification defect first** — fix
SPEC-001, then both implementations (R-05).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from eth_utils import keccak

CANONICAL_VERSION: Final = "canonical-v1"

# §2.2 rule 4: the RFC 3986 unreserved set is decoded rather than left encoded.
_UNRESERVED: Final = frozenset(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)
_DEFAULT_PORTS: Final = {"http": 80, "https": 443}
_HEX_DIGITS: Final = b"0123456789ABCDEFabcdef"


class CanonicalError(ValueError):
    """A request that cannot be canonicalised. Never guessed at, always refused."""


# --------------------------------------------------------------------- §2.1 method


def canonical_method(method: str) -> str:
    """Uppercase ASCII; anything outside ``[A-Z]{3,10}`` is rejected."""
    upper = method.strip().upper()
    if not (3 <= len(upper) <= 10) or not all("A" <= c <= "Z" for c in upper):
        raise CanonicalError(f"not a method: {method!r}")
    return upper


# ------------------------------------------------------------------------ §2.2 URI


def _percent_decode(raw: bytes) -> bytes:
    """Decode every ``%XX`` to its byte. Malformed escapes are an error, not a guess."""
    out = bytearray()
    i = 0
    while i < len(raw):
        byte = raw[i]
        if byte != 0x25:  # '%'
            out.append(byte)
            i += 1
            continue
        if i + 2 >= len(raw) or raw[i + 1] not in _HEX_DIGITS or raw[i + 2] not in _HEX_DIGITS:
            raise CanonicalError(f"malformed percent-escape at offset {i}")
        out.append(int(raw[i + 1 : i + 3].decode("ascii"), 16))
        i += 3
    return bytes(out)


def _percent_encode(raw: bytes) -> str:
    """Re-encode, leaving the unreserved set alone and uppercasing the hex digits."""
    return "".join(chr(b) if b in _UNRESERVED else f"%{b:02X}" for b in raw)


def _normalise_path_encoding(path: str) -> str:
    """Normalise percent-encoding **without** decoding the structural characters.

    Decoding then re-encoding wholesale would turn a literal ``%2F`` into ``/`` and
    invent a path segment that was never there, so each run of escapes is decoded and
    re-encoded in place while unescaped characters are left exactly as received (§2.2
    rule 4, "everything else is left exactly as received").
    """
    raw = path.encode("utf-8")
    out: list[str] = []
    i = 0
    while i < len(raw):
        if raw[i] != 0x25:
            out.append(chr(raw[i]))
            i += 1
            continue
        if i + 2 >= len(raw) or raw[i + 1] not in _HEX_DIGITS or raw[i + 2] not in _HEX_DIGITS:
            raise CanonicalError(f"malformed percent-escape in path at offset {i}")
        value = int(raw[i + 1 : i + 3].decode("ascii"), 16)
        # Unreserved bytes are decoded; everything else keeps its escape, uppercased.
        out.append(chr(value) if value in _UNRESERVED else f"%{value:02X}")
        i += 3
    return "".join(out)


def _remove_dot_segments(path: str) -> str:
    """RFC 3986 §5.2.4, applied before hashing (§2.2 rule 4)."""
    segments = path.split("/")
    # A leading empty segment means the path was absolute; remember and re-attach it.
    absolute = path.startswith("/")
    resolved: list[str] = []
    for segment in segments:
        if segment == "." or segment == "":
            continue
        if segment == "..":
            if resolved:
                resolved.pop()
            continue
        resolved.append(segment)

    out = "/".join(resolved)
    if absolute:
        out = "/" + out
    # A trailing slash is significant (§2.2 rule 4), so preserve one that survived.
    if path.endswith(("/", "/.", "/..")) and not out.endswith("/"):
        out += "/"
    return out or "/"


def canonical_query(query: str) -> str:
    """Split, decode, sort by (key, value) as bytes, re-encode (§2.2 rule 5).

    ``+`` is a literal plus, never a space: ``canonical-v1`` is not form encoding, so a
    literal ``+`` re-encodes to ``%2B``.
    """
    if query == "":
        return ""
    pairs: list[tuple[bytes, bytes, bool]] = []
    for part in query.split("&"):
        if part == "":
            continue
        raw = part.encode("utf-8")
        index = raw.find(b"=")  # first '=' only
        if index == -1:
            pairs.append((_percent_decode(raw), b"", False))
        else:
            pairs.append((_percent_decode(raw[:index]), _percent_decode(raw[index + 1 :]), True))

    # Sorting by (key, value) fully determines the order, so duplicate-key order is not
    # preserved -- stated deliberately in §2.2 rule 5.
    pairs.sort(key=lambda p: (p[0], p[1]))
    return "&".join(
        f"{_percent_encode(key)}={_percent_encode(value)}" if had_equals or value == b"" else
        f"{_percent_encode(key)}={_percent_encode(value)}"
        for key, value, had_equals in pairs
    )


def canonical_uri(
    *,
    scheme: str,
    host: str,
    port: int | None = None,
    path: str = "/",
    query: str | None = None,
) -> str:
    """``scheme "://" host [":" port] path ["?" query]`` (§2.2)."""
    scheme_lower = scheme.strip().lower()
    if scheme_lower not in _DEFAULT_PORTS:
        raise CanonicalError(f"unsupported scheme: {scheme!r}")

    host_lower = host.strip().lower()
    if host_lower == "":
        raise CanonicalError("empty host")
    # Internationalised names become A-label (punycode) before hashing.
    try:
        host_ascii = host_lower.encode("idna").decode("ascii")
    except UnicodeError:
        host_ascii = host_lower

    port_part = ""
    if port is not None and port != _DEFAULT_PORTS[scheme_lower]:
        port_part = f":{int(port)}"

    normalised = _remove_dot_segments(_normalise_path_encoding(path or "/"))
    if not normalised.startswith("/"):
        normalised = "/" + normalised

    query_part = ""
    if query:
        # A fragment never reaches the server (§2.2 rule 6).
        canonical = canonical_query(query.split("#", 1)[0])
        if canonical:
            query_part = "?" + canonical

    return f"{scheme_lower}://{host_ascii}{port_part}{normalised}{query_part}"


# --------------------------------------------------------------------- §3 hashing

RESOURCE_TYPE_STRING: Final = (
    "AgentTrustResource(bytes32 methodHash,bytes32 uriHash,bytes32 bodyHash,"
    "uint256 amount,address token,uint256 chainId)"
)
JOB_TYPE_STRING: Final = (
    "AgentTrustJob(uint256 chainId,address escrow,address payer,address payee,"
    "bytes32 resourceHash,bytes32 nonce)"
)
VALIDATION_TYPE_STRING: Final = (
    "AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,"
    "bytes32 resourceHash,bytes32 salt)"
)

RESOURCE_TYPEHASH: Final = keccak(RESOURCE_TYPE_STRING.encode())
JOB_TYPEHASH: Final = keccak(JOB_TYPE_STRING.encode())
VALIDATION_TYPEHASH: Final = keccak(VALIDATION_TYPE_STRING.encode())


def _word_bytes32(value: bytes) -> bytes:
    if len(value) != 32:
        raise CanonicalError(f"expected 32 bytes, got {len(value)}")
    return value


def _word_uint(value: int) -> bytes:
    if value < 0 or value >= 2**256:
        raise CanonicalError(f"uint256 out of range: {value}")
    return value.to_bytes(32, "big")


def _word_address(value: str | bytes) -> bytes:
    """An address is encoded as a 20-byte word, left-padded -- never as a string."""
    if isinstance(value, str):
        text = value[2:] if value.startswith(("0x", "0X")) else value
        if len(text) != 40:
            raise CanonicalError(f"not an address: {value!r}")
        raw = bytes.fromhex(text)
    else:
        raw = value
    if len(raw) != 20:
        raise CanonicalError(f"not a 20-byte address: {value!r}")
    return b"\x00" * 12 + raw


def to_bytes32(value: str | bytes) -> bytes:
    if isinstance(value, bytes):
        return _word_bytes32(value)
    text = value[2:] if value.startswith(("0x", "0X")) else value
    return _word_bytes32(bytes.fromhex(text))


def method_hash(method: str) -> bytes:
    return keccak(canonical_method(method).encode("utf-8"))


def uri_hash(uri: str) -> bytes:
    return keccak(uri.encode("utf-8"))


def body_hash(raw: bytes) -> bytes:
    """keccak256 of the exact bytes on the wire; an empty body hashes b""."""
    return keccak(raw)


def resource_hash(
    *,
    method_hash_: bytes,
    uri_hash_: bytes,
    body_hash_: bytes,
    amount: int,
    token: str,
    chain_id: int,
) -> bytes:
    """abi.encode, 32-byte padded -- never abi.encodePacked (§3.3)."""
    return keccak(
        RESOURCE_TYPEHASH
        + _word_bytes32(method_hash_)
        + _word_bytes32(uri_hash_)
        + _word_bytes32(body_hash_)
        + _word_uint(amount)
        + _word_address(token)
        + _word_uint(chain_id)
    )


def job_id(
    *, chain_id: int, escrow: str, payer: str, payee: str, resource_hash_: bytes, nonce: bytes
) -> bytes:
    return keccak(
        JOB_TYPEHASH
        + _word_uint(chain_id)
        + _word_address(escrow)
        + _word_address(payer)
        + _word_address(payee)
        + _word_bytes32(resource_hash_)
        + _word_bytes32(nonce)
    )


def request_hash(
    *, chain_id: int, escrow: str, job_id_: bytes, resource_hash_: bytes, salt: bytes
) -> bytes:
    return keccak(
        VALIDATION_TYPEHASH
        + _word_uint(chain_id)
        + _word_address(escrow)
        + _word_bytes32(job_id_)
        + _word_bytes32(resource_hash_)
        + _word_bytes32(salt)
    )


# ------------------------------------------------------------- §4 EIP-712 typed data

DOMAIN_TYPE_STRING: Final = (
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)
DELIVERY_RECEIPT_TYPE_STRING: Final = (
    "DeliveryReceipt(bytes32 jobId,bytes32 resourceHash,bytes32 responseHash,"
    "uint256 sellerAgentId,uint64 servedAt,bytes32 salt)"
)
DELIVERY_REQUEST_TYPE_STRING: Final = (
    "DeliveryRequest(bytes32 jobId,bytes32 resourceHash,string sellerOrigin,"
    "uint64 expiry,bytes32 clientNonce)"
)
EVIDENCE_ACCESS_TYPE_STRING: Final = (
    "EvidenceAccess(bytes32 jobId,uint64 expiry,bytes32 clientNonce)"
)


def domain_separator(*, chain_id: int, verifying_contract: str) -> bytes:
    return keccak(
        keccak(DOMAIN_TYPE_STRING.encode())
        + keccak(b"AgentTrust")
        + keccak(b"1")
        + _word_uint(chain_id)
        + _word_address(verifying_contract)
    )


@dataclass(frozen=True)
class DeliveryReceipt:
    job_id: bytes
    resource_hash: bytes
    response_hash: bytes
    seller_agent_id: int
    served_at: int
    salt: bytes

    def struct_hash(self) -> bytes:
        return keccak(
            keccak(DELIVERY_RECEIPT_TYPE_STRING.encode())
            + _word_bytes32(self.job_id)
            + _word_bytes32(self.resource_hash)
            + _word_bytes32(self.response_hash)
            + _word_uint(self.seller_agent_id)
            + _word_uint(self.served_at)
            + _word_bytes32(self.salt)
        )


def typed_data_digest(*, chain_id: int, verifying_contract: str, struct_hash: bytes) -> bytes:
    """keccak256(0x1901 ‖ domainSeparator ‖ structHash)."""
    return keccak(
        b"\x19\x01" + domain_separator(chain_id=chain_id, verifying_contract=verifying_contract) + struct_hash
    )
