/**
 * API-001 — the seller entry point.
 *
 * Refuses to start rather than starting wrong: configuration problems are reported all
 * at once (ENV-005), the chain id is checked against the node, and the payment gate is
 * required unless `ALLOW_UNGATED=1` is set explicitly. An ungated seller gives away the
 * resource, so it must never be reachable by omission.
 */
import { createChainClient, loadConfig, SELLER_SPEC } from "@agenttrust/core";
import { createApp } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(SELLER_SPEC);
  const chain = createChainClient({
    rpcUrl: config.RPC_URL,
    chainId: Number(config.CHAIN_ID),
    escrow: config.ESCROW_ADDRESS as `0x${string}`,
  });
  await chain.verifyChainId();

  const ungated = process.env["ALLOW_UNGATED"] === "1";
  if (ungated) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "starting WITHOUT a payment gate: every paid route serves anyone who asks. " +
          "Only for handler tests and the labelled vulnerable fixture (API-008).",
      }),
    );
  }

  const app = createApp({
    origin: config.SELLER_ORIGIN,
    agentId: config.SELLER_AGENT_ID,
    gated: !ungated,
    // API-002..005 install the real gate here. Until then, `gated: true` throws.
    paymentGate: undefined,
  });

  const port = Number(process.env["PORT"] ?? 8402);
  app.listen(port, () => {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "seller listening",
        port,
        origin: config.SELLER_ORIGIN,
        chainId: Number(config.CHAIN_ID),
        escrow: config.ESCROW_ADDRESS,
        gated: !ungated,
      }),
    );
  });
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "fatal", msg: (error as Error)?.message ?? String(error) }));
  process.exitCode = 1;
});
