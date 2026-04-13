"use client";
import React from "react";
import { useXeroOracle } from "../../hooks/useXeroOracle";
import { NavPriceCard } from "../../components/NavPriceCard";
import { IntegrationSnippet } from "../../components/IntegrationSnippet";

const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS ?? "";

export default function OraclePage() {
  const { prices, loading, error, refresh } = useXeroOracle();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">Oracle Explorer</h1>
          <p className="mt-1 text-gray-500 text-sm">
            Live on-chain NAV prices for tokenized RWA assets on HashKey Chain.
            Auto-refreshes every 30 s via on-chain events.
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 font-medium text-sm hover:bg-indigo-100 transition-colors border border-indigo-200"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Price grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-gray-100 animate-pulse h-32" />
          ))}
        </div>
      ) : prices.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-200 p-12 text-center text-gray-400 mb-12">
          No assets registered yet. Deploy and register assets first.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {prices.map((p) => (
            <NavPriceCard key={p.assetId} data={p} />
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-200 mb-10" />

      {/* Integration guide */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Integrate Xero Labs Oracle in Your Protocol
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Any DeFi protocol on HashKey Chain can query our permissionless NAV oracle
          with a single external call — no API keys, no permissioned access.
        </p>
        <IntegrationSnippet oracleAddress={ORACLE_ADDRESS} />
      </div>
    </div>
  );
}
