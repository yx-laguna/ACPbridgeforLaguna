/**
 * Provider-side ACP v2 agent.
 *
 * v2 event model: a single `agent.on("entry", ...)` handler receives
 * (session, entry). For a Provider, the events we care about:
 *   - job.created   → set budget (0 USDC for our free offerings)
 *   - job.funded    → do the work, submit deliverable
 *
 * Offering name comes from AcpJob.description (set by client to offering.name
 * when calling createJobFromOffering). Requirement arrives as a chat message
 * with contentType "requirement" sent immediately after job creation.
 */

import {
  AcpAgent,
  PrivyAlchemyEvmProviderAdapter,
  AssetToken,
} from "@virtuals-protocol/acp-node-v2";
import type { JobSession, JobRoomEntry, AgentMessage } from "@virtuals-protocol/acp-node-v2";
import { baseSepolia, base } from "@account-kit/infra";

import { LagunaClient } from "./laguna/client.js";
import * as mintLink from "./handlers/mint-affiliate-link.js";
import * as sweep from "./handlers/sweep-commissions.js";

const WALLET = requireEnv("ACP_WALLET_ADDRESS") as `0x${string}`;
const WALLET_ID = requireEnv("PRIVY_WALLET_ID");
const SIGNER_KEY = process.env.PRIVY_SIGNER_PRIVATE_KEY;

const laguna = new LagunaClient({
  baseUrl: requireEnv("LAGUNA_API_BASE_URL"),
  walletAddress: WALLET,
});

async function main() {
  const agent = await AcpAgent.create({
    provider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: WALLET,
      walletId: WALLET_ID,
      chains: [baseSepolia, base],
      ...(SIGNER_KEY ? { signerPrivateKey: SIGNER_KEY } : {}),
    }),
  });

  agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (entry.kind !== "system") return;

    try {
      switch (entry.event.type) {
        case "job.created": {
          // Free offering — set zero-USDC budget.
          await session.setBudget(AssetToken.usdc(0, session.chainId));
          return;
        }

        case "job.funded": {
          // Fetch job to get offering name (stored in description) and client address.
          const job = await session.fetchJob();
          const offeringName = job.description ?? "";

          // Requirement is sent as a chat message immediately after job creation.
          const reqEntry = session.entries.find(
            (e): e is AgentMessage =>
              e.kind === "message" && e.contentType === "requirement",
          );
          const req: unknown = reqEntry ? JSON.parse(reqEntry.content) : {};

          const ctx = {
            laguna,
            walletAddress: WALLET,
            clientAgentId: job.clientAddress,
          };

          let deliverable: unknown;
          switch (offeringName) {
            case "mint-affiliate-link":
              deliverable = await mintLink.handler(req, ctx);
              break;
            case "sweep-commissions":
              deliverable = await sweep.handler(req, { laguna, walletAddress: WALLET });
              break;
            default:
              await session.reject(`unknown_offering:${offeringName}`);
              return;
          }
          await session.submit(JSON.stringify(deliverable));
          return;
        }

        case "job.completed":
          log("info", `job ${session.jobId} completed`);
          return;

        case "job.rejected":
          log("warn", `job ${session.jobId} rejected`);
          return;
      }
    } catch (err) {
      await session.reject(serializeError(err));
    }
  });

  await agent.start();
  log("info", `ACPLagunaTranslator up on chains: baseSepolia, base`);
}

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
}
function serializeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
function log(level: "info" | "warn" | "error", msg: string) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
