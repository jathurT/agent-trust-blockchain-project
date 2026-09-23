// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry, IValidationRegistry} from "../interfaces/erc8004/IERC8004.sol";

/// @title MockValidationRegistry
/// @notice ERC-8004 Validation Registry (REG-004), behaviour-for-behaviour with
///         `ValidationRegistryUpgradeable` at erc-8004-contracts, commit b9e466c.
/// @dev    `getVersion()` returns "2.0.0-mock"; there is no proxy, `initialize()` or
///         owner surface. The three behaviours AgentTrust's settlement is built around
///         are reproduced exactly, including the inconvenient ones:
///
///          1. `requestHash` is globally unique and first-come: a second request with
///             the same hash REVERTS "exists", for any agent, from any caller. An
///             unsalted, predictable hash is therefore squattable, which is why the
///             payee binds a salted hash exactly once (DF-06).
///          2. `validationRequest` already sets `lastUpdate`, and `hasResponse` is
///             stored but **never exposed** by `getValidationStatus`. A pending request
///             is therefore indistinguishable from a response of 0 on a per-request
///             read, so there is no early refund on "fail" (DF-05, V-99).
///             `getSummary` does filter on `hasResponse`, but only in aggregate across
///             every validation the agent has ever had — an unbounded loop, unusable
///             from `release()`/`refund()`. See V-99a.
///          3. `validationResponse` is repeatable: the named validator can overwrite an
///             earlier verdict at any time, which is why release snapshots the first
///             passing attestation rather than reading live (DF-15).
contract MockValidationRegistry is IValidationRegistry {
    struct ValidationStatus {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    address private immutable _identityRegistry;

    mapping(bytes32 => ValidationStatus) private _validations;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

    event ValidationRequest(
        address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash
    );
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    constructor(address identityRegistry_) {
        require(identityRegistry_ != address(0), "bad identity");
        _identityRegistry = identityRegistry_;
    }

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        require(validatorAddress != address(0), "bad validator");
        require(_validations[requestHash].validatorAddress == address(0), "exists");

        IIdentityRegistry registry = IIdentityRegistry(_identityRegistry);
        address owner = registry.ownerOf(agentId);
        require(
            msg.sender == owner || registry.isApprovedForAll(owner, msg.sender)
                || registry.getApproved(agentId) == msg.sender,
            "Not authorized"
        );

        _validations[requestHash] = ValidationStatus({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: block.timestamp,
            hasResponse: false
        });

        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        ValidationStatus storage s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        require(msg.sender == s.validatorAddress, "not validator");
        require(response <= 100, "resp>100");
        s.response = response;
        s.responseHash = responseHash;
        s.tag = tag;
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
        emit ValidationResponse(s.validatorAddress, s.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    /// @dev Note what is NOT returned: `hasResponse`. `lastUpdate` is non-zero from the
    ///      moment the request is filed, so (response == 0, lastUpdate == t) means
    ///      either "pending since t" or "failed at t".
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
        )
    {
        ValidationStatus memory s = _validations[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate);
    }

    /// @dev Unbounded: loops over every validation the agent has ever had. Off-chain use
    ///      only — never call this from a settlement path.
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 avgResponse)
    {
        uint256 totalResponse;
        bytes32[] storage requestHashes = _agentValidations[agentId];

        for (uint256 i; i < requestHashes.length; i++) {
            ValidationStatus storage s = _validations[requestHashes[i]];

            bool matchValidator = (validatorAddresses.length == 0);
            if (!matchValidator) {
                for (uint256 j; j < validatorAddresses.length; j++) {
                    if (s.validatorAddress == validatorAddresses[j]) {
                        matchValidator = true;
                        break;
                    }
                }
            }

            bool matchTag = (bytes(tag).length == 0) || (keccak256(bytes(s.tag)) == keccak256(bytes(tag)));

            if (matchValidator && matchTag && s.hasResponse) {
                totalResponse += s.response;
                count++;
            }
        }

        avgResponse = count > 0 ? uint8(totalResponse / count) : 0;
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    function getIdentityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    function getVersion() external pure returns (string memory) {
        return "2.0.0-mock";
    }
}
