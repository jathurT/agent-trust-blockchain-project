/**
 * AGENT-006 — the demo's baseline target, running long enough to film.
 *
 *   npx tsx src/serve.ts --port 4021
 *
 * Blueprint §18 calls this terminal "vanilla control" and the npm script
 * `target:vanilla`. The script name is kept so the documented commands run, but the
 * word is wrong and this file refuses to let it stand: what starts here is a
 * deliberately vulnerable fixture written for this project, not upstream x402 and not
 * anybody else's code (CLAUDE.md §12). The banner says so on every start, the
 * correction is printed whenever the `vanilla` spelling is used, and the counters
 * carry the fixture id.
 *
 * The counter line is the thing the video crops to. It is redrawn whenever a number
 * changes, and both numbers come from the fixture's own grant and settlement records.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFixture, type Deployment, type Target } from "./targets.js";
import { FIXTURE_ID, FIXTURE_LABEL, VANILLA_CORRECTION } from "./fixture-label.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

export interface ServeArgs {
  port: number;
  rpc: string;
  /** True when the caller spelled it `vanilla`, which earns a printed correction. */
  correctedFromVanilla: boolean;
}

export function parseServeArgs(argv: string[]): ServeArgs {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1]!;
  };
  const name = get("target", "fixture");
  if (name !== "fixture" && name !== "vanilla") {
    throw new Error(`unknown target: ${name} (this server only starts the fixture)`);
  }
  return {
    port: Number(get("port", "4021")),
    rpc: get("rpc", process.env["RPC_URL"] ?? "http://127.0.0.1:8545"),
    correctedFromVanilla: name === "vanilla",
  };
}

/** One line, fixed width, so it does not jitter while it is being filmed. */
export function counterLine(label: string, grants: number, settlements: number): string {
  const pad = (n: number) => String(n).padStart(3, " ");
  return `  ${label.padEnd(12)} grants: ${pad(grants)}  |  settlements: ${pad(settlements)}`;
}

async function main(): Promise<void> {
  const args = parseServeArgs(process.argv.slice(2));
  const deployment = JSON.parse(
    readFileSync(join(ROOT, "deployments", "31337.json"), "utf8"),
  ) as Deployment;

  if (args.correctedFromVanilla) console.log(`\n${VANILLA_CORRECTION}\n`);
  console.log(FIXTURE_LABEL);
  console.log("");

  const target: Target = await startFixture({ rpc: args.rpc, deployment, port: args.port });
  console.log(`${FIXTURE_ID} listening on ${target.origin}  (chain ${deployment.chainId})`);
  console.log("");

  let previous = "";
  const tick = async () => {
    const t = await target.totals();
    const line = counterLine("FIXTURE", t.executions_completed, t.settlements);
    if (line !== previous) {
      previous = line;
      console.log(line);
    }
  };
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, 500);

  const shutdown = async () => {
    clearInterval(timer);
    await target.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// `file://${process.argv[1]}` does not round-trip: this repository lives under
// "8th Sem", and `import.meta.url` percent-encodes the space while the argv path does
// not, so the string compare silently failed and the server started, printed nothing
// and served nothing. `pathToFileURL` is the encoding-correct form.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
