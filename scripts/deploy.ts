import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy order:
 *  0. TestUSDC (test stablecoin with faucet)
 *  1. AssetRegistry
 *  2. OracleAggregator(assetRegistry)
 *  3. XeroOracle(aggregator, assetRegistry)
 *  4. SupraAdapters for Gold, Silver, BTC, ETH, USDC
 *  5. Register assets + price sources (sourceId=1 off-chain, sourceId=2 Supra)
 *  6. Grant PRICE_PUSHER_ROLE
 *  7. Push initial seed prices
 *  8. Deploy strategies (MMFStrategy, TBillStrategy, GoldStrategy)
 *  9. StrategyRouter(usdc, oracle)
 * 10. RebalanceEngine(router)
 * 11. XeroVault(usdc, router, engine, oracle, feeRecipient)
 * 12. Wire ownership and roles
 * 13. Write addresses to deployments/<network>.json
 *
 * Supra Pull Oracle — HashKey Testnet:  0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702
 * Supra Storage Contract — Testnet:     0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917
 * DORA consensus: up to 21 sources, Byzantine Fault Tolerant, 18-decimal prices.
 */

// ── Supra configuration ───────────────────────────────────────────────────────
const SUPRA_PULL_ORACLE_TESTNET = "0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702";
const SUPRA_PULL_ORACLE_MAINNET = "0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD";

const SUPRA_PAIRS = {
  BTC_USD:  0,   // Bitcoin / USD
  ETH_USD:  19,  // Ethereum / USD
  USDT_USD: 48,  // Tether / USD
  XAU_USD:  74,  // Gold / USD
  XAG_USD:  75,  // Silver / USD
  USDC_USD: 89,  // USD Coin / USD
} as const;

const SUPRA_DECIMALS = 18; // Supra returns prices with 18 decimal places

const SOURCE_PUSHER = 1;   // off-chain price pusher service
const SOURCE_SUPRA  = 2;   // on-chain Supra Pull Oracle adapter

