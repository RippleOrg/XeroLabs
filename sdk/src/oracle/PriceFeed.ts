import { ethers } from "ethers";
import { OracleClient, NavPrice } from "./OracleClient";

export interface PriceFeedOptions {
  /** Polling interval in milliseconds (default: 30_000) */
  pollingIntervalMs?: number;
  /** If true, use on-chain event subscription; otherwise poll via RPC */
  useEvents?: boolean;
}

/**
 * PriceFeed — subscribes to live NAV price updates for one or more assets.
 *
 * @example
 * ```ts
 * const feed = new PriceFeed(client, [ASSET_IDS.GOLD, ASSET_IDS.TSLA]);
 * feed.on("price", (assetId, price) => console.log(assetId, price.priceFormatted));
 * await feed.start();
 * // later...
 * feed.stop();
 * ```
 */
export class PriceFeed {
  private readonly client: OracleClient;
  private readonly assetIds: string[];
  private readonly options: Required<PriceFeedOptions>;

  private unsubscribeFns: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Map<string, ((assetId: string, price: NavPrice) => void)[]> = new Map();

  constructor(client: OracleClient, assetIds: string[], options: PriceFeedOptions = {}) {
    this.client = client;
    this.assetIds = [...assetIds];
    this.options = {
      pollingIntervalMs: options.pollingIntervalMs ?? 30_000,
      useEvents: options.useEvents ?? true,
    };
  }

  /**
   * Register a listener for price update events.
   * @param event    "price" | "error"
   * @param listener Callback
   */
  on(event: "price", listener: (assetId: string, price: NavPrice) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener as any);
    this.listeners.set(event, existing);
    return this;
  }

  /** Start the price feed. */
  async start(): Promise<void> {
    if (this.options.useEvents) {
      // Subscribe to on-chain events for each asset
      for (const assetId of this.assetIds) {
        const unsub = this.client.subscribeToPrice(assetId, (price) => {
          this._emit("price", assetId, price);
        });
        this.unsubscribeFns.push(unsub);
      }
    } else {
      // Poll via RPC
      this.pollTimer = setInterval(async () => {
        try {
          const prices = await this.client.getPriceBatch(this.assetIds);
          prices.forEach((price, i) => {
            this._emit("price", this.assetIds[i], price);
          });
        } catch (err) {
          this._emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      }, this.options.pollingIntervalMs);

      // Fetch immediately on start
      try {
        const prices = await this.client.getPriceBatch(this.assetIds);
        prices.forEach((price, i) => {
          this._emit("price", this.assetIds[i], price);
        });
      } catch (err) {
        this._emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** Stop the price feed and clean up listeners. */
  stop(): void {
    this.unsubscribeFns.forEach((fn) => fn());
    this.unsubscribeFns = [];

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private _emit(event: string, ...args: any[]): void {
    const fns = this.listeners.get(event) ?? [];
    for (const fn of fns) {
      try {
        fn(...args);
      } catch {
        // Swallow listener errors
      }
    }
  }
}
