// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../PriceAdapter.sol";

/**
 * @title IPythOracle
 * @notice Minimal interface for the Pyth on-chain price oracle.
 */
interface IPythOracle {
    struct Price {
        int64  price;
        uint64 conf;
        int32  expo;
        uint   publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
}

/**
 * @title PythAdapter
 * @notice Wraps a Pyth Network price feed and normalises to 8-decimal USD price.
 */
contract PythAdapter is PriceAdapter {
    IPythOracle public immutable pyth;
    bytes32     public immutable priceId;
    string private _name;

    constructor(address pythAddress, bytes32 _priceId, string memory name_) {
        require(pythAddress != address(0), "PythAdapter: zero address");
        pyth    = IPythOracle(pythAddress);
        priceId = _priceId;
        _name   = name_;
    }

    function name() external pure override returns (string memory) {
        return "";
    }

    function adapterName() external view returns (string memory) {
        return _name;
    }

    /**
     * @notice Fetch the latest Pyth price, normalised to 8 decimals.
     * Pyth prices use `expo` to scale: price = raw * 10^expo
     */
    function latestPrice() external view override returns (uint256 price, uint256 updatedAt) {
        IPythOracle.Price memory p = pyth.getPriceUnsafe(priceId);
        require(p.price > 0, "PythAdapter: non-positive price");

        // Normalise to 8 decimals: expo is typically negative (e.g. -8)
        int256 targetExpo = -8;
        int256 expoDiff = int256(p.expo) - targetExpo;

        uint256 rawPrice = uint256(int256(p.price));
        if (expoDiff >= 0) {
            price = rawPrice * (10 ** uint256(expoDiff));
        } else {
            price = rawPrice / (10 ** uint256(-expoDiff));
        }

        updatedAt = p.publishTime;
    }
}
