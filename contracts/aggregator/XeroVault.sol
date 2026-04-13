// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./StrategyRouter.sol";
import "./RebalanceEngine.sol";
import "../interfaces/IXeroVault.sol";
import "../interfaces/IXeroOracle.sol";
import "../interfaces/IRWAStrategy.sol";

/**
 * @title XeroVault
 * @notice ERC-4626 compliant yield aggregator vault. Users deposit USDC and
 * receive xVAULT shares. Capital is allocated across RWA strategies by the
 * StrategyRouter.
 *
 * FEES:
 * - Management fee : 0.5 % per year, accrued continuously.
 * - Performance fee: 10 % of yield above the benchmark (currently unused for MVP).
 *
 * WITHDRAWAL QUEUE: locked strategies (T-bills) queue withdrawals until maturity.
 */
contract XeroVault is IXeroVault, ERC4626, ReentrancyGuard, Ownable, Pausable {
    StrategyRouter  public immutable strategyRouter;
    RebalanceEngine public immutable rebalanceEngine;
    IXeroOracle     public immutable oracle;

    address public feeRecipient;

    uint256 public constant REBALANCE_EPOCH     = 24 hours;
    uint16  public constant MANAGEMENT_FEE_BPS  = 50;   // 0.5 %
    uint16  public constant PERFORMANCE_FEE_BPS = 1000; // 10 %
    uint256 public constant BPS                 = 10_000;
    uint256 public constant SECONDS_PER_YEAR    = 365 days;

    uint256 public lastFeeAccrual;

    // ─── Withdrawal queue ──────────────────────────────────────────────────
    struct QueuedWithdrawal {
        address user;
        uint256 shares;
        uint256 expectedAt;
    }
    QueuedWithdrawal[] public withdrawalQueue;

    // ─── APY snapshot ──────────────────────────────────────────────────────
    struct ApySnapshot {
        uint256 apyBps;
        uint256 timestamp;
    }
    ApySnapshot[] private _apyHistory;

    constructor(
        IERC20  _asset,
        address _strategyRouter,
        address _rebalanceEngine,
        address _oracle,
        address _feeRecipient
    )
        ERC4626(_asset)
        ERC20("Xero RWA Vault", "xVAULT")
        Ownable(msg.sender)
    {
        require(_strategyRouter  != address(0), "XeroVault: zero router");
        require(_rebalanceEngine != address(0), "XeroVault: zero engine");
        require(_oracle          != address(0), "XeroVault: zero oracle");
        require(_feeRecipient    != address(0), "XeroVault: zero fee recipient");

        strategyRouter  = StrategyRouter(_strategyRouter);
        rebalanceEngine = RebalanceEngine(_rebalanceEngine);
        oracle          = IXeroOracle(_oracle);
        feeRecipient    = _feeRecipient;
        lastFeeAccrual  = block.timestamp;
    }

    // =========================================================================
    // ERC-4626 overrides
    // =========================================================================

    /**
     * @notice Total assets = USDC held by this vault + all strategy values.
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + strategyRouter.getTotalValue();
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        _accrueManagementFee();
        super._deposit(caller, receiver, assets, shares);
        // Forward deposited assets to strategy router for allocation
        IERC20(asset()).approve(address(strategyRouter), assets);
    }

    function _withdraw(
        address caller,
        address receiver,
        address _owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        _accrueManagementFee();

        // Check if liquidity is available
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (vaultBalance < assets) {
            // Try to withdraw from strategies
            _pullFromStrategies(assets - vaultBalance);
        }

        vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (vaultBalance < assets) {
            // Not enough liquid — queue withdrawal
            uint256 expectedAt = _estimateAvailability();
            withdrawalQueue.push(QueuedWithdrawal({
                user:       _owner,
                shares:     shares,
                expectedAt: expectedAt
            }));
            emit WithdrawalQueued(_owner, shares, expectedAt);
            return;
        }

        super._withdraw(caller, receiver, _owner, assets, shares);
    }

    // =========================================================================
    // IXeroVault — vault management
    // =========================================================================

    /// @inheritdoc IXeroVault
    function rebalance() external override onlyOwner {
        _accrueManagementFee();
        rebalanceEngine.maybeRebalance(totalAssets());
        _snapshotAPY();
    }

    /// @inheritdoc IXeroVault
    function addStrategy(address strategy, uint16 maxAllocationBps) external override onlyOwner {
        strategyRouter.registerStrategy(strategy, maxAllocationBps);
        emit StrategyAdded(strategy, maxAllocationBps);
    }

    /// @inheritdoc IXeroVault
    function removeStrategy(address strategy) external override onlyOwner {
        // Drain strategy first
        uint256 value = IRWAStrategy(strategy).totalValue();
        if (value > 0) {
            strategyRouter.withdrawFromStrategy(strategy, value);
        }
        strategyRouter.deregisterStrategy(strategy);
        emit StrategyRemoved(strategy);
    }

    /// @inheritdoc IXeroVault
    function emergencyWithdrawAll() external override onlyOwner {
        StrategyRouter.StrategyEntry[] memory entries = strategyRouter.getStrategies();
        uint256 total = 0;
        for (uint256 i = 0; i < entries.length; i++) {
            if (!entries[i].active) continue;
            uint256 v = IRWAStrategy(entries[i].strategy).totalValue();
            if (v == 0) continue;
            try IRWAStrategy(entries[i].strategy).withdraw(v) returns (uint256 received) {
                total += received;
            } catch {}
        }
        _pause();
        emit EmergencyWithdraw(total);
    }

    /// @inheritdoc IXeroVault
    function getStrategyAllocations()
        external
        view
        override
        returns (address[] memory strategies_, uint256[] memory values)
    {
        StrategyRouter.StrategyEntry[] memory entries = strategyRouter.getStrategies();
        uint256 n = entries.length;
        strategies_ = new address[](n);
        values       = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            strategies_[i] = entries[i].strategy;
            values[i]      = entries[i].active
                ? IRWAStrategy(entries[i].strategy).totalValue()
                : 0;
        }
    }

    /// @inheritdoc IXeroVault
    function getAPY() external view override returns (uint256 apyBps) {
        return _blendedAPY();
    }

    /// @inheritdoc IXeroVault
    function getHistoricalAPY(uint256 fromTimestamp) external view override returns (uint256 apyBps) {
        // Find the closest snapshot at or after fromTimestamp
        for (uint256 i = 0; i < _apyHistory.length; i++) {
            if (_apyHistory[i].timestamp >= fromTimestamp) {
                return _apyHistory[i].apyBps;
            }
        }
        return _blendedAPY();
    }

    // =========================================================================
    // Fee management
    // =========================================================================

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "XeroVault: zero address");
        feeRecipient = newRecipient;
    }

    // =========================================================================
    // Pause
    // =========================================================================

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // =========================================================================
    // Internal
    // =========================================================================

    function _accrueManagementFee() internal {
        uint256 elapsed = block.timestamp - lastFeeAccrual;
        if (elapsed == 0) return;
        lastFeeAccrual = block.timestamp;

        uint256 total = totalAssets();
        if (total == 0) return;

        uint256 feeAssets = (total * MANAGEMENT_FEE_BPS * elapsed) / (BPS * SECONDS_PER_YEAR);
        if (feeAssets == 0) return;

        // Mint fee shares to recipient
        uint256 feeShares = convertToShares(feeAssets);
        if (feeShares > 0) {
            _mint(feeRecipient, feeShares);
        }
    }

    function _blendedAPY() internal view returns (uint256 apyBps) {
        StrategyRouter.StrategyEntry[] memory entries = strategyRouter.getStrategies();
        uint256 total = totalAssets();
        if (total == 0) return 0;

        uint256 weightedApy = 0;
        for (uint256 i = 0; i < entries.length; i++) {
            if (!entries[i].active) continue;
            uint256 v   = IRWAStrategy(entries[i].strategy).totalValue();
            uint256 apy = IRWAStrategy(entries[i].strategy).currentAPY();
            weightedApy += v * apy;
        }
        return weightedApy / total;
    }

    function _snapshotAPY() internal {
        _apyHistory.push(ApySnapshot({apyBps: _blendedAPY(), timestamp: block.timestamp}));
    }

    function _pullFromStrategies(uint256 needed) internal {
        StrategyRouter.StrategyEntry[] memory entries = strategyRouter.getStrategies();
        uint256 remaining = needed;
        for (uint256 i = 0; i < entries.length && remaining > 0; i++) {
            if (!entries[i].active) continue;
            address s = entries[i].strategy;
            (bool withdrawable,) = IRWAStrategy(s).isWithdrawable(remaining);
            if (!withdrawable) continue;
            uint256 available = IRWAStrategy(s).totalValue();
            uint256 pull      = available < remaining ? available : remaining;
            if (pull == 0) continue;
            try strategyRouter.withdrawFromStrategy(s, pull) {
                remaining = remaining > pull ? remaining - pull : 0;
            } catch {}
        }
    }

    function _estimateAvailability() internal view returns (uint256 earliest) {
        earliest = type(uint256).max;
        StrategyRouter.StrategyEntry[] memory entries = strategyRouter.getStrategies();
        for (uint256 i = 0; i < entries.length; i++) {
            if (!entries[i].active) continue;
            (, uint256 at) = IRWAStrategy(entries[i].strategy).isWithdrawable(0);
            if (at < earliest) earliest = at;
        }
        if (earliest == type(uint256).max) earliest = block.timestamp;
    }
}
