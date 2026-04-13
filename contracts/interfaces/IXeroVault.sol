// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IXeroVault
 * @notice ERC-4626 compliant yield aggregator vault interface.
 */
interface IXeroVault {
    struct StrategyAllocation {
        address strategy;
        uint256 value;          // Current value in USDC
        uint16 targetBps;       // Target allocation in basis points
        uint16 maxBps;          // Max allocation cap in basis points
    }

    /// @notice Trigger a rebalance across RWA strategies
    function rebalance() external;

    /// @notice Add a new strategy to the vault
    function addStrategy(address strategy, uint16 maxAllocationBps) external;

    /// @notice Remove a strategy, draining its assets first
    function removeStrategy(address strategy) external;

    /// @notice Emergency: drain all strategies to vault and pause
    function emergencyWithdrawAll() external;

    /// @notice Get current strategy allocations
    function getStrategyAllocations() external view returns (address[] memory strategies, uint256[] memory values);

    /// @notice Get blended APY across all strategies (basis points)
    function getAPY() external view returns (uint256 apyBps);

    /// @notice Get historical APY from a given timestamp
    function getHistoricalAPY(uint256 fromTimestamp) external view returns (uint256 apyBps);

    event Rebalanced(uint256[] oldAllocations, uint256[] newAllocations, uint256 timestamp);
    event StrategyAdded(address indexed strategy, uint16 maxAllocationBps);
    event StrategyRemoved(address indexed strategy);
    event WithdrawalQueued(address indexed user, uint256 shares, uint256 expectedAt);
    event EmergencyWithdraw(uint256 totalRecovered);
}
