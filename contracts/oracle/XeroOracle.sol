// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IXeroOracle.sol";
import "./OracleAggregator.sol";
import "./AssetRegistry.sol";

/**
 * @title XeroOracle
 * @notice Core NAV oracle for Xero Labs. Aggregates prices from multiple off-chain
 * sources and publishes a single on-chain price for each tokenized RWA.
 *
 * PRICE AGGREGATION: delegated to OracleAggregator.
 * TWAP: circular buffer of 24 observations per asset.
 * CIRCUIT BREAKER: rejects price if deviation > 20% within < 1 minute.
 *
 * ACCESS CONTROL:
 * - DEFAULT_ADMIN_ROLE : add/remove assets, update staleness thresholds
 * - PRICE_PUSHER_ROLE  : update prices
 * - AGGREGATOR_ROLE    : internal role for OracleAggregator
 */
contract XeroOracle is IXeroOracle, AccessControl, Pausable {
    bytes32 public constant PRICE_PUSHER_ROLE = keccak256("PRICE_PUSHER_ROLE");
    bytes32 public constant AGGREGATOR_ROLE   = keccak256("AGGREGATOR_ROLE");

    OracleAggregator public immutable aggregator;
    AssetRegistry    public immutable assetRegistry;

    // ─── TWAP circular buffer ────────────────────────────────────────────────
    struct PriceObservation {
        uint256 price;
        uint256 timestamp;
    }

    mapping(bytes32 => PriceObservation[24]) private _priceBuffer;
    mapping(bytes32 => uint8)                private _bufferIndex;

    // ─── Current price state ─────────────────────────────────────────────────
    mapping(bytes32 => NavPrice) private _prices;

    // ─── Staleness thresholds (asset-level override; fallback: assetRegistry) ─
    mapping(bytes32 => uint256) public stalenessThreshold;

    // ─── Circuit-breaker state ───────────────────────────────────────────────
    struct LastPushState {
        uint256 price;
        uint256 timestamp;
    }
    mapping(bytes32 => LastPushState) private _lastPush;

    /// @notice Emitted when a suspicious price deviation is detected.
    event PriceAnomalyDetected(bytes32 indexed assetId, uint256 rejectedPrice, uint256 lastPrice, uint256 deviation);

    constructor(address _aggregator, address _assetRegistry) {
        aggregator   = OracleAggregator(_aggregator);
        assetRegistry = AssetRegistry(_assetRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // =========================================================================
    // IXeroOracle — view functions
    // =========================================================================

    /// @inheritdoc IXeroOracle
    function getPrice(bytes32 assetId) external view override returns (NavPrice memory) {
        NavPrice memory p = _prices[assetId];
        p.isStale = _isStale(assetId, p.updatedAt);
        return p;
    }

    /// @inheritdoc IXeroOracle
    function getPriceBatch(bytes32[] calldata assetIds)
        external
        view
        override
        returns (NavPrice[] memory)
    {
        NavPrice[] memory result = new NavPrice[](assetIds.length);
        for (uint256 i = 0; i < assetIds.length; i++) {
            NavPrice memory p = _prices[assetIds[i]];
            p.isStale = _isStale(assetIds[i], p.updatedAt);
            result[i] = p;
        }
        return result;
    }

    /// @inheritdoc IXeroOracle
    function getTWAP(bytes32 assetId, uint256 windowSeconds)
        external
        view
        override
        returns (uint256 twapPrice)
    {
        require(windowSeconds > 0, "XeroOracle: zero window");
        uint256 cutoff = block.timestamp - windowSeconds;

        PriceObservation[24] storage buf = _priceBuffer[assetId];
        uint256 weightedSum = 0;
        uint256 totalTime   = 0;

        for (uint256 i = 0; i < 24; i++) {
            PriceObservation storage obs = buf[i];
            if (obs.timestamp == 0 || obs.timestamp < cutoff) continue;
            // Time weight: use 1 second as minimum granularity
            uint256 w = obs.timestamp - cutoff;
            weightedSum += obs.price * w;
            totalTime   += w;
        }

        if (totalTime == 0) {
            // Fall back to spot price if no observations in window
            return _prices[assetId].price;
        }
        return weightedSum / totalTime;
    }

    /// @inheritdoc IXeroOracle
    function isFresh(bytes32 assetId) external view override returns (bool) {
        return !_isStale(assetId, _prices[assetId].updatedAt);
    }

    /// @inheritdoc IXeroOracle
    function getAllAssets() external view override returns (AssetInfo[] memory) {
        return assetRegistry.getAllAssets();
    }

    /// @inheritdoc IXeroOracle
    function getAsset(bytes32 assetId) external view override returns (AssetInfo memory) {
        return assetRegistry.getAsset(assetId);
    }

    // =========================================================================
    // Price update functions (called by off-chain price pushers)
    // =========================================================================

    /**
     * @notice Submit a single price from a specific source.
     * @param assetId  Asset identifier
     * @param price    Price in USD with 8 decimals
     * @param sourceId Source identifier (must be registered in OracleAggregator)
     */
    function updatePrice(bytes32 assetId, uint256 price, uint8 sourceId)
        external
        whenNotPaused
        onlyRole(PRICE_PUSHER_ROLE)
    {
        _updatePrice(assetId, price, sourceId);
    }

    /**
     * @notice Batch submit prices for multiple assets in one transaction.
     */
    function updatePriceBatch(
        bytes32[] calldata assetIds,
        uint256[] calldata prices,
        uint8[]   calldata sourceIds
    ) external whenNotPaused onlyRole(PRICE_PUSHER_ROLE) {
        require(
            assetIds.length == prices.length && prices.length == sourceIds.length,
            "XeroOracle: length mismatch"
        );
        for (uint256 i = 0; i < assetIds.length; i++) {
            _updatePrice(assetIds[i], prices[i], sourceIds[i]);
        }
    }

    // =========================================================================
    // Source / threshold management (admin)
    // =========================================================================

    /**
     * @notice Add a price source for an asset (delegates to OracleAggregator).
     */
    function addPriceSource(
        bytes32 assetId,
        uint8   sourceId,
        address adapter,
        uint16  weight
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        aggregator.addSource(assetId, sourceId, adapter, weight);
    }

    /**
     * @notice Override the staleness threshold for an asset.
     */
    function setStalenessThreshold(bytes32 assetId, uint256 seconds_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(seconds_ > 0, "XeroOracle: zero staleness");
        stalenessThreshold[assetId] = seconds_;
    }

    /**
     * @notice Return all registered price sources for an asset.
     */
    function getSources(bytes32 assetId)
        external
        view
        returns (OracleAggregator.PriceSource[] memory)
    {
        return aggregator.getSources(assetId);
    }

    // =========================================================================
    // Pause controls
    // =========================================================================

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _updatePrice(bytes32 assetId, uint256 price, uint8 sourceId) internal {
        require(price > 0, "XeroOracle: zero price");

        // Circuit breaker: reject >20% deviation within 1 minute
        LastPushState storage last = _lastPush[assetId];
        if (last.price > 0 && block.timestamp - last.timestamp < 60) {
            uint256 diff = price > last.price
                ? price - last.price
                : last.price - price;
            // Use basis points: (diff * 10000) / last.price
            uint256 deviationBps = (diff * 10000) / last.price;
            if (deviationBps > 2000) { // >20%
                emit PriceAnomalyDetected(assetId, price, last.price, deviationBps);
                return; // silently reject (do not revert so batch doesn't fail)
            }
        }

        // Forward to aggregator
        aggregator.submitSourcePrice(assetId, sourceId, price);

        // Re-aggregate
        (uint256 aggPrice, uint8 confidence) = aggregator.aggregate(assetId);
        if (aggPrice == 0) return;

        // Update price buffer (TWAP ring buffer)
        uint8 idx = _bufferIndex[assetId];
        _priceBuffer[assetId][idx] = PriceObservation({
            price: aggPrice,
            timestamp: block.timestamp
        });
        _bufferIndex[assetId] = (idx + 1) % 24;

        // Update current price
        _prices[assetId] = NavPrice({
            price:     aggPrice,
            updatedAt: block.timestamp,
            confidence: confidence,
            isStale:   false,
            decimals:  8
        });

        // Update circuit-breaker state
        _lastPush[assetId] = LastPushState({price: aggPrice, timestamp: block.timestamp});

        emit PriceUpdated(assetId, aggPrice, block.timestamp, confidence);
    }

    function _isStale(bytes32 assetId, uint256 updatedAt) internal view returns (bool) {
        if (updatedAt == 0) return true;
        uint256 threshold = stalenessThreshold[assetId];
        if (threshold == 0) {
            threshold = assetRegistry.stalenessThreshold(assetId);
        }
        if (threshold == 0) return true;
        return block.timestamp - updatedAt > threshold;
    }
}
