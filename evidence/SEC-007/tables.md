### A6 — Sybil seller selection

Who each gate admits, out of the same populated registry:

| gate | honest admitted | **Sybils admitted** | newcomers admitted |
|---|---|---|---|
| none | 10/10 | **5/5** | 10/10 |
| v1 (the blueprint's rule) | 10/10 | **5/5** | 0/10 |
| v2 (implemented) | 10/10 | **0/5** | 0/10 |

Selection share landing on a Sybil. **The rule is a choice, not a measurement**, so both are shown:

| gate | top-score | weighted |
|---|---|---|
| none | 100.0% | 36.5% |
| v1 | 100.0% | 38.3% |
| v2 | 0.0% | 0.0% |

Gate v2 as the chain enforces it — `fund()` actually sent:

- **honest** — funded
- **sybil** — refused, `ReputationTooLow`
- **newcomer** — refused, `ReputationTooLow`

**An attacker that earns trusted feedback is admitted** (H-A6-5): admitted after earning `true`, still admitted after defecting `true`, refused only after 4 entries were revoked `false`. The gate reads reputation, not conduct, so patience defeats it and the only remedy is retrospective.

**An honest seller becomes unfundable past 26 feedback entries** from one trusted client — 28 was refused with `ReputationTooLow`. `getSummary` runs under a 250,000-gas ceiling; over it the read is caught and reads as `count = 0`, which the gate treats as no reputation. Fail-closed, so safe, but the client's opinion stops counting silently. `fund()` grew 8,588 gas per entry here, against the ~8,589 CONTRACT-005 measured on the read itself — two independent paths agreeing to within a gas.

### Defence coverage
