import { z } from "zod";
import { LagunaClient } from "../laguna/client.js";
import { attest, type Attested } from "../attest.js";
import { getCached, setCached } from "../cache.js";

export const MintLinkRequest = z.object({
  merchant_id: z.string().min(1),
  target_url: z.string().url().optional(),
  geo: z.string().length(2).optional(),
  caller_tag: z.string().max(128).optional(),
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

  // Validate merchant exists in caller's geo before spending a mint call.
  const info = await ctx.laguna.getMerchantInfo(req.merchant_id, req.geo);
  if (!info) throw new ServiceError("unknown_merchant", `merchant_id=${req.merchant_id}`);
  if (req.geo && !info.availability_geo.includes(req.geo)) {
    throw new ServiceError("geo_unavailable", `${req.merchant_id} not in ${req.geo}`);
  }

  const minted = await ctx.laguna.mintLink({
    merchant_id: req.merchant_id,
    wallet_address: ctx.walletAddress,
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
