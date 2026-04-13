// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IRWAStrategy
 * @notice Abstract interface for all RWA yield strategies.
 * Strategies wrap external RWA protocols and expose a uniform interface to the vault.
 */
interface IRWAStrategy {
    /// @notice Deposit USDC into the strategy
    /// @return shares The number of strategy shares received
    function deposit(uint256 amount) external returns (uint256 shares);

    /// @notice Withdraw USDC from the strategy
    /// @return received The actual USDC amount returned
    function withdraw(uint256 amount) external returns (uint256 received);

    /// @notice Total value of strategy holdings in USDC (via oracle)
    function totalValue() external view returns (uint256 usdcValue);

    /// @notice Current annualised yield in basis points
    function currentAPY() external view returns (uint256 apyBps);

    /// @notice Whether a given amount can be withdrawn now, or when it becomes available
    function isWithdrawable(uint256 amount) external view returns (bool canWithdraw, uint256 availableAt);

    /// @notice Claim accrued yield from the underlying protocol
    /// @return yieldHarvested Amount of USDC harvested
    function harvest() external returns (uint256 yieldHarvested);

    /// @notice Human-readable name for the strategy
    function name() external view returns (string memory);

    event Deposited(uint256 amount, uint256 shares);
    event Withdrawn(uint256 amount, uint256 received);
    event Harvested(uint256 yieldHarvested);
}
