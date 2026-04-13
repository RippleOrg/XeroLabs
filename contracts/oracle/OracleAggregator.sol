// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IXeroOracle.sol";
import "./AssetRegistry.sol";

/**
 * @title OracleAggregator
 * @notice Aggregates price submissions from multiple trusted sources and derives
 * a single consensus price with a confidence score.
 *
 * AGGREGATION ALGORITHM:
 * 1. Collect all source prices for a given asset.
 * 2. Remove outliers: discard any price more than 2 standard deviations from the
 *    unweighted median.
 * 3. Weight remaining prices by freshness: weight = 1 / (age_in_seconds + 1).
 * 4. Return the weighted average and confidence = (kept / total) * 100.
 *
 * ACCESS CONTROL:
 * - ORACLE_ROLE  : allowed to submit price updates (granted to XeroOracle)
 * - DEFAULT_ADMIN_ROLE: add/remove price sources
 */
contract OracleAggregator is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    AssetRegistry public immutable assetRegistry;

    struct PriceSource {
        uint8 sourceId;
        address adapter;     // Optional on-chain adapter (may be address(0))
        uint16 weight;       // Static weight hint (0-10000 bps), informational
        bool active;
    }

    struct SourcePrice {
        uint256 price;
        uint256 timestamp;
        uint8 sourceId;
    }

    // assetId => sourceId => PriceSource
    mapping(bytes32 => mapping(uint8 => PriceSource)) private _sources;
    // assetId => list of sourceIds
    mapping(bytes32 => uint8[]) private _sourceIds;
    // assetId => sourceId => latest price submission
    mapping(bytes32 => mapping(uint8 => SourcePrice)) public latestSourcePrices;

    event SourceAdded(bytes32 indexed assetId, uint8 sourceId, address adapter, uint16 weight);
    event SourceRemoved(bytes32 indexed assetId, uint8 sourceId);
    event SourcePriceSubmitted(bytes32 indexed assetId, uint8 sourceId, uint256 price, uint256 timestamp);

    constructor(address _assetRegistry) {
        assetRegistry = AssetRegistry(_assetRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Source management
    // ─────────────────────────────────────────────────────────────────────────

    function addSource(
        bytes32 assetId,
        uint8 sourceId,
        address adapter,
        uint16 weight
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!_sources[assetId][sourceId].active, "OracleAggregator: source exists");
        _sources[assetId][sourceId] = PriceSource({
            sourceId: sourceId,
            adapter: adapter,
            weight: weight,
            active: true
        });
        _sourceIds[assetId].push(sourceId);
        emit SourceAdded(assetId, sourceId, adapter, weight);
    }

    function removeSource(bytes32 assetId, uint8 sourceId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_sources[assetId][sourceId].active, "OracleAggregator: source not found");
        _sources[assetId][sourceId].active = false;
        emit SourceRemoved(assetId, sourceId);
    }

    function getSources(bytes32 assetId) external view returns (PriceSource[] memory) {
        uint8[] storage ids = _sourceIds[assetId];
        uint256 len = ids.length;
        PriceSource[] memory result = new PriceSource[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _sources[assetId][ids[i]];
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Price submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Record a price from a specific source (called by XeroOracle).
     */
    function submitSourcePrice(bytes32 assetId, uint8 sourceId, uint256 price)
        external
        onlyRole(ORACLE_ROLE)
    {
        require(_sources[assetId][sourceId].active, "OracleAggregator: inactive source");
        latestSourcePrices[assetId][sourceId] = SourcePrice({
            price: price,
            timestamp: block.timestamp,
            sourceId: sourceId
        });
        emit SourcePriceSubmitted(assetId, sourceId, price, block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aggregation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Aggregate all active source prices into a single consensus price.
     * @return aggregatedPrice  Weighted average, 8-decimal USD
     * @return confidence       0-100 confidence score
     */
    function aggregate(bytes32 assetId)
        external
        view
        returns (uint256 aggregatedPrice, uint8 confidence)
    {
        uint8[] storage ids = _sourceIds[assetId];
        uint256 total = ids.length;
        if (total == 0) return (0, 0);

        // Collect active, non-zero source prices
        uint256[] memory prices = new uint256[](total);
        uint256[] memory timestamps = new uint256[](total);
        uint256 count = 0;
        for (uint256 i = 0; i < total; i++) {
            uint8 sid = ids[i];
            if (!_sources[assetId][sid].active) continue;
            SourcePrice storage sp = latestSourcePrices[assetId][sid];
            if (sp.price == 0) continue;
            prices[count] = sp.price;
            timestamps[count] = sp.timestamp;
            count++;
        }

        if (count == 0) return (0, 0);
        if (count == 1) {
            return (prices[0], 50); // single source → moderate confidence
        }

        // Compute median for outlier detection
        uint256 median = _median(prices, count);

        // Compute standard deviation
        uint256 stdDev = _stdDev(prices, count, median);

        // Keep prices within 2 standard deviations of median
        uint256 weightedSum = 0;
        uint256 totalWeight = 0;
        uint256 kept = 0;
        uint256 threshold = stdDev * 2;

        for (uint256 i = 0; i < count; i++) {
            uint256 diff = prices[i] > median ? prices[i] - median : median - prices[i];
            if (threshold > 0 && diff > threshold) continue;

            // Freshness weight: 1e18 / (age + 1)
            uint256 age = block.timestamp > timestamps[i] ? block.timestamp - timestamps[i] : 0;
            uint256 w = 1e18 / (age + 1);
            weightedSum += prices[i] * w;
            totalWeight += w;
            kept++;
        }

        if (totalWeight == 0) return (median, 0);

        aggregatedPrice = weightedSum / totalWeight;
        confidence = uint8((kept * 100) / count);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Compute median of the first `n` elements (insertion-sort copy).
    function _median(uint256[] memory arr, uint256 n) internal pure returns (uint256) {
        uint256[] memory copy = new uint256[](n);
        for (uint256 i = 0; i < n; i++) copy[i] = arr[i];

        // Insertion sort
        for (uint256 i = 1; i < n; i++) {
            uint256 key = copy[i];
            uint256 j = i;
            while (j > 0 && copy[j - 1] > key) {
                copy[j] = copy[j - 1];
                j--;
            }
            copy[j] = key;
        }
        return n % 2 == 0 ? (copy[n / 2 - 1] + copy[n / 2]) / 2 : copy[n / 2];
    }

    /// @dev Compute population standard deviation scaled to price units.
    function _stdDev(uint256[] memory arr, uint256 n, uint256 mean)
        internal
        pure
        returns (uint256)
    {
        if (n <= 1) return 0;
        uint256 sumSq = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 diff = arr[i] > mean ? arr[i] - mean : mean - arr[i];
            sumSq += diff * diff;
        }
        return _sqrt(sumSq / n);
    }

    /// @dev Integer square root (Babylonian).
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
