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
const SIGNER_KEY = requireEnv("PRIVY_SIGNER_PRIVATE_KEY");

const laguna = new LagunaClient({
  baseUrl: requireEnv("LAGUNA_API_BASE_URL"),
  walletAddress: WALLET,
});

async function main() {
  log("info", "starting: creating PrivyAlchemy provider adapter...");
  const provider = await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress: WALLET,
    walletId: WALLET_ID,
    chains: [base, baseSepolia],
    signerPrivateKey: SIGNER_KEY,
  });
  log("info", "provider adapter created, creating AcpAgent...");
  const agent = await AcpAgent.create({ provider });
  log("info", "AcpAgent created, registering handler...");

  agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    if (entry.kind !== "system") return;

    try {
      switch (entry.event.type) {
        case "job.created": {
          // Try to read the offering name so we can price correctly.
          // fetchJob() is called again here (SDK already called it in dispatch)
          // so we isolate any failure — a failing fetch must not cascade into
          // session.reject() which would also fail for stale/unowned jobs.
          let createdOffering = "";
          try {
            const createdJob = await session.fetchJob();
            createdOffering = createdJob.description ?? "";
          } catch (fetchErr) {
            log("warn", `job ${session.jobId} fetchJob failed in job.created (stale?): ${serializeError(fetchErr)}`);
          }
          // Always price at the minimum; unknown offerings get 0.01 too
          // (they'll be rejected at job.funded if we don't support them).
          const price =
            createdOffering === "mint_link"         ? 0.01 :
            createdOffering === "sweep_commissions" ? 0.01 :
            0.01;
          try {
            await session.setBudget(AssetToken.usdc(price, session.chainId));
          } catch (budgetErr) {
            log("warn", `job ${session.jobId} setBudget skipped (already set or unauthorized): ${serializeError(budgetErr)}`);
          }
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
            case "mint_link":
              deliverable = await mintLink.handler(req, ctx);
              break;
            case "sweep_commissions":
              deliverable = await sweep.handler(req, { laguna, walletAddress: WALLET });
              break;
            default:
              await session.submit(JSON.stringify({ error: `unknown_offering:${offeringName}` }));
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
      const errMsg = serializeError(err);
      log("error", `job ${session.jobId} handler error: ${errMsg}`);
      // For funded jobs the provider cannot reject — submit an error deliverable
      // so the on-chain state advances and the client can read the failure reason.
      try {
        await session.submit(JSON.stringify({ error: errMsg }));
      } catch {
        // If submit also fails (e.g. wrong state for stale jobs), swallow silently.
        try {
          await session.reject(errMsg);
        } catch (rejectErr) {
          log("warn", `job ${session.jobId} reject also failed: ${serializeError(rejectErr)}`);
        }
      }
    }
  });

  log("info", "handler registered, calling agent.start()...");

  // Skip hydrateSessions() — it fetches all historical active jobs and can
  // hang when there's a large backlog of stale "open" jobs. We only care
  // about new incoming events, not replaying old ones.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentAny = agent as any;
  agentAny.hydrateSessions = async () => {
    log("info", "hydrateSessions skipped (monkey-patched)");
  };

  // Only subscribe to "chat" stream — "wallet" stream is for approval gates
  // which we don't use (our Privy signer auto-signs).
  await agent.start(() => {
    log("info", "SSE onConnected callback fired");
  }, ["chat"]);
  log("info", `ACPLagunaTranslator up on chains: baseSepolia, base`);

  // Keep the process alive. The ACP SDK's internal WebSocket/polling uses
  // unref'd handles so Node exits when main() returns without this.
  setInterval(() => {}, 60_000);
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
