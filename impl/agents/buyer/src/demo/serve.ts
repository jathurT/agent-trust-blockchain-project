/**
 * AGENT-006 — the AgentTrust target, running long enough to film (blueprint §18,
 * `npm run target:agenttrust`).
 *
 * This is the full stack, not the harness's cut-down one: the escrow and the ERC-8004
 * mocks on Anvil, the Express seller with its claim store, and the **Python** validator
 * in its own process. The attack harness deliberately runs without the validator,
 * because A2 and A3 are decided before settlement and the round trip only adds
 * transactions; the demo needs it, because the last thing on screen is a release.
 *
 * The counter line is what the video crops to. `executions` is how many times the work
 * was actually done, read from the seller's claim store; `2xx` is how many callers got
 * bytes. On the fixture those two diverge under replay. Here they must not, and showing
 * them side by side is the entire point of the shot.
 */
import { pathToFileURL } from "node:url";
import { startStack, type Stack } from "../e2e/harness.js";
import { ClaimStore } from "@agenttrust/seller/src/claims.js";

export interface ServeArgs {
  sellerPort: number;
  validatorPort: number;
}

export function parseServeArgs(argv: string[]): ServeArgs {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1]!;
  };
  return {
    sellerPort: Number(get("port", "4022")),
    validatorPort: Number(get("validator-port", "8099")),
  };
}

/** Fixed width, so the number column does not jitter while it is being filmed. */
export function counterLine(executions: number, http2xx: number, replays: number): string {
  const pad = (n: number) => String(n).padStart(3, " ");
  return `  AGENTTRUST   executions: ${pad(executions)}  |  2xx: ${pad(http2xx)}  |  replays served: ${pad(replays)}`;
}

async function main(): Promise<void> {
  const args = parseServeArgs(process.argv.slice(2));

  console.log("starting the AgentTrust stack (escrow + seller + Python validator)...");
  const stack: Stack = await startStack({
    sellerPort: args.sellerPort,
    validatorPort: args.validatorPort,
  });

  console.log("");
  console.log(`seller     ${stack.sellerOrigin}   agent ${stack.agentId}   payee ${stack.payee}`);
  console.log(`validator  ${stack.validatorUrl}`);
  console.log("");
  console.log(`  buy with:  npm run buy -- --resource /v1/summarise --amount 250000`);
  console.log("");

  // The seller's store, opened read-only from this process rather than reaching into
  // the one the server holds. SQLite in WAL mode allows the concurrent reader, which
  // is the property ENV-002 measured on this filesystem.
  const reader = new ClaimStore({ path: stack.claims.path });

  let previous = "";
  const timer = setInterval(() => {
    const t = reader.totals();
    const line = counterLine(t.executions_completed, t.http_2xx, t.replays_served);
    if (line !== previous) {
      previous = line;
      console.log(line);
    }
  }, 500);

  const shutdown = async () => {
    clearInterval(timer);
    reader.close();
    await stack.stop();
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
