/**
 * API-005 — the delivery claim store.
 *
 * This is where the project's central correction lives. The escrow's payer nonce stops
 * a second *payment*; it has nothing to say about a seller serving one payment many
 * times, which is what the published A2 result actually measured — 248 grants for one
 * settlement, and 50 grants for 50 replays with no idempotency at all (V-13). The
 * blueprint tested `ReplayedNonce` and called that an A2 defence; it is not (DF-01).
 *
 *   A funded job is worth exactly one execution. Not one per connection, not one per
 *   process, not one per restart.
 *
 * SQLite in WAL mode gives one writer at a time across processes on a host, which is
 * what makes that true for more than one seller process. Every transition happens in a
 * single `BEGIN IMMEDIATE` transaction, so two racing requests cannot both see "not
 * claimed".
 *
 * `node:sqlite` is used rather than a native binding: it ships with Node 22, so there is
 * no compile step to fail on a fresh machine, and the reproduction instructions stay
 * short. It is flagged experimental, which is recorded in versions.md.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { Hex } from "viem";

export type ClaimState = "CLAIMED" | "RESULT_STORED" | "SERVED" | "FAILED" | "FAILED_FINAL";

export type AcquireResult =
  | { kind: "execute"; attempt: number }
  | { kind: "replay"; body: Buffer; responseHash: Hex; contentType: string }
  | { kind: "busy"; leaseUntil: number }
  | { kind: "exhausted"; attempts: number };

export interface ClaimRow {
  key: string;
  state: ClaimState;
  attempts: number;
  leaseUntil: number;
  responseBody: Buffer | null;
  responseHash: Hex | null;
  contentType: string | null;
  executionsCompleted: number;
  replaysServed: number;
  abortedExecutions: number;
  http2xx: number;
}

export interface ClaimStoreOptions {
  /** Absolute path, or `:memory:` for tests. */
  path?: string;
  /** How long a claim may be held before another process may take it over. */
  leaseMs?: number;
  maxAttempts?: number;
  /** Defaults to console.warn; injected so tests can capture it. */
  warn?: (message: string) => void;
  now?: () => number;
}

/**
 * Default outside the repository and off DrvFs. ENV-002 measured WAL locking working
 * correctly on `/mnt/d`, but small-file writes there are ~38x slower than ext4, and the
 * claim store is on the hot path of every delivery (DF-20).
 */
export function defaultClaimsPath(): string {
  const base = process.env["XDG_STATE_HOME"] ?? `${homedir()}/.local/state`;
  return `${base}/agenttrust/claims.sqlite`;
}

