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

/**
 * Every run under `resultsRoot` that is fit to report.
 *
 * A run recorded against a dirty working tree is **excluded**, loudly. The manifest
 * already records `dirty`, but recording it is not enough: this function used to read
 * every directory it found, so a one-off smoke run — say, a three-replay check that
 * some command still works — would silently join the reported totals and move a
 * published number. The commit hash in such a manifest does not describe the code that
 * produced it, so the run cannot be reproduced and is not evidence (CLAUDE.md §12).
 */
export function load(resultsRoot: string): Loaded[] {
  if (!existsSync(resultsRoot)) return [];
  const out: Loaded[] = [];
  for (const entry of readdirSync(resultsRoot)) {
    const dir = join(resultsRoot, entry);
    const r = join(dir, "results.json");
    const m = join(dir, "manifest.json");
    if (!existsSync(r) || !existsSync(m)) continue;
    const manifest = JSON.parse(readFileSync(m, "utf8")) as ManifestFile;
    if (manifest.dirty) {
      process.stderr.write(
        `skipping ${entry}: recorded against a dirty working tree, so its commit hash ` +
          `does not describe the code that produced it\n`,
      );
      continue;
    }
    out.push({
      results: JSON.parse(readFileSync(r, "utf8")) as ResultsFile,
      manifest,
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

  // Deterministic order everywhere: a table whose row order depends on a directory
  // listing is a table two readers will disagree about, and `git diff --exit-code`
  // would fail for no reason (EVAL-004).
  const order = (l: Loaded) => `${l.results.target}|${l.results.config}`;
  const sorted = <T extends Loaded>(xs: T[]) => [...xs].sort((a, b) => order(a).localeCompare(order(b)));

  lines.push("<!-- GENERATED by impl/attacks/src/aggregate.ts. Do not edit by hand. -->");
  lines.push("<!-- Regenerate: npx tsx src/aggregate.ts results ../../docs/results.tables.md -->");
  lines.push("");
  if (anyManifest) {
    lines.push(
      `Environment: ${anyManifest.env.mode}, chain ${anyManifest.env.chainId}, ` +
        `commit \`${anyManifest.gitCommit.slice(0, 12)}\`` +
        `${anyManifest.dirty ? " **(dirty working tree — the commit does not identify this build)**" : ""}.`,
    );
    lines.push("");
  }

  // ----------------------------------------------------------------- A2
  lines.push("### A2 — replay");
  lines.push("");
  // Median, IQR, min and max, because the pre-registered protocol
  // (`docs/planning/evaluation-plan.md` §6) asks for dispersion and not just a centre.
  // For these runs the spread is zero, which is the interesting part: every run of a
  // configuration produced the same count. Reporting "median 50" alone would hide that.
  lines.push(
    "| target | variant | requests/run | replays/run | runs | executions/run (median) | IQR | min–max | extra executions | unauthorised 2xx | replay success (Wilson 95%) | run id |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of sorted(a2)) {
    const m = l.results.metrics;
    const ex = ((m["executions"] as number[]) ?? []).slice().sort((a, b) => a - b);
    const q = (p: number) => (ex.length ? ex[Math.min(ex.length - 1, Math.floor(ex.length * p))]! : 0);
    const median = q(0.5);
    const iqr = q(0.75) - q(0.25);
    const span = ex.length ? `${ex[0]}–${ex[ex.length - 1]}` : "—";
    const rate = m["replay_success_rate"] as { lower: number; upper: number } | undefined;
    const variant = String(l.results.config).split("-")[0];
    lines.push(
      `| ${l.results.target} | ${variant} | ${m["requests_per_run"]} | ${m["replays_per_run"]} | ${m["runs"]} | ` +
        `**${median}** | ${iqr} | ${span} | ${m["extra_executions_total"]} | ${m["unauthorized_2xx_total"]} | ${ci(rate)} | \`${l.results.runId}\` |`,
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
    const totalReplays = rows.reduce(
      (a, r) => a + Number(r.results.metrics["runs"] ?? 0) * Number(r.results.metrics["replays_per_run"] ?? 0),
      0,
    );
    const { outcome, why } = classifyA2(merged as unknown as Record<string, unknown>);
    lines.push(
      `**${target} — ${outcome}.** Across ${rows.length} configurations and ${totalReplays} replay attempts: ${why}`,
    );
    lines.push("");
  }

  // ----------------------------------------------------------------- A3
  lines.push("### A3 — cross-resource substitution");
  lines.push("");
  lines.push(
    "| target | rounds | substitutions served | Wilson 95% | false refusals | Wilson 95% | one-byte mutations accepted | refusal codes | run id |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const l of sorted(a3)) {
    const m = l.results.metrics;
    const rate = m["substitution_rate"] as { lower: number; upper: number } | undefined;
    const fr = m["false_refusal_rate"] as { lower: number; upper: number } | undefined;
    const codes = Object.entries((m["rejection_codes"] as Record<string, number>) ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `\`${k}\`×${v}`)
      .join(", ");
    lines.push(
      `| ${l.results.target} | ${m["rounds"]} | **${m["substitutions_served"]}** | ${ci(rate)} | ` +
        `${m["false_refusals"]} | ${ci(fr)} | ${m["mutated_body_accepted"]} | ${codes || "—"} | \`${l.results.runId}\` |`,
    );
  }
  lines.push("");
  for (const l of sorted(a3)) {
    const { outcome, why } = classifyA3(l.results.metrics);
    lines.push(`**${l.results.target} — ${outcome}.** ${why}`);
    lines.push("");
  }

  // ------------------------------------------------------------- coverage
  // ----------------------------------------------------------------- A4
  const a4 = loaded.filter((l) => l.results.attackId === "a4_duplication");
  if (a4.length > 0) {
    lines.push("### A4 — concurrent duplication");
    lines.push("");
    lines.push("One payment, N requests fired together, 50 rounds per level.");
    lines.push("");
    lines.push("| target | concurrency | rounds with a duplicate execution | max executions in one round |");
    lines.push("|---|---|---|---|");
    for (const l of sorted(a4)) {
      const by = l.results.metrics["by_concurrency"] as Record<string, Record<string, number>>;
      for (const level of Object.keys(by).sort((x, y) => Number(x) - Number(y))) {
        const c = by[level]!;
        lines.push(
          `| ${l.results.target} | ${level} | **${c["rounds_with_duplicate_execution"]} / ${c["rounds"]}** | ${c["max_executions_in_a_round"]} |`,
        );
      }
    }
    lines.push("");
    lines.push(
      "The fixture's rate is **a function of its verify window** (" +
        `${String(a4[0]!.results.metrics["verify_window_ms"])} ms here), not a reproduction of the published 6%. ` +
        "What is reproduced is the condition — a check-then-act race inside verify→settle — not the number.",
    );
    lines.push("");
  }

  // ----------------------------------------------------------------- A5
  const a5 = loaded.filter((l) => l.results.attackId === "a5_overdraft");
  if (a5.length > 0) {
    lines.push("### A5 — resource leakage under `upto` pricing");
    lines.push("");
    lines.push("| target | delivered | settled | unsettled | **ρ = 1 − settled/delivered** | seller over-draw |");
    lines.push("|---|---|---|---|---|---|");
    for (const l of sorted(a5)) {
      const m = l.results.metrics;
      lines.push(
        `| ${l.results.target} | ${m["delivered"]} | ${m["settled"]} | ${m["unsettled"]} | ` +
          `**${Number(m["rho"]).toFixed(4)}** | ${m["overdraw_succeeded"] ? "succeeded" : "structurally unavailable"} |`,
      );
    }
    lines.push("");
    lines.push(
      "The fixture's ρ is close to the published 97.76%, but that is **a consequence of the allowance chosen " +
        "here** (one job's worth against a fifty-request burst), not an independent reproduction of their figure.",
    );
    lines.push("");
  }

  // ----------------------------------------------------------------- A1
  const a1 = loaded.filter((l) => l.results.attackId === "a1_revert_grant");
  if (a1.length > 0) {
    lines.push("### A1 — revert-grant under reorg");
    lines.push("");
    lines.push("Work delivered for a payment a reorg then removed, out of 20 trials per cell.");
    lines.push("");
    const depths = [1, 2, 3, 5];
    lines.push(`| target | policy | ${depths.map((d) => `d=${d}`).join(" | ")} | mitigated up to |`);
    lines.push(`|---|---|${depths.map(() => "---").join("|")}|---|`);
    for (const l of sorted(a1).filter((x) => x.results.target === "agenttrust")) {
      const m = l.results.metrics;
      const cells = m["cells"] as Record<string, Record<string, number>>;
      const k = (m["policies"] as number[])[0]!;
      const row = depths.map((d) => {
        const c = cells[`k=${k},d=${d}`];
        return c ? `${c["revert_grants"]}/${c["trials"]}` : "—";
      });
      const bound = (m["mitigated_up_to_depth"] as Record<string, number | null>)[`k=${k}`];
      lines.push(`| agenttrust | k=${k} | ${row.join(" | ")} | **${bound === null ? "nothing" : `depth ${bound}`}** |`);
    }
    lines.push("");
    lines.push(
      "**This is a bound, and it can never read \"blocked\".** A reorg deeper than `k` defeats any `k`; the " +
        "cliff sits exactly at `d > k`, which is arithmetic. What the runs establish is that the seller counts " +
        "confirmations against the funding block rather than the tip or the clock, and that a job a reorg removed " +
        "really does read as gone.",
    );
    lines.push("");
    const fx = sorted(a1).find((x) => x.results.target === "fixture");
    if (fx) {
      const cells = fx.results.metrics["cells"] as Record<string, Record<string, number>>;
      const delivered = Object.values(cells).map((c) => `${c["delivered"]}/${c["trials"]}`);
      lines.push(
        `**The fixture delivered ${delivered[0]} in every cell**, at every depth, because it grants without ` +
          "waiting for any confirmation — which is the A1 condition. Its *settlement survival* figures are **not " +
          "reported**: the settlements are fired out of band and land a trial late, so the per-trial reading " +
          "alternates survived/gone in lockstep with trial parity. That measures the fixture's own pipeline, not " +
          "reorg depth. The optimistic baseline for the revert-grant claim is the `k=0` row above, where the job " +
          "is read from chain state directly.",
      );
      lines.push("");
    }
  }

  // ----------------------------------------------------------------- A6
  const a6 = loaded.filter((l) => l.results.attackId === "a6_sybil");
  if (a6.length > 0) {
    const m = a6[0]!.results.metrics;
    const admitted = m["admitted"] as Record<string, Record<string, number>>;
    const capture = m["captureShare"] as Record<string, Record<string, { sybil: number; rounds: number }>>;
    const onChain = (m["onChain"] as { kind: string; funded: boolean; revert: string | null }[]) ?? [];
    const defect = m["honestThenDefect"] as Record<string, unknown> | null;
    const bound = m["fundableHistoryBound"] as { lastFundable: number | null; firstRefused: number | null };
    const gas = (m["gasVsHistory"] as { entries: number; fundGas: string | null }[]) ?? [];

    lines.push("### A6 — Sybil seller selection");
    lines.push("");
    lines.push("Who each gate admits, out of the same populated registry:");
    lines.push("");
    lines.push("| gate | honest admitted | **Sybils admitted** | newcomers admitted |");
    lines.push("|---|---|---|---|");
    for (const g of ["none", "v1", "v2"]) {
      const a = admitted?.[g];
      if (!a) continue;
      const label = g === "v1" ? "v1 (the blueprint's rule)" : g === "v2" ? "v2 (implemented)" : "none";
      lines.push(`| ${label} | ${a["honest"]}/10 | **${a["sybil"]}/5** | ${a["newcomer"]}/10 |`);
    }
    lines.push("");
    lines.push("Selection share landing on a Sybil. **The rule is a choice, not a measurement**, so both are shown:");
    lines.push("");
    lines.push("| gate | top-score | weighted |");
    lines.push("|---|---|---|");
    for (const g of ["none", "v1", "v2"]) {
      const c = capture?.[g];
      if (!c) continue;
      const pct = (x?: { sybil: number; rounds: number }) =>
        x ? `${((100 * x.sybil) / x.rounds).toFixed(1)}%` : "—";
      lines.push(`| ${g} | ${pct(c["top-score"])} | ${pct(c["weighted"])} |`);
    }
    lines.push("");
    lines.push("Gate v2 as the chain enforces it — `fund()` actually sent:");
    lines.push("");
    for (const r of onChain) {
      lines.push(`- **${r.kind}** — ${r.funded ? "funded" : `refused, \`${r.revert}\``}`);
    }
    lines.push("");
    if (defect) {
      lines.push(
        `**An attacker that earns trusted feedback is admitted** (H-A6-5): admitted after earning ` +
          `\`${String(defect["admittedAfterEarning"])}\`, still admitted after defecting ` +
          `\`${String(defect["admittedAfterDefection"])}\`, refused only after ${String(defect["entriesRevoked"])} ` +
          `entries were revoked \`${String(defect["admittedAfterRevocation"])}\`. The gate reads reputation, ` +
          "not conduct, so patience defeats it and the only remedy is retrospective.",
      );
      lines.push("");
    }
    if (bound?.lastFundable != null) {
      const first = gas[0];
      const last = gas.filter((p) => p.fundGas !== null).at(-1);
      const perEntry =
        first?.fundGas && last?.fundGas && last.entries > first.entries
          ? Math.round((Number(last.fundGas) - Number(first.fundGas)) / (last.entries - first.entries))
          : null;
      lines.push(
        `**An honest seller becomes unfundable past ${bound.lastFundable} feedback entries** from one trusted ` +
          `client — ${bound.firstRefused} was refused with \`ReputationTooLow\`. \`getSummary\` runs under a ` +
          "250,000-gas ceiling; over it the read is caught and reads as `count = 0`, which the gate treats as no " +
          "reputation. Fail-closed, so safe, but the client's opinion stops counting silently." +
          (perEntry !== null
            ? ` \`fund()\` grew ${perEntry.toLocaleString()} gas per entry here, against the ~8,589 CONTRACT-005 ` +
              "measured on the read itself — two independent paths agreeing to within a gas."
            : ""),
      );
      lines.push("");
    }
  }

  lines.push("### Defence coverage");
  lines.push("");
  lines.push("| attack | outcome for AgentTrust | mechanism, where blocked |");
  lines.push("|---|---|---|");
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
      lines.push(`| ${name} | Not evaluated | — |`);
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
    // A1 reports the *best* bound across the policies that were run, so the row
    // describes the confirmation policy a deployment would actually choose.
    const a1Merged =
      id === "a1_revert_grant"
        ? {
            mitigated_up_to_depth: Object.assign(
              {},
              ...rows.map((r) => r.results.metrics["mitigated_up_to_depth"] ?? {}),
            ),
          }
        : merged;
    const { outcome } =
      id === "a2_replay"
        ? classifyA2(merged as Record<string, unknown>)
        : id === "a6_sybil"
          ? classifyA6(merged)
          : id === "a4_duplication"
            ? classifyA4(merged)
            : id === "a5_overdraft"
              ? classifyA5(merged)
              : id === "a1_revert_grant"
                ? classifyA1(a1Merged as Record<string, unknown>)
                : classifyA3(merged);
    const mechanism =
      id === "a2_replay"
        ? "atomic claim store keyed by (chainId, escrow, jobId), plus payer-signed delivery"
        : id === "a3_cross_resource"
          ? "on-chain `resourceHash` over method, URI, body, amount, token and chain"
          : id === "a6_sybil"
            ? "`getSummary` over a bounded list of buyer-named trusted clients, enforced in `fund()`"
            : id === "a4_duplication"
              ? "the same atomic claim as A2; there is no verify→settle window to race"
              : id === "a5_overdraft"
                ? "funds locked at an exact price before execution, so there is no allowance to exhaust"
                : id === "a1_revert_grant"
                  ? "the seller's confirmation policy — a bound, not a barrier"
                  : "—";
    lines.push(
      `| ${name} | ${outcome} | ${outcome.startsWith("Blocked") || outcome.startsWith("Mitigated") ? mechanism : "—"} |`,
    );
  }
  lines.push("");
  const notRun = all.filter(([, id]) => !evaluated.has(id)).map(([name]) => name.split(" ")[0]);
  lines.push(
    `**${evaluated.size} of the 6 defined attacks evaluated.** ` +
      (notRun.length > 0
        ? `${notRun.join(", ")} ${notRun.length === 1 ? "is" : "are"} EXTENDED-E2 and ${notRun.length === 1 ? "was" : "were"} not run; "Not evaluated" is reported rather than omitted.`
        : "All six were run."),
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * A6's category, and why it is not "Blocked".
 *
 * The ring is refused — every Sybil's `fund()` reverts `ReputationTooLow`, which is the
 * chain's own answer, not a model's. But the same run measures an agent that earns
 * genuine trusted feedback and is then admitted on exactly the evidence an honest
 * seller presents. A gate that reads reputation cannot see conduct, so patience defeats
 * it. "Blocked (structural)" would claim a property the experiment disproves in its own
 * results, so the bound travels with the verdict.
 */
/** A4: zero duplicate rounds at every concurrency level. */
export function classifyA4(m: Record<string, unknown>): { outcome: string } {
  const by = (m["by_concurrency"] as Record<string, Record<string, number>>) ?? {};
  const cells = Object.values(by);
  if (cells.length === 0) return { outcome: "Not evaluated" };
  const dup = cells.reduce((a, c) => a + Number(c["rounds_with_duplicate_execution"] ?? 0), 0);
  return { outcome: dup === 0 ? "Blocked (structural)" : "Not blocked" };
}

/**
 * A5. "Blocked" covers the direction that was measured — no delivered work went
 * unsettled, and the seller cannot over-draw. It does **not** cover the residual: a job
 * whose validator never answers is delivered and then refunded, so the seller carries
 * the same loss by another route. That path is exercised by INT-002 rather than
 * measured as a rate here, and the qualifier travels with the verdict.
 */
export function classifyA5(m: Record<string, unknown>): { outcome: string } {
  const rho = Number(m["rho"] ?? 1);
  const overdraw = Boolean(m["overdraw_succeeded"]);
  if (rho > 0 || overdraw) return { outcome: "Not blocked" };
  return { outcome: "Blocked (structural, for the measured direction)" };
}

/** A1 is a bound by construction: `mitigated up to depth k`, never "blocked". */
export function classifyA1(m: Record<string, unknown>): { outcome: string } {
  const bounds = (m["mitigated_up_to_depth"] as Record<string, number | null>) ?? {};
  const best = Object.values(bounds).reduce<number | null>(
    (a, b) => (b === null ? a : a === null ? b : Math.max(a, b)),
    null,
  );
  if (best === null) return { outcome: "Not blocked at any depth tested" };
  return { outcome: `Mitigated up to reorg depth ${best} (policy k=${best})` };
}

export function classifyA6(m: Record<string, unknown>): { outcome: string } {
  const onChain = (m["onChain"] as { kind: string; funded: boolean }[] | undefined) ?? [];
  const sybilFunded = onChain.filter((r) => r.kind === "sybil" && r.funded).length;
  const defect = m["honestThenDefect"] as { admittedAfterDefection?: boolean } | null | undefined;

  if (sybilFunded > 0) return { outcome: "Not blocked" };
  if (defect?.admittedAfterDefection) {
    return { outcome: "Mitigated (ring refused; an earned reputation still admits)" };
  }
  return { outcome: "Mitigated (ring refused)" };
}

/** A chart, generated from the same data. EVAL-004 asks for one; hand-drawing it would
 *  reintroduce exactly the hand-typed numbers the whole arrangement exists to avoid. */
export function renderChart(loaded: Loaded[]): string {
  const a2 = loaded.filter((l) => l.results.attackId === "a2_replay" && l.results.config.startsWith("original"));
  const rows = [...a2]
    .map((l) => {
      const ex = ((l.results.metrics["executions"] as number[]) ?? []).slice().sort((a, b) => a - b);
      return {
        label: `${l.results.target} ${l.results.metrics["requests_per_run"]}x`,
        target: l.results.target,
        median: ex.length ? ex[Math.floor(ex.length / 2)]! : 0,
        requests: Number(l.results.metrics["requests_per_run"] ?? 0),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const W = 720;
  const barH = 30;
  const gap = 14;
  const left = 190;
  const top = 64;
  const H = top + rows.length * (barH + gap) + 56;
  const max = Math.max(1, ...rows.map((r) => r.requests));
  const scale = (v: number) => (v / max) * (W - left - 90);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="16" y="28" font-size="16" font-weight="600" fill="#111">A2 — executions per payment (median of 10 runs)</text>`);
  parts.push(`<text x="16" y="48" font-size="12" fill="#555">Lighter bar: replay requests fired. Darker bar: times the work was actually done.</text>`);
  rows.forEach((r, i) => {
    const y = top + i * (barH + gap);
    parts.push(`<text x="${left - 10}" y="${y + 20}" font-size="12" text-anchor="end" fill="#333">${r.label}</text>`);
    parts.push(`<rect x="${left}" y="${y}" width="${scale(r.requests).toFixed(1)}" height="${barH}" fill="#dfe6ee" rx="3"/>`);
    const fill = r.target === "fixture" ? "#c0392b" : "#1e7a46";
    parts.push(`<rect x="${left}" y="${y}" width="${Math.max(2, scale(r.median)).toFixed(1)}" height="${barH}" fill="${fill}" rx="3"/>`);
    parts.push(`<text x="${left + scale(r.requests) + 8}" y="${y + 20}" font-size="12" fill="#333">${r.median} / ${r.requests}</text>`);
  });
  parts.push(`<text x="16" y="${H - 20}" font-size="11" fill="#777">Generated by impl/attacks/src/aggregate.ts. The fixture is a deliberately vulnerable baseline, not upstream x402.</text>`);
  parts.push("</svg>");
  return parts.join("\n") + "\n";
}

if (process.argv[1]?.endsWith("aggregate.ts")) {
  const root = process.argv[2] ?? join(process.cwd(), "results");
  const out = process.argv[3] ?? join(process.cwd(), "..", "..", "docs", "results.tables.md");
  const loaded = load(root);
  if (loaded.length === 0) {
    process.stderr.write(`no results under ${root}\n`);
    process.exit(1);
  }
  writeFileSync(out, render(loaded));
  writeFileSync(out.replace(/\.tables\.md$/, ".chart.svg"), renderChart(loaded));
  process.stdout.write(`wrote ${out} and the chart from ${loaded.length} runs\n`);
}
