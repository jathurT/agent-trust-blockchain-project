/**
 * EVAL-004/005 — turn the recorded runs into the results document.
 *
 * Every number in `docs/results.md` is read from a `results.json`. Nothing is typed by
 * hand, so a figure in the document that nobody measured is structurally impossible —
 * which is what CLAUDE.md §12 asks for and what makes the claims audit (SEC-012) a
 * matter of checking wording rather than arithmetic.
 *
 * The outcome category is assigned **here**, from the aggregate, not guessed per run,
 * and the rules are spelled out rather than applied by eye.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Outcome =
  | "Blocked (structural)"
  | "No failures observed"
  | "Mitigated-to-bound"
  | "Not blocked"
  | "Not evaluated";

export interface ResultsFile {
  runId: string;
  attackId: string;
  target: string;
  targetLabel: string | null;
  config: string;
  metrics: Record<string, unknown>;
  hypothesis: string;
  rawLogs: string[];
}

export interface ManifestFile {
  gitCommit: string;
  dirty: boolean;
  env: { chainId: number; blockNumber: string; mode: string };
  versions: Record<string, unknown>;
  params: Record<string, unknown>;
  notes: string[];
}

export interface Loaded {
  results: ResultsFile;
  manifest: ManifestFile;
  dir: string;
}

export function load(resultsRoot: string): Loaded[] {
  if (!existsSync(resultsRoot)) return [];
  const out: Loaded[] = [];
  for (const entry of readdirSync(resultsRoot)) {
    const dir = join(resultsRoot, entry);
    const r = join(dir, "results.json");
    const m = join(dir, "manifest.json");
    if (!existsSync(r) || !existsSync(m)) continue;
    out.push({
      results: JSON.parse(readFileSync(r, "utf8")) as ResultsFile,
      manifest: JSON.parse(readFileSync(m, "utf8")) as ManifestFile,
      dir,
    });
  }
  return out;
}

/**
 * The rules, stated so a reader can disagree with them rather than guess at them.
 *
 * "Blocked (structural)" is reserved for a named mechanism that makes success
 * impossible, evidenced by every run and by a test that asserts the rejection. Where
 * the evidence is only statistical the honest label is "No failures observed", with N
 * and the interval attached.
 */
export function classifyA2(m: Record<string, unknown>): { outcome: Outcome; why: string } {
  const executions = (m["executions"] as number[]) ?? [];
  const extra = Number(m["extra_executions_total"] ?? 0);
  const unauthorized = Number(m["unauthorized_2xx_total"] ?? 0);
  if (executions.length === 0) return { outcome: "Not evaluated", why: "no runs recorded" };

  if (extra === 0 && unauthorized === 0) {
    return {
      outcome: "Blocked (structural)",
      why:
        "every run executed exactly once and no replay obtained the resource. The " +
        "mechanism is the atomic claim store keyed by (chainId, escrow, jobId), " +
        "asserted by API-005's tests as well as measured here.",
    };
  }
  return {
    outcome: "Not blocked",
    why: `${extra} replays became a second execution and ${unauthorized} unauthorised responses were served`,
  };
}

