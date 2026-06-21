/**
 * One-off: print the ACP provider registration spec and write offering.json
 * files compatible with `acp offering create --from-file`.
 *
 * Usage:
 *   npm run register
 *
 * Output:
 *   - Console summary for manual reference
 *   - agents/laguna/offerings/<name>/offering.json  (one per offering)
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { agentIdentity, offerings, resources } from "../acp.config.js";

async function main() {
  console.log("Agent identity:");
  console.log("  name:    ", agentIdentity.name);
  console.log("  email:   ", agentIdentity.email);
  console.log("  wallet:  ", agentIdentity.walletAddress);
  console.log("  chains:  ", agentIdentity.chainNames.join(","));
  console.log();
  console.log("Offerings:");
  for (const o of offerings) console.log(`  - ${o.name}  price=${o.priceUsdc} USDC  sla=${o.slaMinutes}min`);
  console.log("Resources:");
  for (const r of resources) console.log(`  - ${r.name}`);
  console.log();

  // Write offering.json files for `acp offering create --from-file`
  for (const o of offerings) {
    const dir = join("agents", "laguna", "offerings", o.name);
    mkdirSync(dir, { recursive: true });
    const offeringJson = {
      name: o.name,
      description: o.description,
      price: {
        amount: o.priceUsdc,
        currency: "USDC",
      },
      sla_minutes: o.slaMinutes,
      chains: agentIdentity.chainNames,
      provider: {
        name: agentIdentity.name,
        wallet: agentIdentity.walletAddress,
        email: agentIdentity.email,
      },
    };
    const outPath = join(dir, "offering.json");
    writeFileSync(outPath, JSON.stringify(offeringJson, null, 2) + "\n");
    console.log(`Wrote ${outPath}`);
  }

  console.log();
  console.log("Next: acp offering create --from-file agents/laguna/offerings/<name>/offering.json");
  console.log("      (or register manually via app.virtuals.io/acp/new)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
