# SPEC-001 — Canonical request hash, typed data and shared vectors

**Version:** `canonical-v1` (the version string travels in the 402 as `extra.canonicalVersion`).
**Status:** normative. Where this document and any implementation disagree, **this document and `impl/vectors/canonical-v1.json` win** — fix the code, not the vectors.
**Why it exists:** the escrow binds money to exactly one HTTP request. Buyer (TypeScript), seller (TypeScript) and validator (Python) must each derive byte-identical hashes from the same request, and the escrow must derive the same value on-chain. Any ambiguity here is a security bug (DF-04), so every rule below is stated to the byte.

---

## 1. Layers

| Layer | Who computes it | Checked by |
|---|---|---|
| **A. Canonicalisation** — raw request → canonical method string, canonical URI string, raw body bytes | Off-chain only: TypeScript and Python | TS + Python vectors |
| **B. Hashing** — the three component hashes → `resourceHash` → `jobId` → `requestHash`, plus EIP-712 digests | Off-chain **and** on-chain | Solidity + TS + Python vectors |

The escrow never sees a URL. It receives `methodHash`, `uriHash`, `bodyHash` and derives everything else itself (DF-04).

## 2. Layer A — canonicalisation rules

### 2.1 Method
Uppercase ASCII, no whitespace: `GET`, `POST`. Lowercase input is uppercased. Any method outside `[A-Z]{3,10}` is rejected.

### 2.2 Canonical URI

Built from the seller's **configured origin**, never from the `Host` header (a spoofed `Host` would otherwise change the hash):

```
canonicalUri = scheme "://" host [ ":" port ] path [ "?" query ]
```

1. **scheme** — lowercase. Only `http` (local development) and `https` (deployed) are allowed.
2. **host** — lowercase. Internationalised names are converted to A-label (punycode) form before hashing.
3. **port** — omitted when it is the scheme default (80 for http, 443 for https); otherwise `:port` in decimal with no leading zeros.
4. **path** — never empty: an empty path becomes `/`.
   - Percent-encoding is normalised: hex digits uppercased (`%2f` → `%2F`), and characters in the RFC 3986 *unreserved* set (`A-Z a-z 0-9 - . _ ~`) are decoded rather than left encoded.
   - Dot segments (`.`, `..`) are resolved before hashing.
   - A trailing slash is **significant**: `/v1/x` and `/v1/x/` are different resources.
   - Everything else is left exactly as received.
5. **query** — split on `&`, then each pair split at its **first** `=`; keys and values are percent-decoded to raw bytes, **sorted by (key, value)** as byte strings, then re-encoded with the path's percent-encoding rules.
   - `+` is a **literal plus**, never a space: `canonical-v1` is not `application/x-www-form-urlencoded`. A literal `+` re-encodes to `%2B`, so a client that meant "space" must send `%20`.
   - **Consequence, stated deliberately:** sorting by (key, value) fully determines the order, so the original order of duplicate keys is **not** preserved. `?b=2&a=1` and `?a=1&b=2` hash identically, and so do `?k=2&k=1` and `?k=1&k=2`.
   - A key with an empty value keeps its `=` (`?flag=`). A key with no `=` at all is encoded as key with empty value.
   - An empty query string produces no `?` at all.
6. **fragment** — stripped; it never reaches the server.

### 2.3 Body
`bodyHash = keccak256(rawBodyBytes)` over the **exact bytes received on the wire**, captured before any parser touches them. An empty body hashes the empty byte string, which is `keccak256("") = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`.

- JSON is **never** re-serialised before hashing. Key order and whitespace are part of the request.
- `Content-Encoding` (gzip, br, …) is **rejected** in `canonical-v1`: the seller responds `415` rather than guess which representation to hash.
- `Content-Type` is not hashed. It is recorded in logs and evidence, and the fixture routes accept only `application/json`.

### 2.4 Price, token, chain
- `amount` — an unsigned integer in the token's **atomic units**. USDC has 6 decimals, so `$0.25` is `250000` (V-81). Decimal strings, floats and scaled values never enter a hash.
- `token` — the ERC-20 contract address, hashed as a 20-byte `address` word, not as a string. Case is irrelevant because it is encoded, not spelled.
- `chainId` — `uint256`, from `block.chainid` on-chain.

## 3. Layer B — hashing

### 3.1 Component hashes

```
methodHash = keccak256(bytes(canonicalMethod))
uriHash    = keccak256(bytes(canonicalUri))
bodyHash   = keccak256(rawBodyBytes)
```

### 3.2 Type hashes

