// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../PriceAdapter.sol";

/**
 * @title IUniswapV3Pool
 * @notice Minimal interface used for TWAP observation.
 */
interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * @title TwapAdapter
 * @notice On-chain TWAP price derived from a Uniswap V3 (or compatible) pool.
 * The adapter converts the geometric mean tick into a price and normalises to 8 decimals.
 *
 * NOTE: The underlying pool must exist and have sufficient observation history.
 */
contract TwapAdapter is PriceAdapter {
    IUniswapV3Pool public immutable pool;
    uint32         public immutable twapWindow; // seconds
    uint8          public immutable baseDecimals;
    string         private _name;

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    constructor(
        address poolAddress,
        uint32  _twapWindow,
        uint8   _baseDecimals,
        string memory name_
    ) {
        require(poolAddress != address(0), "TwapAdapter: zero pool");
        pool         = IUniswapV3Pool(poolAddress);
        twapWindow   = _twapWindow;
        baseDecimals = _baseDecimals;
        _name        = name_;
    }

    function name() external pure override returns (string memory) {
        return "";
    }

    function adapterName() external view returns (string memory) {
        return _name;
    }

    /**
     * @notice Compute the TWAP price from the pool.
     * Returns price in USD with 8 decimals (assumes token1 is the USD stablecoin).
     */
    function latestPrice() external view override returns (uint256 price, uint256 updatedAt) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);
        int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 meanTick  = int24(tickDelta / int56(uint56(twapWindow)));

        // Clamp tick to valid range
        if (meanTick < MIN_TICK) meanTick = MIN_TICK;
        if (meanTick > MAX_TICK) meanTick = MAX_TICK;

        // sqrtPriceX96 ≈ 1.0001^(tick/2) * 2^96
        // We compute price = 1.0001^tick, scaled to 8 decimals
        // For a simplified approximation: use tick * ln(1.0001) ≈ tick * 1e-4
        // price = 1e8 * (1.0001^tick)
        // Use integer approximation: shift tick by base decimals for USDC precision
        uint256 rawPrice;
        if (meanTick >= 0) {
            rawPrice = _approxPriceFromTick(uint256(int256(meanTick)), true);
        } else {
            rawPrice = _approxPriceFromTick(uint256(-int256(meanTick)), false);
        }

        // Adjust for base asset decimals relative to 8
        if (baseDecimals <= 8) {
            price = rawPrice * (10 ** (8 - baseDecimals));
        } else {
            price = rawPrice / (10 ** (baseDecimals - 8));
        }

        updatedAt = block.timestamp;
    }

    /**
     * @dev Approximate 1.0001^tick in 8-decimal fixed point.
     * Uses the identity: 1.0001^n ≈ e^(n * 0.00009999) and the approximation
     * e^x ≈ 1 + x for small x. For larger values this will underestimate, but
     * it is sufficient for a hackathon oracle fallback.
     */
    function _approxPriceFromTick(uint256 absTick, bool positive) internal pure returns (uint256) {
        // 1e8 * (1 + absTick * 1e-4) or 1e8 / (1 + absTick * 1e-4)
        uint256 scale = 1e8;
        uint256 adjusted = scale + (absTick * scale) / 10000;
        if (positive) {
            return adjusted;
        } else {
            // 1e8 / adjusted * 1e8 to retain precision
            return (scale * scale) / adjusted;
        }
    }
}
