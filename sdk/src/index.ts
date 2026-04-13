// ── Oracle ───────────────────────────────────────────────────────────────────
export { OracleClient }      from "./oracle/OracleClient";
export type { NavPrice, AssetInfo } from "./oracle/OracleClient";
export { PriceFeed }         from "./oracle/PriceFeed";
export type { PriceFeedOptions } from "./oracle/PriceFeed";
export { ASSET_IDS, ASSET_ID_TO_KEY, DEFAULT_STALENESS } from "./oracle/AssetList";
export type { AssetKey }     from "./oracle/AssetList";

// ── Vault ────────────────────────────────────────────────────────────────────
export { VaultClient }       from "./vault/VaultClient";
export type { StrategyAllocation, VaultStats } from "./vault/VaultClient";
export { aprToApy, blendedApy, estimateYield, computeApy } from "./vault/YieldCalculator";

// ── ABIs ─────────────────────────────────────────────────────────────────────
export { XERO_ORACLE_ABI, XERO_VAULT_ABI } from "./abis";
