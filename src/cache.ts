/**
 * In-memory idempotency cache for mint-link results.
 * Key: hash(client_agent_id | merchant_id | target_url | caller_tag)
 * TTL: 24h per entry; expired entries are lazily evicted on read.
 */

import crypto from "node:crypto";

export interface CacheKey {
  client_agent_id: string;
  merchant_id: string;
  target_url?: string;
  caller_tag?: string;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

function hashKey(k: CacheKey): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([k.client_agent_id, k.merchant_id, k.target_url ?? "", k.caller_tag ?? ""]))
    .digest("hex");
}

export function getCached<T>(k: CacheKey): T | null {
  const entry = store.get(hashKey(k)) as Entry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(hashKey(k));
    return null;
  }
  return entry.value;
}

export function setCached<T>(k: CacheKey, value: T, ttlMs = 24 * 60 * 60 * 1000): void {
  store.set(hashKey(k), { value, expiresAt: Date.now() + ttlMs });
}

export function reapExpired(): void {
  const now = Date.now();
  for (const [k, e] of store) {
    if (e.expiresAt <= now) store.delete(k);
  }
}
