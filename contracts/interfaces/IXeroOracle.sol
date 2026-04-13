// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IXeroOracle
 * @notice Composable NAV oracle interface for tokenized RWAs on HashKey Chain.
 * Any protocol integrating Xero Labs needs only this interface.
 */
interface IXeroOracle {
    struct NavPrice {
        uint256 price;      // NAV per unit in USD, 8 decimals (Chainlink standard)
        uint256 updatedAt;  // Last update timestamp
        uint8 confidence;   // 0-100, confidence score across sources
        bool isStale;       // True if price older than staleness threshold
        uint8 decimals;     // Always 8 for USD prices
    }

    struct AssetInfo {
        bytes32 assetId;        // Unique identifier (e.g. keccak256("TSLA-TOKENIZED"))
        string symbol;          // e.g. "xTSLA", "xGOLD", "xMMF-USD"
        address tokenAddress;   // Tokenized asset address on HashKey Chain
        AssetType assetType;    // STOCK, PRECIOUS_METAL, REAL_ESTATE, MMF, TBILL
        bool active;
    }

    enum AssetType { STOCK, PRECIOUS_METAL, REAL_ESTATE, MMF, TBILL }

    /// @notice Get the current NAV price for an asset
    function getPrice(bytes32 assetId) external view returns (NavPrice memory);

    /// @notice Get prices for multiple assets in one call
    function getPriceBatch(bytes32[] calldata assetIds) external view returns (NavPrice[] memory);

    /// @notice Get the TWAP price over a given window
    function getTWAP(bytes32 assetId, uint256 windowSeconds) external view returns (uint256 twapPrice);

    /// @notice Check if an asset's price is within acceptable freshness
    function isFresh(bytes32 assetId) external view returns (bool);

    /// @notice Enumerate all supported assets
    function getAllAssets() external view returns (AssetInfo[] memory);

    /// @notice Get asset info by ID
    function getAsset(bytes32 assetId) external view returns (AssetInfo memory);

    event PriceUpdated(bytes32 indexed assetId, uint256 price, uint256 timestamp, uint8 confidence);
    event AssetAdded(bytes32 indexed assetId, string symbol, address tokenAddress, AssetType assetType);
    event AssetDeactivated(bytes32 indexed assetId);
}
