// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../oracle/AssetRegistry.sol";
import "../oracle/OracleAggregator.sol";
import "../interfaces/IXeroOracle.sol";

/**
 * @title OracleGovernance
 * @notice Governance contract for adding/removing assets and updating price
 * sources in the XeroOracle system.
 *
 * For the hackathon this is a simple AccessControl wrapper that provides
 * named functions with clear governance semantics.
 */
contract OracleGovernance is AccessControl {
    AssetRegistry    public immutable assetRegistry;
    OracleAggregator public immutable oracleAggregator;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    event AssetProposed(bytes32 indexed assetId, string symbol);
    event SourceUpdated(bytes32 indexed assetId, uint8 sourceId);

    constructor(address _assetRegistry, address _oracleAggregator) {
        assetRegistry    = AssetRegistry(_assetRegistry);
        oracleAggregator = OracleAggregator(_oracleAggregator);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);
    }

    // ─── Asset lifecycle ─────────────────────────────────────────────────────

    function proposeAsset(
        bytes32 assetId,
        string calldata symbol,
        address tokenAddress,
        IXeroOracle.AssetType assetType,
        uint256 stalenessSeconds
    ) external onlyRole(GOVERNOR_ROLE) {
        assetRegistry.addAsset(assetId, symbol, tokenAddress, assetType, stalenessSeconds);
        emit AssetProposed(assetId, symbol);
    }

    function retireAsset(bytes32 assetId) external onlyRole(GOVERNOR_ROLE) {
        assetRegistry.deactivateAsset(assetId);
    }

    function updateStalenessThreshold(bytes32 assetId, uint256 threshold)
        external
        onlyRole(GOVERNOR_ROLE)
    {
        assetRegistry.setStalenessThreshold(assetId, threshold);
    }

    // ─── Source lifecycle ─────────────────────────────────────────────────────

    function addSource(
        bytes32 assetId,
        uint8   sourceId,
        address adapter,
        uint16  weight
    ) external onlyRole(GOVERNOR_ROLE) {
        oracleAggregator.addSource(assetId, sourceId, adapter, weight);
        emit SourceUpdated(assetId, sourceId);
    }

    function removeSource(bytes32 assetId, uint8 sourceId)
        external
        onlyRole(GOVERNOR_ROLE)
    {
        oracleAggregator.removeSource(assetId, sourceId);
    }
}
