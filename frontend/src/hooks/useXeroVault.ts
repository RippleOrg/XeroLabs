import { ethers } from "ethers";
import { useState, useEffect, useCallback } from "react";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const RPC_URL       = process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.hsk.xyz";

const VAULT_ABI = [
  "function totalAssets() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function getAPY() external view returns (uint256)",
  "function getStrategyAllocations() external view returns (address[] strategies, uint256[] values)",
  "function previewDeposit(uint256 assets) external view returns (uint256)",
  "function previewRedeem(uint256 shares) external view returns (uint256)",
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
];

export interface StrategyAllocation {
  strategyAddress:   string;
  currentValueUSDC:  bigint;
  allocationPercent: number;
}

export interface VaultHookResult {
  tvl:         bigint;
  apy:         number;  // percentage e.g. 5.23
  allocations: StrategyAllocation[];
  userShares:  bigint;
  userUSDCValue: bigint;
  loading:     boolean;
  error:       string | null;
  deposit:     (amount: bigint, signer: ethers.Signer) => Promise<string>;
  withdraw:    (shares: bigint, signer: ethers.Signer) => Promise<string>;
  refresh:     () => void;
}

/**
 * useXeroVault — React hook for vault TVL, APY, allocations and user position.
 * @param userAddress Optional user address to load their position.
 */
export function useXeroVault(userAddress?: string): VaultHookResult {
  const [tvl,           setTvl]           = useState(0n);
  const [apy,           setApy]           = useState(0);
  const [allocations,   setAllocations]   = useState<StrategyAllocation[]>([]);
  const [userShares,    setUserShares]    = useState(0n);
  const [userUSDCValue, setUserUSDCValue] = useState(0n);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!VAULT_ADDRESS) { setError("Vault address not configured"); setLoading(false); return; }
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const vault    = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

      const [ta, apyBps, [strategies, values]] = await Promise.all([
        vault.totalAssets(),
        vault.getAPY(),
        vault.getStrategyAllocations(),
      ]);

      const total = (values as bigint[]).reduce((acc: bigint, v: bigint) => acc + BigInt(v), 0n);
      const allocs: StrategyAllocation[] = (strategies as string[]).map((addr: string, i: number) => ({
        strategyAddress:   addr,
        currentValueUSDC:  BigInt(values[i]),
        allocationPercent: total > 0n ? Number((BigInt(values[i]) * 10000n) / total) / 100 : 0,
      }));

      setTvl(BigInt(ta));
      setApy(Number(apyBps) / 100);
      setAllocations(allocs);

      if (userAddress) {
        const [shares, usdcVal] = await Promise.all([
          vault.balanceOf(userAddress),
          vault.convertToAssets(await vault.balanceOf(userAddress)),
        ]);
        setUserShares(BigInt(shares));
        setUserUSDCValue(BigInt(usdcVal));
      }

      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const t = setInterval(fetchAll, 30_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const deposit = useCallback(async (amount: bigint, signer: ethers.Signer) => {
    const vault    = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
    const receiver = await signer.getAddress();
    const tx       = await vault.deposit(amount, receiver);
    const receipt  = await tx.wait();
    fetchAll();
    return receipt.hash;
  }, [fetchAll]);

  const withdraw = useCallback(async (shares: bigint, signer: ethers.Signer) => {
    const vault   = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
    const owner   = await signer.getAddress();
    const tx      = await vault.redeem(shares, owner, owner);
    const receipt = await tx.wait();
    fetchAll();
    return receipt.hash;
  }, [fetchAll]);

  return { tvl, apy, allocations, userShares, userUSDCValue, loading, error, deposit, withdraw, refresh: fetchAll };
}
