# Xero Labs — On-Chain NAV Oracle & Yield Aggregator

> **HashKey Chain On-Chain Horizon Hackathon — DeFi Track submission**

Xero Labs solves the RWA pricing problem: most tokenized asset protocols leave NAV data stale, off-chain, or gated behind permissioned APIs.  
We publish a **permissionless, composable on-chain price feed** for tokenized stocks, gold, real estate indices, and money-market funds — then layer a **yield aggregator** that auto-routes stablecoin deposits into the highest-yielding RWA pool.

---

## 🏗 Architecture

```
Off-chain Price Pusher  →  XeroOracle (NAV Registry)  →  StrategyRouter + Rebalancer  →  XeroVault (ERC-4626)
```

```
xero-labs/
├── contracts/
│   ├── oracle/
│   │   ├── XeroOracle.sol          # Core NAV oracle — price registry + TWAP + circuit breaker
│   │   ├── OracleAggregator.sol    # Multi-source aggregation + outlier filtering
│   │   ├── AssetRegistry.sol       # RWA asset metadata registry
│   │   └── adapters/               # Chainlink, Pyth, on-chain TWAP wrappers
│   ├── aggregator/
│   │   ├── XeroVault.sol           # ERC-4626 yield aggregator vault
│   │   ├── StrategyRouter.sol      # Routes deposits to best RWA strategy
│   │   ├── RebalanceEngine.sol     # Epoch-based rebalancing
│   │   └── strategies/             # MMF, T-Bill, Gold strategies
│   ├── governance/                 # On-chain governance for assets & strategies
│   └── interfaces/                 # IXeroOracle, IXeroVault, IRWAStrategy
├── sdk/                            # TypeScript SDK
├── offchain/                       # Price pusher service + REST API
├── frontend/                       # Next.js dashboard
├── scripts/                        # Deployment scripts
└── test/                           # Hardhat tests
```

---

## 🔑 Problem: RWA Pricing Gap on HashKey Chain

- Tokenized stocks, treasury bills, and gold funds exist on HashKey Chain
- But their NAV prices are **stale, centralized, or locked behind permissioned endpoints**
- DeFi protocols (lending, derivatives, AMMs) that want to integrate RWAs **cannot get a trustworthy on-chain price**

## ✅ Solution

**Xero Labs** provides:

1. **Permissionless on-chain price feed** — any smart contract on HashKey Chain reads NAV prices with one call
2. **Multi-source aggregation** — Chainlink + Pyth + custom pushers, 2σ outlier filtering, TWAP buffer
3. **Circuit breaker** — rejects anomalous price spikes (>20% in <1 min)
4. **Yield aggregator** — ERC-4626 vault auto-routes USDC across MMF (~5% APY), T-bills (~5.3%), and gold strategies

---

## 📦 Contracts

### IXeroOracle — Oracle Interface

```solidity
interface IXeroOracle {
    function getPrice(bytes32 assetId) external view returns (NavPrice memory);
    function getPriceBatch(bytes32[] calldata assetIds) external view returns (NavPrice[] memory);
    function getTWAP(bytes32 assetId, uint256 windowSeconds) external view returns (uint256);
    function isFresh(bytes32 assetId) external view returns (bool);
    function getAllAssets() external view returns (AssetInfo[] memory);
}
```

### Asset IDs

| Symbol   | Asset                     | keccak256 Input           |
|----------|---------------------------|---------------------------|
| xTSLA    | Tokenized Tesla stock     | `"TSLA-TOKENIZED"`        |
| xAAPL    | Tokenized Apple stock     | `"AAPL-TOKENIZED"`        |
| xGOLD    | Tokenized gold (XAU)      | `"XAU-TOKENIZED"`         |
| xMMF     | Money-market fund NAV     | `"MMF-USD"`               |
| xTBILL3M | 3-month T-bill (discount) | `"TBILL-3M"`              |

---

## 🔌 Oracle Integration Guide (3-line Solidity)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IXeroOracle {
    struct NavPrice {
        uint256 price;      // 8-decimal USD (e.g. 195000000000 = $1,950.00)
        uint256 updatedAt;
        uint8   confidence; // 0-100
        bool    isStale;
        uint8   decimals;   // always 8
    }
    function getPrice(bytes32 assetId) external view returns (NavPrice memory);
    function isFresh(bytes32 assetId)  external view returns (bool);
}

