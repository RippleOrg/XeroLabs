// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./BaseStrategy.sol";
import "../../interfaces/IXeroOracle.sol";

/**
 * @title TBillStrategy
 * @notice Wraps a tokenised US Treasury bill position on HashKey Chain.
 *
 * T-bills have a fixed maturity date (1, 3, or 6 months). Funds are locked
 * until maturity; on maturity, principal + yield are returned to the vault.
 *
 * For the hackathon this is a mock: maturity is set at deploy time and the
 * yield is computed at a fixed APY (mimicking a 3-month T-bill ~5.3 %).
 */
contract TBillStrategy is BaseStrategy {
    IXeroOracle public immutable oracle;
    bytes32     public immutable assetId;

    uint256 public constant APY_BPS          = 530;  // 5.3 %
    uint256 public constant BPS              = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public maturityTimestamp;
    uint256 private _principal;
    uint256 private _depositTimestamp;

    constructor(address _usdc, address _oracle, bytes32 _assetId, uint256 _maturityTimestamp)
        BaseStrategy(_usdc, "T-Bill Strategy")
    {
        require(_maturityTimestamp > block.timestamp, "TBillStrategy: maturity in past");
        oracle             = IXeroOracle(_oracle);
        assetId            = _assetId;
        maturityTimestamp  = _maturityTimestamp;
    }

    // =========================================================================
    // IRWAStrategy
    // =========================================================================

    function deposit(uint256 amount) external override onlyOwner returns (uint256 shares) {
        require(amount > 0, "TBillStrategy: zero amount");
        require(block.timestamp < maturityTimestamp, "TBillStrategy: matured");
        _receiveUSDC(amount);
        if (_depositTimestamp == 0) _depositTimestamp = block.timestamp;
        _principal += amount;
        shares = amount;
        emit Deposited(amount, shares);
    }

    function withdraw(uint256 amount) external override onlyOwner returns (uint256 received) {
        require(block.timestamp >= maturityTimestamp, "TBillStrategy: not matured");
        require(amount > 0, "TBillStrategy: zero amount");
        uint256 available = totalValue();
        require(amount <= available, "TBillStrategy: insufficient");
        _principal = available > amount ? available - amount : 0;
        received   = amount;
        _sendUSDC(owner(), received);
        emit Withdrawn(amount, received);
    }

    function totalValue() public view override returns (uint256 usdcValue) {
        if (_principal == 0) return 0;
        uint256 elapsed = block.timestamp > _depositTimestamp
            ? block.timestamp - _depositTimestamp
            : 0;
        return _principal + (_principal * APY_BPS * elapsed) / (BPS * SECONDS_PER_YEAR);
    }

    function currentAPY() external pure override returns (uint256 apyBps) {
        return APY_BPS;
    }

    function isWithdrawable(uint256 /*amount*/)
        external
        view
        override
        returns (bool canWithdraw, uint256 availableAt)
    {
        return (block.timestamp >= maturityTimestamp, maturityTimestamp);
    }

    function harvest() external view override onlyOwner returns (uint256 yieldHarvested) {
        // T-bills pay on maturity; no mid-term harvest
        return 0;
    }

    /// @notice Extend maturity — admin only (via StrategyRouter/owner).
    function rollover(uint256 newMaturity) external onlyOwner {
        require(newMaturity > block.timestamp, "TBillStrategy: past");
        maturityTimestamp = newMaturity;
    }
}
