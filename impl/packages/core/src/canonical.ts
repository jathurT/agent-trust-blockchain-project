/**
 * SPEC-001 reference implementation: canonicalisation and hashing.
 *
 * Normative definition: docs/specs/canonical-hash.md (canonical-v1).
 * Vectors: impl/vectors/canonical-v1.json — if this code and the vectors
 * disagree, the vectors win.
 *
 * The Python validator implements the same rules independently from the spec
 * (VAL-003). That independence is the point: it is what makes agreement
 * evidence rather than coincidence.
 */
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const CANONICAL_VERSION = "canonical-v1";

// ---------------------------------------------------------------- type hashes

export const RESOURCE_TYPE_STRING =
  "AgentTrustResource(bytes32 methodHash,bytes32 uriHash,bytes32 bodyHash,uint256 amount,address token,uint256 chainId)";
export const JOB_TYPE_STRING =
  "AgentTrustJob(uint256 chainId,address escrow,address payer,address payee,bytes32 resourceHash,bytes32 nonce)";
export const VALIDATION_TYPE_STRING =
  "AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,bytes32 resourceHash,bytes32 salt)";

export const RESOURCE_TYPEHASH = keccak256(toHex(RESOURCE_TYPE_STRING));
export const JOB_TYPEHASH = keccak256(toHex(JOB_TYPE_STRING));
export const VALIDATION_TYPEHASH = keccak256(toHex(VALIDATION_TYPE_STRING));

// -------------------------------------------------------- layer A: canonical

const UNRESERVED = /[A-Za-z0-9\-._~]/;
const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };

/** Uppercase ASCII method; anything unusual is rejected rather than guessed. */
export function canonicalMethod(method: string): string {
  const m = method.trim().toUpperCase();
  if (!/^[A-Z]{3,10}$/.test(m)) throw new Error(`invalid HTTP method: ${JSON.stringify(method)}`);
  return m;
}

function percentDecode(s: string): Uint8Array {
  const out: number[] = [];
  const enc = new TextEncoder();
  const chars = Array.from(s); // by code point, so surrogate pairs stay intact
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === "%" && i + 2 < chars.length && /^[0-9A-Fa-f]$/.test(chars[i + 1]!) && /^[0-9A-Fa-f]$/.test(chars[i + 2]!)) {
      out.push(parseInt(chars[i + 1]! + chars[i + 2]!, 16));
      i += 2;
    } else {
      for (const b of enc.encode(ch)) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

function percentEncode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += b < 0x80 && UNRESERVED.test(c) ? c : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Normalise percent-encoding in place: uppercase hex, decode unreserved, keep structure. */
function normalizePercentInPath(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const pair = s.slice(i + 1, i + 3);
    if (ch === "%" && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      const b = parseInt(pair, 16);
      const c = String.fromCharCode(b);
      out += b < 0x80 && UNRESERVED.test(c) ? c : "%" + pair.toUpperCase();
      i += 2;
    } else {
      out += ch;
    }
  }
  return out;
}

