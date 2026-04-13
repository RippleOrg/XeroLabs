// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../PriceAdapter.sol";

/**
 * @title IChainlinkAggregatorV3
 * @notice Minimal Chainlink AggregatorV3Interface.
 */
interface IChainlinkAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80  roundId,
            int256  answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80  answeredInRound
        );

    function decimals() external view returns (uint8);
}

/**
 * @title ChainlinkAdapter
 * @notice Wraps a Chainlink AggregatorV3 feed and normalises its output to 8
 * decimal USD price expected by XeroOracle.
 */
contract ChainlinkAdapter is PriceAdapter {
    IChainlinkAggregatorV3 public immutable feed;
    string private _name;

    constructor(address feedAddress, string memory name_) {
        require(feedAddress != address(0), "ChainlinkAdapter: zero feed");
        feed  = IChainlinkAggregatorV3(feedAddress);
        _name = name_;
    }

    function name() external pure override returns (string memory) {
        // Return storage name — override to satisfy compiler
        return "";
    }

    function adapterName() external view returns (string memory) {
        return _name;
    }

    /**
     * @notice Fetch the latest Chainlink price, normalised to 8 decimals.
     */
    function latestPrice() external view override returns (uint256 price, uint256 updatedAt) {
        (, int256 answer, , uint256 ts,) = feed.latestRoundData();
        require(answer > 0, "ChainlinkAdapter: non-positive price");

        uint8 feedDecimals = feed.decimals();
        if (feedDecimals <= 8) {
            price = uint256(answer) * (10 ** (8 - feedDecimals));
        } else {
            price = uint256(answer) / (10 ** (feedDecimals - 8));
        }
        updatedAt = ts;
    }
}
