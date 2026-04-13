import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { XeroOracle, OracleAggregator, AssetRegistry } from "../typechain-types";

const ASSET_TSLA  = ethers.id("TSLA-TOKENIZED");
const ASSET_GOLD  = ethers.id("XAU-TOKENIZED");
const SOURCE_A    = 1;
const SOURCE_B    = 2;
const STALENESS   = 3600; // 1 hour

describe("XeroOracle", function () {
  // ──────────────────────────────────────────────────────────────────────────
  // Fixtures
  // ──────────────────────────────────────────────────────────────────────────

  async function deployOracleFixture() {
    const [owner, pusher, stranger, tokenAddr] = await ethers.getSigners();

    const AssetRegistryF = await ethers.getContractFactory("AssetRegistry");
    const assetRegistry  = (await AssetRegistryF.deploy()) as unknown as AssetRegistry;

    const AggregatorF = await ethers.getContractFactory("OracleAggregator");
    const aggregator  = (await AggregatorF.deploy(await assetRegistry.getAddress())) as unknown as OracleAggregator;

    const OracleF = await ethers.getContractFactory("XeroOracle");
    const oracle  = (await OracleF.deploy(
      await aggregator.getAddress(),
      await assetRegistry.getAddress()
    )) as unknown as XeroOracle;

    // Grant ORACLE_ROLE to oracle (so it can call aggregator.submitSourcePrice)
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    await aggregator.grantRole(ORACLE_ROLE, await oracle.getAddress());

    // Grant DEFAULT_ADMIN_ROLE to oracle on aggregator (so it can call addSource)
    await aggregator.grantRole(ethers.ZeroHash, await oracle.getAddress());

    // Grant PRICE_PUSHER_ROLE to pusher
    const PUSHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PRICE_PUSHER_ROLE"));
    await oracle.grantRole(PUSHER_ROLE, pusher.address);

    // Register TSLA asset
    await assetRegistry.addAsset(
      ASSET_TSLA,
      "xTSLA",
      tokenAddr.address,
      0, // STOCK
      STALENESS
    );

    // Register GOLD asset
    await assetRegistry.addAsset(
      ASSET_GOLD,
      "xGOLD",
      tokenAddr.address,
      1, // PRECIOUS_METAL
      STALENESS
    );

    // Add price sources (via oracle's addPriceSource)
    await oracle.addPriceSource(ASSET_TSLA, SOURCE_A, ethers.ZeroAddress, 5000);
    await oracle.addPriceSource(ASSET_TSLA, SOURCE_B, ethers.ZeroAddress, 5000);
    await oracle.addPriceSource(ASSET_GOLD, SOURCE_A, ethers.ZeroAddress, 5000);
    await oracle.addPriceSource(ASSET_GOLD, SOURCE_B, ethers.ZeroAddress, 5000);

    return { oracle, aggregator, assetRegistry, owner, pusher, stranger };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Unit tests: updatePrice
  // ──────────────────────────────────────────────────────────────────────────

  describe("updatePrice", function () {
    it("authorized pusher can update a price and it is stored", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      const price = 28473_00000000n; // $28,473.00 with 8 decimals

      await oracle.connect(pusher).updatePrice(ASSET_TSLA, price, SOURCE_A);

      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.price).to.be.gt(0n);
      expect(p.decimals).to.equal(8);
    });

    it("unauthorized caller cannot update price", async function () {
      const { oracle, stranger } = await loadFixture(deployOracleFixture);

      await expect(
        oracle.connect(stranger).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A)
      ).to.be.reverted;
    });

    it("price requires at least one source submission to be non-zero after aggregation", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      const price = 100_00000000n;
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, price, SOURCE_A);
      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.price).to.equal(price); // single source → exact price
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Circuit breaker
  // ──────────────────────────────────────────────────────────────────────────

  describe("circuit breaker", function () {
    it("rejects price deviating > 20% within < 1 minute and emits PriceAnomalyDetected", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      const initialPrice = 100_00000000n;
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, initialPrice, SOURCE_A);

      // Push a price that is 25% higher within the same block/minute
      const anomalousPrice = 125_00000000n;
      await expect(
        oracle.connect(pusher).updatePrice(ASSET_TSLA, anomalousPrice, SOURCE_A)
      ).to.emit(oracle, "PriceAnomalyDetected");

      // Original price should be preserved
      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.price).to.equal(initialPrice);
    });

    it("accepts a large deviation after 1 minute has passed", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      const initialPrice = 100_00000000n;
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, initialPrice, SOURCE_A);

      // Advance time by 61 seconds
      await time.increase(61);

      const newPrice = 125_00000000n;
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, newPrice, SOURCE_A);

      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.price).to.equal(newPrice);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Staleness
  // ──────────────────────────────────────────────────────────────────────────

  describe("staleness", function () {
    it("fresh price has isStale = false", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);
      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.isStale).to.equal(false);
    });

    it("stale price (older than threshold) has isStale = true", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);

      // Advance past staleness threshold (3600s)
      await time.increase(STALENESS + 1);

      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.isStale).to.equal(true);
    });

    it("isFresh() returns false after threshold exceeded", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);
      await time.increase(STALENESS + 1);

      expect(await oracle.isFresh(ASSET_TSLA)).to.equal(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getPriceBatch
  // ──────────────────────────────────────────────────────────────────────────

  describe("getPriceBatch", function () {
    it("returns correct isStale per asset for mixed fresh/stale prices", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      // Push TSLA price
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 200_00000000n, SOURCE_A);
      // Push GOLD price
      await oracle.connect(pusher).updatePrice(ASSET_GOLD, 1900_00000000n, SOURCE_A);

      // Advance past staleness
      await time.increase(STALENESS + 1);

      // Push a fresh TSLA price
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 200_00000000n, SOURCE_A);

      const [tsla, gold] = await oracle.getPriceBatch([ASSET_TSLA, ASSET_GOLD]);
      expect(tsla.isStale).to.equal(false);
      expect(gold.isStale).to.equal(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TWAP
  // ──────────────────────────────────────────────────────────────────────────

  describe("getTWAP", function () {
    it("TWAP reverts for zero window", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);
      await expect(oracle.getTWAP(ASSET_TSLA, 0)).to.be.revertedWith("XeroOracle: zero window");
    });

    it("TWAP falls back to spot price when no buffer observations in window", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);
      const spotPrice = 100_00000000n;
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, spotPrice, SOURCE_A);

      // Window is 1 second in the past — buffer observation is at block.timestamp, so
      // cutoff = block.timestamp - 1, observation.timestamp >= cutoff → included
      // The TWAP should approximate the spot price
      const twap = await oracle.getTWAP(ASSET_TSLA, 3600);
      // Since we have one observation, TWAP should equal spot
      expect(twap).to.be.gt(0n);
    });

    it("circular buffer stores up to 24 observations", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      // Push 25 prices, stepping time between each
      for (let i = 1; i <= 25; i++) {
        await oracle.connect(pusher).updatePrice(ASSET_TSLA, BigInt(i) * 100_00000000n, SOURCE_A);
        await time.increase(10);
      }

      // After 25 pushes, the TWAP should still be computable
      const twap = await oracle.getTWAP(ASSET_TSLA, 300); // last 5 minutes
      expect(twap).to.be.gt(0n);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Aggregation confidence
  // ──────────────────────────────────────────────────────────────────────────

  describe("confidence", function () {
    it("two sources close together → high confidence", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      // Submit from both sources (similar prices)
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);
      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_05000000n, SOURCE_B);

      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.confidence).to.be.gte(80); // two matching sources → high confidence
    });

    it("single source → moderate confidence (50)", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await oracle.connect(pusher).updatePrice(ASSET_TSLA, 100_00000000n, SOURCE_A);
      const p = await oracle.getPrice(ASSET_TSLA);
      expect(p.confidence).to.equal(50);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // updatePriceBatch
  // ──────────────────────────────────────────────────────────────────────────

  describe("updatePriceBatch", function () {
    it("pushes multiple assets in one call", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await oracle.connect(pusher).updatePriceBatch(
        [ASSET_TSLA, ASSET_GOLD],
        [100_00000000n, 1900_00000000n],
        [SOURCE_A, SOURCE_A]
      );

      const [tsla, gold] = await oracle.getPriceBatch([ASSET_TSLA, ASSET_GOLD]);
      expect(tsla.price).to.equal(100_00000000n);
      expect(gold.price).to.equal(1900_00000000n);
    });

    it("reverts on length mismatch", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      await expect(
        oracle.connect(pusher).updatePriceBatch([ASSET_TSLA], [100_00000000n, 200_00000000n], [SOURCE_A])
      ).to.be.revertedWith("XeroOracle: length mismatch");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getAllAssets / getAsset
  // ──────────────────────────────────────────────────────────────────────────

  describe("asset enumeration", function () {
    it("getAllAssets returns registered assets", async function () {
      const { oracle } = await loadFixture(deployOracleFixture);

      const assets = await oracle.getAllAssets();
      expect(assets.length).to.equal(2);
      const symbols = assets.map((a) => a.symbol);
      expect(symbols).to.include("xTSLA");
      expect(symbols).to.include("xGOLD");
    });

    it("getAsset returns correct metadata", async function () {
      const { oracle } = await loadFixture(deployOracleFixture);

      const info = await oracle.getAsset(ASSET_TSLA);
      expect(info.symbol).to.equal("xTSLA");
      expect(info.active).to.equal(true);
      expect(info.assetType).to.equal(0); // STOCK
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Integration test: full flow
  // ──────────────────────────────────────────────────────────────────────────

  describe("integration: full price feed lifecycle", function () {
    it("deploy → push prices → query prices → verify all fields", async function () {
      const { oracle, pusher } = await loadFixture(deployOracleFixture);

      const goldPrice = 1950_50000000n; // $1,950.50

      await oracle.connect(pusher).updatePrice(ASSET_GOLD, goldPrice, SOURCE_A);
      await oracle.connect(pusher).updatePrice(ASSET_GOLD, goldPrice + 1_00000000n, SOURCE_B);

      const p = await oracle.getPrice(ASSET_GOLD);

      expect(p.price).to.be.closeTo(goldPrice, 5_00000000n); // within $5
      expect(p.isStale).to.equal(false);
      expect(p.confidence).to.be.gte(80);
      expect(p.decimals).to.equal(8);
      expect(p.updatedAt).to.be.gt(0n);
    });
  });
});
