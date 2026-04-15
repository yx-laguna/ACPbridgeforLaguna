/**
 * Smoke test: act as a Client agent on Base Sepolia, hire our Provider
 * for a mint-link, verify the deliverable attestation.
 *
 * Uses the v2 unified event model (per migration.md).
 */

import {
  AcpAgent,
  AlchemyEvmProviderAdapter,
  AssetToken,
} from "@virtuals-protocol/acp-node-v2";
import type { JobSession, JobRoomEntry } from "@virtuals-protocol/acp-node-v2";
import { baseSepolia } from "@account-kit/infra";

import { verify, type Attested } from "../src/attest.js";
import type { MintLinkDeliverable } from "../src/handlers/mint-affiliate-link.js";

async function main() {
  const client = await AcpAgent.create({
    provider: await AlchemyEvmProviderAdapter.create({
      walletAddress: requireEnv("SMOKE_CLIENT_WALLET") as `0x${string}`,
      privateKey: requireEnv("SMOKE_CLIENT_PK") as `0x${string}`,
      entityId: Number(requireEnv("SMOKE_CLIENT_ENTITY_ID")),
      chains: [baseSepolia],
    }),
  });

  let done = false;

  client.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (entry.kind !== "system") return;
    switch (entry.event.type) {
      case "budget.set":
        // Provider set a 0-USDC budget; fund it.
        await session.fund(AssetToken.usdc(0, session.chainId));
        return;
      case "job.submitted": {
        const attested = JSON.parse(
          (entry as unknown as { event: { deliverable: string } }).event.deliverable,
        ) as Attested<MintLinkDeliverable>;
        const ok = verify(attested);
        console.log(
          JSON.stringify({ shortlink: attested.payload.shortlink, attestationValid: ok }, null, 2),
        );
        if (!ok) process.exit(1);
        await session.complete("ok");
        return;
      }
      case "job.completed":
        done = true;
        await client.stop();
        return;
    }
  });

  await client.start();

  const providerAddress = requireEnv("PROVIDER_ADDRESS");
  // Provider's offerings are discovered via browseAgents; for the smoke we
  // know the offering name directly and can construct the request.
  const agents = await client.browseAgents("Laguna Affiliate", { topK: 1 });
  const provider = agents.find((a) => a.walletAddress.toLowerCase() === providerAddress.toLowerCase());
  if (!provider) throw new Error(`provider ${providerAddress} not found in registry`);
  const offering = provider.offerings.find((o) => o.name === "mint-affiliate-link");
  if (!offering) throw new Error("mint-affiliate-link offering not published");

  const jobId = await client.createJobFromOffering(
    baseSepolia.id,
    offering,
    provider.walletAddress,
    { merchant_id: "nike", geo: "SG", caller_tag: "smoke-test" },
    { evaluatorAddress: await client.getAddress() },
  );
  console.log("Job created:", jobId);

  // Wait for the entry handler to flip `done`.
  const deadline = Date.now() + 90_000;
  while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  if (!done) {
    console.error("timed out");
    process.exit(1);
  }
}

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
