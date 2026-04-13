// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IRWAStrategy.sol";
import "./StrategyRouter.sol";

/**
 * @title RebalanceEngine
 * @notice Epoch-based rebalancing logic. Tracks when the next rebalance is due
 * and provides yield-gap analysis to determine whether a rebalance is worthwhile.
 *
 * Only the vault (owner) may trigger rebalances.
 */
contract RebalanceEngine is Ownable {
    StrategyRouter public immutable router;

    uint256 public constant REBALANCE_EPOCH  = 24 hours;
    uint256 public constant MIN_YIELD_GAP_BPS = 50; // 0.5 % APY gap before forced rebalance

    uint256 public lastRebalance;

    event RebalanceTriggered(uint256 totalAssets, uint256 timestamp);
    event RebalanceSkipped(string reason);

    constructor(address _router) Ownable(msg.sender) {
        router = StrategyRouter(_router);
    }

    /**
     * @notice Trigger a rebalance if the epoch has elapsed or yield gap justifies it.
     * @param totalAssets Total USDC managed by the vault.
     */
    function maybeRebalance(uint256 totalAssets) external onlyOwner returns (bool didRebalance) {
        if (!_shouldRebalance()) {
            emit RebalanceSkipped("epoch not elapsed");
            return false;
        }

        router.rebalance(totalAssets);
        lastRebalance = block.timestamp;
        emit RebalanceTriggered(totalAssets, block.timestamp);
        return true;
    }

    /**
     * @notice Force a rebalance regardless of epoch (admin only).
     */
    function forceRebalance(uint256 totalAssets) external onlyOwner {
        router.rebalance(totalAssets);
        lastRebalance = block.timestamp;
        emit RebalanceTriggered(totalAssets, block.timestamp);
    }

    function _shouldRebalance() internal view returns (bool) {
        return block.timestamp >= lastRebalance + REBALANCE_EPOCH;
    }

    function nextRebalanceAt() external view returns (uint256) {
        return lastRebalance + REBALANCE_EPOCH;
    }
}
