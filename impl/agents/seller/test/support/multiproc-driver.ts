/**
 * Drives the cross-process claim test: two seller processes, one shared claim
 * database, N authenticated retries spread across both, and the metrics read back
 * afterwards. Prints one JSON object so the shell script can assert on it and the
 * evidence file is machine-readable.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaimStore } from "../../src/claims.js";
import { buildWorld, fundJob, ORIGIN, signedHeader, accounts, deployment } from "./world.js";

const total = Number(process.argv[2] ?? 50);
const processes = Number(process.argv[3] ?? 2);
const basePort = 8500;

/**
 * How long a child gets to print `ready:<port>`.
 *
 * This was 30 s, and on 2026-09-25 the script started failing on an idle machine with
 * nothing but "never became ready". The child was fine — run standalone it starts and
 * serves correctly — but loading its module graph under `tsx` on this DrvFs workspace
 * was **measured at 36 s**, and the children start one after another. The test was
 * timing the filesystem rather than the claim store (CLAUDE.md §15: small-file I/O
 * here is ~38x slower than ext4).
 *
 * The default is deliberately far above the measurement rather than just above it: a
 * loaded machine is several times slower again, and a startup wait that is merely
 * "usually enough" produces a flaky test, which is worse than a slow one. Nothing is
 * being relaxed about what the test *asserts* — 50 requests must still produce exactly
 * one execution. Override with MULTIPROC_READY_TIMEOUT_MS on a faster filesystem.
 */
const READY_TIMEOUT_MS = Number(process.env["MULTIPROC_READY_TIMEOUT_MS"] ?? 180_000);

async function waitForReady(child: ChildProcess, port: number): Promise<void> {
  // Accumulated, not examined chunk by chunk: `ready:8500` can be split across two
  // reads, and the previous version tested each chunk on its own, so a marker that
  // arrived in two pieces was never seen at all.
  let output = "";
  const started = Date.now();

  await new Promise<void>((resolve, reject) => {
    const fail = (reason: string) =>
      reject(
        new Error(
          `${reason}\n` +
            `  waited ${((Date.now() - started) / 1000).toFixed(1)}s of ` +
            `${(READY_TIMEOUT_MS / 1000).toFixed(0)}s ` +
            `(raise MULTIPROC_READY_TIMEOUT_MS if this workspace is simply slow)\n` +
            `  captured output from the child:\n` +
            (output.trim() ? output.replace(/^/gm, "    ") : "    (nothing)"),
        ),
      );

    const timer = setTimeout(() => fail(`process on ${port} never became ready`), READY_TIMEOUT_MS);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      // `ready:` is written from inside app.listen's callback, so seeing it means the
      // socket is accepting connections — exactly the precondition for firing requests.
      if (output.includes(`ready:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(`process on ${port} exited with ${code} before becoming ready`);
    });
  });
}

const children: ChildProcess[] = [];

/** Kill the whole group: `tsx` runs the server as a grandchild. */
function stopChildren(): void {
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  children.length = 0;
}

// A run that fails during startup must not leave a server holding a port, or the next
// run fails for a reason that has nothing to do with the code under test.
process.on("exit", stopChildren);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopChildren();
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "agenttrust-multiproc-"));
  const dbPath = join(dir, "claims.sqlite");
  const world = await buildWorld();

  const sellerConfig = JSON.stringify({
    origin: ORIGIN,
    agentId: world.agentId.toString(),
    payee: world.verifyConfig.payee,
    token: deployment.token,
    chainId: deployment.chainId,
    escrow: deployment.escrow,
    validator: accounts.validator.address,
    rpcUrl: process.env["RPC_URL"] ?? "http://127.0.0.1:8545",
  });

  const ports: number[] = [];
  for (let i = 0; i < processes; i++) {
    const port = basePort + i;
    ports.push(port);
    const child = spawn(
      // The tsx binary directly, not `npx tsx`: npx inserts `npm exec` -> `sh -c` ->
      // `cli.mjs` -> node, and a process-group kill through that chain is unreliable,
      // which is how the first version leaked a listening server on every failed run.
      fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url)),
      // fileURLToPath, not URL.pathname: this workspace lives under "8th Sem", and
      // pathname keeps the %20.
      [fileURLToPath(new URL("multiproc-server.ts", import.meta.url))],
      {
        env: { ...process.env, PORT: String(port), CLAIMS_DB_PATH: dbPath, SELLER_CONFIG: sellerConfig },
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group. `tsx` runs the server as a grandchild, so killing
        // only the child leaves the actual server listening — which leaked two node
        // processes per run until this was fixed.
        detached: true,
      },
    );
    child.stderr?.on("data", (c: Buffer) => process.stderr.write(`[seller ${port}] ${c.toString()}`));
    child.stdout?.on("data", (c: Buffer) => process.stderr.write(`[seller ${port}] ${c.toString()}`));
    children.push(child);
    await waitForReady(child, port);
  }

  const body = '{"text":"One. Two. Three."}';
  const job = await fundJob(world, "/v1/summarise", body);

  // Distinct signatures, as genuine retries from the payer would be, fired at once
  // across both processes.
  const headers = await Promise.all(
    Array.from({ length: total }, () => signedHeader(world, job, "/v1/summarise", body)),
  );
  const results = await Promise.all(
    headers.map((header, i) =>
      fetch(`http://127.0.0.1:${ports[i % ports.length]}/v1/summarise`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": header },
        body,
      })
        .then(async (r) => ({ status: r.status, text: await r.text() }))
        .catch((e: unknown) => ({ status: 0, text: String(e) })),
    ),
  );

  stopChildren();

  const key = `${deployment.chainId}:${deployment.escrow.toLowerCase()}:${job.jobId.toLowerCase()}`;
  const store = new ClaimStore({ path: dbPath });
  const metrics = store.metrics(key);
  store.close();

  const statuses: Record<string, number> = {};
  for (const r of results) statuses[String(r.status)] = (statuses[String(r.status)] ?? 0) + 1;
  const distinctBodies = new Set(results.filter((r) => r.status === 200).map((r) => r.text));

  process.stdout.write(
    JSON.stringify(
      {
        requests: total,
        processes,
        jobId: job.jobId,
        statuses,
        distinct_200_bodies: distinctBodies.size,
        metrics,
        pass:
          metrics.executions_completed === 1 &&
          metrics.distinct_results === 1 &&
          distinctBodies.size <= 1 &&
          Object.keys(statuses).every((s) => Number(s) < 500 && Number(s) > 0),
      },
      null,
      2,
    ) + "\n",
  );

  rmSync(dir, { recursive: true, force: true });
  process.exit(metrics.executions_completed === 1 && metrics.distinct_results === 1 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
