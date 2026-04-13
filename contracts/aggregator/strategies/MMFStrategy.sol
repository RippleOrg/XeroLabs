// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./BaseStrategy.sol";
import "../../interfaces/IXeroOracle.sol";

/**
 * @title MMFStrategy
 * @notice Wraps a tokenised money-market fund position on HashKey Chain.
 * MMFs are same-day liquid, stable NAV (~$1.00), ~5 % APY.
 *
 * For the hackathon this is a mock implementation: deposits are tracked
 * internally and yield is accrued at a configurable constant APY.
 */
contract MMFStrategy is BaseStrategy {
    IXeroOracle public immutable oracle;
    bytes32     public immutable assetId;

    uint256 public constant BASE_APY_BPS = 500; // 5 %
    uint256 public constant BPS          = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 private _principal;     // USDC deposited (6 dec)
    uint256 private _lastHarvest;   // timestamp of last harvest

    constructor(address _usdc, address _oracle, bytes32 _assetId)
        BaseStrategy(_usdc, "MMF Strategy")
    {
        oracle  = IXeroOracle(_oracle);
        assetId = _assetId;
    }

    // =========================================================================
    // IRWAStrategy
    // =========================================================================

    function deposit(uint256 amount) external override onlyOwner returns (uint256 shares) {
        require(amount > 0, "MMFStrategy: zero amount");
        _receiveUSDC(amount);
        _principal += amount;
        shares = amount; // 1:1 for MMF (stable NAV)
        emit Deposited(amount, shares);
    }

    function withdraw(uint256 amount) external override onlyOwner returns (uint256 received) {
        require(amount > 0, "MMFStrategy: zero amount");
        uint256 available = _principal + _pendingYield();
        require(amount <= available, "MMFStrategy: insufficient balance");
        if (amount <= _principal) {
            _principal -= amount;
        } else {
            _principal = 0;
        }
        received = amount;
        _sendUSDC(owner(), received);
        emit Withdrawn(amount, received);
    }

    function totalValue() external view override returns (uint256 usdcValue) {
        return _principal + _pendingYield();
    }

    function currentAPY() external pure override returns (uint256 apyBps) {
        return BASE_APY_BPS;
    }

    function isWithdrawable(uint256 /*amount*/)
        external
        pure
        override
        returns (bool canWithdraw, uint256 availableAt)
    {
        return (true, 0); // MMFs are always liquid
    }

    function harvest() external override onlyOwner returns (uint256 yieldHarvested) {
        yieldHarvested = _pendingYield();
        _principal     += yieldHarvested; // reinvest
        _lastHarvest    = block.timestamp;
        emit Harvested(yieldHarvested);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _pendingYield() internal view returns (uint256) {
        if (_principal == 0) return 0;
        uint256 elapsed = block.timestamp - _lastHarvest;
        return (_principal * BASE_APY_BPS * elapsed) / (BPS * SECONDS_PER_YEAR);
    }
}
