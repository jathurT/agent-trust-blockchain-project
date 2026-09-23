# Skills Inventory — AgentTrust (Claude Code, project scope)

**Status:** PLAN-003 complete on 2026-09-22. Everything below was installed or vendored in this planning session, and each item was inspected before installation. Nothing else was installed: no toolchains, packages, LSP binaries or setup scripts.
**Environment:** Claude Code 2.1.278 on WSL2 Linux. Workspace `/mnt/d/8th Sem/Blockchain_Project` (not yet a git repo).
**Facts cited:** V-120 to V-124 in `verification-log.md`.

---

## 1. Installed plugins (project scope)

Each plugin was installed with `claude plugin install <id> --scope project`. The exit code was 0 in every case, and each one shows `scope: project, enabled` in `claude plugin list --json`. Hooks = 0 and LSP servers = 0 for all six. `-y`/`--accept-command` was never used, and no install asked to run a command.

| Plugin | Source @ SHA / version | Licence | Adds | Always-on context cost* | Purpose | Main tasks |
|---|---|---|---|---|---|---|
| `building-secure-contracts@trailofbits` | trailofbits/skills @ `32e34f8173796e3566a51aee877dc96bc5191f64` (2026-09-21), plugin 1.2.2 | CC-BY-SA-4.0 | 11 skills. 5 are EVM-relevant: secure-workflow-guide, token-integration-analyzer, guidelines-advisor, audit-prep-assistant, code-maturity-assessor. 6 target other chains and are irrelevant here | ~1,660 tokens | Smart-contract security workflow; token-integration review (USDC/EIP-3009 semantics) | CONTRACT-002/004/007/008/010, CONTRACT-016, SEC-010 |
| `entry-point-analyzer@trailofbits` | same marketplace/SHA, 1.0.4 | CC-BY-SA-4.0 | 2 skills | ~224 | Enumerates every state-changing entry point and its access control | CONTRACT-010, CONTRACT-016, SEC-010 |
| `spec-to-code-compliance@trailofbits` | same, 2.0.2 | CC-BY-SA-4.0 | 1 skill + agent `spec-compliance-checker` | ~190 | Checks code against a written spec: ERC-8004 ABI conformance of the mocks, and SPEC-001/002/003 vs the implementation | REG-008, CONTRACT-011, API-003, VAL-003 |
| `differential-review@trailofbits` | same, 1.1.4 | CC-BY-SA-4.0 | 2 skills + agent `adversarial-modeler` | ~258 | Security-focused review of diffs before a task is marked DONE | every CONTRACT-* and payment-path API-* task; SEC-010 |
| `solidity@solskill` | Cyfrin/solskill @ `d17bda028df073c61711a1fe156b5ca5dea91642` (2026-06-18); loads only `skills/solidity` | AGPL-3.0 | 1 skill, **user-invoked only** | ~73 | Solidity standards; Foundry test patterns incl. fuzz and invariant; `forge script` with a keystore; slither/aderyn usage | CONTRACT-001…018, DEPLOY-001 |
| `context7@claude-plugins-official` | official marketplace @ `c447c32` | vendor-hosted service | 1 **remote** MCP server: `https://mcp.context7.com/mcp?client=claude-code-plugin`. An optional `CONTEXT7_API_KEY` header is currently empty, so it runs anonymously | ~0 | Version-specific docs: Foundry book, OpenZeppelin, viem, wagmi, x402-foundation/x402, langgraphjs, erc-8004-contracts | ENV-001, REG-001, AGENT-001, API-*, VAL-*, DASH-001, AGENT-005 |

\* As reported by `claude plugin details`.

**Where things live:**
- `.claude/settings.json` holds `enabledPlugins` (all six) and `extraKnownMarketplaces` (`trailofbits` → github `trailofbits/skills`; `solskill` → github `Cyfrin/solskill`).
- Marketplace clones sit in `~/.claude/plugins/marketplaces/` and plugin caches in `~/.claude/plugins/cache/`. Both are user-level caches; that is how the plugin system works.

**Side effects recorded:**
- Installing context7 refreshed the official marketplace catalog cache (its `lastUpdated` changed). The context7 version still matches the inspected commit `c447c32`.
- Before installation, `claude plugin details <id>` returns "not found". The pre-install inspection therefore used `claude --plugin-dir <marketplace clone>/plugins/<name> plugin details <name>`. Cyfrin `solidity` has no plugin manifest, so its files were inspected directly and `details` was run after install.

