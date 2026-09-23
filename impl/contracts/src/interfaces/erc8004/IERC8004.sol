// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ERC-8004 registry interfaces, transcribed from the canonical implementation
 * at erc-8004/erc-8004-contracts, commit b9e466c250744a7e06b13dff9d3c2844ed64f825
 * (REG-001, V-50). Only the members AgentTrust uses are declared; every one of
 * them keeps the upstream signature exactly, so the same interface binds both
 * the mocks and the live registries on Base Sepolia (V-97).
 *
 * The standard is a Draft and has changed before (V-90, V-91). REG-008 checks
 * these selectors against the deployed contracts, and V-139 requires a re-check
 * on the day the live registries are used.
 *
 * Behaviours that matter to the escrow, verified in the upstream source:
 *  - Reputation.getSummary REVERTS with "clientAddresses required" on an empty list,
 *    and iterates every feedback entry of every listed client (gas grows with history).
 *  - Reputation.giveFeedback REVERTS with "Self-feedback not allowed" when the caller
 *    is the agent's owner or an approved operator.
 *  - Validation.validationRequest REVERTS with "exists" if the requestHash was ever used,
 *    which is what makes an unsalted hash squattable (DF-06).
 *  - Validation.getValidationStatus REVERTS with "unknown" for an unseen hash, and
 *    validationRequest already sets lastUpdate, so a pending request is indistinguishable
 *    from a response of 0 (DF-05).
 *  - Identity clears agentWallet on NFT transfer, after which getAgentWallet returns
 *    address(0); callers must fall back to ownerOf (DF-12).
 */

interface IIdentityRegistry {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    function register(string memory agentURI) external returns (uint256 agentId);
    function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function getAgentWallet(uint256 agentId) external view returns (address);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function unsetAgentWallet(uint256 agentId) external;
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
    function getVersion() external pure returns (string memory);

    // ERC-721 members the escrow and the Validation registry rely on
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    /// @dev Reverts "clientAddresses required" when the list is empty. The filter is
    ///      the protocol's own Sybil mitigation (V-96) and the basis of our gate (DF-09).
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);

    function getClients(uint256 agentId) external view returns (address[] memory);
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
    function getIdentityRegistry() external view returns (address);
    function getVersion() external pure returns (string memory);
}

interface IValidationRegistry {
    /// @dev Callable only by the agent's owner or operator; reverts "exists" if the
    ///      hash was ever used, by anyone, for any agent.
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;

    /// @dev Callable only by the named validator; response must be <= 100; may be called
    ///      more than once, so a later call can overwrite an earlier verdict (DF-05, DF-15).
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;

    /// @dev Reverts "unknown" when the hash was never requested.
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        );

    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 avgResponse);

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory);
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory);
    function getIdentityRegistry() external view returns (address);
    function getVersion() external pure returns (string memory);
}
