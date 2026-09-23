# Owner-reachable entry points (CONTRACT-010)

Acceptance asks that the entry-point inventory show **no owner-reachable path that
transfers escrowed tokens**. Rather than assert that in prose, `AdminTest` executes it:
`test_NoSetterCanTouchAFundedJob` fires every setter at its extreme against a funded job,
then settles the job and checks the seller was paid in full and the owner holds nothing.

| Function | Reachable by | Read where | Can it reach a funded job? | Bound |
|---|---|---|---|---|
| `setTokenAllowed` | owner | `fund()` only | no — `release`/`refund` never re-check the allowlist, so revoking a token cannot lock money in | boolean |
| `setTtlBounds` | owner | `fund()` only | no | `min > 0`, `max >= min`, `max <= MAX_TTL_LIMIT` (30 d) |
| `setGrace` | owner | **snapshotted into each job at funding** | no — this was the one exception until the security review; before the snapshot it could open the refund valve early and, at `type(uint64).max`, overflow `deadline + grace` and freeze every job permanently | `<= MAX_GRACE` (30 d) |
| `setGateFloors` | owner | `fund()` only | no | `distinct <= 32`, `count <= 1000` |
| `setMaxTrustedClients` | owner | `fund()` only | no | `<= 32` |
| `setReputationReadGas` | owner | `fund()` only | no | `45,000 <= g <= 5,000,000` — a floor because a ceiling low enough to starve every read would switch the gate off while leaving it looking applied, and a cap because `fund()` must stay affordable |
| `transferOwnership` / `acceptOwnership` | owner / pending | — | no | two-step (`Ownable2Step`) |
| `renounceOwnership` | owner | — | no | **one step, inherited from `Ownable` and not overridden.** It cannot strand funds, because settlement reads no setting except the snapshotted grace, but it does freeze configuration forever. Recorded, not removed: `test_RenouncingOwnershipDoesNotStrandFunds` |

**Not present, deliberately:** no sweep, no pause, no upgrade path, no admin transfer of
escrowed tokens, no way to change a registry address (all three are `immutable`), no way
to change `PASS_THRESHOLD` or `FEEDBACK_TAG` (both `constant`, so no key can lower the bar
for a pass or point the gate at a tag the seller controls).

Stray or donated tokens are therefore unrecoverable. That is the accepted cost of having
no sweep; a pull-payment `withdraw(to)` is STRETCH-008 and would change this.

12 tests, `forge-test.log`. The funds-conservation half is proved separately by
CONTRACT-013's `invariant_C_ConfigurationNeverTouchesTheBalance`, which fires the same
setters at random throughout a 256 x 500 run.
