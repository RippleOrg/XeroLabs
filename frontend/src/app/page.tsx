import React from "react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold mb-6">
          HashKey Chain On-Chain Horizon Hackathon — DeFi Track
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight mb-5">
          Permissionless NAV Oracle<br />
          <span className="text-indigo-600">for Tokenized RWAs</span>
        </h1>

        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-8">
          Xero Labs publishes a composable on-chain price feed for tokenized stocks,
          gold, real estate, and money-market funds — then auto-routes stablecoin
          deposits into the highest-yielding RWA pool.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/oracle"
            className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
          >
            Explore Oracle →
          </Link>
          <Link
            href="/vault"
            className="px-6 py-3 rounded-xl bg-white text-gray-700 font-semibold border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Open Vault
          </Link>
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
        {[
          {
            icon: "📡",
            title: "Composable Oracle",
            body: "Any protocol on HashKey Chain can query NAV prices with a single Solidity call. No API keys, no permissions.",
          },
          {
            icon: "🔄",
            title: "Multi-Source Aggregation",
            body: "Prices aggregated from Chainlink, Pyth, and custom data providers. Outlier detection via 2σ filtering.",
          },
          {
            icon: "💰",
            title: "Auto-Yield Vault",
            body: "ERC-4626 vault auto-routes USDC across MMF, T-bill, and gold strategies for the highest blended APY.",
          },
        ].map((f) => (
          <div key={f.title} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-sm text-gray-500">{f.body}</p>
          </div>
        ))}
      </div>

      {/* Quick-start code snippet */}
      <div className="bg-gray-950 rounded-2xl p-6 border border-gray-800">
        <p className="text-xs text-gray-400 mb-3 font-mono">
          // Integrate Xero Labs in your protocol — it&apos;s 3 lines
        </p>
        <pre className="text-sm font-mono text-green-300 leading-relaxed overflow-x-auto">
          {`IXeroOracle oracle = IXeroOracle(ORACLE_ADDRESS);
IXeroOracle.NavPrice memory p = oracle.getPrice(keccak256("XAU-TOKENIZED"));
// p.price = $1,935.74 with 8 decimals`}
        </pre>
      </div>

      {/* Architecture overview */}
      <div className="mt-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Architecture</h2>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm font-medium">
            {["Off-chain\nPrice Pusher", "XeroOracle\n(NAV Registry)", "StrategyRouter\n+ Rebalancer", "XeroVault\n(ERC-4626)"].map((box, i) => (
              <React.Fragment key={box}>
                <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl px-4 py-3 text-center whitespace-pre-line">
                  {box}
                </div>
                {i < 3 && <span className="text-gray-400 text-lg">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
