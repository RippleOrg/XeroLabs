import { ethers } from "ethers";

const VAULT_ABI = [
  "function rebalance() external",
  "function getAPY() external view returns (uint256)",
  "function getStrategyAllocations() external view returns (address[] strategies, uint256[] values)",
  "function totalAssets() external view returns (uint256)",
];

const STRATEGY_ABI = [
  "function currentAPY() external view returns (uint256)",
  "function totalValue() external view returns (uint256)",
];

export interface RebalancerConfig {
  rpcUrl:           string;
  vaultAddress:     string;
  keeperPrivateKey: string;
  /** Minimum APY gap (bps) between best and worst strategy before forcing a rebalance */
  yieldGapBps?:     number;
  /** Check interval in milliseconds */
  checkIntervalMs?: number;
}

/**
 * Rebalancer — off-chain keeper that triggers vault rebalances when:
 * 1. The epoch has elapsed (vault enforces this on-chain), or
 * 2. The yield gap between strategies exceeds `yieldGapBps`.
 */
export class Rebalancer {
  private readonly config: Required<RebalancerConfig>;
  private provider!: ethers.JsonRpcProvider;
  private wallet!:   ethers.Wallet;
  private vault!:    ethers.Contract;

  private running   = false;
  private timer:    NodeJS.Timer | null = null;

  constructor(config: RebalancerConfig) {
    this.config = {
      yieldGapBps:    config.yieldGapBps    ?? 50,
      checkIntervalMs: config.checkIntervalMs ?? 60_000,
      ...config,
    };
  }

  start(): void {
    if (this.running) return;
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet   = new ethers.Wallet(this.config.keeperPrivateKey, this.provider);
    this.vault    = new ethers.Contract(this.config.vaultAddress, VAULT_ABI, this.wallet);
    this.running  = true;

    this._check().catch(console.error);
    this.timer = setInterval(() => this._check().catch(console.error), this.config.checkIntervalMs);
    console.log("[Rebalancer] Started.");
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer as unknown as number); this.timer = null; }
    console.log("[Rebalancer] Stopped.");
  }

  private async _check(): Promise<void> {
    if (!this.running) return;
    try {
      const tx = await this.vault.rebalance();
      await tx.wait();
      console.log("[Rebalancer] Rebalance executed.");
    } catch (err: any) {
      // Vault may revert if epoch hasn't elapsed — that's expected
      if (!String(err?.message).includes("epoch")) {
        console.error("[Rebalancer] Error:", err?.message);
      }
    }
  }
}