**Auto-update.** No `autoUpdate` keys exist in the user settings, project settings or `known_marketplaces.json`. The Claude Code docs say third-party marketplaces default to no auto-update, but this **couldn't be confirmed from local files**. Policy:
- Do not update these marketplaces or plugins during the project.
- Before any update, re-inspect the diff and record the new SHA here.

---

## 2. Vendored skills (superpowers subset, no hook)

- **Source:** `obra/superpowers` @ `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (v6.3.0, MIT).
- **User decision:** vendor a subset **without** the plugin's SessionStart hook, which would otherwise inject "using-superpowers" rules into every session.
- **Method:** every file was fetched with `gh api …/contents/…?ref=<sha>` and written to `.claude/skills/<name>/`. The repo-root `LICENSE` was copied into each directory.
- **Integrity:** 27 files (20 skill files + 7 `LICENSE`) were checked with `git hash-object`. All match their upstream blob SHAs, 0 mismatches.
- **Execution:** nothing was executed.

| Skill (invocation name) | Files | Use in this project |
|---|---|---|
| `writing-plans` | SKILL.md, plan-document-reviewer-prompt.md | Breaking a single authorised task into steps. **task.md stays the plan of record** |
| `executing-plans` | SKILL.md | Checkpointed execution of an authorised task |
| `systematic-debugging` | SKILL.md, CREATION-LOG.md, condition-based-waiting.md, condition-based-waiting-example.ts, defense-in-depth.md, find-polluter.sh, root-cause-tracing.md, test-academic.md, test-pressure-1/2/3.md | Mandatory for any failing test or unexpected behaviour: root cause before fix |
| `test-driven-development` | SKILL.md, writing-good-tests.md | Default for every implementation task (Foundry, vitest, pytest) |
| `verification-before-completion` | SKILL.md | Required before a task is marked DONE: run the verification commands and attach the evidence |
| `requesting-code-review` | SKILL.md, code-reviewer.md | Gate reviews (G1–G3) and payment-path changes |
| `receiving-code-review` | SKILL.md | Handling review findings rigorously |

**Bundled non-Markdown files (inspected, never run by the install):**
- `find-polluter.sh` is a local test-bisection helper that runs `npm test` on each file. It makes no network calls.
- `condition-based-waiting-example.ts` is a documentation example.

**Caveat.** `writing-plans` and `executing-plans` refer to superpowers skills that were not vendored: `superpowers:subagent-driven-development`, `using-git-worktrees` and `finishing-a-development-branch`. **The CLAUDE.md workflow supersedes those references.** The vendored skills also use the `superpowers:` prefix, whereas they are invoked here by bare name.

**Licence note.** The vendored files are MIT, and their copyright notice is kept in each `LICENSE`. Before any public release, DOC-009 decides whether `.claude/` is published.

---

## 3. Already available (no installation needed)

| Skill / command | Use |
|---|---|
| `/code-review` (built-in) | PR/diff review at chosen effort; gate reviews |
| `/security-review` (built-in) | Security pass on pending changes (P0 before G1 and G3) |
| `/simplify` (built-in) | Clean-up after a task passes |
| `/run` (built-in) | Launching the seller/validator/buyer stack for E2E checks |
| `dataviz` (built-in) | Result charts (EVAL-004) |
| `frontend-design` (user plugin) | Dashboard (DASH-001, E2) |
| `anthropic-skills:pptx` (synced) | Deck `GP_XX_AgentTrust` (PRES-002) |
| `skill-creator` (synced) | Future project skills (SKILL-001…003) |

---

## 4. Capability coverage

| Capability (requested) | Covered by | Gap / fallback workflow |
|---|---|---|
| Requirements analysis & task decomposition | `writing-plans`, `executing-plans` + task.md template | Workflow authority is CLAUDE.md §Workflow |
| Solidity development | `solidity@solskill`; Context7 (OZ, Foundry) | — |
| Smart-contract security | `building-secure-contracts`, `entry-point-analyzer`, `differential-review`, `spec-to-code-compliance`, `/security-review` | Slither and Aderyn binaries are **not installed**, so static analysis is E1 (CONTRACT-016); installing the tools is future work |
| Foundry unit/fuzz/invariant testing | `solidity@solskill` (fuzz/invariant patterns) + Context7 Foundry book | No dedicated invariant skill. Fallback: handler-based invariant checklist in CONTRACT-013/018; SKILL-001 later |
| TypeScript/backend | `test-driven-development` + Context7 (express, viem) | No TS-specific skill; `typescript-lsp` deferred (binary missing) → ENV-010 |
| API & integration testing | `test-driven-development` + vitest/supertest + `/run` | No dedicated skill. Fallback: spec-driven tests from SPEC-002, plus the claim-store concurrency tests |
| Systematic debugging | `systematic-debugging` | — |
| Code review | `requesting-code-review`, `receiving-code-review`, `/code-review`, `differential-review` | — |
| Documentation & ADRs | — | No suitable vetted skill. Fallback: ADR template in `docs/adr/` (DOC-008) and design-findings.md; SKILL-002 later |
| React/dashboard | `frontend-design`, `dataviz`, Context7 (wagmi/viem) | — |
| Reproducible environments & CI | — | No suitable vetted skill. Fallback: hand-written GitHub Actions using `foundry-rs/foundry-toolchain` (ENV-008), scripts + optional docker-compose (ENV-009) |
| FastAPI validator (Python) | `test-driven-development`; Context7 | `pyright-lsp` deferred (binary missing) → ENV-010 |
| ERC-8004 / x402 domain knowledge | Context7 (`erc-8004-contracts`, `x402-foundation/x402`) + `spec-to-code-compliance` | No official skill exists (checked: erc-8004 org, x402-foundation, foundry-rs) |

---

## 5. Candidates considered and not installed

All were inspected read-only on 2026-09-22.

| Candidate | Reason |
|---|---|
| superpowers **full plugin** | SessionStart hook injects instructions into every session; replaced by the vendored subset (user decision) |
| security-guidance (official) | SessionStart pip-installs a venv; Stop/SubagentStop run LLM diff reviews (extra usage). Built-in `/security-review` covers the need |
| claude-security (official) | Proprietary licence; token-heavy multi-agent scans. Optional one-off final scan only if the user asks |
| semgrep (marketplace) | Closed prebuilt binaries; hooks on every tool call; a `curl \| sh` installer for a proxy; no LICENSE file |
| OpenZeppelin/openzeppelin-skills v0.0.3 | Early release; AGPL; only 3 of 12 skills are Solidity; instructs unpinned `npx @openzeppelin/contracts-cli`. Redundant with Cyfrin + Trail of Bits |
| pr-review-toolkit | Overlaps built-in `/code-review` and `/simplify` (user decision: skip) |
| mattpocock-skills | Overlaps superpowers |
| feature-dev, claude-md-management, commit-commands, official code-review plugin | Redundant with built-ins or plan mode |
| playwright (MCP) | Pulls an unpinned `@latest` package on each start. Use `@playwright/test` in the repo if the dashboard needs E2E |
| circle-skills | Circle-wallet-specific; remote MCP; scripts can broadcast transactions |
| coinbase cdp-sdk skills | Require a CDP API key/wallet; installed via third-party `npx skills add` |
| base/skills (build-on-base) | Optional later for DEPLOY-*; its `register.sh` POSTs to `api.base.dev` (ERC-8021, not ERC-8004) |
| anthropics/skills bundle | Only webapp-testing is relevant; its helper uses `subprocess.Popen(shell=True)`. Copy it later only if DASH-001 needs it |
| typescript-lsp / pyright-lsp | Need global binaries (`typescript-language-server`, `pyright`); installing binaries is out of scope now → ENV-010 |

---

## 6. Teammate setup (for anyone working in this repo)

The Claude Code docs note that externally-sourced plugins enabled only in project settings must be installed by each teammate. To set up without changing the vetted versions:

```bash
cd "<repo root>"
claude plugin marketplace add trailofbits/skills --scope project
claude plugin marketplace add Cyfrin/solskill --scope project
claude plugin install building-secure-contracts@trailofbits --scope project
claude plugin install entry-point-analyzer@trailofbits --scope project
claude plugin install spec-to-code-compliance@trailofbits --scope project
claude plugin install differential-review@trailofbits --scope project
claude plugin install solidity@solskill --scope project
claude plugin install context7@claude-plugins-official --scope project
git -C ~/.claude/plugins/marketplaces/trailofbits rev-parse HEAD   # expect 32e34f81…; if different, re-inspect before use
git -C ~/.claude/plugins/marketplaces/solskill rev-parse HEAD      # expect d17bda02…
```

The vendored skills in `.claude/skills/` arrive with the repository. Nothing needs to be installed for them.

## 7. Re-verification commands

```bash
claude plugin list --json                      # six project-scoped plugins enabled
cat .claude/settings.json                      # enabledPlugins + extraKnownMarketplaces only
find .claude/skills -type f | wc -l            # 27
```

**Maintenance rule.** Any addition, removal or update of a skill requires three things:
1. an inspection of its contents (hooks, MCP, scripts, network);
2. a recorded source SHA in this file;
3. a note in task.md §14 (Evidence).
