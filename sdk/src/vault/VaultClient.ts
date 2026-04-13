import { ethers } from "ethers";
import { XERO_VAULT_ABI } from "../abis";

export interface StrategyAllocation {
  strategyAddress: string;
  currentValueUSDC: bigint;
  allocationPercent: number;
}

export interface VaultStats {
  totalAssets: bigint;
  totalShares: bigint;
  apyBps: bigint;
  sharePrice: bigint; // assets per share (18 decimals)
}

/**
 * Xero Labs Vault Client — interact with the XeroVault ERC-4626 contract.
 *
 * @example
 * ```ts
 * const client = new VaultClient(VAULT_ADDRESS, provider);
 *
 * // Deposit 100 USDC
 * const receipt = await client.deposit(100_000_000n, signer);
 *
 * // Get current APY
 * const apy = await client.getAPY();
 * console.log(`Current APY: ${apy.toFixed(2)}%`);
 * ```
 */
export class VaultClient {
  private readonly contract: ethers.Contract;
  private readonly address: string;

  constructor(vaultAddress: string, provider: ethers.Provider) {
    this.address  = vaultAddress;
    this.contract = new ethers.Contract(vaultAddress, XERO_VAULT_ABI, provider);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Deposits & withdrawals (require a Signer)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Deposit USDC into the vault.
   * NOTE: The caller must approve the vault to spend the USDC first.
   * @param amount   Amount of USDC to deposit (6-decimal)
   * @param signer   Ethers Signer for the depositor
   * @returns        Transaction receipt
   */
  async deposit(amount: bigint, signer: ethers.Signer): Promise<ethers.TransactionReceipt> {
    const signed = this.contract.connect(signer) as ethers.Contract;
    const receiver = await signer.getAddress();
    const tx = await signed.deposit(amount, receiver);
    return tx.wait() as Promise<ethers.TransactionReceipt>;
  }

  /**
   * Redeem xVAULT shares for USDC.
   * @param shares   Number of vault shares to redeem
   * @param signer   Ethers Signer for the share owner
   */
  async withdraw(shares: bigint, signer: ethers.Signer): Promise<ethers.TransactionReceipt> {
    const signed = this.contract.connect(signer) as ethers.Contract;
    const owner  = await signer.getAddress();
    const tx = await signed.redeem(shares, owner, owner);
    return tx.wait() as Promise<ethers.TransactionReceipt>;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // View functions
  // ──────────────────────────────────────────────────────────────────────────

  /** xVAULT share balance for an address. */
  async getShareBalance(address: string): Promise<bigint> {
    return BigInt(await this.contract.balanceOf(address));
  }

  /**
   * Convert a share balance to its current USDC value.
   * @param shares  Number of vault shares
   */
  async getUSDCValue(shares: bigint): Promise<bigint> {
    return BigInt(await this.contract.convertToAssets(shares));
  }

  /**
   * Get the blended APY across all RWA strategies as a percentage number.
   * @returns APY as a percentage, e.g. 5.23
   */
  async getAPY(): Promise<number> {
    const apyBps = BigInt(await this.contract.getAPY());
    return Number(apyBps) / 100;
  }

  /** Get current strategy allocations. */
  async getStrategyAllocations(): Promise<StrategyAllocation[]> {
    const [strategies, values] = await this.contract.getStrategyAllocations();
    const total = (values as bigint[]).reduce((acc: bigint, v: bigint) => acc + BigInt(v), 0n);

    return (strategies as string[]).map((addr: string, i: number) => ({
      strategyAddress:   addr,
      currentValueUSDC:  BigInt(values[i]),
      allocationPercent: total > 0n ? Number((BigInt(values[i]) * 10000n) / total) / 100 : 0,
    }));
  }

  /** Total USDC value locked in the vault. */
  async getTotalTVL(): Promise<bigint> {
    return BigInt(await this.contract.totalAssets());
  }

  /**
   * Preview how many xVAULT shares a given USDC deposit would yield.
   * @param amount  USDC amount (6-decimal)
   */
  async previewDeposit(amount: bigint): Promise<bigint> {
    return BigInt(await this.contract.previewDeposit(amount));
  }

  /**
   * Preview how much USDC a given share redemption would yield.
   * @param shares  Number of vault shares
   */
  async previewWithdraw(shares: bigint): Promise<bigint> {
    return BigInt(await this.contract.previewRedeem(shares));
  }

  /** Get combined vault stats in a single call. */
  async getVaultStats(): Promise<VaultStats> {
    const [totalAssets, totalShares, apyBps] = await Promise.all([
      this.contract.totalAssets(),
      this.contract.totalSupply(),
      this.contract.getAPY(),
    ]);

    const ta = BigInt(totalAssets);
    const ts = BigInt(totalShares);
    const sharePrice = ts > 0n ? (ta * 10n ** 18n) / ts : 10n ** 18n;

    return {
      totalAssets:  ta,
      totalShares:  ts,
      apyBps:       BigInt(apyBps),
      sharePrice,
    };
  }
}
