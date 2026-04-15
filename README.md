# XeroLabs — RWA Yield Aggregator & NAV Oracle on HashKey Chain

> **HashKey Chain On-Chain Horizon Hackathon — DeFi Track**

XeroLabs solves the RWA pricing gap on HashKey Chain: tokenized stocks, gold, treasury bills, and money-market funds exist on-chain, but their NAV prices have historically been stale, centralised, or locked behind permissioned APIs.

XeroLabs deploys a **permissionless, composable on-chain NAV oracle** backed by Supra's DORA consensus, then layers an **ERC-4626 yield aggregator** that automatically routes USDC deposits into the highest-yielding RWA strategy.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Contract Overview](#2-contract-overview)
3. [Oracle Layer — XeroOracle](#3-oracle-layer--xerooracle)
4. [Supra Pull Oracle Integration](#4-supra-pull-oracle-integration)
5. [Vault Layer — XeroVault](#5-vault-layer--xerovault)
6. [RWA Strategies](#6-rwa-strategies)
7. [Governance](#7-governance)
8. [Deployed Contracts — HashKey Testnet](#8-deployed-contracts--hashkey-testnet)
9. [Supported Assets & Supra Pair IDs](#9-supported-assets--supra-pair-ids)
10. [Getting Started](#10-getting-started)
11. [Environment Variables](#11-environment-variables)
12. [Compile & Deploy](#12-compile--deploy)
13. [Running Tests](#13-running-tests)
14. [TypeScript SDK](#14-typescript-sdk)
15. [Off-chain Services](#15-off-chain-services)
16. [Frontend](#16-frontend)
17. [Security](#17-security)
18. [Key Design Decisions](#18-key-design-decisions)
19. [License](#19-license)

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        XeroLabs System                          │
│                                                                 │
│  ┌─────────────────┐   ┌──────────────────────────────────┐    │
│  │ Off-chain        │   │         Oracle Layer             │    │
│  │ PricePusher  ───┼──▶│  XeroOracle ◀── OracleAggregator │    │
│  └─────────────────┘   │      │              │            │    │
│                         │      │         AssetRegistry    │    │
│  ┌─────────────────┐   │      │              │            │    │
│  │ Supra DORA      │   │      │         SupraAdapters     │    │
│  │ Pull Oracle  ───┼──▶│      │         (on-chain pull)   │    │
│  └─────────────────┘   └──────┼──────────────────────────┘    │
│                                │                                │
│                         ┌──────▼──────────────────────────┐    │
│                         │         Vault Layer              │    │
│                         │  XeroVault (ERC-4626)            │    │
│                         │    ├── StrategyRouter            │    │
│                         │    │     ├── MMFStrategy  ~5%    │    │
│                         │    │     ├── TBillStrategy ~5.3% │    │
│                         │    │     └── GoldStrategy ~1.5%  │    │
│                         │    └── RebalanceEngine (24h)     │    │
│                         └─────────────────────────────────┘    │
│                                                                 │
│  OracleGovernance | StrategyGovernance                         │
└─────────────────────────────────────────────────────────────────┘
```

### Repository Layout

```
xero-labs/
├── contracts/
│   ├── oracle/
│   │   ├── XeroOracle.sol          # Core NAV oracle — TWAP + circuit breaker
│   │   ├── OracleAggregator.sol    # Multi-source aggregation, outlier filtering
│   │   ├── AssetRegistry.sol       # RWA asset metadata + staleness config
│   │   ├── PriceAdapter.sol        # Abstract base for on-chain adapters
│   │   └── adapters/
│   │       ├── SupraAdapter.sol    # Supra Pull Oracle (primary, on-chain)
│   │       ├── ChainlinkAdapter.sol
│   │       ├── PythAdapter.sol
│   │       └── TwapAdapter.sol
│   ├── aggregator/
│   │   ├── XeroVault.sol           # ERC-4626 yield aggregator vault
│   │   ├── StrategyRouter.sol      # Risk-weighted capital allocator
│   │   ├── RebalanceEngine.sol     # Epoch-based rebalancer
│   │   └── strategies/
│   │       ├── BaseStrategy.sol
│   │       ├── MMFStrategy.sol     # Money-market fund (~5.0% APY)
│   │       ├── TBillStrategy.sol   # T-bill (locked until maturity)
│   │       └── GoldStrategy.sol    # Tokenised gold (~1.5% APY)
│   ├── governance/
│   │   ├── OracleGovernance.sol    # Asset + source lifecycle governance
│   │   └── StrategyGovernance.sol  # Strategy add/remove governance
│   ├── interfaces/
│   │   ├── IXeroOracle.sol
│   │   ├── IXeroVault.sol
│   │   ├── IRWAStrategy.sol
│   │   └── ISupraSValueFeed.sol    # Supra Pull Oracle interface
│   └── test/
│       ├── TestUSDC.sol            # Mintable ERC-20 stablecoin, 6 decimals
│       └── MockERC20.sol
├── sdk/                            # @xero-labs/sdk TypeScript client
├── offchain/                       # Price pusher daemon + REST API
├── frontend/                       # Next.js 14 dashboard
├── scripts/deploy.ts               # Hardhat deployment script
└── test/
    ├── XeroOracle.test.ts
    └── XeroVault.test.ts
```

---

## 2. Contract Overview

| Contract | Role | Key Features |
|---|---|---|
| `XeroOracle` | NAV price registry | 24-slot TWAP buffer, circuit breaker, multi-role ACL |
| `OracleAggregator` | Multi-source consensus | 2σ outlier rejection, freshness-weighted average, confidence score |
| `AssetRegistry` | Asset metadata store | Asset types, token addresses, per-asset staleness thresholds |
| `SupraAdapter` | On-chain Supra bridge | Reads Supra Pull Oracle, normalises 18-dec → 8-dec, staleness guard |
| `XeroVault` | ERC-4626 vault | 0.5%/yr management fee, 10% performance fee, withdrawal queue |
| `StrategyRouter` | Capital allocator | APY-sorted, risk-weighted, 5% diversification floor, 60% max single |
| `RebalanceEngine` | Rebalance scheduler | 24-hour epochs, 50 bps minimum yield-gap guard |
| `MMFStrategy` | Money-market fund | Stable NAV ≈ $1.00, 5.0% APY, same-day liquid |
| `TBillStrategy` | T-bill wrapper | 5.3% APY, locked until maturity timestamp |
| `GoldStrategy` | Tokenised gold | 1.5% APY, mark-to-market via Supra XAU/USD (pair 74) |
| `OracleGovernance` | Oracle DAO interface | Propose/retire assets, update sources via `GOVERNOR_ROLE` |
| `StrategyGovernance` | Vault DAO interface | Add/remove strategies, adjust allocation caps |
| `TestUSDC` | Test stablecoin | ERC-20, 6 decimals, public permissionless `mint()` faucet |

---

## 3. Oracle Layer — XeroOracle

### Price Flow

```
Off-chain pusher ──updatePrice()──▶ XeroOracle ──submitSourcePrice()──▶ OracleAggregator
Supra on-chain ──getIndexedPrice()──▶ SupraAdapter ─────────────────────────────────▲
                                           │
                               Circuit-breaker check (>20% in <60 s = reject)
                                           │
                               TWAP ring-buffer update (24 observations)
                                           │
                               NavPrice stored on-chain, queryable by anyone
```

### NavPrice Struct

```solidity
struct NavPrice {
    uint256 price;      // USD value, 8 decimals  (e.g. 193574_00000000 = $1,935.74)
    uint256 updatedAt;  // Block timestamp of last update
    uint8   confidence; // 0–100; ≥ 2 agreeing sources → ≥ 80
    bool    isStale;    // True if age > per-asset staleness threshold
    uint8   decimals;   // Always 8 (Chainlink-compatible)
}
```

### Access Control Roles

| Role | Capability |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke all roles, add/retire assets, update staleness thresholds |
| `PRICE_PUSHER_ROLE` | Call `updatePrice()` and `updatePriceBatch()` |
| `AGGREGATOR_ROLE` | Internal — granted to `OracleAggregator` at deployment |

### Circuit Breaker

Any price update deviating **> 20%** from the previous price within **< 60 seconds** is automatically rejected. The contract emits `PriceAnomalyDetected(assetId, rejectedPrice, lastPrice, deviation)` and the previous price remains live. An admin can override with `setCircuitBreakerOverride(assetId, true)`.

### TWAP (Time-Weighted Average Price)

A 24-slot circular ring buffer is maintained per asset. `getTWAP(assetId, windowSeconds)` returns a time-weighted average over any sliding window within the buffer depth. Falls back to spot price if fewer than 2 observations exist.

---

## 4. Supra Pull Oracle Integration

XeroLabs uses [Supra's DORA (Distributed Oracle Agreement)](https://docs.supra.com/oracles/data-feeds/pull-oracle) as the **primary on-chain price source** for all assets with a matching Supra pair ID.

DORA aggregates price data from up to **21 independent nodes** using **Byzantine Fault Tolerance**, ensuring data integrity with no single trusted intermediary and addressing traditional oracle latency and centralisation problems.

### How It Works

```
Supra DORA nodes (up to 21 sources, BFT consensus)
        │
        ▼
Supra Pull Oracle Storage  ◀── PricePusher calls verifyOracleProof()
        │
        ▼
SupraAdapter.latestPrice()  (normalises 18-dec → 8-dec, enforces maxAge)
        │
        ▼
OracleAggregator (registered as sourceId = 2, on-chain)
        │
        ▼
XeroOracle.NavPrice  (permissionless, composable, any contract can query)
```

### HashKey Chain Supra Contract Addresses

| Network | Pull Oracle (read prices) | Storage Contract (verify proofs) |
|---|---|---|
| **Testnet** | `0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702` | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` |
| **Mainnet** | `0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD` | `0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57` |

### SupraAdapter Constructor

```solidity
constructor(
    address _supraOracle,   // Supra Pull Oracle address for this network
    uint256 _pairIndex,     // Supra data pair index (see table below)
    uint256 _supraDecimals, // 18 — Supra always returns 18-decimal prices
    uint256 _maxAge,        // Staleness threshold in seconds
    string  name_           // e.g. "Supra XAU/USD"
)
```

### Deployed Supra Adapters (Testnet)

| Adapter | Asset | Supra Pair ID | Max Age | Address |
|---|---|---|---|---|
| `SupraAdapterGold` | XAU/USD (Gold) | **74** | 86 400 s (24 h) | `0xD5a9a979ce19334e031bfe642214133d6f94d117` |
| `SupraAdapterSilver` | XAG/USD (Silver) | **75** | 86 400 s (24 h) | `0x3E35ef53069E5063c435C44ae32767F7D69cB6b2` |
| `SupraAdapterBTC` | BTC/USD | **0** | 3 600 s (1 h) | `0x2d4fef60517265e48C5027778E8cB3E1b3d5349a` |
| `SupraAdapterETH` | ETH/USD | **19** | 3 600 s (1 h) | `0x3b189854F168fA216ff7612aB286582641459492` |
| `SupraAdapterUSDC` | USDC/USD | **89** | 86 400 s (24 h) | `0xCCf8B231f32ED84A53b1b29f019fcaFd514C5006` |

### Price Normalisation

Supra returns 18-decimal fixed-point prices. The adapter normalises to the Chainlink-standard 8 decimals:

```solidity
// supraDecimals = 18, TARGET_DECIMALS = 8
uint256 normalised = rawPrice / 10 ** (supraDecimals - TARGET_DECIMALS);
// Example: 193574000000000000000000 → 1935740000000 (= $19,357.40 with 8 dec)
```

If Supra has fewer decimals than the target, the adapter scales up instead.

### Minimal On-Chain Usage

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISupraPullOracle {
    function getIndexedPrice(uint256 _index)
        external view returns (uint256 price, uint256 timestamp);
}

contract SupraConsumer {
    ISupraPullOracle public immutable supra =
        ISupraPullOracle(0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702); // Testnet

    /// @notice Returns XAU/USD gold price (18 decimals) and last update timestamp.
    function getGoldPrice() external view returns (uint256 price, uint256 ts) {
        (price, ts) = supra.getIndexedPrice(74); // pair 74 = XAU/USD
    }
}
```

### ISupraSValueFeed Interface (used by SupraAdapter)

```solidity
interface ISupraPullOracle {
    function getIndexedPrice(uint256 _index)
        external view returns (uint256 price, uint256 timestamp);

    function verifyOracleProof(bytes calldata _bytesproof)
        external returns (PriceData memory);
}
```

---

## 5. Vault Layer — XeroVault

`XeroVault` is a fully ERC-4626 compliant tokenised vault. Users deposit **USDC** (6 decimals) and receive **xVAULT** shares representing a proportional claim on the entire portfolio including all strategy holdings.

### Fee Structure

| Fee | Rate | Implementation |
|---|---|---|
| Management fee | 0.5% per year (`MANAGEMENT_FEE_BPS = 50`) | Accrued continuously; new shares minted to `feeRecipient` proportional to time elapsed |
| Performance fee | 10% of yield above benchmark (`PERFORMANCE_FEE_BPS = 1000`) | Reserved for post-MVP |

Fee accrual formula:
```
feeShares = totalSupply * (elapsed / SECONDS_PER_YEAR) * MANAGEMENT_FEE_BPS / BPS
```

### Withdrawal Queue

T-bill positions are locked until maturity. If insufficient liquid capital exists to satisfy a redemption, the request is appended to `withdrawalQueue[]` with an `expectedAt` timestamp and dispatched once the T-bill's `maturityTimestamp` passes.

### Rebalance Epoch

`RebalanceEngine.maybeRebalance()` at most once per **24 hours** (`REBALANCE_EPOCH`). A rebalance is also skipped if no individual strategy reallocation exceeds 1% of `totalAssets` (avoids burning gas for negligible shifts).

### Core ERC-4626 Functions

```solidity
function deposit(uint256 assets, address receiver)
    external returns (uint256 shares);

function mint(uint256 shares, address receiver)
    external returns (uint256 assets);

function redeem(uint256 shares, address receiver, address owner)
    external returns (uint256 assets);

function withdraw(uint256 assets, address receiver, address owner)
    external returns (uint256 shares);

function totalAssets()          external view returns (uint256); // All strategies
function previewDeposit(uint256) external view returns (uint256);
function previewRedeem(uint256)  external view returns (uint256);
```

---

## 6. RWA Strategies

All strategies implement `IRWAStrategy`:

```solidity
interface IRWAStrategy {
    function deposit(uint256 amount)  external returns (uint256 shares);
    function withdraw(uint256 amount) external returns (uint256 received);
    function totalValue()             external view returns (uint256 usdcValue);
    function currentAPY()             external view returns (uint256 apyBps);
    function isWithdrawable(uint256 amount)
        external view returns (bool ok, uint256 availableAt);
    function harvest()                external returns (uint256 yieldHarvested);
    function name()                   external view returns (string memory);
}
```

### MMFStrategy — Money Market Fund

| Parameter | Value |
|---|---|
| APY | 5.0% (500 bps), constant |
| Liquidity | Same-day (`isWithdrawable` always returns `true, 0`) |
| Yield accrual | Continuous; folded back into `_principal` on each interaction |
| Oracle | USDC/USD via XeroOracle ← Supra pair **89** |
| Allocation cap | 60% (default `MAX_SINGLE_BPS`) |

### TBillStrategy — US Treasury Bill

| Parameter | Value |
|---|---|
| APY | 5.3% (530 bps), constant |
| Liquidity | **Locked** until `maturityTimestamp` (set at deployment) |
| Pre-maturity | `withdraw()` reverts: *"TBillStrategy: not matured"* |
| Post-maturity | Principal + accrued yield fully withdrawable |
| Withdrawal queue | Vault queues requests and dispatches on maturity |
| Oracle | TBILL-3M price via XeroOracle (off-chain sourced) |

### GoldStrategy — Tokenised Gold (XAU)

| Parameter | Value |
|---|---|
| APY | 1.5% (150 bps) — gold lending / options premium |
| Liquidity | Fully liquid |
| Valuation | Mark-to-market: `_holdingsUsdc + pendingYield()` |
| Oracle | XAU/USD via XeroOracle ← Supra pair **74** |
| Allocation cap | 20% by default at registration |

### Capital Allocation Algorithm (StrategyRouter)

1. Call `currentAPY()` on every active strategy
2. Sort strategies descending by APY
3. Greedily assign capital:
   - **Floor**: minimum 5% per active strategy (`MIN_ALLOCATION_BPS = 500`)
   - **Ceiling**: maximum 60% in any single strategy (`MAX_SINGLE_BPS = 6000`)
   - Per-strategy override cap from `maxAllocationBps` at registration
4. Skip rebalance if no single reallocation ≥ 1% of `totalAssets`
5. Emit `Rebalanced(oldAllocations, newAllocations, timestamp)`

---

## 7. Governance

### OracleGovernance

Requires `GOVERNOR_ROLE`:

```solidity
/// Register a new tokenised RWA asset in the oracle
function proposeAsset(
    bytes32 assetId,
    string calldata symbol,
    address tokenAddress,
    IXeroOracle.AssetType assetType,  // STOCK | PRECIOUS_METAL | REAL_ESTATE | MMF | TBILL
    uint256 stalenessSeconds
) external onlyRole(GOVERNOR_ROLE);

/// Retire an asset (marks inactive, halts price updates)
function retireAsset(bytes32 assetId) external onlyRole(GOVERNOR_ROLE);

/// Add or update a price source adapter + weight
function updateSource(
    bytes32 assetId,
    uint8   sourceId,
    address adapter,
    uint16  weight
) external onlyRole(GOVERNOR_ROLE);
```

### StrategyGovernance

Requires `GOVERNOR_ROLE`:

```solidity
function addStrategy(address strategy, uint16 maxAllocationBps)
    external onlyRole(GOVERNOR_ROLE);

function removeStrategy(address strategy)
    external onlyRole(GOVERNOR_ROLE);
```

---

## 8. Deployed Contracts — HashKey Testnet

**Network:** HashKey Chain Testnet
**Chain ID:** 133
**RPC Endpoint:** `https://testnet.hsk.xyz`
**Deployment Date:** 2026-04-15
**Deployer:** `0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4`

### Core Protocol Contracts

| Contract | Address |
|---|---|
| **TestUSDC** (6-dec mintable stablecoin, permissionless faucet) | `0x79F319104FEE8e9f2209246eF878aa46deC0bedb` |
| **AssetRegistry** | `0xC9C0F7d64f3863434FacE04Ab844694126a03252` |
| **OracleAggregator** | `0x99f971814e75430596337ca81A4176d5C60D47E3` |
| **XeroOracle** | `0x5d019f68DCD9792afb242eec64074558fBd6b10B` |
| **StrategyRouter** | `0x96bB3E850d22DA5F4feC256A719f2767D9309D91` |
| **RebalanceEngine** | `0xcEBa64651C6bc9af45aBBCA1fc3215ccb38669AE` |
| **XeroVault** (token: **xVAULT**) | `0x6060e1E6303e035668ac76DC4B6002aF2EDd622a` |

### Supra Price Adapters (XeroLabs-deployed)

| Contract | Asset | Supra Pair | Address |
|---|---|---|---|
| **SupraAdapterGold** | XAU/USD | 74 | `0xD5a9a979ce19334e031bfe642214133d6f94d117` |
| **SupraAdapterSilver** | XAG/USD | 75 | `0x3E35ef53069E5063c435C44ae32767F7D69cB6b2` |
| **SupraAdapterBTC** | BTC/USD | 0 | `0x2d4fef60517265e48C5027778E8cB3E1b3d5349a` |
| **SupraAdapterETH** | ETH/USD | 19 | `0x3b189854F168fA216ff7612aB286582641459492` |
| **SupraAdapterUSDC** | USDC/USD | 89 | `0xCCf8B231f32ED84A53b1b29f019fcaFd514C5006` |

### RWA Strategy Contracts

| Contract | APY | Liquidity | Address |
|---|---|---|---|
| **MMFStrategy** | ~5.0% | Liquid (same-day) | `0xfD314FCb29946d86bea3dde8754cEc20eBB37257` |
| **TBillStrategy** | ~5.3% | Locked until maturity | `0x3c9d5c21C7D75A7fa3EA3662E172A52092a327E0` |
| **GoldStrategy** | ~1.5% | Liquid | `0x4Fc42373230F8b69785ba8c5A472D6453d5e48C9` |

### Supra Infrastructure (External — HashKey Testnet)

| Contract | Address |
|---|---|
| **Supra Pull Oracle** (price reads) | `0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702` |
| **Supra Storage Contract** (proof verification) | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` |

> Full address manifest is also stored at [deployments/hashkeyTestnet.json](deployments/hashkeyTestnet.json).

---

## 9. Supported Assets & Supra Pair IDs

Compute an `assetId` in Solidity with `keccak256(abi.encodePacked("TBILL-3M"))` or in JavaScript/TypeScript with `ethers.id("TBILL-3M")`.

| keccak256 Input | Symbol | Asset Type | Price Source | Supra Pair |
|---|---|---|---|---|
| `"XAU-TOKENIZED"` | **xGOLD** | PRECIOUS_METAL | SupraAdapter on-chain | **74** |
| `"XAG-TOKENIZED"` | **xSILVER** | PRECIOUS_METAL | SupraAdapter on-chain | **75** |
| `"MMF-USD"` | **xMMF** | MMF | SupraAdapter on-chain | **89** |
| `"TBILL-3M"` | **xTBILL3M** | TBILL | Off-chain pusher | — |
| `"TBILL-1M"` | **xTBILL1M** | TBILL | Off-chain pusher | — |
| `"TSLA-TOKENIZED"` | **xTSLA** | STOCK | Off-chain pusher | — |
| `"AAPL-TOKENIZED"` | **xAAPL** | STOCK | Off-chain pusher | — |
| `"NVDA-TOKENIZED"` | **xNVDA** | STOCK | Off-chain pusher | — |
| `"US-REAL-ESTATE-INDEX"` | **xREIT** | REAL_ESTATE | Off-chain pusher | — |

All prices are denominated in **USD with 8 decimal places** (Chainlink-compatible).
Example: `193574_00000000` = **$1,935.74**

---

## 10. Getting Started

### Prerequisites

- Node.js ≥ 18, npm ≥ 9
- Funded HashKey Testnet wallet — get HSK from [https://faucet.hsk.xyz](https://faucet.hsk.xyz)

### Install

```bash
git clone https://github.com/your-org/XeroLabs.git
cd XeroLabs
npm install
```

### Mint Test USDC

`TestUSDC` has a **permissionless** `mint(address to, uint256 amount)` function — no access control:

```bash
npx hardhat console --network hashkeyTestnet
> const usdc = await ethers.getContractAt(
    "TestUSDC",
    "0x79F319104FEE8e9f2209246eF878aa46deC0bedb"
  )
> await usdc.mint("0xYOUR_ADDRESS", 1_000_000n * 1_000_000n)  // 1,000,000 USDC
```

### Query a Price On-Chain

```bash
npx hardhat console --network hashkeyTestnet
> const oracle = await ethers.getContractAt(
    "XeroOracle",
    "0x5d019f68DCD9792afb242eec64074558fBd6b10B"
  )
> const goldId = ethers.id("XAU-TOKENIZED")
> const p      = await oracle.getPrice(goldId)
> p.price.toString()     // 8-decimal USD
> p.confidence           // 0-100
> p.isStale              // false if fresh
> p.updatedAt            // Unix timestamp
```

### Deposit into the Vault

```bash
npx hardhat console --network hashkeyTestnet
> const usdc  = await ethers.getContractAt("TestUSDC",  "0x79F319104FEE8e9f2209246eF878aa46deC0bedb")
> const vault = await ethers.getContractAt("XeroVault", "0x6060e1E6303e035668ac76DC4B6002aF2EDd622a")
> await usdc.approve(vault.target, 100n * 1_000_000n)
> await vault.deposit(100n * 1_000_000n, "0xYOUR_ADDRESS")
> // You now hold xVAULT shares
```

---

## 11. Environment Variables

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | **Yes** | Hex private key for deployment (no 0x prefix) |
| `HASHKEY_TESTNET_RPC` | No | Default: `https://testnet.hsk.xyz` |
| `HASHKEY_MAINNET_RPC` | No | Default: `https://mainnet.hsk.xyz` |
| `FEE_RECIPIENT_ADDRESS` | No | Receives management fees; defaults to deployer |
| `PRICE_PUSHER_ADDRESS` | No | Granted `PRICE_PUSHER_ROLE`; defaults to deployer |
| `PRICE_PUSHER_PRIVATE_KEY` | Off-chain only | Key used by the price pusher daemon |

---

## 12. Compile & Deploy

### Compile

```bash
npx hardhat compile
```

Solidity **0.8.26**, `viaIR: true`, `optimizer: { runs: 1000 }`, `evmVersion: "cancun"`.

### Deploy to HashKey Testnet

```bash
npx hardhat run scripts/deploy.ts --network hashkeyTestnet
```

**Deployment sequence** (scripts/deploy.ts):

| Step | Action |
|---|---|
| 0 | Deploy `TestUSDC`; mint 10,000,000 USDC to deployer |
| 1 | Deploy `AssetRegistry` |
| 2 | Deploy `OracleAggregator(assetRegistry)` |
| 3 | Deploy `XeroOracle(aggregator, assetRegistry)`; grant `ORACLE_ROLE` to aggregator |
| 4 | Deploy 5× `SupraAdapter` (Gold/pair-74, Silver/75, BTC/0, ETH/19, USDC/89) |
| 5 | Register 9 RWA assets in `AssetRegistry` with symbols, types, staleness windows |
| 6 | Add each SupraAdapter as `sourceId = 2` price source in `OracleAggregator` |
| 7 | Grant `PRICE_PUSHER_ROLE` to pusher address on `XeroOracle` |
| 8 | Seed all 9 asset prices via `updatePriceBatch()` |
| 9 | Deploy `MMFStrategy`, `TBillStrategy`, `GoldStrategy` |
| 10 | Deploy `StrategyRouter(usdc, oracle)` |
| 11 | Deploy `RebalanceEngine(router)` |
| 12 | Deploy `XeroVault(usdc, router, engine, oracle, feeRecipient)` |
| 13 | Transfer `StrategyRouter` + `RebalanceEngine` ownership to vault |
| 14 | Register all 3 strategies with the vault |
| 15 | Write all addresses to `deployments/hashkeyTestnet.json` |

### Deploy to HashKey Mainnet

```bash
npx hardhat run scripts/deploy.ts --network hashkeyMainnet
```

The script auto-selects the mainnet Supra Pull Oracle (`0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD`) when `network.name === "hashkeyMainnet"`.

---

## 13. Running Tests

```bash
npx hardhat test test/XeroOracle.test.ts   # 19 tests
npx hardhat test test/XeroVault.test.ts    # 14 tests
npx hardhat test                           # full suite
```

### Oracle Test Coverage

| Test | What is verified |
|---|---|
| `updatePrice` — authorised | Price stored, confidence correct |
| `updatePrice` — unauthorised | Reverts without `PRICE_PUSHER_ROLE` |
| Circuit breaker active | >20% deviation in <60 s → rejected, `PriceAnomalyDetected` emitted |
| Circuit breaker inactive >60 s | Large move accepted after cool-down |
| Staleness flag | `isStale = true` when age > staleness threshold |
| `isFresh` | Returns `false` after threshold, `true` after fresh update |
| `getPriceBatch` | Mixed fresh/stale correctly per-asset |
| TWAP circular buffer | Returns weighted average, not spot |
| TWAP zero-window | Reverts with descriptive error |
| TWAP spot fallback | Returns spot price when buffer has < 2 entries |
| Confidence — single source | Returns 50 |
| Confidence — two agreeing sources | Returns ≥ 80 |
| `updatePriceBatch` | Multi-asset push in one transaction |
| Length mismatch | Reverts when arrays have different lengths |

### Vault Test Coverage

| Test | What is verified |
|---|---|
| Deposit | Correct xVAULT shares minted proportional to assets |
| `totalAssets` | Includes all strategy holdings, not just vault balance |
| Management fee | Shares minted to `feeRecipient` after time advances |
| Proportional allocation | Capital split across strategies after deposit |
| T-bill withdrawal queue | Request queued before maturity, dispatched after |
| Liquid redeem | Correct USDC returned from MMF/Gold strategies |
| Emergency withdraw | Drains all strategies, pauses vault, returns funds |
| Rebalance epoch guard | Skipped before 24 h elapsed, executed after |
| APY snapshot | Recorded on each successful rebalance |

---

## 14. TypeScript SDK

```bash
cd sdk && npm install
```

```typescript
import { OracleClient, VaultClient, ASSET_IDS } from "@xero-labs/sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://testnet.hsk.xyz");

// ── Oracle ─────────────────────────────────────────────────────────────────
const oracle = new OracleClient(
  "0x5d019f68DCD9792afb242eec64074558fBd6b10B",
  provider
);

const gold = await oracle.getPrice(ASSET_IDS.GOLD);
console.log(gold.priceFormatted); // "1,935.74"
console.log(gold.confidence);     // 85
console.log(gold.isStale);        // false

// Batch query — one RPC call
const [goldP, tslaP, mmfP] = await oracle.getPriceBatch([
  ASSET_IDS.GOLD, ASSET_IDS.TSLA, ASSET_IDS.MMF,
]);

// Subscribe to live price updates (polls every 12 s)
const unsubscribe = oracle.subscribeToPrice(ASSET_IDS.TSLA, (p) => {
  console.log("TSLA NAV:", p.priceFormatted);
});
unsubscribe(); // stop subscription

// ── Vault ──────────────────────────────────────────────────────────────────
const vault = new VaultClient(
  "0x6060e1E6303e035668ac76DC4B6002aF2EDd622a",
  provider
);

const tvl    = await vault.getTVL();         // e.g. "1,234,567.89" USD
const apy    = await vault.getAPY();         // e.g. 5.23 (percent)
const allocs = await vault.getAllocations(); // [{strategy, name, bps}, ...]
```

### Asset ID Constants

```typescript
import { ethers } from "ethers";

export const ASSET_IDS = {
  TSLA:    ethers.id("TSLA-TOKENIZED"),
  AAPL:    ethers.id("AAPL-TOKENIZED"),
  NVDA:    ethers.id("NVDA-TOKENIZED"),
  GOLD:    ethers.id("XAU-TOKENIZED"),
  SILVER:  ethers.id("XAG-TOKENIZED"),
  REIT:    ethers.id("US-REAL-ESTATE-INDEX"),
  MMF:     ethers.id("MMF-USD"),
  TBILL1M: ethers.id("TBILL-1M"),
  TBILL3M: ethers.id("TBILL-3M"),
} as const;
```

---

## 15. Off-chain Services

Located in `offchain/src/`:

### Price Pusher (`price-pusher/`)

Polls external NAV data providers (Bloomberg, Refinitiv, CoinGecko) on a configurable interval and calls `updatePriceBatch()` on `XeroOracle`. Also calls `verifyOracleProof()` on the Supra Storage Contract to keep Supra prices fresh.

```bash
cd offchain && npm install
PRICE_PUSHER_PRIVATE_KEY=0x... \
ORACLE_ADDRESS=0x5d019f68DCD9792afb242eec64074558fBd6b10B \
npm run pusher
# Default push interval: 60 seconds
```

### Rebalancer (`rebalancer/`)

Monitors the vault epoch and calls `maybeRebalance()` on `XeroVault` when 24 hours have elapsed.

```bash
DEPLOYER_PRIVATE_KEY=0x... \
VAULT_ADDRESS=0x6060e1E6303e035668ac76DC4B6002aF2EDd622a \
npm run rebalancer
```

### REST API (`api/`)

```bash
ORACLE_ADDRESS=0x5d019f68DCD9792afb242eec64074558fBd6b10B npm run api
# Listens on http://localhost:3001
```

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service liveness check |
| `/prices` | GET | All registered asset NAV prices |
| `/prices/:assetId` | GET | Single asset (hex keccak256 assetId) |
| `/assets` | GET | All registered assets with metadata |
| `/vault/tvl` | GET | Total value locked in USDC |
| `/vault/apy` | GET | Blended APY across active strategies |

---

## 16. Frontend

Built with **Next.js 14** (App Router), **wagmi v2**, **viem**, **Tailwind CSS**.

```bash
cd frontend && npm install
cp ../.env.example .env.local

# Required env vars:
# NEXT_PUBLIC_ORACLE_ADDRESS=0x5d019f68DCD9792afb242eec64074558fBd6b10B
# NEXT_PUBLIC_VAULT_ADDRESS=0x6060e1E6303e035668ac76DC4B6002aF2EDd622a
# NEXT_PUBLIC_USDC_ADDRESS=0x79F319104FEE8e9f2209246eF878aa46deC0bedb
# NEXT_PUBLIC_CHAIN_ID=133

npm run dev
# Open http://localhost:3000
```

### Pages

| Route | Description |
|---|---|
| `/` | Home — live NAV price cards, TVL banner, blended APY |
| `/oracle` | Oracle dashboard — confidence indicators, staleness warnings, per-asset TWAP chart |
| `/vault` | Vault dashboard — deposit/withdraw widget, strategy allocation donut, APY history |

---

## 17. Security

### Implemented Measures

| Measure | Details |
|---|---|
| **ReentrancyGuard** | All vault state-changing functions (`deposit`, `redeem`, `withdraw`, `emergencyWithdraw`) |
| **AccessControl / Ownable** | No unprotected admin functions anywhere in the system |
| **Circuit breaker** | Anomalous price spikes >20% in <60 s automatically rejected |
| **Staleness flags** | Every `NavPrice` exposes `isStale`; integrators should check `isFresh()` |
| **SafeERC20** | All `IERC20` transfers use OpenZeppelin's safe wrappers |
| **Pausable vault** | Owner can pause deposits/withdrawals in an emergency |
| **Emergency withdraw** | Drains all strategy holdings to vault, disables further deposits |
| **Constructor guards** | Zero-address checks on all critical immutables at deployment |
| **Integer safety** | Solidity 0.8 built-in overflow/underflow protection |
| **Role separation** | `PRICE_PUSHER_ROLE` cannot govern; `GOVERNOR_ROLE` cannot push prices |

### Audit Status

Developed for the **HashKey Chain On-Chain Horizon Hackathon**. No formal security audit has been conducted. **Do not use in production without a full third-party audit.**

### Known MVP Limitations

- Strategy `totalValue()` uses in-contract simulated yield accrual, not a live RWA protocol connection
- T-bill maturity is a fixed timestamp. No on-chain renewal or roll mechanism yet
- Off-chain price pusher requires licensed data feed credentials for production
- No timelock on governance actions (recommended before mainnet)

---

## 18. Key Design Decisions

### Why Supra Pull Oracle (not Push)?

Supra's Pull model avoids the gas cost of continuously pushing prices. Prices are verified and stored on-chain **only when consumed** by a keeper or user. This minimises on-chain storage overhead while providing BFT-level data integrity from up to 21 independent DORA nodes — ideal for HashKey Chain's transaction cost model.

### Why ERC-4626?

ERC-4626 is the tokenised vault standard. Any DeFi protocol (Aave fork, yield aggregator, AMM) that supports the standard can integrate with `XeroVault` with **zero custom adapter code** — they get TVL, share price, and deposit/withdraw flows automatically.

### Why TWAP?

Spot prices are manipulatable in lower-liquidity environments. The 24-slot TWAP buffer makes it significantly more expensive to move the effective oracle price within the window an attacker would need to extract value from the vault.

### Why 8-Decimal Prices?

Following Chainlink's established convention means `XeroOracle` prices slot directly into any Chainlink-compatible DeFi protocol (lending markets, synthetic assets, structured products) deployed on HashKey Chain without any conversion layer.

### Why a Diversification Floor?

A 5% minimum allocation per active strategy prevents the router from concentrating 100% of capital into a single strategy that may be temporarily the highest-yielding but is also illiquid or risky. The 60% ceiling prevents dangerous over-concentration.

---

## 19. License

MIT — see [LICENSE](LICENSE)

---

*Built for the HashKey Chain On-Chain Horizon Hackathon 2026 by the XeroLabs team.*
