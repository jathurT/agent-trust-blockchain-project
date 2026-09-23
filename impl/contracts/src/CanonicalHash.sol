// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CanonicalHash
/// @notice On-chain derivation of the AgentTrust request, job and validation hashes.
/// @dev Normative definition: docs/specs/canonical-hash.md (canonical-v1).
///      Vectors: impl/vectors/canonical-v1.json — the vectors win over this code.
///      Canonicalisation of the method and URI happens off-chain; the chain only
///      ever sees the three component hashes (DF-04).
library CanonicalHash {
    bytes32 internal constant RESOURCE_TYPEHASH = keccak256(
        "AgentTrustResource(bytes32 methodHash,bytes32 uriHash,bytes32 bodyHash,uint256 amount,address token,uint256 chainId)"
    );
    bytes32 internal constant JOB_TYPEHASH = keccak256(
        "AgentTrustJob(uint256 chainId,address escrow,address payer,address payee,bytes32 resourceHash,bytes32 nonce)"
    );
    bytes32 internal constant VALIDATION_TYPEHASH = keccak256(
        "AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,bytes32 resourceHash,bytes32 salt)"
    );

    /// @notice Binds one canonical request to a price, an asset and a chain.
    function resourceHash(
        bytes32 methodHash,
        bytes32 uriHash,
        bytes32 bodyHash,
        uint256 amount,
        address token,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(RESOURCE_TYPEHASH, methodHash, uriHash, bodyHash, amount, token, chainId));
    }

    /// @notice Domain-separated job identifier: valid against one deployment only.
    function jobId(
        uint256 chainId,
        address escrow,
        address payer,
        address payee,
        bytes32 resourceHash_,
        bytes32 nonce
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(JOB_TYPEHASH, chainId, escrow, payer, payee, resourceHash_, nonce));
    }

    /// @notice ERC-8004 validation request key; the salt keeps it unsquattable (DF-06).
    function requestHash(
        uint256 chainId,
        address escrow,
        bytes32 jobId_,
        bytes32 resourceHash_,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(VALIDATION_TYPEHASH, chainId, escrow, jobId_, resourceHash_, salt));
    }
}
