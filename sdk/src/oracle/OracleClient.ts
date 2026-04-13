import { ethers } from "ethers";
import { XERO_ORACLE_ABI } from "../abis";
import { DEFAULT_STALENESS } from "./AssetList";

export interface NavPrice {
  /** Raw price with 8 decimal places (e.g. 285000000000 = $2,850.00) */
  price: bigint;
  /** Unix timestamp of last update */
  updatedAt: number;
  /** 0-100 confidence score */
  confidence: number;
  /** True if the price exceeds the asset's staleness threshold */
  isStale: boolean;
  /** Always 8 for USD prices */
  decimals: number;
  /** Human-readable price string, e.g. "2,850.00" */
  priceFormatted: string;
}

export interface AssetInfo {
  assetId: string;
  symbol: string;
  tokenAddress: string;
  assetType: "STOCK" | "PRECIOUS_METAL" | "REAL_ESTATE" | "MMF" | "TBILL";
  active: boolean;
}

const ASSET_TYPE_MAP: Record<number, AssetInfo["assetType"]> = {
  0: "STOCK",
  1: "PRECIOUS_METAL",
  2: "REAL_ESTATE",
  3: "MMF",
  4: "TBILL",
};

/**
 * Xero Labs Oracle Client — query NAV prices for RWA assets on HashKey Chain.
 * Designed to be embedded in any DeFi protocol.
 *
 * @example
 * ```ts
 * const client = new OracleClient(ORACLE_ADDRESS, provider);
 * const price = await client.getPrice(ASSET_IDS.GOLD);
 * console.log(price.priceFormatted); // "1,924.56"
 * ```
 */
export class OracleClient {
  private readonly contract: ethers.Contract;

  constructor(oracleAddress: string, provider: ethers.Provider) {
    this.contract = new ethers.Contract(oracleAddress, XERO_ORACLE_ABI, provider);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Price queries
  // ──────────────────────────────────────────────────────────────────────────

  /** Fetch the current NAV price for a single asset. */
  async getPrice(assetId: string): Promise<NavPrice> {
    const raw = await this.contract.getPrice(assetId);
    return this._mapPrice(raw);
  }

  /** Fetch NAV prices for multiple assets in a single RPC call. */
  async getPriceBatch(assetIds: string[]): Promise<NavPrice[]> {
    const raws = await this.contract.getPriceBatch(assetIds);
    return (raws as any[]).map((r) => this._mapPrice(r));
  }

  /**
   * Compute the time-weighted average price over a given window.
   * @param assetId       Asset identifier
   * @param windowSeconds Length of the TWAP window in seconds (e.g. 3600 for 1 h)
   */
  async getTWAP(assetId: string, windowSeconds: number): Promise<bigint> {
    return BigInt(await this.contract.getTWAP(assetId, windowSeconds));
  }

  /** Returns false if the on-chain price is older than the staleness threshold. */
  async isFresh(assetId: string): Promise<boolean> {
    return this.contract.isFresh(assetId) as Promise<boolean>;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Asset enumeration
  // ──────────────────────────────────────────────────────────────────────────

  /** List all registered RWA assets. */
  async getAllAssets(): Promise<AssetInfo[]> {
    const raws = await this.contract.getAllAssets();
    return (raws as any[]).map((r) => this._mapAsset(r));
  }

  /** Fetch metadata for a specific asset. */
  async getAsset(assetId: string): Promise<AssetInfo> {
    const raw = await this.contract.getAsset(assetId);
    return this._mapAsset(raw);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Real-time subscription
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to on-chain PriceUpdated events for a specific asset.
   * @param assetId   Asset to watch
   * @param callback  Called with the new price whenever it is updated on-chain
   * @returns Unsubscribe function — call it to stop listening
   */
  subscribeToPrice(assetId: string, callback: (price: NavPrice) => void): () => void {
    const filter = this.contract.filters.PriceUpdated(assetId);

    const listener = async () => {
      try {
        const price = await this.getPrice(assetId);
        callback(price);
      } catch (err) {
        // Swallow errors in event callbacks to avoid crashing the listener
        console.error("[OracleClient] Error in price subscription:", err);
      }
    };

    this.contract.on(filter, listener);

    return () => {
      this.contract.off(filter, listener);
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Format a raw 8-decimal price bigint as a human-readable USD string.
   * @example formatPrice(285043200000n, 8) → "2,850.43"
   */
  formatPrice(rawPrice: bigint, decimals = 8): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = rawPrice / divisor;
    const frac  = rawPrice % divisor;

    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
    return `${whole.toLocaleString("en-US")}.${fracStr}`;
  }

  /**
   * Check if a price timestamp is stale given the asset type's default threshold.
   * @param updatedAt  Unix timestamp (seconds) of the last price update
   * @param assetType  Asset type string (e.g. "STOCK", "MMF")
   */
  isStale(updatedAt: number, assetType: string): boolean {
    const threshold = DEFAULT_STALENESS[assetType] ?? 3600;
    return Date.now() / 1000 - updatedAt > threshold;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────────

  private _mapPrice(raw: any): NavPrice {
    const price = BigInt(raw.price ?? raw[0]);
    return {
      price,
      updatedAt: Number(raw.updatedAt ?? raw[1]),
      confidence: Number(raw.confidence ?? raw[2]),
      isStale:    Boolean(raw.isStale ?? raw[3]),
      decimals:   Number(raw.decimals ?? raw[4]),
      priceFormatted: this.formatPrice(price, 8),
    };
  }

  private _mapAsset(raw: any): AssetInfo {
    const typeNum = Number(raw.assetType ?? raw[3]);
    return {
      assetId:      String(raw.assetId ?? raw[0]),
      symbol:       String(raw.symbol ?? raw[1]),
      tokenAddress: String(raw.tokenAddress ?? raw[2]),
      assetType:    ASSET_TYPE_MAP[typeNum] ?? "STOCK",
      active:       Boolean(raw.active ?? raw[4]),
    };
  }
}
