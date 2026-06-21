# CLAUDE.md

Context for Claude Code sessions working on this repo.

## What this is

A Virtuals **ACP v2** provider agent that fronts the **Laguna** affiliate-commerce backend. Free to callers; the operator (Menyala) earns revenue via Laguna cashback commissions on conversions through minted affiliate links.

**Does not touch the Laguna MCP repo.** This service talks to Laguna over HTTP as a client and exposes ACP v2 offerings to the Virtuals agent economy.

## Architecture

```
Client agent (Virtuals)  ──ACP v2──▶  ACPLagunaTranslator (this repo)  ──HTTP──▶  Laguna backend
```

- `src/server.ts` — main entrypoint. Programmatic ACP v2 `AcpAgent` using the unified event model. **Not `acp serve`** — we use the programmatic SDK so the SQLite cache and ed25519 attestation can run in the handler path.
- `src/laguna/client.ts` — typed HTTP client to the Laguna backend. **Only place that knows REST paths.** Base: `https://agents.laguna.network/api/v1`. All endpoints are GET.
- `src/handlers/*.ts` — one pure handler per ACP offering / resource. Handlers are framework-agnostic so they're easy to unit-test.
- `src/attest.ts` — ed25519 signing of deliverables. Pubkey published via the agent card for caller verification.
- `src/cache.ts` — SQLite idempotency cache, 24h TTL, keyed on (client, merchant, target_url, caller_tag).
- `acp.config.ts` — manifest of offerings + resources + identity. Source of truth for `scripts/register-agent.ts` output (emits `offering.json` files per offering).
- `scripts/register-agent.ts` — prints spec for the ACP Registry UI (TODO: wire programmatic registration once the SDK exposes it).
- `scripts/smoke-sepolia.ts` — end-to-end client-side smoke test on Base Sepolia.

## ACP v2 mental model (important — v2 is a breaking rewrite of v1)

Per the migration doc:

- Single event handler: `agent.on("entry", (session, entry) => {...})` with `switch (entry.event.type)`.
- Event stream: `job.created` → `budget.set` → `job.funded` → `job.submitted` → `job.completed` / `job.rejected`.
- **Provider** (us) acts on `job.created` (setBudget) and `job.funded` (submit).
- **Client** acts on `budget.set` (fund) and `job.submitted` (complete/reject, if they're also evaluator).
- Pricing uses `AssetToken.usdc(amount, chainId)`.
- Chains come from `@account-kit/infra` (`baseSepolia`, `base`).
- Legacy v1 agents need a one-time "Upgrade Now" on app.virtuals.io before v2 SDK works.

## Offerings (0.01 USDC per call, refunded after completion)

| Name | What it does |
|---|---|
| `mint_link` | Mint Laguna shortlink for `merchant_id` (+ optional `target_url`, `geo`, `caller_tag`). |
| `sweep_commissions` | Trigger Laguna withdrawal to the on-record wallet. Safe because Laguna withdrawal is wallet-bound. |

## Resources (read-only)

| Name | What it does |
|---|---|
| `merchant-discovery` | Search merchants by name/category/geo. |

## How revenue works

Jobs cost 0.01 USDC (nominal toll to satisfy ACP escrow). Provider refunds the 0.01 USDC to the client after job completion — net cost to caller is zero. Commission comes from Laguna paying USDC to `ACP_WALLET_ADDRESS` (Base) when users convert through minted links. That wallet is both the ACP provider signing address AND the Laguna payout address — intentional single-wallet design to avoid internal transfers.

## Known TODOs (before mainnet)

1. **Upgrade Now on app.virtuals.io** if the existing agent is v1.
3. **Live-test `AssetToken.usdc(0, ...)`** — confirm zero-amount escrow funding works on native-ACP rail. x402 handles free endpoints natively; native-ACP may not.
4. **Register offerings via ACP Registry UI.** `npm run register` prints the spec to paste.
5. **Run `npm run smoke`** on Base Sepolia. Verify ERC-8183 escrow + ERC-8004 reputation delta.

## Dev workflow

```bash
npm i
cp .env.example .env    # fill LAGUNA_*, ACP_*, ATTEST_*
npm run typecheck       # must pass before commits
npm run dev             # tsx watch
npm run smoke           # after bridge is up + registered on Sepolia
```

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Keep it strict.
- All user input validated with `zod` at handler entry.
- All deliverables go through `attest(...)` — never return raw payloads.
- Errors from Laguna bubble up as `LagunaError` with `{ status, path, body }`. Errors from us are `ServiceError` with a stable `code`.
- Never log wallet private keys. Never log Laguna API key.
- Never commit `.env`.
