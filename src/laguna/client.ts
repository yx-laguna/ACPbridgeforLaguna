/**
 * Thin HTTP client around the Laguna backend.
 * All endpoints are GET. Base: https://agents.laguna.network/api/v1
 *
 * Keep this file as the ONLY place that knows about Laguna's wire format —
 * handlers depend on the typed interfaces, not on these paths.
 */

import { request } from "undici";

export interface LagunaConfig {
  baseUrl: string;       // https://agents.laguna.network/api/v1
  walletAddress: string;
}

// ─── public-facing types (what handlers see) ───────────────────────

export interface Merchant {
  merchant_id: string;
  name: string;
  category: string;
  cashback_rate_bps: number;      // basis points (e.g. 126 = 1.26%)
  cookie_window_days: number;
  availability_geo: string[];     // ISO 3166-1 alpha-2 (e.g. "SG")
}

export interface MintLinkResult {
  shortlink: string;
  shortcode: string;
  merchant_id: string;
  cashback_rate_bps: number;
  cookie_window_days: number;
}

export interface WithdrawResult {
  withdrawal_id: string;
  status: "pending" | "completed" | "failed";
  amount_usdc: number;
  fee_usdc: number;
  tx_hash?: string;
  basescan_url?: string;
}

export interface DashboardSummary {
  wallet_address: string;
  balance_usdc: number;
  pending_usdc: number;
  lifetime_usdc: number;
  conversions_count: number;
}

// ─── raw API shapes ────────────────────────────────────────────────

interface RawMerchant {
  id: string;
  name: string;
  category: string;
  bestRate: number;           // basis points
  availableCountries: string[];
}

interface RawSearchResponse {
  merchants: RawMerchant[];
}

interface RawMerchantInfoResponse {
  merchant: { id: string; name: string; category: string };
  cashback: {
    best_rate: number;        // percentage (e.g. 1.26)
    cookie_days: number;
    available_countries: string[];
  };
  available: boolean;
}

interface RawMintLinkResponse {
  shortcode: string;
  shortlink: string;
  merchant_id: string;
  cashback: {
    rate: number;             // percentage (e.g. 1.26)
    cookie_days: number;
  };
}

interface RawCategoryResponse {
  categories: Array<{ name: string; merchantCount: number; topCashbackRate: number }>;
}

// ─── helpers ───────────────────────────────────────────────────────

/** Convert percentage (1.26) to basis points (126). */
function pctToBps(pct: number): number {
  return Math.round(pct * 100);
}

function normalizeMerchant(r: RawMerchant): Merchant {
  return {
    merchant_id: r.id,
    name: r.name,
    category: r.category,
    cashback_rate_bps: r.bestRate,
    cookie_window_days: 0,           // not in list response; use getMerchantInfo for details
    availability_geo: r.availableCountries,
  };
}

// ─── client ────────────────────────────────────────────────────────

export class LagunaClient {
  constructor(private readonly cfg: LagunaConfig) {}

  private async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) qs.set(k, String(v));
      }
    }
    const qstr = qs.toString();
    const url = `${this.cfg.baseUrl}${path}${qstr ? `?${qstr}` : ""}`;
    const res = await request(url, { method: "GET" });
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new LagunaError(res.statusCode, text, path);
    }
    return (await res.body.json()) as T;
  }

  // ─── discovery ─────────────────────────────────────────────────
  async searchMerchants(q: {
    query?: string;
    category?: string;
    geo?: string;
    sort?: string;
    limit?: number;
  }): Promise<Merchant[]> {
    const raw = await this.get<RawSearchResponse>("/search_merchants", q);
    return raw.merchants.map(normalizeMerchant);
  }

  async getCategories(geo?: string): Promise<Array<{ name: string; merchantCount: number }>> {
    const raw = await this.get<RawCategoryResponse>("/categories", geo ? { geo } : undefined);
    return raw.categories.map((c) => ({ name: c.name, merchantCount: c.merchantCount }));
  }

  async getMerchantInfo(merchantId: string, geo?: string): Promise<Merchant | null> {
    try {
      const raw = await this.get<RawMerchantInfoResponse>("/merchant_info", {
        merchant_id: merchantId,
        ...(geo !== undefined ? { geo } : {}),
      });
      if (!raw.available) return null;
      return {
        merchant_id: raw.merchant.id,
        name: raw.merchant.name,
        category: raw.merchant.category,
        cashback_rate_bps: pctToBps(raw.cashback.best_rate),
        cookie_window_days: raw.cashback.cookie_days,
        availability_geo: raw.cashback.available_countries,
      };
    } catch (e) {
      if (e instanceof LagunaError && e.status === 404) return null;
      throw e;
    }
  }

  // ─── commerce ──────────────────────────────────────────────────
  async mintLink(p: {
    merchant_id: string;
    wallet_address: string;
    target_url?: string;
    geo?: string;
  }): Promise<MintLinkResult> {
    const raw = await this.get<RawMintLinkResponse>("/mint_link", p);
    return {
      shortlink: raw.shortlink,
      shortcode: raw.shortcode,
      merchant_id: raw.merchant_id,
      cashback_rate_bps: pctToBps(raw.cashback.rate),
      cookie_window_days: raw.cashback.cookie_days,
    };
  }

  async withdraw(p: { wallet_address: string; amount?: number }): Promise<WithdrawResult> {
    return this.get<WithdrawResult>("/withdraw", p);
  }

  async getWithdrawalStatus(withdrawalId: string): Promise<WithdrawResult> {
    return this.get<WithdrawResult>("/withdrawal_status", { withdrawal_id: withdrawalId });
  }

  async getDashboard(include?: string): Promise<DashboardSummary> {
    return this.get<DashboardSummary>("/get_dashboard", {
      wallet_address: this.cfg.walletAddress,
      ...(include !== undefined ? { include } : {}),
    });
  }

  // ─── wallet connection (operator-only) ─────────────────────────
  async requestWalletConnection(email: string, walletAddress: string): Promise<void> {
    await this.get("/request_wallet_connection", { email, wallet_address: walletAddress });
  }

  async confirmWalletConnection(
    email: string,
    walletAddress: string,
    verificationCode: string,
  ): Promise<void> {
    await this.get("/confirm_wallet_connection", {
      email,
      wallet_address: walletAddress,
      verification_code: verificationCode,
    });
  }
}

export class LagunaError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`Laguna ${status} @ ${path}: ${body}`);
  }
}
