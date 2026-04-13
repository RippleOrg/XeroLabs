"use client";
import React, { useState, useCallback } from "react";
import { useXeroVault } from "../../hooks/useXeroVault";
import { StrategyDonutChart } from "../../components/StrategyDonutChart";
import { DepositWithdrawWidget } from "../../components/DepositWithdrawWidget";
import { ethers } from "ethers";

const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
const RPC_URL       = process.env.NEXT_PUBLIC_RPC_URL ?? "https://mainnet.hsk.xyz";

const VAULT_PREVIEW_ABI = [
  "function previewDeposit(uint256 assets) external view returns (uint256)",
  "function previewRedeem(uint256 shares) external view returns (uint256)",
];

const STRATEGY_NAMES: Record<number, string> = {
  0: "MMF Strategy",
  1: "T-Bill Strategy",
  2: "Gold Strategy",
};

function formatUSDC(raw: bigint): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });
}

export default function VaultPage() {
  const { tvl, apy, allocations, userShares, userUSDCValue, loading, error, deposit, withdraw, refresh } =
    useXeroVault();

  // Wallet state (simplified — production would use wagmi/RainbowKit)
  const [isConnected] = useState(false);
  const [walletAddress] = useState<string | null>(null);

  const previewDeposit = useCallback(async (amount: bigint) => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_PREVIEW_ABI, provider);
    return BigInt(await vault.previewDeposit(amount));
  }, []);

  const previewWithdraw = useCallback(async (shares: bigint) => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_PREVIEW_ABI, provider);
    return BigInt(await vault.previewRedeem(shares));
  }, []);

  const handleDeposit = useCallback(async (amount: bigint) => {
    // In production: get signer from wagmi/MetaMask
    throw new Error("Connect wallet to deposit");
  }, []);

  const handleWithdraw = useCallback(async (shares: bigint) => {
    throw new Error("Connect wallet to withdraw");
  }, []);

  const namedAllocations = allocations.map((a, i) => ({
    ...a,
    name: STRATEGY_NAMES[i] ?? `Strategy ${i + 1}`,
    apy:  i === 0 ? 5.0 : i === 1 ? 5.3 : 1.5, // mock APY per strategy
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900">Vault Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Deposit USDC and earn blended yield across tokenized RWA strategies. Fully on-chain.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Hero stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
        <StatCard
          label="Total Value Locked"
          value={loading ? "—" : formatUSDC(tvl)}
          accent="indigo"
        />
        <StatCard
          label="Current Blended APY"
          value={loading ? "—" : `${apy.toFixed(2)}%`}
          accent="green"
        />
        <StatCard
          label="Active Strategies"
          value={loading ? "—" : String(allocations.filter(a => a.currentValueUSDC > 0n).length)}
          accent="cyan"
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: strategy breakdown + my position */}
        <div className="space-y-6">
          {/* Strategy donut */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">Strategy Allocation</h2>
            <StrategyDonutChart allocations={namedAllocations} />
          </div>

          {/* My position */}
          {walletAddress && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-bold text-gray-900 mb-4">My Position</h2>
              <div className="space-y-3">
                <Row label="xVAULT Shares" value={userShares.toLocaleString()} />
                <Row label="USDC Value" value={formatUSDC(userUSDCValue)} />
              </div>
            </div>
          )}
        </div>

        {/* Right: deposit/withdraw widget */}
        <div>
          <DepositWithdrawWidget
            previewDeposit={previewDeposit}
            previewWithdraw={previewWithdraw}
            onDeposit={handleDeposit}
            onWithdraw={handleWithdraw}
            isConnected={isConnected}
            onConnect={() => alert("Connect wallet via MetaMask / WalletConnect")}
          />

          {/* Strategy table */}
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Strategy Breakdown</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 font-medium border-b border-gray-100">
                  <th className="px-5 py-2 text-left">Strategy</th>
                  <th className="px-5 py-2 text-right">Value</th>
                  <th className="px-5 py-2 text-right">Alloc</th>
                  <th className="px-5 py-2 text-right">APY</th>
                </tr>
              </thead>
              <tbody>
                {namedAllocations.map((a, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{a.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{formatUSDC(a.currentValueUSDC)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{a.allocationPercent.toFixed(1)}%</td>
                    <td className="px-5 py-3 text-right font-semibold text-green-600">{(a.apy ?? 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    indigo: "bg-indigo-600",
    green:  "bg-green-600",
    cyan:   "bg-cyan-600",
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className={`w-2 h-2 rounded-full ${colors[accent] ?? "bg-gray-400"} mb-3`} />
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-gray-900">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}
