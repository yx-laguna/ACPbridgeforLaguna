import { z } from "zod";
import { LagunaClient } from "../laguna/client.js";
import { attest, type Attested } from "../attest.js";
import { ServiceError } from "./mint-affiliate-link.js";

export const SweepRequest = z.object({
  wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.number().positive().optional(),
});
export type SweepRequest = z.infer<typeof SweepRequest>;

export interface SweepDeliverable {
  withdrawal_id: string;
  status: "pending" | "completed" | "failed";
  amount_usdc: number;
  fee_usdc: number;
  tx_hash?: string;
  basescan_url?: string;
  monetization: "provider_earns_affiliate_commission_on_conversion";
}

export interface HandlerCtx {
  laguna: LagunaClient;
  walletAddress: string; // our on-record Laguna wallet
}

export async function handler(
  raw: unknown,
  ctx: HandlerCtx,
): Promise<Attested<SweepDeliverable>> {
  const req = SweepRequest.parse(raw);

  // Laguna itself only ever pays to the registered wallet, but we still
  // refuse requests that target a different address — fail fast rather
  // than rely on upstream to reject.
  if (req.wallet_address.toLowerCase() !== ctx.walletAddress.toLowerCase()) {
    throw new ServiceError(
      "wallet_mismatch",
      "wallet_address must match the Laguna-registered wallet",
    );
  }

  const result = await ctx.laguna.withdraw({
    wallet_address: req.wallet_address,
    ...(req.amount !== undefined ? { amount: req.amount } : {}),
  });

  const deliverable: SweepDeliverable = {
    withdrawal_id: result.withdrawal_id,
    status: result.status,
    amount_usdc: result.amount_usdc,
    fee_usdc: result.fee_usdc,
    monetization: "provider_earns_affiliate_commission_on_conversion",
    ...(result.tx_hash !== undefined ? { tx_hash: result.tx_hash } : {}),
    ...(result.basescan_url !== undefined ? { basescan_url: result.basescan_url } : {}),
  };

  return attest(deliverable);
}
