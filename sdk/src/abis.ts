// Minimal ABI for XeroOracle contract
export const XERO_ORACLE_ABI = [
  // IXeroOracle read functions
  "function getPrice(bytes32 assetId) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals))",
  "function getPriceBatch(bytes32[] assetIds) external view returns (tuple(uint256 price, uint256 updatedAt, uint8 confidence, bool isStale, uint8 decimals)[])",
  "function getTWAP(bytes32 assetId, uint256 windowSeconds) external view returns (uint256)",
  "function isFresh(bytes32 assetId) external view returns (bool)",
  "function getAllAssets() external view returns (tuple(bytes32 assetId, string symbol, address tokenAddress, uint8 assetType, bool active)[])",
  "function getAsset(bytes32 assetId) external view returns (tuple(bytes32 assetId, string symbol, address tokenAddress, uint8 assetType, bool active))",
  // Events
  "event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 timestamp, uint8 confidence)",
  "event AssetAdded(bytes32 indexed assetId, string symbol, address tokenAddress, uint8 assetType)",
  "event AssetDeactivated(bytes32 indexed assetId)",
] as const;

// Minimal ABI for XeroVault contract (ERC-4626 + extensions)
export const XERO_VAULT_ABI = [
  // ERC-20
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  // ERC-4626
  "function asset() external view returns (address)",
  "function totalAssets() external view returns (uint256)",
  "function convertToShares(uint256 assets) external view returns (uint256)",
  "function convertToAssets(uint256 shares) external view returns (uint256)",
  "function maxDeposit(address receiver) external view returns (uint256)",
  "function previewDeposit(uint256 assets) external view returns (uint256)",
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function maxMint(address receiver) external view returns (uint256)",
  "function previewMint(uint256 shares) external view returns (uint256)",
  "function mint(uint256 shares, address receiver) external returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)",
  "function previewWithdraw(uint256 assets) external view returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)",
  "function maxRedeem(address owner) external view returns (uint256)",
  "function previewRedeem(uint256 shares) external view returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  // XeroVault extras
  "function getAPY() external view returns (uint256)",
  "function getHistoricalAPY(uint256 fromTimestamp) external view returns (uint256)",
  "function getStrategyAllocations() external view returns (address[] strategies, uint256[] values)",
  // Events
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Rebalanced(uint256[] oldAllocations, uint256[] newAllocations, uint256 timestamp)",
  "event WithdrawalQueued(address indexed user, uint256 shares, uint256 expectedAt)",
] as const;
