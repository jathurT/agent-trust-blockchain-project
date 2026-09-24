# Testnet wallets (ENV-006)

**Public addresses only.** No private key, mnemonic or keystore password belongs in this
file, anywhere else in the repository, in chat, or in an evidence log (CLAUDE.md §11).
Base Sepolia only — these addresses must never hold real funds.

Fill in the `0x…` column as you create each one, then commit this file.

| Role | Address | Keystore account | Needs | Why |
|---|---|---|---|---|
| deployer | `0x` | `agenttrust-deployer` | ETH | deploys the escrow; becomes its owner |
| seller | `0x` | `agenttrust-seller` | ETH | `validationRequest` + `bindValidation`, two transactions per job |
| validator | `0x` | `agenttrust-validator` | ETH | `validationResponse` + `release`, two transactions per job |
| buyer | `0x` | `agenttrust-buyer` | ETH **and** test USDC | `approve` + `fund`, and it pays the price |

## One key, three roles — do not split the seller

The seller address above must be **all three** of: the ERC-8004 agent **owner** (only the
owner or an operator may call `validationRequest`), the **`agentWallet`** the escrow
snapshots as payee (only the payee may call `bindValidation`), and the key the seller
service signs and sends with. Splitting them means a fifth key to create and fund, and
`startStack` now fails loudly at setup if they ever diverge (REG-006).

## Creating them

```bash
cast wallet new ~/.foundry/keystores agenttrust-deployer  -p
cast wallet new ~/.foundry/keystores agenttrust-seller    -p
cast wallet new ~/.foundry/keystores agenttrust-validator -p
cast wallet new ~/.foundry/keystores agenttrust-buyer     -p
```

`-p` prompts for a keystore password with the input hidden. The command prints **only the
address** — verified, zero key-shaped values in its output. Plain `cast wallet new` with
no path prints the private key instead; do not use that form.

**Do not run these through Claude Code's `!` prefix, and do not paste the output into a
Claude session.** Anything that appears in a terminal Claude can see enters the
transcript. Run them in your own terminal and type the addresses in here by hand.

`~/.foundry/keystores` is outside the repository. `.gitignore` also covers `.env`,
`*.key` and `keystore/`, but the keystore directory being outside the repo is the real
protection.

To confirm an address later without unlocking anything:

```bash
cast wallet address --account agenttrust-deployer
```

## Balances

Record the balances that satisfy ENV-007 here once funded, with the date:

| Role | ETH | USDC | Checked |
|---|---|---|---|
| deployer | | — | |
| seller | | — | |
| validator | | — | |
| buyer | | | |

```bash
for a in deployer seller validator buyer; do
  ADDR=$(cast wallet address --account agenttrust-$a)
  echo "$a $ADDR $(cast balance $ADDR --rpc-url https://sepolia.base.org --ether) ETH"
done
```
