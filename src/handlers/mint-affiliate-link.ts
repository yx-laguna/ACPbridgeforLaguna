import { z } from "zod";
import { LagunaClient } from "../laguna/client.js";
import { attest, type Attested } from "../attest.js";
import { getCached, setCached } from "../cache.js";

export const MintLinkRequest = z.object({
  merchant_id: z.string().min(1),
  target_url: z.string().url().optional(),
  geo: z.string().length(2).optional(),
  caller_tag: z.string().max(128).optional(),
  /**
   * Ethereum wallet address to receive Laguna cashback commissions.
   * Accepts "wallet_address" (Laguna offering schema) or "recipient_wallet" (legacy).
   * wallet_address takes precedence.
   */
  wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  recipient_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});
export type MintLinkRequest = z.infer<typeof MintLinkRequest>;

export interface MintLinkDeliverable {
  shortlink: string;
  shortcode: string;           // unique link ID from Laguna (was laguna_link_id)
  merchant_id: string;
  cashback_rate_bps: number;
  cookie_window_days: number;
  caller_tag?: string;
  monetization: "provider_earns_affiliate_commission_on_conversion";
}

export interface HandlerCtx {
  laguna: LagunaClient;
  walletAddress: string;
  clientAgentId: string;
}

export async function handler(
  raw: unknown,
  ctx: HandlerCtx,
): Promise<Attested<MintLinkDeliverable>> {
  const req = MintLinkRequest.parse(raw);

  const cacheKey = {
    client_agent_id: ctx.clientAgentId,
    merchant_id: req.merchant_id,
    ...(req.target_url !== undefined ? { target_url: req.target_url } : {}),
    ...(req.caller_tag !== undefined ? { caller_tag: req.caller_tag } : {}),
  };
  const cached = getCached<Attested<MintLinkDeliverable>>(cacheKey);
  if (cached) return cached;

  // Validate merchant exists (and is available in caller's geo if provided).
  // getMerchantInfo already checks `available` server-side when geo is passed —
  // returning null means unavailable. Don't re-check availability_geo locally
  // since the API may use different country code formats than the caller.
  const info = await ctx.laguna.getMerchantInfo(req.merchant_id, req.geo);
  if (!info) {
    throw new ServiceError(
      req.geo ? "geo_unavailable" : "unknown_merchant",
      `merchant_id=${req.merchant_id}${req.geo ? ` geo=${req.geo}` : ""}`,
    );
  }

  // Commission recipient: user's wallet_address > legacy recipient_wallet >
  // client agent's on-chain address > provider wallet (last resort).
  const commissionWallet = req.wallet_address ?? req.recipient_wallet ?? ctx.clientAgentId ?? ctx.walletAddress;

  const minted = await ctx.laguna.mintLink({
    merchant_id: req.merchant_id,
    wallet_address: commissionWallet,
    ...(req.target_url !== undefined ? { target_url: req.target_url } : {}),
    ...(req.geo !== undefined ? { geo: req.geo } : {}),
  });

  const deliverable: MintLinkDeliverable = {
    shortlink: minted.shortlink,
    shortcode: minted.shortcode,
    merchant_id: minted.merchant_id,
    cashback_rate_bps: minted.cashback_rate_bps,
    cookie_window_days: minted.cookie_window_days,
    monetization: "provider_earns_affiliate_commission_on_conversion",
    ...(req.caller_tag !== undefined ? { caller_tag: req.caller_tag } : {}),
  };

  const attested = attest(deliverable);
  setCached(cacheKey, attested);
  return attested;
}

export class ServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}
