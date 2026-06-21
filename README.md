# ACPLagunaTranslator

Virtuals **ACP v2** provider agent that fronts the Laguna affiliate backend. Free to callers; we earn the spread via Laguna cashback commission on resulting conversions.

**Does not touch the Laguna MCP repo.** This service talks to Laguna over HTTP as a client, and exposes ACP v2 offerings via the programmatic ACP v2 SDK (`AcpAgent` + `agent.on("entry", ...)` — not `acp serve`). The programmatic path is intentional: it allows the SQLite idempotency cache and ed25519 attestation to run in the handler path.

## Quickstart

```bash
# 1. deps
npm i

# 2. env
cp .env.example .env            # fill in LAGUNA_*, ACP_*, ATTEST_*

# 3. generate attestation keys (one-off)
node -e "const n=require('tweetnacl');const k=n.sign.keyPair();
  console.log('ATTEST_PUBKEY_B64=',Buffer.from(k.publicKey).toString('base64'));
  console.log('ATTEST_SECKEY_B64=',Buffer.from(k.secretKey).toString('base64'))" >> .env

# 4. Upgrade agent to v2 on app.virtuals.io (one-time, UI-only).
#    Grab walletId + signerPrivateKey from the Signers tab.

# 5. (option A) dev wallet via private key → put ACP_SIGNER_PRIVATE_KEY in .env
#    (option B) OS keychain via acp-cli:
npx acp agent add-signer

# 6. Register offerings on the ACP Registry UI (see README TODOs).
npm run register       # prints the spec to paste into the Registry form

# 7. Run
npm run dev            # hot-reload via tsx
# or
npm run build && npm start
```

## What this exposes

| Offering              | Price | What it does |
|-----------------------|-------|--------------|
| `mint_link`           | 0.01 USDC | Returns a Laguna shortlink for a given `merchant_id` (+ optional `target_url`, `geo`, `caller_tag`). Cached 24h per (client, merchant, target, tag). |
| `sweep_commissions`   | 0.01 USDC | Triggers a Laguna withdrawal. Only pays to the on-record wallet — validated against `ACP_WALLET_ADDRESS`. |

| Resource             | What it does |
|----------------------|--------------|
| `merchant-discovery` | Search merchants by `query`, `category`, `geo`. Read-only, free. |

## Monetization

Jobs are priced at 0.01 USDC per call. The provider refunds the 0.01 USDC to the client after job completion (nominal toll to satisfy ACP escrow; net cost to caller is zero). Revenue = Laguna commissions on conversions attributed to minted links; these settle to `ACP_WALLET_ADDRESS` on Base and are swept via `sweep_commissions` (or manually via Laguna's dashboard).

Every deliverable carries a `monetization: provider_earns_affiliate_commission_on_conversion` tag plus an ed25519 attestation so callers can verify the shortlink came from us.

## Layout

```
acp.config.ts           declarative offerings + resources for `acp serve`
src/laguna/client.ts    typed HTTP client for Laguna backend (only place that knows paths)
src/handlers/           one file per offering/resource — pure handlers
src/attest.ts           ed25519 signed deliverables
src/cache.ts            SQLite idempotency cache
src/server.ts           main entrypoint — programmatic ACP v2 (not acp serve)
scripts/register-agent  identity + offering registration
scripts/smoke-sepolia   e2e client-side smoke test
```

## ACP v2 event model (from migration.md)

v2 is a **breaking rewrite** of v1. Key shifts we've already baked in:

- Single unified handler: `agent.on("entry", (session, entry) => {...})` with a switch on `entry.event.type`. No per-phase callbacks.
- Events: `job.created` → `budget.set` → `job.funded` → `job.submitted` → `job.completed` / `job.rejected`.
- Provider acts on `job.created` (setBudget) and `job.funded` (submit). Client acts on `budget.set` (fund) and `job.submitted` (complete).
- Pricing: `AssetToken.usdc(amount, chainId)` not plain `{ amount, currency }`.
- Chains come from `@account-kit/infra` (`baseSepolia`, `base`).
- Legacy agents need the one-time **"Upgrade Now"** action on app.virtuals.io before the v2 SDK works against them.

## TODOs before first real deploy

1. **Upgrade agent on app.virtuals.io** (if an existing legacy v1 agent exists). Copy `walletId` + generate a signer private key from the Signers tab.
2. **Confirm Laguna REST paths in `src/laguna/client.ts`.** Placeholders mirror MCP tool names — replace with the real OpenAPI from the Laguna dev team.
3. **Test price = 0 USDC on native-ACP rail.** v2's `setBudget(AssetToken.usdc(0, chainId))` + `session.fund(AssetToken.usdc(0, chainId))` should work but needs a live Sepolia run to confirm escrow accepts a zero-amount fund.
4. **Register offerings on the ACP Registry UI.** v2 publishes offerings via the Registry + smart contract, not a config file. `scripts/register-agent.ts` just prints the spec right now — wire it to the Registry API once confirmed.
5. **Decide signer strategy.**
   - **Keychain via `acp agent add-signer`** → single instance, easiest for dev.
   - **Privy (`PrivyAlchemyEvmProviderAdapter`)** → needed for HA / containerized deploys. `walletId` + `signerPrivateKey` from the agent's Signers tab.
6. **Run `scripts/smoke-sepolia.ts`** end-to-end; confirm ERC-8183 escrow state + ERC-8004 reputation delta after completion.
7. **Pick a deploy target.** Any Node 20 host; SSE transport is the v2 default so no special infra needed beyond outbound HTTPS.

## License

TBD.
