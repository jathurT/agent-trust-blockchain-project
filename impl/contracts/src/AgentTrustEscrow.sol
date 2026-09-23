// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CanonicalHash} from "./CanonicalHash.sol";
import {IIdentityRegistry, IReputationRegistry} from "./interfaces/erc8004/IERC8004.sol";

/// @title AgentTrustEscrow
/// @notice Escrow that binds one agent-to-agent payment to one canonical HTTP request
///         and releases it only against a validator attestation.
/// @dev    CONTRACT-004 builds the state machine and `fund()`; CONTRACT-005 adds the
///         reputation gate. `bindValidation`/`confirmValidation`/`release`/`refund`
///         arrive in CONTRACT-007/008, so this contract can take money but cannot yet
///         pay it out. **Do not deploy it.**
///
///         Design decisions this implements, with their findings:
///          - the resource hash is derived **on-chain** from the request fields plus
///            amount, token and chain, so a caller cannot pay for one request and
///            claim another (DF-04);
///          - the payee is **snapshotted** at funding, because transferring the agent
///            NFT clears `agentWallet` in the Identity registry (DF-12, V-92);
///          - `agentId` **0 is a real agent** (V-141), so job existence is decided by
///            `state`, never by a zero id;
///          - the payer's nonce is burned atomically with the transfer, and the amount
///            actually received is checked, so a fee-on-transfer or rebasing token
///            cannot leave a job funded for less than it claims (DF-12).
contract AgentTrustEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Released,
        Refunded
    }

    /// @param payer            who funded the job and who a refund returns to
    /// @param payee            payment destination, resolved and frozen at funding time
    /// @param payeeAgentId     ERC-8004 agent the payment is for; **0 is valid**
    /// @param validator        the mutually agreed attester for this job
    /// @param resourceHash     binds the job to one canonical request at one price
    /// @param requestHash      the bound ERC-8004 validation key (CONTRACT-007)
    /// @param deadline         last moment an attestation may carry to be usable
    /// @param validationRecorded  a passing attestation has been snapshotted
    struct Job {
        address payer;
        address payee;
        uint256 payeeAgentId;
        address validator;
        address token;
        uint256 amount;
        bytes32 resourceHash;
        bytes32 requestHash;
        uint64 fundedAt;
        uint64 deadline;
        State state;
        bool validationRecorded;
    }

    /// @notice The buyer's own trust anchor for the reputation gate (DF-09).
    /// @dev    `trustedClients` is the buyer's list: addresses whose opinion *this
    ///         buyer* accepts. It is capped by `maxTrustedClients` so `fund()` never
    ///         contains an unbounded loop, and duplicates are rejected rather than
    ///         deduplicated, because a repeated address would otherwise inflate
    ///         `distinct` past an owner floor.
    /// @param minDistinct  how many of those clients must have left usable feedback
    /// @param minCount     total feedback entries across them
    /// @param minAvgValue  entry-weighted average, in the project's feedback units —
    ///                     two decimals, so 9000 means 90.00 (DF-21)
    struct GatePolicy {
        address[] trustedClients;
        uint16 minDistinct;
        uint64 minCount;
        int128 minAvgValue;
    }

    /// @notice Which requirement a `ReputationTooLow` revert failed on.
    enum GateDimension {
        Distinct,
        Count,
        Average
    }

    /// @notice The canonical request fields, grouped so `fund()` stays within the
    ///         stack limit and so callers cannot transpose two bytes32 arguments.
    struct ResourceRef {
        bytes32 methodHash;
        bytes32 uriHash;
        bytes32 bodyHash;
    }

    /// @dev Feedback is read under one fixed tag. It is a constant, not a setting,
    ///      so no admin key can point the gate at a tag the seller controls.
    string public constant FEEDBACK_TAG = "agenttrust";

    /// @dev The registry's own units. `valueDecimals` is capped at 18 on write.
    uint8 internal constant WAD_DECIMALS = 18;
    /// @dev The project's feedback units: two decimals (DF-21).
    uint8 internal constant FEEDBACK_DECIMALS = 2;

    IIdentityRegistry public immutable identityRegistry;
    IReputationRegistry public immutable reputationRegistry;

    mapping(bytes32 => Job) private _jobs;
    mapping(address => mapping(bytes32 => bool)) public consumedNonce;
    mapping(address => bool) public tokenAllowed;

    uint64 public minTtl;
    uint64 public maxTtl;
    uint16 public maxTrustedClients;

    /// @notice Gas ceiling for one `getSummary` read.
    /// @dev    `getSummary` walks every feedback entry a client has ever left for the
    ///         agent, and history length is attacker-influenced (V-99), so an
    ///         unbounded read would let a seller brick `fund()` by accumulating
    ///         feedback. A read that exceeds this contributes nothing.
    uint64 public reputationReadGas;

    /// @notice Owner floors. A buyer may be stricter than these, never weaker.
    uint16 public minDistinctFloor;
    uint64 public minCountFloor;
    int128 public minAvgValueFloor;

    event JobFunded(
        bytes32 indexed jobId,
        address indexed payer,
        address indexed payee,
        uint256 payeeAgentId,
        address validator,
        address token,
        uint256 amount,
        bytes32 resourceHash,
        uint64 deadline
    );
    event TokenAllowed(address indexed token, bool allowed);
    event GateFloorsUpdated(uint16 minDistinct, uint64 minCount, int128 minAvgValue);
    event ReputationReadGasUpdated(uint64 reputationReadGas);
    event TtlBoundsUpdated(uint64 minTtl, uint64 maxTtl);
    event MaxTrustedClientsUpdated(uint16 maxTrustedClients);

    error ZeroAmount();
    error TokenNotAllowed(address token);
    error TtlOutOfBounds(uint64 ttlSeconds, uint64 minTtl, uint64 maxTtl);
    error ReplayedNonce(address payer, bytes32 nonce);
    error JobAlreadyExists(bytes32 jobId);
    error InvalidValidator(address validator);
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error TooManyTrustedClients(uint256 given, uint16 max);
    error DuplicateTrustedClient(address client);
    error ZeroTrustedClient();
    error ReputationTooLow(GateDimension dimension, int256 observed, int256 required);
    error InsufficientGasForReputationRead(uint256 available, uint256 required);
    error ReputationReadGasTooLow(uint64 given, uint64 min);
    error InvalidTtlBounds();
    error UnknownJob(bytes32 jobId);

    /// @param identityRegistry_ ERC-8004 Identity registry: a mock in tests, the live
    ///        proxy on Base Sepolia. Immutable, so no admin key can repoint it.
    constructor(
        address owner_,
        address identityRegistry_,
        address reputationRegistry_,
        uint64 minTtl_,
        uint64 maxTtl_,
        uint16 maxTrustedClients_,
        uint64 reputationReadGas_
    ) Ownable(owner_) {
        if (identityRegistry_ == address(0) || reputationRegistry_ == address(0)) {
            revert InvalidValidator(address(0));
        }
        if (minTtl_ == 0 || maxTtl_ < minTtl_) revert InvalidTtlBounds();
        if (reputationReadGas_ < MIN_REPUTATION_READ_GAS) {
            revert ReputationReadGasTooLow(reputationReadGas_, MIN_REPUTATION_READ_GAS);
        }
        identityRegistry = IIdentityRegistry(identityRegistry_);
        reputationRegistry = IReputationRegistry(reputationRegistry_);
        minTtl = minTtl_;
        maxTtl = maxTtl_;
        maxTrustedClients = maxTrustedClients_;
        reputationReadGas = reputationReadGas_;
        emit TtlBoundsUpdated(minTtl_, maxTtl_);
        emit MaxTrustedClientsUpdated(maxTrustedClients_);
        emit ReputationReadGasUpdated(reputationReadGas_);
    }

    // ---------------------------------------------------------------------- fund

    /// @notice Escrows `amount` of `token` against one canonical request, for the agent
    ///         `payeeAgentId`, to be attested by `validator`.
    /// @dev    Checks, then effects, then the one interaction — and the interaction is
    ///         re-checked by balance delta. `nonReentrant` because `token` is only as
    ///         trustworthy as the allowlist that admitted it.
    /// @param payeeAgentId ERC-8004 agent id of the seller. Zero is a valid id (V-141).
    /// @param token        ERC-20 to escrow; must be allowlisted.
    /// @param amount       atomic units (USDC has 6 decimals), and part of the hash.
    /// @param resource     the canonical method, URI and body hashes (SPEC-001).
    /// @param nonce        payer-scoped and burned here; replaying it reverts.
    /// @param ttlSeconds   time the seller has to earn an attestation.
    /// @param validator    must not be the payer, nor the agent's owner or operator.
    /// @param gate         the buyer's trust anchor; enforced in CONTRACT-005.
    /// @return jobId       the derived job identifier.
    function fund(
        uint256 payeeAgentId,
        address token,
        uint256 amount,
        ResourceRef calldata resource,
        bytes32 nonce,
        uint64 ttlSeconds,
        address validator,
        GatePolicy calldata gate
    ) external nonReentrant returns (bytes32 jobId) {
        if (amount == 0) revert ZeroAmount();
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        if (ttlSeconds < minTtl || ttlSeconds > maxTtl) revert TtlOutOfBounds(ttlSeconds, minTtl, maxTtl);
        if (consumedNonce[msg.sender][nonce]) revert ReplayedNonce(msg.sender, nonce);

        // Resolving the payee also proves the agent exists: `ownerOf` reverts otherwise,
        // and failing closed here is the point.
        address payee = _resolvePayee(payeeAgentId);
        _requireAcceptableValidator(validator, payeeAgentId);
        _enforceGate(payeeAgentId, gate);

        bytes32 resourceHash = CanonicalHash.resourceHash(
            resource.methodHash, resource.uriHash, resource.bodyHash, amount, token, block.chainid
        );
        jobId = CanonicalHash.jobId(block.chainid, address(this), msg.sender, payee, resourceHash, nonce);
        if (_jobs[jobId].state != State.None) revert JobAlreadyExists(jobId);

        // casting to 'uint64' is safe because it overflows in the year 584,942,417,355
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 deadline = uint64(block.timestamp) + ttlSeconds;

        consumedNonce[msg.sender][nonce] = true;
        _jobs[jobId] = Job({
            payer: msg.sender,
            payee: payee,
            payeeAgentId: payeeAgentId,
            validator: validator,
            token: token,
            amount: amount,
            resourceHash: resourceHash,
            requestHash: bytes32(0),
            // casting to 'uint64' is safe because it overflows in the year 584,942,417,355
            // forge-lint: disable-next-line(unsafe-typecast)
            fundedAt: uint64(block.timestamp),
            deadline: deadline,
            state: State.Funded,
            validationRecorded: false
        });

        // The only external value transfer. A token that delivers less than it was told
        // to — fee-on-transfer, rebasing, or simply lying — fails the whole call rather
        // than leaving a job funded for less than it records.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert TransferAmountMismatch(amount, received);

        _emitJobFunded(jobId);
    }

    /// @dev Headroom left for the rest of `fund()` after a capped registry read.
    uint256 internal constant GAS_AFTER_READ = 100_000;

    /// @notice Smallest ceiling the owner may set for one reputation read.
    /// @dev    A ceiling low enough that every read runs out of gas and is caught would
    ///         turn the gate off while leaving it looking applied — the same bypass the
    ///         `gasleft()` check closes for callers, from the other direction. Measured
    ///         cost is ~8.6k gas per feedback entry plus ~19k fixed (CONTRACT-005
    ///         evidence), so this floor is worth roughly three entries.
    uint64 public constant MIN_REPUTATION_READ_GAS = 45_000;

    /// @dev The nine-field event does not fit on the stack at the end of `fund()`, and
    ///      this project does not compile with `via_ir`. Reading the job back costs a
    ///      few warm SLOADs and guarantees the event matches what was actually stored.
    function _emitJobFunded(bytes32 jobId) private {
        Job storage j = _jobs[jobId];
        emit JobFunded(
            jobId, j.payer, j.payee, j.payeeAgentId, j.validator, j.token, j.amount, j.resourceHash, j.deadline
        );
    }

    /// @dev `getAgentWallet` is the intended destination, but the Identity registry
    ///      clears it whenever the agent NFT is transferred, after which it returns
    ///      zero (V-92, confirmed live in V-97). Falling back to `ownerOf` keeps a
    ///      freshly transferred agent payable; snapshotting the result keeps a transfer
    ///      *during* the job from redirecting the money (DF-12).
    function _resolvePayee(uint256 agentId) internal view returns (address payee) {
        payee = identityRegistry.getAgentWallet(agentId);
        if (payee == address(0)) payee = identityRegistry.ownerOf(agentId);
    }

    /// @dev Independence is really supplied by the buyer choosing a validator it trusts
    ///      from the seller's offered set (DF-06); this check is defence in depth
    ///      against the two cases the chain can see by itself.
    function _requireAcceptableValidator(address validator, uint256 agentId) internal view {
        if (validator == address(0) || validator == msg.sender) revert InvalidValidator(validator);
        if (identityRegistry.isAuthorizedOrOwner(validator, agentId)) revert InvalidValidator(validator);
    }

    /// @notice The reputation gate (DF-09): does this agent have enough usable
    ///         feedback from clients *this buyer* trusts?
    /// @dev    Deliberately not a "distinct attesters across the whole registry" gate.
    ///         That is what the blueprint proposed, and it is both uncomputable on the
    ///         real ABI — `getSummary` requires a non-empty client list and has no
    ///         distinct-attester output (V-96) — and trivially inflatable: five
    ///         addresses that endorse each other satisfy "distinct >= 3, count >= 5"
    ///         at no cost, which `MockRegistriesTest` demonstrates. Anchoring on the
    ///         buyer's own list moves the cost of a Sybil from "make an address" to
    ///         "be trusted by this buyer". The price is real and is measured, not
    ///         waved away: an honest newcomer with no shared history is refused
    ///         (SEC-007, DOC-004).
    function _enforceGate(uint256 agentId, GatePolicy calldata gate) internal view {
        address[] calldata clients = gate.trustedClients;
        if (clients.length > maxTrustedClients) {
            revert TooManyTrustedClients(clients.length, maxTrustedClients);
        }

        uint256 distinct;
        uint256 totalCount;
        int256 weightedSumWad;

        for (uint256 i; i < clients.length; i++) {
            if (clients[i] == address(0)) revert ZeroTrustedClient();
            // Rejected rather than deduplicated: repeating one address would otherwise
            // lift `distinct` past an owner floor for free.
            for (uint256 j; j < i; j++) {
                if (clients[i] == clients[j]) revert DuplicateTrustedClient(clients[i]);
            }

            (uint64 count, int128 value, uint8 decimals) = _readSummary(agentId, clients[i]);
            if (count == 0) continue;

            distinct += 1;
            totalCount += count;
            // Normalise each client's average to 18 decimals before weighting it by
            // how many entries it summarises. An overflow here reverts, which is the
            // right way to fail.
            weightedSumWad += int256(value) * int256(10 ** uint256(WAD_DECIMALS - decimals)) * int256(uint256(count));
        }

        uint256 requiredDistinct = _max(gate.minDistinct, minDistinctFloor);
        if (distinct < requiredDistinct) {
            revert ReputationTooLow(GateDimension.Distinct, int256(distinct), int256(requiredDistinct));
        }

        uint256 requiredCount = _max(gate.minCount, minCountFloor);
        if (totalCount < requiredCount) {
            revert ReputationTooLow(GateDimension.Count, int256(totalCount), int256(requiredCount));
        }

        int256 requiredAvg = gate.minAvgValue > minAvgValueFloor ? gate.minAvgValue : minAvgValueFloor;
        if (totalCount == 0) {
            // No entries at all: only a policy that asks for nothing can pass, and the
            // two checks above have already allowed that case through.
            if (requiredAvg > 0) revert ReputationTooLow(GateDimension.Average, 0, requiredAvg);
            return;
        }

        // Back to the project's two-decimal units. Integer division truncates towards
        // zero, so a negative average is reported very slightly high; the effect is one
        // hundredth of a point and always in the buyer's favour.
        int256 averageWad = weightedSumWad / int256(totalCount);
        int256 average = averageWad / int256(10 ** uint256(WAD_DECIMALS - FEEDBACK_DECIMALS));
        if (average < requiredAvg) {
            revert ReputationTooLow(GateDimension.Average, average, requiredAvg);
        }
    }

    /// @dev One bounded read. A client whose history is too long, or whose read reverts
    ///      for any other reason, contributes nothing instead of bricking `fund()`.
    ///
    ///      The `gasleft()` check is the part that matters for security: without it a
    ///      caller could supply just enough gas that every read runs out and is caught,
    ///      and walk straight through a gate that appears to have been applied. Under
    ///      EIP-150 a callee receives at most 63/64 of the remaining gas, so the caller
    ///      must hold 64/63 of the ceiling plus room to finish.
    function _readSummary(uint256 agentId, address client)
        internal
        view
        returns (uint64 count, int128 value, uint8 decimals)
    {
        uint64 ceiling = reputationReadGas;
        uint256 required = (uint256(ceiling) * 64) / 63 + GAS_AFTER_READ;
        if (gasleft() < required) revert InsufficientGasForReputationRead(gasleft(), required);

        address[] memory one = new address[](1);
        one[0] = client;
        try reputationRegistry.getSummary{gas: ceiling}(agentId, one, FEEDBACK_TAG, "") returns (
            uint64 c, int128 v, uint8 d
        ) {
            return (c, v, d);
        } catch {
            return (0, 0, 0);
        }
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    // --------------------------------------------------------------------- views

    function jobs(bytes32 jobId) external view returns (Job memory) {
        Job memory job = _jobs[jobId];
        if (job.state == State.None) revert UnknownJob(jobId);
        return job;
    }

    function jobState(bytes32 jobId) external view returns (State) {
        return _jobs[jobId].state;
    }

    /// @notice Lets a client derive the same hash the chain will, before it pays.
    function previewResourceHash(ResourceRef calldata resource, uint256 amount, address token)
        external
        view
        returns (bytes32)
    {
        return CanonicalHash.resourceHash(
            resource.methodHash, resource.uriHash, resource.bodyHash, amount, token, block.chainid
        );
    }

    function previewJobId(address payer, address payee, bytes32 resourceHash, bytes32 nonce)
        external
        view
        returns (bytes32)
    {
        return CanonicalHash.jobId(block.chainid, address(this), payer, payee, resourceHash, nonce);
    }

    function previewPayee(uint256 agentId) external view returns (address) {
        return _resolvePayee(agentId);
    }

    // --------------------------------------------------------------------- admin

    /// @dev CONTRACT-010 adds the gate floors, the refund grace and bounded ranges.
    ///      No administrative function here can move escrowed funds (CONTRACT-013).
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setTtlBounds(uint64 minTtl_, uint64 maxTtl_) external onlyOwner {
        if (minTtl_ == 0 || maxTtl_ < minTtl_) revert InvalidTtlBounds();
        minTtl = minTtl_;
        maxTtl = maxTtl_;
        emit TtlBoundsUpdated(minTtl_, maxTtl_);
    }

    /// @dev Floors only ever make the gate stricter: a buyer's policy is combined with
    ///      these by taking the larger requirement, never the smaller.
    function setGateFloors(uint16 minDistinct_, uint64 minCount_, int128 minAvgValue_) external onlyOwner {
        minDistinctFloor = minDistinct_;
        minCountFloor = minCount_;
        minAvgValueFloor = minAvgValue_;
        emit GateFloorsUpdated(minDistinct_, minCount_, minAvgValue_);
    }

    function setReputationReadGas(uint64 reputationReadGas_) external onlyOwner {
        if (reputationReadGas_ < MIN_REPUTATION_READ_GAS) {
            revert ReputationReadGasTooLow(reputationReadGas_, MIN_REPUTATION_READ_GAS);
        }
        reputationReadGas = reputationReadGas_;
        emit ReputationReadGasUpdated(reputationReadGas_);
    }

    function setMaxTrustedClients(uint16 maxTrustedClients_) external onlyOwner {
        maxTrustedClients = maxTrustedClients_;
        emit MaxTrustedClientsUpdated(maxTrustedClients_);
    }
}
