// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PriceAdapter
 * @notice Abstract base contract for on-chain price feed adapters.
 * Concrete adapters wrap external price providers (Chainlink, Pyth, TWAP).
 */
abstract contract PriceAdapter {
    /// @notice Human-readable name of this adapter
    function name() external pure virtual returns (string memory);

    /**
     * @notice Fetch the latest price from the underlying data source.
     * @return price      Price in USD, 8 decimals
     * @return updatedAt  Timestamp of the underlying observation
     */
    function latestPrice() external view virtual returns (uint256 price, uint256 updatedAt);
}
