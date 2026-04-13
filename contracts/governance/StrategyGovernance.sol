// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../aggregator/XeroVault.sol";
import "../aggregator/StrategyRouter.sol";

/**
 * @title StrategyGovernance
 * @notice Governance contract for adding/removing strategies and managing
 * allocation caps in the XeroVault.
 */
contract StrategyGovernance is AccessControl {
    XeroVault      public immutable vault;
    StrategyRouter public immutable router;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    event StrategyCapUpdated(address indexed strategy, uint16 newMaxBps);

    constructor(address _vault, address _router) {
        vault  = XeroVault(payable(_vault));
        router = StrategyRouter(_router);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);
    }

    function addStrategy(address strategy, uint16 maxAllocationBps)
        external
        onlyRole(GOVERNOR_ROLE)
    {
        vault.addStrategy(strategy, maxAllocationBps);
    }

    function removeStrategy(address strategy) external onlyRole(GOVERNOR_ROLE) {
        vault.removeStrategy(strategy);
    }
}
