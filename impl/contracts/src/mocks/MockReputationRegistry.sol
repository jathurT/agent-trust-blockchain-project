// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry, IReputationRegistry} from "../interfaces/erc8004/IERC8004.sol";

/// @title MockReputationRegistry
/// @notice ERC-8004 Reputation Registry (REG-003), behaviour-for-behaviour with
///         `ReputationRegistryUpgradeable` at erc-8004-contracts, commit b9e466c.
/// @dev    `getVersion()` returns "2.0.0-mock"; there is no proxy, `initialize()` or
///         owner surface. Everything AgentTrust's gate depends on is reproduced exactly:
///
///          - `getSummary` REVERTS "clientAddresses required" on an empty list. There is
///            no "all clients" mode, which is the protocol's own Sybil mitigation (V-96)
///            and the reason the gate takes a buyer-supplied trusted set (DF-09).
///          - `count` counts **feedback entries, not distinct clients** — one client
///            leaving five reviews returns count == 5. This is why the gate calls
///            getSummary once per trusted client and counts distinct attesters itself.
///          - it loops over every entry of every listed client, so gas grows with
///            history (measured in SEC-013).
///          - `giveFeedback` REVERTS "Self-feedback not allowed" when the caller is the
///            agent's owner or an approved operator, and ERC721NonexistentToken when the
///            agent does not exist.
///          - values are normalised to 18 decimals, averaged, then scaled back to the
///            most frequent `valueDecimals` among the matching entries.
contract MockReputationRegistry is IReputationRegistry {
    int128 private constant MAX_ABS_VALUE = 1e38;
    bytes32 private constant EMPTY_HASH = keccak256(bytes(""));

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    /// @dev Running totals for getSummary, in memory so the loop fits the stack.
    struct Accumulator {
        int256 sum;
        uint64 count;
        uint64[19] decimalCounts;
    }

    address private immutable _identityRegistry;

    mapping(uint256 => mapping(address => uint64)) private _lastIndex;
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) private _feedback;
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _clientExists;

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    constructor(address identityRegistry) {
        _identityRegistry = identityRegistry;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(valueDecimals <= 18, "too many decimals");
        require(value >= -MAX_ABS_VALUE && value <= MAX_ABS_VALUE, "value too large");
        require(
            !IIdentityRegistry(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
            "Self-feedback not allowed"
        );

        uint64 currentIndex = ++_lastIndex[agentId][msg.sender];
        _feedback[agentId][msg.sender][currentIndex] =
            Feedback({value: value, valueDecimals: valueDecimals, tag1: tag1, tag2: tag2, isRevoked: false});

        if (!_clientExists[agentId][msg.sender]) {
            _clients[agentId].push(msg.sender);
            _clientExists[agentId][msg.sender] = true;
        }

        _emitNewFeedback(agentId, currentIndex, endpoint, feedbackURI, feedbackHash);
    }

    /// @dev The 11-field event does not fit on the stack inline (upstream compiles with
    ///      via_ir; this project does not). Emitting from a storage pointer keeps the
    ///      event identical while holding only 8 slots live.
    function _emitNewFeedback(
        uint256 agentId,
        uint64 feedbackIndex,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) private {
        Feedback storage fb = _feedback[agentId][msg.sender][feedbackIndex];
        emit NewFeedback(
            agentId,
            msg.sender,
            feedbackIndex,
            fb.value,
            fb.valueDecimals,
            fb.tag1,
            fb.tag1,
            fb.tag2,
            endpoint,
            feedbackURI,
            feedbackHash
        );
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        require(feedbackIndex > 0, "index must be > 0");
        require(feedbackIndex <= _lastIndex[agentId][msg.sender], "index out of bounds");
        require(!_feedback[agentId][msg.sender][feedbackIndex].isRevoked, "Already revoked");

        _feedback[agentId][msg.sender][feedbackIndex].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        if (clientAddresses.length == 0) revert("clientAddresses required");

        Accumulator memory acc;
        bytes32 tag1Hash = keccak256(bytes(tag1));
        bytes32 tag2Hash = keccak256(bytes(tag2));

        for (uint256 i; i < clientAddresses.length; i++) {
            _accumulate(agentId, clientAddresses[i], tag1Hash, tag2Hash, acc);
        }

        if (acc.count == 0) return (0, 0, 0);

        summaryValueDecimals = _modeDecimals(acc.decimalCounts);
        summaryValue = int128(
            (acc.sum / int256(uint256(acc.count))) / int256(10 ** uint256(18 - summaryValueDecimals))
        );
        count = acc.count;
    }

    /// @dev Split out of getSummary only to keep it inside the stack limit; the
    ///      arithmetic and the iteration order are upstream's.
    function _accumulate(uint256 agentId, address client, bytes32 tag1Hash, bytes32 tag2Hash, Accumulator memory acc)
        private
        view
    {
        uint64 lastIdx = _lastIndex[agentId][client];
        for (uint64 j = 1; j <= lastIdx; j++) {
            Feedback storage fb = _feedback[agentId][client][j];
            if (fb.isRevoked) continue;
            if (EMPTY_HASH != tag1Hash && tag1Hash != keccak256(bytes(fb.tag1))) continue;
            if (EMPTY_HASH != tag2Hash && tag2Hash != keccak256(bytes(fb.tag2))) continue;

            // Normalise to 18 decimals (WAD) before averaging.
            acc.sum += fb.value * int256(10 ** uint256(18 - fb.valueDecimals));
            acc.decimalCounts[fb.valueDecimals]++;
            acc.count++;
        }
    }

    /// @dev Most frequent valueDecimals among the matching entries; ties go to the
    ///      lowest, because the scan runs 0..18 and only a strictly greater count wins.
    function _modeDecimals(uint64[19] memory decimalCounts) private pure returns (uint8 modeDecimals) {
        uint64 maxCount;
        for (uint8 d; d <= 18; d++) {
            if (decimalCounts[d] > maxCount) {
                maxCount = decimalCounts[d];
                modeDecimals = d;
            }
        }
    }

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        require(feedbackIndex > 0, "index must be > 0");
        require(feedbackIndex <= _lastIndex[agentId][clientAddress], "index out of bounds");
        Feedback storage f = _feedback[agentId][clientAddress][feedbackIndex];
        return (f.value, f.valueDecimals, f.tag1, f.tag2, f.isRevoked);
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64) {
        return _lastIndex[agentId][clientAddress];
    }

    function getIdentityRegistry() external view returns (address) {
        return _identityRegistry;
    }

    function getVersion() external pure returns (string memory) {
        return "2.0.0-mock";
    }

    // ------------------------------------------------------- NOT PART OF ERC-8004

    /// @notice Number of distinct addresses that have ever left non-revoked feedback,
    ///         with no trusted-client filter.
    /// @dev    **This function does not exist on the real registry** and must never be
    ///         called by production code. It exists only so SEC-007 can evaluate the
    ///         blueprint's "gate v1" (distinct attesters >= 3, count >= 5) as a
    ///         comparison model — a gate that cannot be computed on the real ABI at all,
    ///         and that five cross-endorsing Sybils pass (DF-09). Results using it are
    ///         labelled "gate v1 (mock-only model)".
    function distinctClientsUnfiltered(uint256 agentId) external view returns (uint256 distinct) {
        address[] storage cs = _clients[agentId];
        for (uint256 i; i < cs.length; i++) {
            uint64 lastIdx = _lastIndex[agentId][cs[i]];
            for (uint64 j = 1; j <= lastIdx; j++) {
                if (!_feedback[agentId][cs[i]][j].isRevoked) {
                    distinct++;
                    break;
                }
            }
        }
    }
}
