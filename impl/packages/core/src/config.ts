/**
 * ENV-005: configuration loading.
 *
 * Every service fails fast with one clear message listing *all* problems, so a
 * misconfigured run stops before it can half-start and produce a misleading
 * result. Secrets are never read from here: keys live in a Foundry keystore or
 * the OS keychain and are referenced by name (see .env.example).
 */

export type EnvSource = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`configuration is not usable:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SECRET_SHAPED = /^(0x)?[0-9a-fA-F]{64}$/;

interface FieldSpec {
  /** false => optional */
  required?: boolean;
  kind: "address" | "uint" | "origin" | "url" | "path" | "addressList" | "enum" | "string";
  values?: readonly string[];
  /** used when the variable is absent and not required */
  fallback?: string;
}

export type Spec = Record<string, FieldSpec>;

export interface LoadOptions {
  env?: EnvSource;
  /** called for non-fatal problems; defaults to console.warn */
  warn?: (message: string) => void;
}

function validate(name: string, raw: string, spec: FieldSpec, problems: string[]): string | undefined {
  switch (spec.kind) {
    case "address":
      if (!ADDRESS.test(raw)) problems.push(`${name} is not a 20-byte address: ${raw}`);
      return raw;
    case "addressList": {
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const bad = parts.filter((p) => !ADDRESS.test(p));
      if (bad.length) problems.push(`${name} contains non-addresses: ${bad.join(", ")}`);
      return parts.join(",");
    }
    case "uint":
      if (!/^\d+$/.test(raw)) problems.push(`${name} must be a non-negative integer: ${raw}`);
      return raw;
    case "origin": {
      try {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") problems.push(`${name} must be http(s): ${raw}`);
        if (u.pathname !== "/" || u.search || u.hash) {
          problems.push(`${name} must be a bare origin with no path or query: ${raw}`);
        }
      } catch {
        problems.push(`${name} is not a URL: ${raw}`);
      }
      return raw.replace(/\/$/, "");
    }
    case "url":
      try {
        new URL(raw);
      } catch {
        problems.push(`${name} is not a URL: ${raw}`);
      }
      return raw;
    case "enum":
      if (!spec.values?.includes(raw)) {
        problems.push(`${name} must be one of ${spec.values?.join(" | ")}: ${raw}`);
      }
      return raw;
    default:
      return raw;
  }
}

/**
 * Reads and validates the named variables. Throws once, listing every problem.
 * Anything that *looks* like a private key in the environment is refused
 * outright — keys belong in a keystore, never in configuration.
 */
export function loadConfig<S extends Spec>(spec: S, options: LoadOptions = {}): Record<keyof S, string> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const problems: string[] = [];
  const out: Record<string, string> = {};

  for (const [name, field] of Object.entries(spec)) {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") {
      if (field.required !== false) problems.push(`${name} is required but not set`);
      else if (field.fallback !== undefined) out[name] = field.fallback;
      continue;
    }
    if (SECRET_SHAPED.test(raw) && field.kind !== "string") {
      problems.push(`${name} looks like a private key; use a keystore name instead`);
      continue;
    }
    const value = validate(name, raw, field, problems);
    if (value !== undefined) out[name] = value;
  }

  // Not fatal, but worth saying out loud every time (DF-20): DrvFs writes are
  // ~38x slower than ext4, and the claim store is on the hot path.
  const db = out["CLAIMS_DB_PATH"];
  if (db && /^\/mnt\//.test(db)) {
    warn(
      `CLAIMS_DB_PATH is on ${db} (a Windows drive under WSL). Writes there measured ~38x slower ` +
        `than on the Linux filesystem; prefer $HOME/.local/state/agenttrust/.`,
    );
  }

  if (problems.length) throw new ConfigError(problems);
  return out as Record<keyof S, string>;
}

// ------------------------------------------------------------- service specs

export const CHAIN_SPEC = {
  RPC_URL: { kind: "url" },
  CHAIN_ID: { kind: "uint" },
  CONFIRMATIONS: { kind: "uint", required: false, fallback: "1" },
  ESCROW_ADDRESS: { kind: "address" },
  USDC_ADDRESS: { kind: "address" },
} as const satisfies Spec;

export const SELLER_SPEC = {
  ...CHAIN_SPEC,
  SELLER_ORIGIN: { kind: "origin" },
  SELLER_AGENT_ID: { kind: "uint" },
  SELLER_KEYSTORE: { kind: "string" },
  CLAIMS_DB_PATH: { kind: "path", required: false, fallback: "" },
  REPLAY_POLICY: { kind: "enum", values: ["idempotent", "strict"], required: false, fallback: "idempotent" },
  ACCEPTED_VALIDATORS: { kind: "addressList" },
  VALIDATOR_URL: { kind: "url" },
} as const satisfies Spec;

export const BUYER_SPEC = {
  ...CHAIN_SPEC,
  BUYER_KEYSTORE: { kind: "string" },
  TRUSTED_CLIENTS: { kind: "addressList" },
  MAX_PRICE_ATOMIC: { kind: "uint", required: false, fallback: "1000000" },
} as const satisfies Spec;
