import express, { Request, Response } from "express";
import { ethers } from "ethers";

const ORACLE_ABI = [
  "function getPrice(bytes32 assetId) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals))",
  "function getAllAssets() external view returns (tuple(bytes32 assetId, string symbol, address tokenAddress, uint8 assetType, bool active)[])",
  "function getPriceBatch(bytes32[] assetIds) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals)[])",
];

export function createApiServer(config: {
  oracleAddress: string;
  rpcUrl:        string;
  port?:         number;
}): express.Application {
  const app      = express();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const oracle   = new ethers.Contract(config.oracleAddress, ORACLE_ABI, provider);
  const port     = config.port ?? 3001;

  app.use(express.json());

  // ── GET /health ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // ── GET /prices/:assetId ─────────────────────────────────────────────────────
  app.get("/prices/:assetId", async (req: Request, res: Response) => {
    try {
      const { assetId } = req.params;
      const raw = await oracle.getPrice(assetId);
      res.json({
        assetId,
        price:     raw.price.toString(),
        updatedAt: Number(raw.updatedAt),
        confidence: Number(raw.confidence),
        isStale:    Boolean(raw.isStale),
        decimals:   Number(raw.decimals),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /prices ──────────────────────────────────────────────────────────────
  // Returns all registered assets with their current prices.
  app.get("/prices", async (_req: Request, res: Response) => {
    try {
      const assets  = await oracle.getAllAssets();
      const assetIds = (assets as any[]).map((a: any) => a.assetId);
      const prices   = await oracle.getPriceBatch(assetIds);

      const result = (assets as any[]).map((a: any, i: number) => ({
        assetId:    a.assetId,
        symbol:     a.symbol,
        assetType:  a.assetType,
        price:      prices[i].price.toString(),
        updatedAt:  Number(prices[i].updatedAt),
        confidence: Number(prices[i].confidence),
        isStale:    Boolean(prices[i].isStale),
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /assets ───────────────────────────────────────────────────────────────
  app.get("/assets", async (_req: Request, res: Response) => {
    try {
      const assets = await oracle.getAllAssets();
      res.json(
        (assets as any[]).map((a: any) => ({
          assetId:      a.assetId,
          symbol:       a.symbol,
          tokenAddress: a.tokenAddress,
          assetType:    Number(a.assetType),
          active:       Boolean(a.active),
        }))
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

// ── Entry point when run directly ─────────────────────────────────────────────
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require("dotenv");
  dotenv.config({ path: "../../.env" });

  const config = {
    oracleAddress: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "",
    rpcUrl:        process.env.HASHKEY_TESTNET_RPC || "https://testnet.hsk.xyz",
    port:          Number(process.env.API_PORT || 3001),
  };

  const app = createApiServer(config);
  app.listen(config.port, () => {
    console.log(`[API] Listening on port ${config.port}`);
  });
}
