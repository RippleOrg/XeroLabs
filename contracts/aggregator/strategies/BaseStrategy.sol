// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../interfaces/IRWAStrategy.sol";

/**
 * @title BaseStrategy
 * @notice Abstract base for all RWA yield strategies. Concrete strategies wrap
 * an external RWA protocol and implement the IRWAStrategy interface.
 *
 * Only the StrategyRouter (owner) may call deposit/withdraw/harvest.
 */
abstract contract BaseStrategy is IRWAStrategy, Ownable {
    using SafeERC20 for IERC20;

    IERC20  public immutable usdc;
    string  private _strategyName;

    constructor(address _usdc, string memory strategyName) Ownable(msg.sender) {
        require(_usdc != address(0), "BaseStrategy: zero USDC");
        usdc = IERC20(_usdc);
        _strategyName = strategyName;
    }

    /// @inheritdoc IRWAStrategy
    function name() external view override returns (string memory) {
        return _strategyName;
    }

    // ─── helpers available to subclasses ──────────────────────────────────────

    /// @dev Pull USDC from caller and record the receipt.
    function _receiveUSDC(uint256 amount) internal {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev Send USDC to the strategy router (owner).
    function _sendUSDC(address to, uint256 amount) internal {
        usdc.safeTransfer(to, amount);
    }
}
