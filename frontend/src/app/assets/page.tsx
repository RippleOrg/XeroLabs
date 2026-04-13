"use client";
import React from "react";
import { useXeroOracle } from "../../hooks/useXeroOracle";

const ASSET_TYPE_LABELS = ["Stock", "Precious Metal", "Real Estate", "MMF", "T-Bill"];
const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "";

export default function AssetsPage() {
  const { prices, loading, error } = useXeroOracle();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">Asset Registry</h1>
          <p className="mt-1 text-sm text-gray-500">
            All registered tokenized RWA assets tracked by the Xero Labs oracle on HashKey Chain.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Assets table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm animate-pulse">
            Loading assets…
          </div>
        ) : prices.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            No assets registered yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Symbol", "Type", "Asset ID (truncated)", "Current NAV", "Confidence", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prices.map((asset) => (
                <tr key={asset.assetId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-bold text-gray-900">{asset.symbol}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                      {ASSET_TYPE_LABELS[asset.assetType] ?? "Unknown"}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-gray-400 text-xs">
                    {asset.assetId.slice(0, 10)}…{asset.assetId.slice(-6)}
                  </td>
                  <td className="px-5 py-3 font-mono font-semibold text-gray-900">
                    ${asset.formatted}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${asset.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{asset.confidence}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {asset.isStale ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Stale
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Fresh
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
