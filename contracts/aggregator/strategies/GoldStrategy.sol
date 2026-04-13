// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./BaseStrategy.sol";
import "../../interfaces/IXeroOracle.sol";

/**
 * @title GoldStrategy
 * @notice Wraps a tokenised gold position (e.g. PAXG equivalent) on HashKey Chain.
 * Yield is derived from gold lending and options premium (~1-2 % APY).
 * Price is volatile; the vault caps gold allocation at 20 % by default.
 *
 * Total value is mark-to-market: (gold holdings * XAU/USD price) from XeroOracle.
 * For the hackathon mock, gold holdings are tracked in "micro-ounces" (1e6 = 1 oz).
 */
contract GoldStrategy is BaseStrategy {
    IXeroOracle public immutable oracle;
    bytes32     public immutable goldAssetId;

    uint256 public constant APY_BPS          = 150;  // 1.5 %
    uint256 public constant BPS              = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // Gold holdings in USDC-equivalent (for simplicity in mock)
    uint256 private _holdingsUsdc;
    uint256 private _lastYieldTimestamp;

    constructor(address _usdc, address _oracle, bytes32 _goldAssetId)
        BaseStrategy(_usdc, "Gold Strategy")
    {
        oracle          = IXeroOracle(_oracle);
        goldAssetId     = _goldAssetId;
        _lastYieldTimestamp = block.timestamp;
    }

    // =========================================================================
    // IRWAStrategy
    // =========================================================================

    function deposit(uint256 amount) external override onlyOwner returns (uint256 shares) {
        require(amount > 0, "GoldStrategy: zero amount");
        _receiveUSDC(amount);
        _accrue();
        _holdingsUsdc += amount;
        shares = amount;
        emit Deposited(amount, shares);
    }

    function withdraw(uint256 amount) external override onlyOwner returns (uint256 received) {
        require(amount > 0, "GoldStrategy: zero amount");
        _accrue();
        require(amount <= _holdingsUsdc, "GoldStrategy: insufficient");
        _holdingsUsdc -= amount;
        received = amount;
        _sendUSDC(owner(), received);
        emit Withdrawn(amount, received);
    }

    function totalValue() external view override returns (uint256 usdcValue) {
        return _holdingsUsdc + _pendingYield();
    }

    function currentAPY() external pure override returns (uint256 apyBps) {
        return APY_BPS;
    }

    function isWithdrawable(uint256 /*amount*/)
        external
        pure
        override
        returns (bool canWithdraw, uint256 availableAt)
    {
        return (true, 0); // liquid
    }

    function harvest() external override onlyOwner returns (uint256 yieldHarvested) {
        _accrue();
        yieldHarvested = 0; // yield already folded into holdings
        emit Harvested(0);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _pendingYield() internal view returns (uint256) {
        if (_holdingsUsdc == 0) return 0;
        uint256 elapsed = block.timestamp - _lastYieldTimestamp;
        return (_holdingsUsdc * APY_BPS * elapsed) / (BPS * SECONDS_PER_YEAR);
    }

    function _accrue() internal {
        uint256 yield = _pendingYield();
        _holdingsUsdc += yield;
        _lastYieldTimestamp = block.timestamp;
    }
}
