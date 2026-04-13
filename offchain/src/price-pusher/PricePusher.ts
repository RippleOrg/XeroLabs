import { ethers } from "ethers";
import { ASSET_IDS } from "../../sdk/src/oracle/AssetList";

// ── Minimal ABI for on-chain price push ──────────────────────────────────────
const ORACLE_ABI = [
  "function updatePriceBatch(bytes32[] assetIds, uint256[] prices, uint8[] sourceIds) external",
  "function updatePrice(bytes32 assetId, uint256 price, uint8 sourceId) external",
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface PusherConfig {
  rpcUrl:          string;
  fallbackRpcUrl?: string;
  oracleAddress:   string;
  pusherPrivateKey: string;
  /** Source ID assigned to this pusher service (1–255) */
  sourceId:        number;
  /** Minimum price change (bps) before pushing. Default: 10 (0.1%) */
  minChangeBps?:   number;
  /** Maximum age (seconds) before forcing a push. Default: 3600 */
  maxAgeSeconds?:  number;
}

export interface PusherStatus {
  running:         boolean;
  lastPushAt:      Record<string, number>;   // assetId → Unix timestamp
  pendingAssets:   string[];
  gasSpentToday:   bigint;
  pushesLast24h:   number;
}

interface AssetState {
  assetId:     string;
  lastPrice:   bigint;
  lastPushAt:  number;
}

// ── Mock price source ─────────────────────────────────────────────────────────
// In production this would call Chainlink feeds, Pyth, CoinGecko, etc.
// For the hackathon it returns plausible mock prices with slight random drift.

const MOCK_BASE_PRICES: Record<string, bigint> = {
  [ASSET_IDS.TSLA]:       28473_00000000n,  // $284.73
  [ASSET_IDS.AAPL]:       19587_00000000n,  // $195.87
  [ASSET_IDS.NVDA]:       87523_00000000n,  // $875.23
  [ASSET_IDS.GOLD]:       193574_00000000n, // $1,935.74
  [ASSET_IDS.SILVER]:     2427_00000000n,   // $24.27
  [ASSET_IDS.MMF_USD]:    1_00000000n,      // $1.00 (stable)
  [ASSET_IDS.TBILL_3M]:   9978_00000000n,   // $99.78 (discount price)
  [ASSET_IDS.TBILL_1M]:   9993_00000000n,   // $99.93
  [ASSET_IDS.US_RE_INDEX]: 35421_00000000n, // $354.21
};

function fetchMockPrice(assetId: string, previousPrice?: bigint): bigint {
  const base = MOCK_BASE_PRICES[assetId] ?? 1_00000000n;
  if (!previousPrice) return base;

  // Small random drift: ±0.05%
  const driftBps = BigInt(Math.floor(Math.random() * 10) - 5); // -5 to +4 bps
  return (previousPrice * (10000n + driftBps)) / 10000n;
}

// ── PricePusher ───────────────────────────────────────────────────────────────

/**
 * PricePusher — off-chain service that fetches RWA NAV prices from multiple
 * data providers and pushes them on-chain to XeroOracle.
 *
 * Push logic:
 * - Poll all assets every 60 s.
 * - Push only if: (a) price changed > minChangeBps, OR (b) last push > maxAgeSeconds ago.
 * - Batch all stale assets into a single updatePriceBatch() call (gas efficiency).
 * - Circuit breaker: after 3 consecutive failures, pause and emit alert.
 */
export class PricePusher {
  private readonly config: Required<PusherConfig>;
  private provider!:  ethers.JsonRpcProvider;
  private wallet!:    ethers.Wallet;
  private oracle!:    ethers.Contract;

  private assetStates: Map<string, AssetState> = new Map();
  private running     = false;
  private pollTimer:  NodeJS.Timer | null = null;
  private failCount   = 0;
  private gasToday    = 0n;
  private pushCount   = 0;

  constructor(config: PusherConfig) {
    this.config = {
      fallbackRpcUrl:  config.fallbackRpcUrl ?? config.rpcUrl,
      minChangeBps:    config.minChangeBps   ?? 10,
      maxAgeSeconds:   config.maxAgeSeconds  ?? 3600,
      ...config,
    };

    // Initialise asset states for all known assets
    for (const assetId of Object.values(ASSET_IDS)) {
      this.assetStates.set(assetId, { assetId, lastPrice: 0n, lastPushAt: 0 });
    }
  }

  /** Start the price pusher. */
  start(): void {
    if (this.running) return;
    this._connect(this.config.rpcUrl);
    this.running = true;

    // Immediate first push
    this._poll().catch(console.error);

    // Schedule recurring polls every 60 s
    this.pollTimer = setInterval(() => {
      this._poll().catch(console.error);
    }, 60_000);

    console.log("[PricePusher] Started. Oracle:", this.config.oracleAddress);
  }

  /** Stop the price pusher. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer as unknown as number);
      this.pollTimer = null;
    }
    console.log("[PricePusher] Stopped.");
  }

  /**
   * Force push a single asset immediately.
   * @returns Transaction hash
   */
  async forcePush(assetId: string): Promise<string> {
    const price = this._fetchPrice(assetId);
    const tx = await this.oracle.updatePrice(assetId, price, this.config.sourceId);
    const receipt = await tx.wait();

    const state = this.assetStates.get(assetId)!;
    state.lastPrice  = price;
    state.lastPushAt = Math.floor(Date.now() / 1000);
    this.gasToday   += receipt.gasUsed * receipt.gasPrice;
    this.pushCount++;

    return receipt.hash;
  }

  /** Return current pusher status. */
  getStatus(): PusherStatus {
    const now = Math.floor(Date.now() / 1000);
    const lastPushAt: Record<string, number> = {};
    const pendingAssets: string[] = [];

    for (const [id, state] of this.assetStates) {
      lastPushAt[id] = state.lastPushAt;
      if (now - state.lastPushAt > this.config.maxAgeSeconds) {
        pendingAssets.push(id);
      }
    }

    return {
      running:       this.running,
      lastPushAt,
      pendingAssets,
      gasSpentToday: this.gasToday,
      pushesLast24h: this.pushCount,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────────────────────

  private _connect(rpcUrl: string): void {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet   = new ethers.Wallet(this.config.pusherPrivateKey, this.provider);
    this.oracle   = new ethers.Contract(this.config.oracleAddress, ORACLE_ABI, this.wallet);
  }

  private async _poll(): Promise<void> {
    if (!this.running) return;

    const now        = Math.floor(Date.now() / 1000);
    const toBatch: { assetId: string; price: bigint }[] = [];

    for (const [assetId, state] of this.assetStates) {
      const newPrice = this._fetchPrice(assetId, state.lastPrice || undefined);

      // Decide whether to push
      const ageSecs = now - state.lastPushAt;
      let shouldPush = ageSecs > this.config.maxAgeSeconds;

      if (!shouldPush && state.lastPrice > 0n) {
        const diff = newPrice > state.lastPrice
          ? newPrice - state.lastPrice
          : state.lastPrice - newPrice;
        const changeBps = Number((diff * 10000n) / state.lastPrice);
        shouldPush = changeBps >= this.config.minChangeBps;
      } else if (state.lastPrice === 0n) {
        shouldPush = true;
      }

      if (shouldPush) toBatch.push({ assetId, price: newPrice });
    }

    if (toBatch.length === 0) return;

    try {
      const assetIds = toBatch.map((x) => x.assetId);
      const prices   = toBatch.map((x) => x.price);
      const sources  = toBatch.map(() => this.config.sourceId);

      const tx      = await this.oracle.updatePriceBatch(assetIds, prices, sources);
      const receipt = await tx.wait();

      // Update state
      for (const { assetId, price } of toBatch) {
        const state = this.assetStates.get(assetId)!;
        state.lastPrice  = price;
        state.lastPushAt = now;
      }

      this.gasToday += receipt.gasUsed * receipt.gasPrice;
      this.pushCount++;
      this.failCount = 0; // reset circuit breaker

      console.log(`[PricePusher] Pushed ${toBatch.length} assets. Gas: ${receipt.gasUsed}`);
    } catch (err) {
      this.failCount++;
      console.error(`[PricePusher] Push failed (attempt ${this.failCount}):`, err);

      if (this.failCount >= 3) {
        console.error("[PricePusher] Circuit breaker triggered — pausing pusher.");
        this.stop();
        // In production: send alert (PagerDuty, Slack, etc.)
      } else {
        // Retry via fallback RPC
        this._connect(this.config.fallbackRpcUrl);
      }
    }
  }

  private _fetchPrice(assetId: string, previousPrice?: bigint): bigint {
    // In production: call Chainlink / Pyth / CoinGecko
    return fetchMockPrice(assetId, previousPrice);
  }
}