```solidity
RESOURCE_TYPEHASH   = keccak256("AgentTrustResource(bytes32 methodHash,bytes32 uriHash,bytes32 bodyHash,uint256 amount,address token,uint256 chainId)")
JOB_TYPEHASH        = keccak256("AgentTrustJob(uint256 chainId,address escrow,address payer,address payee,bytes32 resourceHash,bytes32 nonce)")
VALIDATION_TYPEHASH = keccak256("AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,bytes32 resourceHash,bytes32 salt)")
```

### 3.3 Derivations

```
resourceHash = keccak256(abi.encode(RESOURCE_TYPEHASH, methodHash, uriHash, bodyHash, amount, token, chainId))
jobId        = keccak256(abi.encode(JOB_TYPEHASH, chainId, escrow, payer, payee, resourceHash, nonce))
requestHash  = keccak256(abi.encode(VALIDATION_TYPEHASH, chainId, escrow, jobId, resourceHash, salt))
```

`abi.encode` (32-byte-padded), never `abi.encodePacked` — packed encoding is ambiguous across variable-length inputs.

Why each field is present:
- `amount`, `token`, `chainId` inside `resourceHash` bind the price, the asset and the chain, which is what removes the need for `quotedMax` (DF-04).
- `chainId` and `escrow` inside `jobId` give domain separation: a payload valid against one deployment is invalid against another.
- `salt` inside `requestHash` makes the validation request unpredictable, so it cannot be squatted before the seller files it (DF-06).

## 4. EIP-712 typed data (off-chain messages)

One domain for all three messages:

```
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
name = "AgentTrust", version = "1", chainId = <chain>, verifyingContract = <escrow address>
```

| primaryType | Fields | Signer | Verified by |
|---|---|---|---|
| `DeliveryRequest` | `bytes32 jobId, bytes32 resourceHash, string sellerOrigin, uint64 expiry, bytes32 clientNonce` | payer (EOA) | seller (API-004) |
| `DeliveryReceipt` | `bytes32 jobId, bytes32 resourceHash, bytes32 responseHash, uint256 sellerAgentId, uint64 servedAt, bytes32 salt` | seller's payee wallet | buyer (AGENT-002), validator (VAL-002) |
| `EvidenceAccess` | `bytes32 jobId, uint64 expiry, bytes32 clientNonce` | payer (EOA) | validator (VAL-006) |

`DeliveryReceipt` carries the **salt** so the validator can derive `requestHash` itself and wait for the escrow to show that hash bound to the job before it attests (the fix recorded in §14 row 16).

Digest: `keccak256(0x1901 ‖ domainSeparator ‖ structHash)`, where `structHash = keccak256(abi.encode(typeHash, …fields))` and a `string` field is hashed with `keccak256(bytes(s))` before encoding.

Signatures are EOA-only in v1: 65-byte `(r, s, v)`, `v ∈ {27, 28}`, and `s` in the lower half-order (EIP-2). ERC-1271 contract signatures are future work.

## 5. Versioning

`canonical-v1` is frozen once the first measured run happens. Any change to a rule in §2 or §3 means a new version string, a new vector file, and a re-run of every affected measurement — the version travels in the 402 so a buyer and seller can never silently disagree.

## 6. Test vectors

`impl/vectors/canonical-v1.json` is the single source of truth, consumed by:

| Implementation | Runner |
|---|---|
| Solidity | `forge test --match-contract CanonicalHashTest` (reads the JSON with `vm.readFile` + `vm.parseJson`) |
| TypeScript | `pnpm -C impl/packages/core test` |
| Python | `uv run pytest impl/validator -k vectors` (VAL-003) |

The file has two sections:

- **`canonicalisation`** — raw inputs (method, scheme, host, port, path, query, body) with the expected canonical method, canonical URI and `bodyHash`. Off-chain implementations only.
- **`hashing`** — component hashes plus amount/token/chainId, with expected `resourceHash`, `jobId`, `requestHash` and the three EIP-712 digests. All three implementations, including Solidity.

Expected values were produced with `cast` (Foundry v1.8.3) by `impl/scripts/gen-vectors.sh`, so they are independent of the TypeScript and Solidity code that must reproduce them. Regenerating must be byte-identical: `bash impl/scripts/gen-vectors.sh --check`.

Coverage required (each is a case in the file): simple GET · POST with a JSON body · empty body · binary body · Unicode path · percent-encoding normalisation · unreserved decoding · duplicate query keys in two input orders (must match) · reordered distinct keys (must match) · default port omitted · explicit non-default port · uppercase host · trailing slash significance · dot-segment resolution · fragment stripped · large body · amount edge values (1 and a large value) · different token address · different chainId · sibling resources at the same price (the A3 pair).
