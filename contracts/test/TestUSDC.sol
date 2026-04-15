// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestUSDC
 * @notice Test USD Coin for HashKey Chain testnet deployments.
 *
 * Mimics real USDC with 6 decimals and a public mint function for test funding.
 * The owner can mint arbitrary amounts; anyone can self-mint up to 10,000 USDC
 * per call via the faucet function for easy testing.
 */
contract TestUSDC is ERC20, Ownable {
    uint8  private constant _DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 10_000 * 10 ** 6; // 10,000 USDC

    event FaucetDrip(address indexed recipient, uint256 amount);

    constructor(address initialOwner) ERC20("USD Coin", "USDC") Ownable(initialOwner) {
        // Mint 100 million USDC to owner for initial distribution
        _mint(initialOwner, 100_000_000 * 10 ** _DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Owner-only mint for controlled distribution.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Self-serve faucet — anyone can claim FAUCET_AMOUNT once per call.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetDrip(msg.sender, FAUCET_AMOUNT);
    }
}
