"use client";
import React, { useState, useEffect } from "react";

interface LivePrice {
  assetId:    string;
  symbol:     string;
  assetType:  number;
  price:      bigint;
  updatedAt:  number;
  confidence: number;
  isStale:    boolean;
  formatted:  string;
}

interface NavPriceCardProps {
  data: LivePrice;
}

const ASSET_TYPE_LABELS: Record<number, string> = {
  0: "Stock",
  1: "Precious Metal",
  2: "Real Estate",
  3: "MMF",
  4: "T-Bill",
};

function relativeTime(ts: number): string {
  if (ts === 0) return "Never";
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function confidenceColor(confidence: number, isStale: boolean): string {
  if (isStale) return "bg-red-100 text-red-700 border-red-200";
  if (confidence >= 80) return "bg-green-100 text-green-700 border-green-200";
  if (confidence >= 50) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}

/**
 * NavPriceCard — displays a live NAV price for a single RWA asset.
 * Pulses briefly when the price updates.
 */
export function NavPriceCard({ data }: NavPriceCardProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 800);
    return () => clearTimeout(t);
  }, [data.price]);

  const cardBorder = data.isStale
    ? "border-red-300"
    : data.confidence >= 80
    ? "border-green-300"
    : "border-amber-300";

  const statusColor = data.isStale
    ? "text-red-600"
    : data.confidence >= 80
    ? "text-green-600"
    : "text-amber-600";

  return (
    <div
      className={`
        relative rounded-2xl border-2 bg-white shadow-sm p-5 transition-all duration-300
        ${cardBorder}
        ${pulse ? "scale-[1.02] shadow-md" : ""}
      `}
    >
      {/* Pulse ring animation on price update */}
      {pulse && (
        <span className="absolute inset-0 rounded-2xl border-2 border-blue-400 animate-ping opacity-50" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-lg font-bold text-gray-900">{data.symbol}</span>
          <span className="ml-2 text-xs text-gray-400">{ASSET_TYPE_LABELS[data.assetType]}</span>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${confidenceColor(data.confidence, data.isStale)}`}
        >
          {data.isStale ? "STALE" : `${data.confidence}% conf`}
        </span>
      </div>

      {/* Price */}
      <div className="text-3xl font-mono font-extrabold text-gray-900 mb-1">
        ${data.formatted}
      </div>

      {/* Footer */}
      <div className={`text-xs font-medium ${statusColor}`}>
        Updated {relativeTime(data.updatedAt)}
      </div>
    </div>
  );
}
