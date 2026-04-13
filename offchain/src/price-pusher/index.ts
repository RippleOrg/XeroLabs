import * as dotenv from "dotenv";
import { PricePusher } from "./PricePusher";

dotenv.config({ path: "../../.env" });

const config = {
  rpcUrl:           process.env.HASHKEY_TESTNET_RPC  || "https://testnet.hsk.xyz",
  fallbackRpcUrl:   process.env.HASHKEY_MAINNET_RPC  || "https://mainnet.hsk.xyz",
  oracleAddress:    process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "",
  pusherPrivateKey: process.env.PRICE_PUSHER_PRIVATE_KEY  || "",
  sourceId:         1,
  minChangeBps:     10,
  maxAgeSeconds:    3600,
};

if (!config.oracleAddress) {
  console.error("NEXT_PUBLIC_ORACLE_ADDRESS not set");
  process.exit(1);
}
if (!config.pusherPrivateKey) {
  console.error("PRICE_PUSHER_PRIVATE_KEY not set");
  process.exit(1);
}

const pusher = new PricePusher(config);

// Graceful shutdown
process.on("SIGINT",  () => { pusher.stop(); process.exit(0); });
process.on("SIGTERM", () => { pusher.stop(); process.exit(0); });

pusher.start();
