/**
 * SQLite idempotency cache for mint-link results.
 * Key: hash(client_agent_id | merchant_id | target_url | caller_tag)
 * TTL: 24h (matches the design doc).
 */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function resolveDbPath(): string {
  const preferred = process.env.CACHE_DB_PATH ?? "./var/cache.sqlite";
  try {
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    return preferred;
  } catch {
    // Fall back to a local path if the preferred location isn't writable (e.g. disk not yet mounted)
    const fallback = "./cache.sqlite";
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    return fallback;
  }
}

const DB_PATH = resolveDbPath();

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS mint_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mint_cache_expires ON mint_cache(expires_at);
`);

export interface CacheKey {
  client_agent_id: string;
  merchant_id: string;
  target_url?: string;
  caller_tag?: string;
}

function hashKey(k: CacheKey): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify([k.client_agent_id, k.merchant_id, k.target_url ?? "", k.caller_tag ?? ""]));
  return h.digest("hex");
}

export function getCached<T>(k: CacheKey): T | null {
  const now = Date.now();
  const row = db
    .prepare("SELECT value FROM mint_cache WHERE key = ? AND expires_at > ?")
    .get(hashKey(k), now) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setCached<T>(k: CacheKey, value: T, ttlMs = 24 * 60 * 60 * 1000): void {
  db.prepare(
    "INSERT OR REPLACE INTO mint_cache (key, value, expires_at) VALUES (?, ?, ?)",
  ).run(hashKey(k), JSON.stringify(value), Date.now() + ttlMs);
}

export function reapExpired(): void {
  db.prepare("DELETE FROM mint_cache WHERE expires_at <= ?").run(Date.now());
}
