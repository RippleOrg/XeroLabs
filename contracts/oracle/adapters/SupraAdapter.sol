// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../PriceAdapter.sol";
import "../../interfaces/ISupraSValueFeed.sol";

/**
 * @title SupraAdapter
 * @notice On-chain price adapter that reads verified prices from Supra's Pull Oracle.
 *
 * Supra's DORA (Distributed Oracle Agreement) consensus aggregates data from up to
 * 21 independent nodes using Byzantine Fault Tolerance, providing high-quality
 * price feeds with a single on-chain call.
 *
 * PRICE FORMAT:
 *   Supra returns prices with 18 decimal places.
 *   This adapter normalises to 8 decimals (Xero Oracle / Chainlink standard).
 *
 * LIVENESS:
 *   The Pull Oracle stores prices only after someone submits a valid signed proof.
 *   An off-chain keeper (PricePusher service) calls verifyOracleProof() regularly.
 *   This adapter reads the latest verified price via getIndexedPrice().
 *
 * HashKey Testnet addresses:
 *   Pull Oracle:  0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702
 *   Storage:      0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917
 */
contract SupraAdapter is PriceAdapter {
    /// @notice Supra Pull Oracle contract on HashKey Chain.
    ISupraPullOracle public immutable supraOracle;

    /// @notice Supra pair index for this adapter's feed.
    uint256 public immutable pairIndex;

    /// @notice Maximum acceptable price age in seconds (staleness guard).
    uint256 public immutable maxAge;

    /// @notice Number of decimals the Supra oracle returns (typically 18).
    uint256 public immutable supraDecimals;

    string private _adapterName;

    // ─── Constants ─────────────────────────────────────────────────────────
    uint256 private constant TARGET_DECIMALS = 8;

    // ─── Events ─────────────────────────────────────────────────────────────
    event PriceFetched(uint256 indexed pairIndex, uint256 rawPrice, uint256 normalised, uint256 timestamp);

    /**
     * @param _supraOracle   Address of Supra Pull Oracle (ISupraPullOracle).
     * @param _pairIndex     Supra pair index (0 = BTC/USD, 74 = XAU/USD, etc.).
     * @param _supraDecimals Decimal places returned by Supra (typically 18).
     * @param _maxAge        Maximum acceptable price age in seconds.
     * @param name_          Human-readable name, e.g. "Supra XAU/USD".
     */
    constructor(
        address _supraOracle,
        uint256 _pairIndex,
        uint256 _supraDecimals,
        uint256 _maxAge,
        string memory name_
    ) {
        require(_supraOracle != address(0), "SupraAdapter: zero oracle address");
        require(_supraDecimals >= TARGET_DECIMALS, "SupraAdapter: decimals < 8");
        require(_maxAge > 0, "SupraAdapter: zero maxAge");

        supraOracle   = ISupraPullOracle(_supraOracle);
        pairIndex     = _pairIndex;
        supraDecimals = _supraDecimals;
        maxAge        = _maxAge;
        _adapterName  = name_;
    }

    // ─── PriceAdapter ───────────────────────────────────────────────────────

    /// @inheritdoc PriceAdapter
    function name() external pure override returns (string memory) {
        return "SupraAdapter";
    }

    /// @notice Human-readable name including the pair symbol.
    function adapterName() external view returns (string memory) {
        return _adapterName;
    }

    /**
     * @inheritdoc PriceAdapter
     * @dev Calls Supra's getIndexedPrice() and normalises from supraDecimals to 8.
     *
     * Reverts if:
     *   - Supra returns a zero price (oracle not yet seeded / pair not available)
     *   - The price observation is older than maxAge
     */
    function latestPrice()
        external
        view
        override
        returns (uint256 price, uint256 updatedAt)
    {
        (uint256 rawPrice, uint256 ts) = supraOracle.getIndexedPrice(pairIndex);

        require(rawPrice > 0, "SupraAdapter: zero price from Supra");
        require(
            block.timestamp - ts <= maxAge,
            "SupraAdapter: stale Supra price"
        );

        // Normalise: supraDecimals → TARGET_DECIMALS (8)
        uint256 decimalDiff = supraDecimals - TARGET_DECIMALS;
        price     = rawPrice / (10 ** decimalDiff);
        updatedAt = ts;
    }

    /**
     * @notice Preview the raw Supra price without stale checks.
     * Useful for monitoring. Does NOT revert on stale price.
     * @return rawPrice   Price as returned by Supra (supraDecimals precision)
     * @return timestamp  Timestamp of the Supra observation
     * @return isStale    True if the price exceeds maxAge
     */
    function peekRawPrice()
        external
        view
        returns (uint256 rawPrice, uint256 timestamp, bool isStale)
    {
        (rawPrice, timestamp) = supraOracle.getIndexedPrice(pairIndex);
        isStale = (rawPrice == 0) || (block.timestamp - timestamp > maxAge);
    }
}
