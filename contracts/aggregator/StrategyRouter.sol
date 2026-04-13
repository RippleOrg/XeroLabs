// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IRWAStrategy.sol";
import "../interfaces/IXeroOracle.sol";

/**
 * @title StrategyRouter
 * @notice Allocates vault capital across active RWA strategies.
 *
 * ALLOCATION ALGORITHM (rebalance):
 * 1. Query each strategy's currentAPY.
 * 2. Sort strategies descending by APY.
 * 3. Allocate capital using risk-weighted approach:
 *    - Highest-APY strategy gets up to maxAllocationBps.
 *    - Remaining capital flows to next-highest, etc.
 *    - Minimum allocation: 5 % per active strategy (diversification floor).
 *    - If reallocation < 1 % of totalAssets, skip (gas efficiency).
 * 4. Emit Rebalanced.
 *
 * Only the XeroVault (owner) may call rebalance/deposit/withdraw.
 */
contract StrategyRouter is Ownable {
    using SafeERC20 for IERC20;

    IERC20      public immutable usdc;
    IXeroOracle public immutable oracle;

    struct StrategyEntry {
        address strategy;
        uint16  maxAllocationBps;
        bool    active;
    }

    StrategyEntry[] public strategies;
    mapping(address => uint256) public strategyIndex; // strategy => index+1 (0 = not registered)

    uint16 public constant MIN_ALLOCATION_BPS = 500;  // 5 %
    uint16 public constant MAX_SINGLE_BPS     = 6000; // 60 %
    uint16 public constant BPS                = 10000;

    event Rebalanced(uint256[] oldAllocations, uint256[] newAllocations, uint256 timestamp);
    event StrategyRegistered(address indexed strategy, uint16 maxAllocationBps);
    event StrategyDeregistered(address indexed strategy);

    constructor(address _usdc, address _oracle) Ownable(msg.sender) {
        require(_usdc   != address(0), "StrategyRouter: zero usdc");
        require(_oracle != address(0), "StrategyRouter: zero oracle");
        usdc   = IERC20(_usdc);
        oracle = IXeroOracle(_oracle);
    }

    // =========================================================================
    // Strategy registration (owner = XeroVault)
    // =========================================================================

    function registerStrategy(address strategy, uint16 maxBps) external onlyOwner {
        require(strategy != address(0), "StrategyRouter: zero strategy");
        require(strategyIndex[strategy] == 0, "StrategyRouter: already registered");
        require(maxBps <= BPS, "StrategyRouter: bps overflow");

        strategies.push(StrategyEntry({
            strategy: strategy,
            maxAllocationBps: maxBps > 0 ? maxBps : MAX_SINGLE_BPS,
            active: true
        }));
        strategyIndex[strategy] = strategies.length; // 1-indexed
        emit StrategyRegistered(strategy, maxBps);
    }

    function deregisterStrategy(address strategy) external onlyOwner {
        uint256 idx = strategyIndex[strategy];
        require(idx > 0, "StrategyRouter: not found");
        strategies[idx - 1].active = false;
        strategyIndex[strategy]    = 0;
        emit StrategyDeregistered(strategy);
    }

    // =========================================================================
    // Capital management (called by XeroVault)
    // =========================================================================

    function depositToStrategy(address strategy, uint256 amount) external onlyOwner {
        require(amount > 0, "StrategyRouter: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.approve(strategy, amount);
        IRWAStrategy(strategy).deposit(amount);
    }

    function withdrawFromStrategy(address strategy, uint256 amount) external onlyOwner {
        require(amount > 0, "StrategyRouter: zero amount");
        IRWAStrategy(strategy).withdraw(amount);
        usdc.safeTransfer(msg.sender, usdc.balanceOf(address(this)));
    }

    // =========================================================================
    // Rebalancing
    // =========================================================================

    /**
     * @notice Compute and execute the optimal allocation across strategies.
     * @param totalAssets Total vault USDC to distribute.
     */
    function rebalance(uint256 totalAssets) external onlyOwner returns (uint256[] memory allocations) {
        uint256 n = strategies.length;
        uint256[] memory apys       = new uint256[](n);
        uint256[] memory oldValues  = new uint256[](n);
        uint256   activeCount       = 0;

        for (uint256 i = 0; i < n; i++) {
            if (!strategies[i].active) continue;
            address s = strategies[i].strategy;
            apys[i]      = IRWAStrategy(s).currentAPY();
            oldValues[i] = IRWAStrategy(s).totalValue();
            activeCount++;
        }

        if (activeCount == 0) {
            allocations = new uint256[](0);
            return allocations;
        }

        // Compute target allocations (in USDC)
        uint256[] memory targets = _computeTargets(totalAssets, apys, activeCount);

        // Check if reallocation is worth executing (> 1 % of total)
        uint256 totalDiff = 0;
        for (uint256 i = 0; i < n; i++) {
            totalDiff += targets[i] > oldValues[i]
                ? targets[i] - oldValues[i]
                : oldValues[i] - targets[i];
        }
        if (totalDiff * BPS < totalAssets * 100) {
            // < 1 % change — skip
            allocations = targets;
            return allocations;
        }

        // Execute moves: withdraw excess first, then deposit deficits
        for (uint256 i = 0; i < n; i++) {
            if (!strategies[i].active) continue;
            if (oldValues[i] > targets[i]) {
                uint256 excess = oldValues[i] - targets[i];
                IRWAStrategy(strategies[i].strategy).withdraw(excess);
            }
        }
        for (uint256 i = 0; i < n; i++) {
            if (!strategies[i].active) continue;
            if (targets[i] > oldValues[i]) {
                uint256 deficit = targets[i] - oldValues[i];
                uint256 available = usdc.balanceOf(address(this));
                if (available < deficit) deficit = available;
                if (deficit > 0) {
                    usdc.approve(strategies[i].strategy, deficit);
                    IRWAStrategy(strategies[i].strategy).deposit(deficit);
                }
            }
        }

        emit Rebalanced(oldValues, targets, block.timestamp);
        allocations = targets;
    }

    // =========================================================================
    // View functions
    // =========================================================================

    function getTotalValue() external view returns (uint256 total) {
        for (uint256 i = 0; i < strategies.length; i++) {
            if (!strategies[i].active) continue;
            total += IRWAStrategy(strategies[i].strategy).totalValue();
        }
    }

    function getStrategyValue(address strategy) external view returns (uint256) {
        return IRWAStrategy(strategy).totalValue();
    }

    function getTargetAllocation()
        external
        view
        returns (address[] memory strats, uint16[] memory bps)
    {
        uint256 n = strategies.length;
        strats = new address[](n);
        bps    = new uint16[](n);
        for (uint256 i = 0; i < n; i++) {
            strats[i] = strategies[i].strategy;
            bps[i]    = strategies[i].maxAllocationBps;
        }
    }

    function getStrategies() external view returns (StrategyEntry[] memory) {
        return strategies;
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _computeTargets(
        uint256 total,
        uint256[] memory apys,
        uint256 /* activeCount */
    ) internal view returns (uint256[] memory targets) {
        uint256 n = strategies.length;
        targets = new uint256[](n);
        if (total == 0) return targets;

        // Sort active strategy indices by APY descending
        uint256[] memory sortedIdx = new uint256[](n);
        uint256 k = 0;
        for (uint256 i = 0; i < n; i++) {
            if (strategies[i].active) sortedIdx[k++] = i;
        }

        // Simple insertion sort on small arrays
        for (uint256 i = 1; i < k; i++) {
            uint256 key = sortedIdx[i];
            uint256 j   = i;
            while (j > 0 && apys[sortedIdx[j - 1]] < apys[key]) {
                sortedIdx[j] = sortedIdx[j - 1];
                j--;
            }
            sortedIdx[j] = key;
        }

        // Minimum allocation floor per active strategy (5 %)
        uint256 minAlloc = (total * MIN_ALLOCATION_BPS) / BPS;
        uint256 remaining = total;

        // Reserve minimums
        for (uint256 i = 0; i < k; i++) {
            targets[sortedIdx[i]] = minAlloc;
            remaining = remaining > minAlloc ? remaining - minAlloc : 0;
        }

        // Distribute remaining to highest-APY strategies up to their cap
        for (uint256 i = 0; i < k && remaining > 0; i++) {
            uint256 idx = sortedIdx[i];
            uint256 cap = (total * strategies[idx].maxAllocationBps) / BPS;
            uint256 canAdd = cap > targets[idx] ? cap - targets[idx] : 0;
            uint256 add    = remaining < canAdd ? remaining : canAdd;
            targets[idx] += add;
            remaining    -= add;
        }

        // Leftover (rounding) goes to first active strategy
        if (remaining > 0) targets[sortedIdx[0]] += remaining;
    }
}