/** RFC 3986 §5.2.4 remove_dot_segments. */
function removeDotSegments(path: string): string {
  const out: string[] = [];
  const trailingSlash = path.endsWith("/");
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  let result = "/" + out.join("/");
  if (trailingSlash && result !== "/") result += "/";
  return result;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/**
 * Sort query pairs by (key, value) as raw bytes and re-encode.
 * `+` is a literal plus, never a space — canonical-v1 is not form encoding.
 */
export function canonicalQuery(query: string): string {
  const raw = query.startsWith("?") ? query.slice(1) : query;
  if (raw === "") return "";
  const pairs = raw
    .split("&")
    .filter((p) => p.length > 0)
    .map((p) => {
      const i = p.indexOf("=");
      const k = i < 0 ? p : p.slice(0, i);
      const v = i < 0 ? "" : p.slice(i + 1);
      return { k: percentDecode(k), v: percentDecode(v) };
    });
  pairs.sort((a, b) => compareBytes(a.k, b.k) || compareBytes(a.v, b.v));
  return pairs.map(({ k, v }) => `${percentEncode(k)}=${percentEncode(v)}`).join("&");
}

export interface UriParts {
  scheme: string;
  host: string;
  /** Omitted when it is the scheme default. */
  port?: number | null;
  path: string;
  query?: string;
  /** Accepted and discarded: fragments never reach the server. */
  fragment?: string | null;
}

export function canonicalUri(parts: UriParts): string {
  const scheme = parts.scheme.trim().toLowerCase();
  if (scheme !== "http" && scheme !== "https") throw new Error(`unsupported scheme: ${parts.scheme}`);

  // new URL() gives lowercase + punycode (A-label) for the host
  const host = new URL(`${scheme}://${parts.host}`).hostname;
  if (host === "") throw new Error("empty host");

  const portPart =
    parts.port == null || parts.port === DEFAULT_PORTS[scheme] ? "" : `:${Number(parts.port)}`;

  let path = parts.path ?? "";
  if (path === "") path = "/";
  if (!path.startsWith("/")) path = "/" + path;
  path = removeDotSegments(normalizePercentInPath(path));

  const query = canonicalQuery(parts.query ?? "");
  return `${scheme}://${host}${portPart}${path}${query === "" ? "" : "?" + query}`;
}

// --------------------------------------------------------- layer B: hashing

export const methodHash = (canonicalMethodString: string): Hex => keccak256(toHex(canonicalMethodString));
export const uriHash = (canonicalUriString: string): Hex => keccak256(toHex(canonicalUriString));

/** Hash of the exact bytes received on the wire (never re-serialised JSON). */
export const bodyHash = (body: Uint8Array | Hex): Hex =>
  keccak256(typeof body === "string" ? body : toHex(body));

export function resourceHash(input: {
  methodHash: Hex;
  uriHash: Hex;
  bodyHash: Hex;
  amount: bigint;
  token: Address;
  chainId: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, bytes32, uint256, address, uint256"), [
      RESOURCE_TYPEHASH,
      input.methodHash,
      input.uriHash,
      input.bodyHash,
      input.amount,
      input.token,
      input.chainId,
    ]),
  );
}

export function jobId(input: {
  chainId: bigint;
  escrow: Address;
  payer: Address;
  payee: Address;
  resourceHash: Hex;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, uint256, address, address, address, bytes32, bytes32"), [
      JOB_TYPEHASH,
      input.chainId,
      input.escrow,
      input.payer,
      input.payee,
      input.resourceHash,
      input.nonce,
    ]),
  );
}

export function requestHash(input: {
  chainId: bigint;
  escrow: Address;
  jobId: Hex;
  resourceHash: Hex;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, uint256, address, bytes32, bytes32, bytes32"), [
      VALIDATION_TYPEHASH,
      input.chainId,
      input.escrow,
      input.jobId,
      input.resourceHash,
      input.salt,
    ]),
  );
}

// ------------------------------------------------------------- EIP-712 data

export const EIP712_TYPES = {
  DeliveryRequest: [
    { name: "jobId", type: "bytes32" },
    { name: "resourceHash", type: "bytes32" },
    { name: "sellerOrigin", type: "string" },
    { name: "expiry", type: "uint64" },
    { name: "clientNonce", type: "bytes32" },
  ],
  DeliveryReceipt: [
    { name: "jobId", type: "bytes32" },
    { name: "resourceHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "sellerAgentId", type: "uint256" },
    { name: "servedAt", type: "uint64" },
    { name: "salt", type: "bytes32" },
  ],
  EvidenceAccess: [
    { name: "jobId", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "clientNonce", type: "bytes32" },
  ],
} as const;

export interface AgentTrustDomain {
  chainId: number;
  verifyingContract: Address;
}

export const domain = (d: AgentTrustDomain) =>
  ({ name: "AgentTrust", version: "1", chainId: d.chainId, verifyingContract: d.verifyingContract }) as const;

export type PrimaryType = keyof typeof EIP712_TYPES;

/** EIP-712 digest that a signer signs and a verifier recovers against. */
export function typedDataDigest(
  d: AgentTrustDomain,
  primaryType: PrimaryType,
  message: Record<string, unknown>,
): Hex {
  const types: Record<string, readonly { name: string; type: string }[]> = {
    [primaryType]: EIP712_TYPES[primaryType],
  };
  // One cast at the boundary: viem's generics infer the message shape from a
  // literal `types` object, which we build dynamically from the vector file.
  return hashTypedData({ domain: domain(d), types, primaryType, message } as Parameters<
    typeof hashTypedData
  >[0]);
}
