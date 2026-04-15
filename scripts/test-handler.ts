/**
 * Quick integration test: exercises the mint-affiliate-link handler
 * directly against the live Laguna API (no ACP round-trip needed).
 *
 * Run: npm run test:handler
 */

import { LagunaClient } from "../src/laguna/client.js";
import { handler } from "../src/handlers/mint-affiliate-link.js";

const laguna = new LagunaClient({
  baseUrl: process.env.LAGUNA_API_BASE_URL ?? "https://agents.laguna.network/api/v1",
  walletAddress: process.env.ACP_WALLET_ADDRESS ?? "",
});

async function main() {
  console.log("1. Searching merchants...");
  const merchants = await laguna.searchMerchants({ limit: 5 });
  console.log(`   Found ${merchants.length} merchants:`, merchants.map((m) => m.merchant_id));

  const target = merchants[0];
  if (!target) throw new Error("No merchants returned");

  console.log(`\n2. Getting merchant info for ${target.merchant_id}...`);
  const info = await laguna.getMerchantInfo(target.merchant_id);
  console.log("  ", JSON.stringify(info, null, 2));

  console.log(`\n3. Minting affiliate link for ${target.merchant_id}...`);
  const result = await handler(
    { merchant_id: target.merchant_id, caller_tag: "handler-test" },
    {
      laguna,
      walletAddress: process.env.ACP_WALLET_ADDRESS ?? "",
      clientAgentId: "test-client",
    },
  );
  console.log("\n   Deliverable:");
  console.log("  ", JSON.stringify(result.payload, null, 2));
  console.log("\n   Attestation valid signature:", !!result.attestation.sig_b64);
  console.log("   Shortlink:", result.payload.shortlink);
  console.log("\n✅ Handler test passed");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
