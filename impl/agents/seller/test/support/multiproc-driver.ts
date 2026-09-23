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

async function waitForReady(child: ChildProcess, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process on ${port} never became ready`)), 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(`ready:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`process on ${port} exited with ${code}`));
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