function toBuffer(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

export class ClaimStore {
  private readonly db: DatabaseSync;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  /** Where this store lives, so a second process can open the same file to read it. */
  readonly path: string;

  constructor(options: ClaimStoreOptions = {}) {
    const path = options.path ?? defaultClaimsPath();
    this.path = path;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.now = options.now ?? (() => Date.now());
    const warn = options.warn ?? ((m: string) => console.warn(m));

    // A warning, not a refusal. DF-20's hard "refuse to start" was downgraded after
    // ENV-002 measured that locking actually works here — it is slow, not unsafe, and
    // a seller that refused to run would be worse than one that runs slowly.
    if (path.startsWith("/mnt/")) {
      warn(
        `CLAIMS_DB_PATH is on ${path} (a Windows drive under WSL). Locking was measured ` +
          `correct there, but small-file writes are ~38x slower than on the Linux ` +
          `filesystem, and this database is on the hot path of every delivery. ` +
          `Prefer ${defaultClaimsPath()}.`,
      );
    }

    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // WAL is what allows a reader and a writer at once, and one writer across
    // processes. NORMAL is safe under WAL: a crash can lose the last commit, and the
    // "in doubt" rule below is exactly what covers that.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        key                  TEXT PRIMARY KEY,
        state                TEXT NOT NULL,
        attempts             INTEGER NOT NULL DEFAULT 0,
        lease_until          INTEGER NOT NULL DEFAULT 0,
        response_body        BLOB,
        response_hash        TEXT,
        content_type         TEXT,
        executions_completed INTEGER NOT NULL DEFAULT 0,
        replays_served       INTEGER NOT NULL DEFAULT 0,
        aborted_executions   INTEGER NOT NULL DEFAULT 0,
        http_2xx             INTEGER NOT NULL DEFAULT 0,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retry_nonces (
        key          TEXT NOT NULL,
        client_nonce TEXT NOT NULL,
        seen_at      INTEGER NOT NULL,
        PRIMARY KEY (key, client_nonce)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------------- nonces

  /**
   * Record a client nonce, returning false if it was already present. The UNIQUE
   * constraint does the deciding, so two racing requests cannot both be told "fresh".
   */
  claimNonce(key: string, clientNonce: Hex): boolean {
    try {
      this.db
        .prepare("INSERT INTO retry_nonces (key, client_nonce, seen_at) VALUES (?, ?, ?)")
        .run(key, clientNonce, this.now());
      return true;
    } catch (error) {
      if (/UNIQUE|constraint/i.test((error as Error).message)) return false;
      throw error;
    }
  }

  seenNonce(key: string, clientNonce: Hex): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM retry_nonces WHERE key = ? AND client_nonce = ?")
      .get(key, clientNonce);
    return row !== undefined;
  }

  // -------------------------------------------------------------------- claims

  /**
   * The outcome of asking for the right to execute a job.
   *
   *  - `execute`  — this caller holds the claim and must do the work.
   *  - `replay`   — a result already exists; serve those exact bytes.
   *  - `busy`     — someone else holds a live claim.
   *  - `exhausted`— the handler has failed too many times.
   */
  acquire(key: string): AcquireResult {
    const now = this.now();
    // BEGIN IMMEDIATE takes the write lock up front. Without it, two readers could
    // both see "no claim" and both decide to execute — the race this whole table
    // exists to prevent.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.get(key);

      if (row === undefined) {
        this.db
          .prepare(
            `INSERT INTO claims (key, state, attempts, lease_until, created_at, updated_at)
             VALUES (?, 'CLAIMED', 1, ?, ?, ?)`,
          )
          .run(key, now + this.leaseMs, now, now);
        this.db.exec("COMMIT");
        return { kind: "execute", attempt: 1 };
      }

      // A stored result ends the question, whatever else is true. Serving it again is
      // a replay, never a second execution.
      if (row.state === "RESULT_STORED" || row.state === "SERVED") {
        this.db.exec("COMMIT");
        return {
          kind: "replay",
          body: row.responseBody ?? Buffer.alloc(0),
          responseHash: row.responseHash ?? ("0x" as Hex),
          contentType: row.contentType ?? "application/json; charset=utf-8",
        };
      }

      if (row.state === "FAILED_FINAL") {
        this.db.exec("COMMIT");
        return { kind: "exhausted", attempts: row.attempts };
      }

      const leaseLive = row.state === "CLAIMED" && row.leaseUntil > now;
      if (leaseLive) {
        this.db.exec("COMMIT");
        return { kind: "busy", leaseUntil: row.leaseUntil };
      }

      // Either the previous holder failed, or its lease expired with **no result
      // stored**. That row is "in doubt": we cannot tell a crash before the work from
      // a crash after it. Re-executing is safe only because the routes are
      // deterministic, so a second run produces the same bytes (DF-17).
      if (row.attempts >= this.maxAttempts) {
        this.db
          .prepare("UPDATE claims SET state = 'FAILED_FINAL', updated_at = ? WHERE key = ?")
          .run(now, key);
        this.db.exec("COMMIT");
        return { kind: "exhausted", attempts: row.attempts };
      }

      const attempt = row.attempts + 1;
      this.db
        .prepare(
          `UPDATE claims
              SET state = 'CLAIMED', attempts = ?, lease_until = ?,
                  aborted_executions = aborted_executions + ?, updated_at = ?
            WHERE key = ?`,
        )
        .run(attempt, now + this.leaseMs, row.state === "CLAIMED" ? 1 : 0, now, key);
      this.db.exec("COMMIT");
      return { kind: "execute", attempt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Persist the result. **This happens before any byte is sent**: a crash after
   * sending but before storing would otherwise be indistinguishable from a crash
   * before doing anything, and the job would be executed twice.
   */
  storeResult(key: string, body: Buffer, responseHash: Hex, contentType: string): void {
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE claims
              SET state = 'RESULT_STORED', response_body = ?, response_hash = ?,
                  content_type = ?, executions_completed = executions_completed + 1,
                  lease_until = 0, updated_at = ?
            WHERE key = ? AND state = 'CLAIMED'`,
        )
        .run(body, responseHash, contentType, now, key);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Mark that the bytes went out. Separate from storing, so the order is auditable. */
  markServed(key: string, replay: boolean): void {
    const now = this.now();
    this.db
      .prepare(
        `UPDATE claims
            SET state = 'SERVED', http_2xx = http_2xx + 1,
                replays_served = replays_served + ?, updated_at = ?
          WHERE key = ?`,
      )
      .run(replay ? 1 : 0, now, key);
  }

  /** The handler threw. Another attempt is allowed until `maxAttempts`. */
  markFailed(key: string): void {
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.get(key);
      const state = row && row.attempts >= this.maxAttempts ? "FAILED_FINAL" : "FAILED";
      this.db
        .prepare("UPDATE claims SET state = ?, lease_until = 0, updated_at = ? WHERE key = ?")
        .run(state, now, key);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The per-job counters the harness reports (SPEC-002 §6.3). */
  metrics(key: string): {
    executions_completed: number;
    distinct_results: number;
    http_2xx: number;
    replays_served: number;
    aborted_executions: number;
  } {
    const row = this.get(key);
    return {
      executions_completed: row?.executionsCompleted ?? 0,
      // One row holds at most one result, so a job that executed at all has exactly
      // one distinct result. Stored as a derived value so the schema cannot drift
      // from the claim that matters.
      distinct_results: row && row.responseHash !== null ? 1 : 0,
      http_2xx: row?.http2xx ?? 0,
      replays_served: row?.replaysServed ?? 0,
      aborted_executions: row?.abortedExecutions ?? 0,
    };
  }

  /**
   * The same counters, summed over every job this seller has served (AGENT-006).
   *
   * The demo shows these two numbers side by side, so they must come from the
   * seller's own records rather than from counting HTTP responses: `http_2xx` is how
   * many callers got bytes, `executions_completed` is how many times the work was
   * actually done. On the fixture those diverge; here they must not.
   */
  totals(): {
    jobs: number;
    executions_completed: number;
    distinct_results: number;
    http_2xx: number;
    replays_served: number;
    aborted_executions: number;
  } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*)                                        AS jobs,
                COALESCE(SUM(executions_completed), 0)          AS executions_completed,
                COALESCE(SUM(response_hash IS NOT NULL), 0)     AS distinct_results,
                COALESCE(SUM(http_2xx), 0)                      AS http_2xx,
                COALESCE(SUM(replays_served), 0)                AS replays_served,
                COALESCE(SUM(aborted_executions), 0)            AS aborted_executions
           FROM claims`,
      )
      .get() as Record<string, number>;
    return {
      jobs: Number(row["jobs"]),
      executions_completed: Number(row["executions_completed"]),
      distinct_results: Number(row["distinct_results"]),
      http_2xx: Number(row["http_2xx"]),
      replays_served: Number(row["replays_served"]),
      aborted_executions: Number(row["aborted_executions"]),
    };
  }

  get(key: string): ClaimRow | undefined {
    const row = this.db.prepare("SELECT * FROM claims WHERE key = ?").get(key) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      key: row["key"] as string,
      state: row["state"] as ClaimState,
      attempts: Number(row["attempts"]),
      leaseUntil: Number(row["lease_until"]),
      // node:sqlite hands back a Uint8Array, not a Buffer. Converting here, once,
      // keeps every caller from having to know that — and stops `.toString()`
      // silently producing "114,101,115" instead of the bytes.
      responseBody: toBuffer(row["response_body"]),
      responseHash: (row["response_hash"] as Hex | null) ?? null,
      contentType: (row["content_type"] as string | null) ?? null,
      executionsCompleted: Number(row["executions_completed"]),
      replaysServed: Number(row["replays_served"]),
      abortedExecutions: Number(row["aborted_executions"]),
      http2xx: Number(row["http_2xx"]),
    };
  }
}