contract MyDeFiProtocol {
    // Step 1: Point to the deployed oracle
    IXeroOracle constant oracle = IXeroOracle(0x/* ORACLE_ADDRESS */);

    // Step 2: Define asset IDs
    bytes32 constant GOLD = keccak256("XAU-TOKENIZED");

    // Step 3: Query the price
    function getGoldPrice() external view returns (uint256) {
        require(oracle.isFresh(GOLD), "Stale price");
        return oracle.getPrice(GOLD).price; // 8-decimal USD
    }
}
```

That's it. **One external call** to access any tokenized RWA price on HashKey Chain.

---

## 🚀 Deployed Contracts (HashKey Testnet)

> Contract addresses will be populated after testnet deployment.

| Contract          | Address |
|-------------------|---------|
| AssetRegistry     | TBD     |
| OracleAggregator  | TBD     |
| XeroOracle        | TBD     |
| StrategyRouter    | TBD     |
| RebalanceEngine   | TBD     |
| XeroVault         | TBD     |

---

## 🛠 How to Run Locally

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Clone & install

```bash
git clone https://github.com/RippleOrg/XeroLabs.git
cd XeroLabs
npm install
```

### Compile contracts

```bash
npx hardhat compile
```

### Run tests

```bash
npx hardhat test
```

### Deploy to HashKey Testnet

```bash
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY, PRICE_PUSHER_PRIVATE_KEY, etc.
npx hardhat run scripts/deploy.ts --network hashkeyTestnet
```

### Start the frontend

```bash
cd frontend
npm install
cp ../.env.example .env.local
# Set NEXT_PUBLIC_ORACLE_ADDRESS, NEXT_PUBLIC_VAULT_ADDRESS, etc.
npm run dev
```

### Start the price pusher

```bash
cd offchain
npm install
PRICE_PUSHER_PRIVATE_KEY=0x... NEXT_PUBLIC_ORACLE_ADDRESS=0x... npm run pusher
```

### Start the REST API

```bash
cd offchain
NEXT_PUBLIC_ORACLE_ADDRESS=0x... npm run api
# GET http://localhost:3001/prices
# GET http://localhost:3001/prices/:assetId
# GET http://localhost:3001/assets
# GET http://localhost:3001/health
```

---

## 🧪 Tests

```bash
# Oracle tests (19 tests)
npx hardhat test test/XeroOracle.test.ts

# Vault tests (14 tests)
npx hardhat test test/XeroVault.test.ts

# All tests
npx hardhat test
```

**Test coverage:**
- `updatePrice`: authorized / unauthorized, price storage
- Circuit breaker: >20% deviation in <1 min → rejects + emits `PriceAnomalyDetected`
- Staleness: `isStale` flag, `isFresh()` return value
- `getPriceBatch`: mixed fresh/stale correct per asset
- TWAP: circular buffer, zero-window revert, fallback to spot
- Confidence: single source → 50%, two matching sources → ≥80%
- `updatePriceBatch`: multi-asset push, length-mismatch revert
- Vault deposit: correct shares, proportional allocation
- Vault withdraw: correct USDC returned, withdrawal queue for locked strategies
- Management fee: minted to `feeRecipient` after time passes
- Emergency withdraw: drains strategies + pauses vault
- T-bill strategy: locked before maturity, withdrawable after

---

## 📐 TypeScript SDK

```typescript
import { OracleClient, ASSET_IDS, VaultClient } from "@xero-labs/sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://testnet.hsk.xyz");

// Query a price
const oracle = new OracleClient(ORACLE_ADDRESS, provider);
const gold   = await oracle.getPrice(ASSET_IDS.GOLD);
console.log(gold.priceFormatted); // "1,935.74"

// Subscribe to live updates
const unsub = oracle.subscribeToPrice(ASSET_IDS.TSLA, (price) => {
  console.log("TSLA updated:", price.priceFormatted);
});

// Interact with vault
const vault = new VaultClient(VAULT_ADDRESS, provider);
const apy   = await vault.getAPY(); // e.g. 5.23
```

---

## 🏗 Key Design Decisions

### Price Aggregation
- Minimum 1 source required (minimum 2 for high confidence)
- Outlier detection: discard prices >2σ from median
- Freshness-weighted aggregation
- Confidence score = `(agreeing sources / total sources) × 100`

### Circuit Breaker
- New price deviating >20% from last price within <60 seconds → rejected
- Emits `PriceAnomalyDetected(assetId, attempted, current, timestamp)`
- Admin can override via `setCircuitBreakerOverride(assetId, true)`

### TWAP
- 24-slot circular ring buffer per asset
- `getTWAP(assetId, windowSeconds)` returns time-weighted average
- Falls back to spot price if buffer is empty

### ERC-4626 Vault
- Management fee: 0.5% annually, accrued continuously as minted shares
- Performance fee: 10% of yield above benchmark (configurable)
- Withdrawal queue: locked T-bill positions queue until maturity
- Emergency withdraw: drains all strategies and pauses

---

## 🎬 Demo Script

```
1. Open /oracle  → Live NAV cards for xTSLA, xGOLD, xMMF
                    Show confidence scores and last-updated times

2. Open /vault   → TVL, blended APY, strategy donut chart
                    Deposit 100 USDC → share minting live

3. Integration   → 3-line Solidity snippet on Oracle page
                    "One call to get any RWA price on HashKey Chain"

4. Rebalance     → Admin triggers rebalance
                    T-bill APY rises → funds flow from MMF to T-bill

5. Closing       → "Every DeFi protocol on HashKey Chain that touches RWAs
                    needs a pricing source. We built the public good layer."
```

---

## 📄 License

MIT
