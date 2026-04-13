import { ethers } from "ethers";
import { useState, useEffect, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS ?? "";
const RPC_URL        = process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.hsk.xyz";

const ORACLE_ABI = [
  "function getPrice(bytes32 assetId) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals))",
  "function getAllAssets() external view returns (tuple(bytes32 assetId, string symbol, address tokenAddress, uint8 assetType, bool active)[])",
  "function getPriceBatch(bytes32[] assetIds) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals)[])",
  "event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 timestamp, uint8 confidence)",
];

export interface LivePrice {
  assetId:    string;
  symbol:     string;
  assetType:  number;
  price:      bigint;
  updatedAt:  number;
  confidence: number;
  isStale:    boolean;
  formatted:  string;
  change24h?: number; // percentage
}

function formatPrice(raw: bigint): string {
  const divisor = 10n ** 8n;
  const whole   = raw / divisor;
  const frac    = raw % divisor;
  const fracStr = frac.toString().padStart(8, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useXeroOracle — React hook providing live NAV prices for all supported assets.
 *
 * @returns { prices, loading, error, refresh }
 */
export function useXeroOracle() {
  const [prices,  setPrices]  = useState<LivePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!ORACLE_ADDRESS) { setError("Oracle address not configured"); setLoading(false); return; }
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const oracle   = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);

      const assets = await oracle.getAllAssets();
      if (!assets.length) { setPrices([]); setLoading(false); return; }

      const ids    = (assets as any[]).map((a: any) => a.assetId);
      const pRaws  = await oracle.getPriceBatch(ids);

      const mapped: LivePrice[] = (assets as any[]).map((a: any, i: number) => ({
        assetId:    a.assetId,
        symbol:     a.symbol,
        assetType:  Number(a.assetType),
        price:      BigInt(pRaws[i].price),
        updatedAt:  Number(pRaws[i].updatedAt),
        confidence: Number(pRaws[i].confidence),
        isStale:    Boolean(pRaws[i].isStale),
        formatted:  formatPrice(BigInt(pRaws[i].price)),
      }));

      setPrices(mapped);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  // Subscribe to on-chain PriceUpdated events for real-time updates
  useEffect(() => {
    if (!ORACLE_ADDRESS) return;
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const oracle   = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);

    const handler = () => { fetchAll(); };
    oracle.on("PriceUpdated", handler);
    return () => { oracle.off("PriceUpdated", handler); };
  }, [fetchAll]);

  return { prices, loading, error, refresh: fetchAll };
}