// Seed prices (8-decimal USD) for off-chain sourced assets (sourceId=1)
const SEED_PRICES: Record<string, bigint> = {
  "TSLA-TOKENIZED":       28473_00000000n, // $284.73
  "AAPL-TOKENIZED":       19587_00000000n, // $195.87
  "NVDA-TOKENIZED":       87523_00000000n, // $875.23
  "XAU-TOKENIZED":       193574_00000000n, // $1,935.74 (also Supra pair 74)
  "XAG-TOKENIZED":         2427_00000000n, // $24.27    (also Supra pair 75)
  "US-REAL-ESTATE-INDEX":  35421_00000000n,// $354.21
  "MMF-USD":               1_00000000n,    // $1.00     (also Supra USDC/USD)
  "TBILL-1M":              9993_00000000n, // $99.93
  "TBILL-3M":              9978_00000000n, // $99.78
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" XeroLabs — HashKey Testnet Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Deployer :", deployerAddr);
  console.log("Network  :", network.name);
  const balance = await ethers.provider.getBalance(deployerAddr);
  console.log("Balance  :", ethers.formatEther(balance), "HSK");
  console.log("───────────────────────────────────────────────────────────\n");

  // ── Configuration ──────────────────────────────────────────────────────────
  const feeRecipient  = process.env.FEE_RECIPIENT_ADDRESS  || deployerAddr;
  const pusherAddress = process.env.PRICE_PUSHER_ADDRESS   || deployerAddr;
  const supraOracle   = (network.name === "hashkeyMainnet")
    ? SUPRA_PULL_ORACLE_MAINNET
    : SUPRA_PULL_ORACLE_TESTNET;

  console.log("Supra Oracle :", supraOracle);
  console.log("Fee Recipient:", feeRecipient);
  console.log();

  // ── 0. TestUSDC ────────────────────────────────────────────────────────────
  console.log("0. Deploying TestUSDC...");
  const TestUSDCF = await ethers.getContractFactory("TestUSDC");
  const testUsdc  = await TestUSDCF.deploy(deployerAddr);
  await testUsdc.waitForDeployment();
  const usdcAddress = await testUsdc.getAddress();
  console.log("   TestUSDC:", usdcAddress);
  await (await testUsdc.mint(deployerAddr, 10_000_000n * 1_000_000n)).wait();
  console.log("   Minted 10,000,000 USDC to deployer.");

  // ── 1. AssetRegistry ───────────────────────────────────────────────────────
  console.log("\n1. Deploying AssetRegistry...");
  const AssetRegistryF = await ethers.getContractFactory("AssetRegistry");
  const assetRegistry  = await AssetRegistryF.deploy();
  await assetRegistry.waitForDeployment();
  console.log("   AssetRegistry:", await assetRegistry.getAddress());

  // ── 2. OracleAggregator ────────────────────────────────────────────────────
  console.log("2. Deploying OracleAggregator...");
  const AggregatorF = await ethers.getContractFactory("OracleAggregator");
  const aggregator  = await AggregatorF.deploy(await assetRegistry.getAddress());
  await aggregator.waitForDeployment();
  console.log("   OracleAggregator:", await aggregator.getAddress());

  // ── 3. XeroOracle ──────────────────────────────────────────────────────────
  console.log("3. Deploying XeroOracle...");
  const OracleF = await ethers.getContractFactory("XeroOracle");
  const oracle  = await OracleF.deploy(
    await aggregator.getAddress(),
    await assetRegistry.getAddress()
  );
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("   XeroOracle:", oracleAddr);

  // Grant ORACLE_ROLE + DEFAULT_ADMIN_ROLE to XeroOracle on OracleAggregator
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  await (await aggregator.grantRole(ORACLE_ROLE, oracleAddr)).wait();
  await (await aggregator.grantRole(ethers.ZeroHash, oracleAddr)).wait();

  // ── 4. Deploy Supra Adapters ───────────────────────────────────────────────
  console.log("\n4. Deploying Supra Price Adapters...");
  const SupraAdapterF = await ethers.getContractFactory("SupraAdapter");

  const supraGold = await SupraAdapterF.deploy(
    supraOracle, SUPRA_PAIRS.XAU_USD, SUPRA_DECIMALS, 86400, "Supra XAU/USD"
  );
  await supraGold.waitForDeployment();
  console.log("   SupraAdapter XAU/USD:", await supraGold.getAddress());

  const supraSilver = await SupraAdapterF.deploy(
    supraOracle, SUPRA_PAIRS.XAG_USD, SUPRA_DECIMALS, 86400, "Supra XAG/USD"
  );
  await supraSilver.waitForDeployment();
  console.log("   SupraAdapter XAG/USD:", await supraSilver.getAddress());

  const supraBtc = await SupraAdapterF.deploy(
    supraOracle, SUPRA_PAIRS.BTC_USD, SUPRA_DECIMALS, 3600, "Supra BTC/USD"
  );
  await supraBtc.waitForDeployment();
  console.log("   SupraAdapter BTC/USD:", await supraBtc.getAddress());

  const supraEth = await SupraAdapterF.deploy(
    supraOracle, SUPRA_PAIRS.ETH_USD, SUPRA_DECIMALS, 3600, "Supra ETH/USD"
  );
  await supraEth.waitForDeployment();
  console.log("   SupraAdapter ETH/USD:", await supraEth.getAddress());

  const supraUsdc = await SupraAdapterF.deploy(
    supraOracle, SUPRA_PAIRS.USDC_USD, SUPRA_DECIMALS, 86400, "Supra USDC/USD"
  );
  await supraUsdc.waitForDeployment();
  console.log("   SupraAdapter USDC/USD:", await supraUsdc.getAddress());

  // ── 5. Register Assets + Price Sources ────────────────────────────────────
  console.log("\n5. Registering assets and price sources...");

  type AssetConfig = {
    key: string;
    sym: string;
    type: number;
    staleness: number;
    supraAdapter?: string;
  };

  const assets: AssetConfig[] = [
    { key: "TSLA-TOKENIZED",       sym: "xTSLA",    type: 0, staleness: 3600  },
    { key: "AAPL-TOKENIZED",       sym: "xAAPL",    type: 0, staleness: 3600  },
    { key: "NVDA-TOKENIZED",       sym: "xNVDA",    type: 0, staleness: 3600  },
    { key: "XAU-TOKENIZED",        sym: "xGOLD",    type: 1, staleness: 86400,
      supraAdapter: await supraGold.getAddress() },
    { key: "XAG-TOKENIZED",        sym: "xSILVER",  type: 1, staleness: 86400,
      supraAdapter: await supraSilver.getAddress() },
    { key: "US-REAL-ESTATE-INDEX", sym: "xRE",      type: 2, staleness: 86400 },
    { key: "MMF-USD",              sym: "xMMF",     type: 3, staleness: 3600,
      supraAdapter: await supraUsdc.getAddress() },
    { key: "TBILL-1M",             sym: "xTBILL1M", type: 4, staleness: 86400 },
    { key: "TBILL-3M",             sym: "xTBILL3M", type: 4, staleness: 86400 },
  ];

  // Grant PRICE_PUSHER_ROLE before pushing initial prices
  console.log("\n6. Granting PRICE_PUSHER_ROLE...");
  const PUSHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PRICE_PUSHER_ROLE"));
  await (await oracle.grantRole(PUSHER_ROLE, deployerAddr)).wait();
  if (pusherAddress !== deployerAddr) {
    await (await oracle.grantRole(PUSHER_ROLE, pusherAddress)).wait();
    console.log("   Granted to price pusher service:", pusherAddress);
  }
  console.log("   Granted to deployer:", deployerAddr);

  for (const a of assets) {
    const assetId = ethers.id(a.key);
    await (await assetRegistry.addAsset(assetId, a.sym, deployerAddr, a.type, a.staleness)).wait();
    await (await oracle.addPriceSource(assetId, SOURCE_PUSHER, ethers.ZeroAddress, 10000)).wait();
    if (a.supraAdapter) {
      await (await oracle.addPriceSource(assetId, SOURCE_SUPRA, a.supraAdapter, 10000)).wait();
      console.log(`   Registered: ${a.sym} [off-chain + Supra → ${a.supraAdapter}]`);
    } else {
      console.log(`   Registered: ${a.sym} [off-chain only]`);
    }
  }

  // ── 7. Push initial seed prices ────────────────────────────────────────────
  console.log("\n7. Pushing initial seed prices (sourceId=1)...");
  const seedAssetIds: string[] = [];
  const seedPrices:   bigint[] = [];
  const seedSources:  number[] = [];
  for (const a of assets) {
    const p = SEED_PRICES[a.key];
    if (p) {
      seedAssetIds.push(ethers.id(a.key));
      seedPrices.push(p);
      seedSources.push(SOURCE_PUSHER);
    }
  }
  await (await oracle.updatePriceBatch(seedAssetIds, seedPrices, seedSources)).wait();
  console.log(`   Pushed ${seedAssetIds.length} seed prices.`);

  // ── 8. Deploy Strategies ───────────────────────────────────────────────────
  console.log("\n8. Deploying strategies...");

  const MMFStrategyF = await ethers.getContractFactory("MMFStrategy");
  const mmfStrategy  = await MMFStrategyF.deploy(usdcAddress, oracleAddr, ethers.id("MMF-USD"));
  await mmfStrategy.waitForDeployment();
  console.log("   MMFStrategy:", await mmfStrategy.getAddress());

  const futureMaturity = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const TBillF  = await ethers.getContractFactory("TBillStrategy");
  const tbill   = await TBillF.deploy(usdcAddress, oracleAddr, ethers.id("TBILL-3M"), futureMaturity);
  await tbill.waitForDeployment();
  console.log("   TBillStrategy:", await tbill.getAddress());

  const GoldF  = await ethers.getContractFactory("GoldStrategy");
  const gold   = await GoldF.deploy(usdcAddress, oracleAddr, ethers.id("XAU-TOKENIZED"));
  await gold.waitForDeployment();
  console.log("   GoldStrategy:", await gold.getAddress());

  // ── 9. StrategyRouter ──────────────────────────────────────────────────────
  console.log("\n9. Deploying StrategyRouter...");
  const RouterF = await ethers.getContractFactory("StrategyRouter");
  const router  = await RouterF.deploy(usdcAddress, oracleAddr);
  await router.waitForDeployment();
  console.log("   StrategyRouter:", await router.getAddress());

  // ── 10. RebalanceEngine ────────────────────────────────────────────────────
  console.log("10. Deploying RebalanceEngine...");
  const EngineF  = await ethers.getContractFactory("RebalanceEngine");
  const engine   = await EngineF.deploy(await router.getAddress());
  await engine.waitForDeployment();
  console.log("    RebalanceEngine:", await engine.getAddress());

  // ── 11. XeroVault ─────────────────────────────────────────────────────────
  console.log("11. Deploying XeroVault...");
  const VaultF = await ethers.getContractFactory("XeroVault");
  const vault  = await VaultF.deploy(
    usdcAddress,
    await router.getAddress(),
    await engine.getAddress(),
    oracleAddr,
    feeRecipient
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("    XeroVault:", vaultAddr);

  // ── 12. Wire ownership ─────────────────────────────────────────────────────
  console.log("\n12. Wiring ownership...");
  await (await router.transferOwnership(vaultAddr)).wait();
  await (await engine.transferOwnership(vaultAddr)).wait();
  await (await mmfStrategy.transferOwnership(await router.getAddress())).wait();
  await (await tbill.transferOwnership(await router.getAddress())).wait();
  await (await gold.transferOwnership(await router.getAddress())).wait();

  // Register strategies: MMF 50% | TBill 30% | Gold 20%
  await (await vault.addStrategy(await mmfStrategy.getAddress(), 5000)).wait();
  await (await vault.addStrategy(await tbill.getAddress(), 3000)).wait();
  await (await vault.addStrategy(await gold.getAddress(), 2000)).wait();
  console.log("   Strategies: MMF(50%) | TBill(30%) | Gold(20%)");

  // ── 13. Write deployment addresses ────────────────────────────────────────
  const deployments = {
    network:    network.name,
    chainId:    (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp:  new Date().toISOString(),
    deployer:   deployerAddr,
    supraOracle,
    contracts: {
      TestUSDC:           usdcAddress,
      AssetRegistry:      await assetRegistry.getAddress(),
      OracleAggregator:   await aggregator.getAddress(),
      XeroOracle:         oracleAddr,
      SupraAdapterGold:   await supraGold.getAddress(),
      SupraAdapterSilver: await supraSilver.getAddress(),
      SupraAdapterBTC:    await supraBtc.getAddress(),
      SupraAdapterETH:    await supraEth.getAddress(),
      SupraAdapterUSDC:   await supraUsdc.getAddress(),
      MMFStrategy:        await mmfStrategy.getAddress(),
      TBillStrategy:      await tbill.getAddress(),
      GoldStrategy:       await gold.getAddress(),
      StrategyRouter:     await router.getAddress(),
      RebalanceEngine:    await engine.getAddress(),
      XeroVault:          vaultAddr,
    },
  };

  const outDir  = path.join(__dirname, "../deployments");
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" ✅  Deployment Complete — HashKey Testnet");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(JSON.stringify(deployments.contracts, null, 2));
  console.log(`\nAddresses saved to: ${outFile}`);

  console.log("\n─── Copy these into your .env ────────────────────────────");
  console.log(`USDC_ADDRESS_HASHKEY=${usdcAddress}`);
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_CHAIN_ID=133`);
  console.log(`NEXT_PUBLIC_RPC_URL=https://testnet.hsk.xyz`);
  console.log("──────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
