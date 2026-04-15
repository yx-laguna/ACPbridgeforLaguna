/**
 * Resource (read-only, free): merchant-discovery.
 */

import { z } from "zod";
import { LagunaClient, type Merchant } from "../laguna/client.js";

export const DiscoveryQuery = z.object({
  query: z.string().min(2).optional(),
  category: z.string().optional(),
  geo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type DiscoveryQuery = z.infer<typeof DiscoveryQuery>;

export interface HandlerCtx {
  laguna: LagunaClient;
}

export async function handler(raw: unknown, ctx: HandlerCtx): Promise<Merchant[]> {
  const q = DiscoveryQuery.parse(raw);
  return ctx.laguna.searchMerchants({
    ...(q.query !== undefined ? { query: q.query } : {}),
    ...(q.category !== undefined ? { category: q.category } : {}),
    ...(q.geo !== undefined ? { geo: q.geo } : {}),
    limit: q.limit,
  });
}