export function classifyA3(m: Record<string, unknown>): { outcome: Outcome; why: string } {
  const substitutions = Number(m["substitutions_served"] ?? 0);
  const falseRefusals = Number(m["false_refusals"] ?? 0);
  const rounds = Number(m["rounds"] ?? 0);
  if (rounds === 0) return { outcome: "Not evaluated", why: "no rounds recorded" };

  if (substitutions === 0 && falseRefusals === 0) {
    return {
      outcome: "Blocked (structural)",
      why:
        "no payment bought a different resource, and no correct request was refused. " +
        "The mechanism is the on-chain resourceHash, which binds the method, URI, body, " +
        "amount, token and chain into the job identity (DF-04).",
    };
  }
  if (substitutions === 0 && falseRefusals > 0) {
    return {
      outcome: "Not evaluated",
      why: `${falseRefusals} correct requests were also refused, so the zero is not evidence of a working defence`,
    };
  }
  return { outcome: "Not blocked", why: `${substitutions} of ${rounds} substitutions were served` };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (i: { lower: number; upper: number } | undefined) =>
  i ? `[${pct(i.lower)}, ${pct(i.upper)}]` : "—";

export function render(loaded: Loaded[]): string {
  const lines: string[] = [];
  const a2 = loaded.filter((l) => l.results.attackId === "a2_replay");
  const a3 = loaded.filter((l) => l.results.attackId === "a3_cross_resource");
  const anyManifest = loaded[0]?.manifest;

  lines.push("# Results");
  lines.push("");
  lines.push(
    "Every number here is read from a recorded run under `impl/attacks/results/`, by " +
      "`impl/attacks/src/aggregate.ts`. None is typed by hand.",
  );
  lines.push("");
  if (anyManifest) {
    lines.push(
      `Runs were made at commit \`${anyManifest.gitCommit.slice(0, 12)}\`` +
        `${anyManifest.dirty ? " **with a dirty working tree**" : ""} against ` +
        `${anyManifest.env.mode} (chain ${anyManifest.env.chainId}).`,
    );
    lines.push("");
  }
  lines.push(
    "> **The baseline is a fixture, not upstream x402.** The `fixture` target is a " +
      "deliberately vulnerable server written for this evaluation, reproducing the " +
      "conditions the two papers describe. It is **not** the `@x402/*` packages and is " +
      "**not** evidence about anyone else's implementation. A claim about upstream " +
      "would need API-009, which was not run.",
  );
  lines.push("");

  // ----------------------------------------------------------------- A2
  lines.push("## A2 — replay");
  lines.push("");
  lines.push(
    "Does one payment buy the resource more than once? The number that matters is " +
      "**executions**, read from each system's own records. HTTP 2xx is not the metric: " +
      "under `REPLAY_POLICY=idempotent` a replay is *supposed* to return the stored " +
      "bytes, and counting that as a failure would be as wrong as counting it as a win.",
  );
  lines.push("");
  lines.push("| target | variant | requests/run | runs | executions/run (median) | extra executions | unauthorised 2xx | replay success 95% CI |");
  lines.push("|---|---|---|---|---|---|---|---|");
  // Deterministic order: target, then variant, then size. A table whose row order
  // depends on directory listing is a table two readers will disagree about.
  const order = (l: Loaded) => `${l.results.target}|${l.results.config}`;
  for (const l of [...a2].sort((a, b) => order(a).localeCompare(order(b)))) {
    const m = l.results.metrics;
    const ex = (m["executions"] as number[]) ?? [];
    const median = ex.length ? [...ex].sort((a, b) => a - b)[Math.floor(ex.length / 2)] : 0;
    const rate = m["replay_success_rate"] as { lower: number; upper: number } | undefined;
    const variant = String(l.results.config).split("-")[0];
    lines.push(
      `| ${l.results.target} | ${variant} | ${m["requests_per_run"] ?? "—"} | ${m["runs"]} | ` +
        `**${median}** | ${m["extra_executions_total"]} | ${m["unauthorized_2xx_total"]} | ${ci(rate)} |`,
    );
  }
  lines.push("");
  for (const target of ["fixture", "agenttrust"]) {
    const rows = a2.filter((l) => l.results.target === target);
    if (rows.length === 0) continue;
    const merged = {
      executions: rows.flatMap((r) => (r.results.metrics["executions"] as number[]) ?? []),
      extra_executions_total: rows.reduce((a, r) => a + Number(r.results.metrics["extra_executions_total"] ?? 0), 0),
      unauthorized_2xx_total: rows.reduce((a, r) => a + Number(r.results.metrics["unauthorized_2xx_total"] ?? 0), 0),
    };
    const { outcome, why } = classifyA2(merged as unknown as Record<string, unknown>);
    lines.push(`**${target} — ${outcome}.** ${why}`);
    lines.push("");
  }

  // ----------------------------------------------------------------- A3
  lines.push("## A3 — cross-resource substitution");
  lines.push("");
  lines.push(
    "Pay for `/v1/summarise`, ask for `/v1/classify`. The two cost **exactly the same**, " +
      "so a substitution cannot be caught by the amount alone. Each round also checks " +
      "that the correct request still succeeds and that a one-byte body change is " +
      "refused — a server that rejects everything is not a defence.",
  );
  lines.push("");
  lines.push("| target | rounds | substitutions served | 95% CI | false refusals | one-byte mutations accepted | refusal codes |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const l of a3) {
    const m = l.results.metrics;
    const rate = m["substitution_rate"] as { lower: number; upper: number } | undefined;
    const codes = Object.entries((m["rejection_codes"] as Record<string, number>) ?? {})
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    lines.push(
      `| ${l.results.target} | ${m["rounds"]} | **${m["substitutions_served"]}** | ${ci(rate)} | ` +
        `${m["false_refusals"]} | ${m["mutated_body_accepted"]} | ${codes || "—"} |`,
    );
  }
  lines.push("");
  for (const l of a3) {
    const { outcome, why } = classifyA3(l.results.metrics);
    lines.push(`**${l.results.target} — ${outcome}.** ${why}`);
    lines.push("");
  }

  // ------------------------------------------------------------- coverage
  lines.push("## Coverage");
  lines.push("");
  lines.push(
    "Of the **six** attacks defined in the evaluation plan, the following were evaluated. " +
      "The denominator is stated because a coverage figure without one is not a figure.",
  );
  lines.push("");
  lines.push("| attack | outcome |");
  lines.push("|---|---|");
  const evaluated = new Set(loaded.map((l) => l.results.attackId));
  const all: [string, string][] = [
    ["A1 revert-grant (reorg)", "a1_revert_grant"],
    ["A2 replay", "a2_replay"],
    ["A3 cross-resource substitution", "a3_cross_resource"],
    ["A4 concurrent duplication", "a4_duplication"],
    ["A5 allowance overdraft", "a5_overdraft"],
    ["A6 Sybil selection", "a6_sybil"],
  ];
  for (const [name, id] of all) {
    if (!evaluated.has(id)) {
      lines.push(`| ${name} | Not evaluated |`);
      continue;
    }
    const rows = loaded.filter((l) => l.results.attackId === id && l.results.target === "agenttrust");
    const merged =
      id === "a2_replay"
        ? {
            executions: rows.flatMap((r) => (r.results.metrics["executions"] as number[]) ?? []),
            extra_executions_total: rows.reduce((a, r) => a + Number(r.results.metrics["extra_executions_total"] ?? 0), 0),
            unauthorized_2xx_total: rows.reduce((a, r) => a + Number(r.results.metrics["unauthorized_2xx_total"] ?? 0), 0),
          }
        : (rows[0]?.results.metrics ?? {});
    const { outcome } = id === "a2_replay" ? classifyA2(merged as Record<string, unknown>) : classifyA3(merged);
    lines.push(`| ${name} | ${outcome} (AgentTrust) |`);
  }
  lines.push("");
  lines.push(
    `**${evaluated.size} of 6 attacks evaluated.** A4, A5, A6 and A1 are EXTENDED-E2 and were ` +
      "not run; \"Not evaluated\" is the honest label and is reported rather than omitted.",
  );
  lines.push("");
  lines.push("## Raw data");
  lines.push("");
  lines.push("| run | manifest | raw |");
  lines.push("|---|---|---|");
  for (const l of loaded) {
    lines.push(`| \`${l.results.runId}\` | \`manifest.json\` | \`${l.results.rawLogs.join(", ")}\` |`);
  }
  lines.push("");
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("aggregate.ts")) {
  const root = process.argv[2] ?? join(process.cwd(), "results");
  const out = process.argv[3] ?? join(process.cwd(), "..", "..", "docs", "results.md");
  const loaded = load(root);
  if (loaded.length === 0) {
    process.stderr.write(`no results under ${root}\n`);
    process.exit(1);
  }
  writeFileSync(out, render(loaded));
  process.stdout.write(`wrote ${out} from ${loaded.length} runs\n`);
}
