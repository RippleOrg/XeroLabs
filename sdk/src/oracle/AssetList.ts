import { ethers } from "ethers";

/** Pre-computed keccak256 asset IDs matching the on-chain registry. */
export const ASSET_IDS = {
  TSLA:       ethers.id("TSLA-TOKENIZED"),
  AAPL:       ethers.id("AAPL-TOKENIZED"),
  NVDA:       ethers.id("NVDA-TOKENIZED"),
  GOLD:       ethers.id("XAU-TOKENIZED"),
  SILVER:     ethers.id("XAG-TOKENIZED"),
  US_RE_INDEX: ethers.id("US-REAL-ESTATE-INDEX"),
  MMF_USD:    ethers.id("MMF-USD"),
  TBILL_1M:   ethers.id("TBILL-1M"),
  TBILL_3M:   ethers.id("TBILL-3M"),
} as const;

export type AssetKey = keyof typeof ASSET_IDS;

/** Mapping from assetId (hex string) back to the human-readable key. */
export const ASSET_ID_TO_KEY: Record<string, AssetKey> = Object.fromEntries(
  (Object.entries(ASSET_IDS) as [AssetKey, string][]).map(([k, v]) => [v, k])
) as Record<string, AssetKey>;

/** Default staleness thresholds per asset type (seconds). */
export const DEFAULT_STALENESS: Record<string, number> = {
  STOCK:           3600,   // 1 hour
  PRECIOUS_METAL:  86400,  // 24 hours
  REAL_ESTATE:     86400,
  MMF:             3600,
  TBILL:           86400,
};
