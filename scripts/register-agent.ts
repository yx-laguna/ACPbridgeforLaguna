/**
 * One-off: print the ACP provider registration spec from acp.config.ts.
 * Paste the output into the ACP Registry UI at app.virtuals.io/acp.
 */

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
  console.log("Next: register via app.virtuals.io/acp/new (or the ACP Registry API once available).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
