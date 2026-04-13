import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy order:
 * 1. AssetRegistry
 * 2. OracleAggregator(assetRegistry)
 * 3. XeroOracle(aggregator, assetRegistry)
 * 4. Register initial assets
 * 5. Grant PRICE_PUSHER_ROLE
 * 6. Deploy strategies
 * 7. StrategyRouter(usdc, oracle)
 * 8. RebalanceEngine(router)
 * 9. XeroVault(usdc, router, engine, oracle, feeRecipient)
 * 10. Wire up ownership and roles
 * 11. Write addresses to deployments/<network>.json
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", network.name);

  // ── Configuration ──────────────────────────────────────────────────────────
  const usdcAddress   = process.env.USDC_ADDRESS_HASHKEY  || ethers.ZeroAddress;
  const feeRecipient  = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;
  const pusherAddress = process.env.PRICE_PUSHER_ADDRESS  || deployer.address;

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
  console.log("   XeroOracle:", await oracle.getAddress());

  // Grant ORACLE_ROLE + DEFAULT_ADMIN_ROLE to oracle on aggregator
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  await (await aggregator.grantRole(ORACLE_ROLE, await oracle.getAddress())).wait();
  await (await aggregator.grantRole(ethers.ZeroHash, await oracle.getAddress())).wait();

  // ── 4. Register initial assets ─────────────────────────────────────────────
  console.log("4. Registering assets...");

  const assets = [
    { id: ethers.id("TSLA-TOKENIZED"),        sym: "xTSLA",  type: 0, staleness: 3600  },
    { id: ethers.id("AAPL-TOKENIZED"),        sym: "xAAPL",  type: 0, staleness: 3600  },
    { id: ethers.id("NVDA-TOKENIZED"),        sym: "xNVDA",  type: 0, staleness: 3600  },
    { id: ethers.id("XAU-TOKENIZED"),         sym: "xGOLD",  type: 1, staleness: 86400 },
    { id: ethers.id("XAG-TOKENIZED"),         sym: "xSILVER",type: 1, staleness: 86400 },
    { id: ethers.id("US-REAL-ESTATE-INDEX"),  sym: "xRE",    type: 2, staleness: 86400 },
    { id: ethers.id("MMF-USD"),               sym: "xMMF",   type: 3, staleness: 3600  },
    { id: ethers.id("TBILL-1M"),              sym: "xTBILL1M",type:4, staleness: 86400 },
    { id: ethers.id("TBILL-3M"),              sym: "xTBILL3M",type:4, staleness: 86400 },
  ];

  for (const a of assets) {
    const mockToken = deployer.address; // mock token address for hackathon
    await (await assetRegistry.addAsset(a.id, a.sym, mockToken, a.type, a.staleness)).wait();
    // Add pusher as source 1 for each asset
    await (await oracle.addPriceSource(a.id, 1, ethers.ZeroAddress, 10000)).wait();
    console.log(`   Registered: ${a.sym}`);
  }

  // ── 5. Grant PRICE_PUSHER_ROLE ─────────────────────────────────────────────
  console.log("5. Granting PRICE_PUSHER_ROLE...");
  const PUSHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PRICE_PUSHER_ROLE"));
  await (await oracle.grantRole(PUSHER_ROLE, pusherAddress)).wait();
  console.log("   PRICE_PUSHER_ROLE granted to:", pusherAddress);

  // ── 6. Deploy Strategies ───────────────────────────────────────────────────
  console.log("6. Deploying strategies...");

  // For hackathon: use deployer address as USDC if no real USDC address
  const usdc = usdcAddress !== ethers.ZeroAddress ? usdcAddress : deployer.address;

  const MMFStrategyF = await ethers.getContractFactory("MMFStrategy");
  const mmfStrategy  = await MMFStrategyF.deploy(
    usdc,
    await oracle.getAddress(),
    ethers.id("MMF-USD")
  );
  await mmfStrategy.waitForDeployment();
  console.log("   MMFStrategy:", await mmfStrategy.getAddress());

  const futureMaturity = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const TBillF  = await ethers.getContractFactory("TBillStrategy");
  const tbill   = await TBillF.deploy(
    usdc,
    await oracle.getAddress(),
    ethers.id("TBILL-3M"),
    futureMaturity
  );
  await tbill.waitForDeployment();
  console.log("   TBillStrategy:", await tbill.getAddress());

  const GoldF  = await ethers.getContractFactory("GoldStrategy");
  const gold   = await GoldF.deploy(
    usdc,
    await oracle.getAddress(),
    ethers.id("XAU-TOKENIZED")
  );
  await gold.waitForDeployment();
  console.log("   GoldStrategy:", await gold.getAddress());

  // ── 7. StrategyRouter ──────────────────────────────────────────────────────
  console.log("7. Deploying StrategyRouter...");
  const RouterF = await ethers.getContractFactory("StrategyRouter");
  const router  = await RouterF.deploy(usdc, await oracle.getAddress());
  await router.waitForDeployment();
  console.log("   StrategyRouter:", await router.getAddress());

  // ── 8. RebalanceEngine ─────────────────────────────────────────────────────
  console.log("8. Deploying RebalanceEngine...");
  const EngineF  = await ethers.getContractFactory("RebalanceEngine");
  const engine   = await EngineF.deploy(await router.getAddress());
  await engine.waitForDeployment();
  console.log("   RebalanceEngine:", await engine.getAddress());

  // ── 9. XeroVault ──────────────────────────────────────────────────────────
  console.log("9. Deploying XeroVault...");
  const VaultF = await ethers.getContractFactory("XeroVault");
  const vault  = await VaultF.deploy(
    usdc,
    await router.getAddress(),
    await engine.getAddress(),
    await oracle.getAddress(),
    feeRecipient
  );
  await vault.waitForDeployment();
  console.log("   XeroVault:", await vault.getAddress());

  // ── 10. Wire ownership ─────────────────────────────────────────────────────
  console.log("10. Wiring ownership...");
  await (await router.transferOwnership(await vault.getAddress())).wait();
  await (await engine.transferOwnership(await vault.getAddress())).wait();
  await (await mmfStrategy.transferOwnership(await router.getAddress())).wait();
  await (await tbill.transferOwnership(await router.getAddress())).wait();
  await (await gold.transferOwnership(await router.getAddress())).wait();

  // Register strategies with vault
  await (await vault.addStrategy(await mmfStrategy.getAddress(), 6000)).wait();
  await (await vault.addStrategy(await tbill.getAddress(), 3000)).wait();
  await (await vault.addStrategy(await gold.getAddress(), 2000)).wait();
  console.log("   Strategies registered.");

  // ── 11. Write deployment addresses ────────────────────────────────────────
  const deployments = {
    network: network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      AssetRegistry:   await assetRegistry.getAddress(),
      OracleAggregator: await aggregator.getAddress(),
      XeroOracle:      await oracle.getAddress(),
      MMFStrategy:     await mmfStrategy.getAddress(),
      TBillStrategy:   await tbill.getAddress(),
      GoldStrategy:    await gold.getAddress(),
      StrategyRouter:  await router.getAddress(),
      RebalanceEngine: await engine.getAddress(),
      XeroVault:       await vault.getAddress(),
    },
  };

  const outDir  = path.join(__dirname, "../deployments");
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));
  console.log(`\n✅ Deployment complete. Addresses written to ${outFile}`);
  console.log(JSON.stringify(deployments.contracts, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
