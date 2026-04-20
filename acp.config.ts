/**
 * Declarative manifest of our offerings + resources.
 *
 * v2 SDK (per migration.md) is programmatic-first: offerings are registered
 * via the ACP Registry UI + smart-contract, and the agent matches incoming
 * jobs in `agent.on("entry", ...)` by offering name. This file is the
 * source-of-truth for:
 *   - what we advertise (also fed into scripts/register-agent.ts)
 *   - requirement schemas used for runtime validation
 *   - pricing (always 0 USDC for us in v1)
 */

import { MintLinkRequest } from "./src/handlers/mint-affiliate-link.js";
import { SweepRequest } from "./src/handlers/sweep-commissions.js";
import { DiscoveryQuery } from "./src/handlers/merchant-discovery.js";

export interface OfferingSpec {
  name: string;
  description: string;
  priceUsdc: number;          // 0 for our free offerings
  slaMinutes: number;
  requirementSchema: unknown;  // zod schema; convert to JSON-schema at registration time
}

export interface ResourceSpec {
  name: string;
  description: string;
  querySchema: unknown;
}

export const agentIdentity = {
  name: "Laguna Affiliate",
  role: "provider" as const,
  email: process.env.ACP_AGENT_EMAIL ?? "laguna-acp@menyala.com",
  walletAddress: process.env.ACP_WALLET_ADDRESS ?? "0xREPLACE_ME",
  chainNames: (process.env.ACP_CHAINS ?? "baseSepolia,base").split(","),
};

export const offerings: OfferingSpec[] = [
  {
    name: "mint_link",
    description:
      "Mint a Laguna affiliate shortlink for a given merchant. Free to caller; provider earns cashback commission on attributed conversions.",
    priceUsdc: 0.01,
    slaMinutes: 2,
    requirementSchema: MintLinkRequest,
  },
  {
    name: "sweep_commissions",
    description:
      "Trigger a Laguna withdrawal to the pre-registered wallet. Only pays to the on-record address; caller cannot redirect funds.",
    priceUsdc: 0.01,
    slaMinutes: 5,
    requirementSchema: SweepRequest,
  },
];

export const resources: ResourceSpec[] = [
  {
    name: "merchant-discovery",
    description: "Search Laguna merchants by name, category, or geo.",
    querySchema: DiscoveryQuery,
  },
];
