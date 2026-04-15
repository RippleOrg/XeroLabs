// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ISupraPullOracle
 * @notice Minimal interface for Supra's Pull Oracle contract on HashKey Chain.
 *
 * HashKey Testnet Pull Oracle:  0x443A0f4Da5d2fdC47de3eeD45Af41d399F0E5702
 * HashKey Testnet Storage:      0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917
 * HashKey Mainnet Pull Oracle:  0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD
 * HashKey Mainnet Storage:      0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57
 *
 * Supra uses a DORA (Distributed Oracle Agreement) consensus algorithm
 * aggregating data from up to 21 sources with Byzantine Fault Tolerance.
 *
 * Pull Oracle flow:
 *   1. Off-chain keeper fetches a signed proof bundle from Supra's gateway.
 *   2. Keeper calls verifyOracleProof() on the Pull Oracle contract.
 *   3. Verified prices are stored in the Storage contract.
 *   4. Anyone reads prices from getIndexedPrice() / getSvalue().
 *
 * For reference – common pair indices:
 *   0   BTC/USD
 *   1   ETH/USD
 *   19  ETH/USD (alt index on some deployments)
 *   48  USDT/USD
 *   74  XAU/USD  (Gold)
 *   75  XAG/USD  (Silver)
 *   89  USDC/USD
 *
 * Prices are returned with 18 decimal places.
 * To convert to 8-decimal USD: divide by 1e10.
 */
interface ISupraPullOracle {
    /**
     * @notice Returns the latest verified price for a pair index.
     * @param _index  Supra pair index (e.g. 0 = BTC/USD, 74 = XAU/USD)
     * @return price      Price scaled to 18 decimals (USD)
     * @return timestamp  Unix timestamp of the price observation
     */
    function getIndexedPrice(uint256 _index)
        external
        view
        returns (uint256 price, uint256 timestamp);

    /**
     * @notice Verify a Supra oracle proof and store the resulting prices.
     * @param _bytesproof  ABI-encoded signed proof bundle from Supra's API.
     * @return            Pair indices and prices updated by this proof.
     */
    function verifyOracleProof(bytes calldata _bytesproof)
        external
        returns (bytes memory);
}

/**
 * @title ISupraStorageOracle
 * @notice Interface for the Supra Storage contract which holds verified prices.
 * Use this for lower-latency view calls when proofs are pre-verified.
 */
interface ISupraStorageOracle {
    struct PriceFeed {
        uint16  round;
        uint64  decimals;
        uint64  time;
        uint128 price;
    }

    /**
     * @notice Get the raw price bytes for a pair index.
     * @param _pairIndex  Supra pair index
     * @return data   Encoded PriceFeed bytes
     * @return valid  True if the price is available
     */
    function getSvalue(uint256 _pairIndex)
        external
        view
        returns (bytes32 data, bool valid);

    /**
     * @notice Get all raw price bytes for an array of pair indices.
     */
    function getSvalues(uint256[] calldata _pairIndexes)
        external
        view
        returns (bytes32[] memory data, bool[] memory valid);
}
