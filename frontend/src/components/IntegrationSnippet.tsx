"use client";
import React, { useState } from "react";

interface IntegrationSnippetProps {
  oracleAddress?: string;
}

const SOLIDITY_TEMPLATE = (address: string) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IXeroOracle {
    struct NavPrice {
        uint256 price;      // 8 decimals USD
        uint256 updatedAt;
        uint8   confidence; // 0-100
        bool    isStale;
        uint8   decimals;
    }
    function getPrice(bytes32 assetId) external view returns (NavPrice memory);
    function isFresh(bytes32 assetId)  external view returns (bool);
}

contract MyProtocol {
    IXeroOracle constant oracle = IXeroOracle(${address || "0xYOUR_ORACLE_ADDRESS"});
    bytes32     constant GOLD   = keccak256("XAU-TOKENIZED");

    function getGoldPrice() external view returns (uint256 price) {
        require(oracle.isFresh(GOLD), "Stale price");
        IXeroOracle.NavPrice memory p = oracle.getPrice(GOLD);
        return p.price; // 8-decimal USD e.g. 195000000000 = $1,950
    }
}`;

/**
 * IntegrationSnippet — shows the one-click Solidity integration pattern.
 */
export function IntegrationSnippet({ oracleAddress }: IntegrationSnippetProps) {
  const [copied, setCopied] = useState(false);
  const code = SOLIDITY_TEMPLATE(oracleAddress ?? "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  };

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-gray-400 font-mono">MyProtocol.sol</span>
        <button
          onClick={handleCopy}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {copied ? "✓ Copied!" : "Copy"}
        </button>
      </div>

      {/* Code */}
      <pre className="overflow-x-auto text-xs font-mono text-green-300 p-5 leading-relaxed">
        <code>{code}</code>
      </pre>

      {/* Footer note */}
      <div className="px-4 py-2 bg-gray-900 border-t border-gray-800">
        <p className="text-xs text-gray-500">
          That&apos;s it. One external call to query any tokenized RWA price on HashKey Chain.
        </p>
      </div>
    </div>
  );
}
