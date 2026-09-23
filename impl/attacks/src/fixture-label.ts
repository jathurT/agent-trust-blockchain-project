/**
 * The label that must travel with every artefact this fixture produces.
 *
 * CLAUDE.md §12: a deliberately vulnerable fixture is always described as such, and is
 * never presented as "vanilla x402" or as upstream behaviour. Claims about upstream
 * need a run against a pinned upstream version, which is API-009 and is EXTENDED.
 *
 * This constant is the single source of that wording, so the code, the logs, the CLI
 * help and `results.json` cannot drift apart — and SEC-012's claims audit has one
 * string to check.
 */
export const FIXTURE_LABEL =
  "DELIBERATELY VULNERABLE FIXTURE — reproduces the conditions described in " +
  "arXiv 2605.11781 §4.3 (replay without idempotency) and arXiv 2605.30998 §4.1 " +
  "(cross-resource substitution). This is NOT upstream x402, NOT the @x402/* packages, " +
  "and NOT evidence about anyone else's implementation. It exists only as a control " +
  "target for AgentTrust's own evaluation, on a local testnet, against itself.";

export const FIXTURE_ID = "vulnerable-fixture-v1";

/**
 * The header form: plain ASCII and short. The full label contains an em dash, which is
 * not a legal character in an HTTP header value — Node rejects it outright, which is
 * how this was found. The long text still travels in every JSON body and log line.
 */
export const FIXTURE_HEADER = "deliberately-vulnerable-fixture; not-upstream-x402; see-body-for-detail";

/** Every log line and every result record carries this. */
export const fixtureBanner = () => ({
  fixture: FIXTURE_ID,
  label: FIXTURE_LABEL,
  isVulnerableByDesign: true,
  isUpstreamX402: false,
});
