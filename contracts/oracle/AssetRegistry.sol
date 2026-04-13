// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IXeroOracle.sol";

/**
 * @title AssetRegistry
 * @notice Registry of all RWA assets supported by the Xero Labs oracle.
 * Manages asset metadata including symbol, token address, type and staleness threshold.
 *
 * ACCESS CONTROL:
 * - DEFAULT_ADMIN_ROLE: add/remove assets, update metadata
 */
contract AssetRegistry is AccessControl {
    mapping(bytes32 => IXeroOracle.AssetInfo) private _assets;
    mapping(bytes32 => uint256) public stalenessThreshold; // assetId => seconds
    bytes32[] private _assetIds;

    event AssetAdded(bytes32 indexed assetId, string symbol, address tokenAddress, IXeroOracle.AssetType assetType);
    event AssetDeactivated(bytes32 indexed assetId);
    event StalenessThresholdUpdated(bytes32 indexed assetId, uint256 threshold);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Register a new RWA asset.
     * @param assetId       keccak256 identifier, e.g. keccak256("TSLA-TOKENIZED")
     * @param symbol        Human-readable ticker, e.g. "xTSLA"
     * @param tokenAddress  On-chain token contract address
     * @param assetType     STOCK | PRECIOUS_METAL | REAL_ESTATE | MMF | TBILL
     * @param stalenessSeconds Staleness window in seconds (e.g. 3600 for 1 h)
     */
    function addAsset(
        bytes32 assetId,
        string calldata symbol,
        address tokenAddress,
        IXeroOracle.AssetType assetType,
        uint256 stalenessSeconds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_assets[assetId].active, "AssetRegistry: asset already active");
        require(bytes(symbol).length > 0, "AssetRegistry: empty symbol");
        require(tokenAddress != address(0), "AssetRegistry: zero token address");
        require(stalenessSeconds > 0, "AssetRegistry: zero staleness");

        _assets[assetId] = IXeroOracle.AssetInfo({
            assetId: assetId,
            symbol: symbol,
            tokenAddress: tokenAddress,
            assetType: assetType,
            active: true
        });
        stalenessThreshold[assetId] = stalenessSeconds;
        _assetIds.push(assetId);

        emit AssetAdded(assetId, symbol, tokenAddress, assetType);
    }

    /**
     * @notice Deactivate an asset. Its price data is preserved but isFresh/getPrice
     * will report stale.
     */
    function deactivateAsset(bytes32 assetId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_assets[assetId].active, "AssetRegistry: asset not active");
        _assets[assetId].active = false;
        emit AssetDeactivated(assetId);
    }

    /**
     * @notice Update the staleness threshold for an asset.
     */
    function setStalenessThreshold(bytes32 assetId, uint256 threshold)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(threshold > 0, "AssetRegistry: zero staleness");
        stalenessThreshold[assetId] = threshold;
        emit StalenessThresholdUpdated(assetId, threshold);
    }

    /// @notice Returns asset metadata, reverts if unknown.
    function getAsset(bytes32 assetId) external view returns (IXeroOracle.AssetInfo memory) {
        require(_assets[assetId].tokenAddress != address(0), "AssetRegistry: unknown asset");
        return _assets[assetId];
    }

    /// @notice Returns all asset IDs ever registered (including inactive ones).
    function getAllAssetIds() external view returns (bytes32[] memory) {
        return _assetIds;
    }

    /// @notice Returns metadata for every registered asset (active + inactive).
    function getAllAssets() external view returns (IXeroOracle.AssetInfo[] memory) {
        uint256 len = _assetIds.length;
        IXeroOracle.AssetInfo[] memory result = new IXeroOracle.AssetInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _assets[_assetIds[i]];
        }
        return result;
    }

    /// @notice Returns true if the asset is registered and active.
    function isActive(bytes32 assetId) external view returns (bool) {
        return _assets[assetId].active;
    }
}
