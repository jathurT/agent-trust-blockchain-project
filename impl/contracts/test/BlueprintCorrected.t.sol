// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";

/// @notice CONTRACT-011 — the blueprint's §9.4 test set, corrected.
///
/// The blueprint proposed four tests by these names. Three of them tested the wrong
/// thing, and this file says so in each case rather than quietly replacing them. The
/// names are kept so §9.4 can be traced to something that actually runs, and each test
/// states what the original asserted and why that was not the property at issue.
///
/// These are contract-level tests only. A2, A3 and A6 are *evaluated* against running
/// services in SEC-003/004/007 — nothing here is evidence that an attack was blocked in
/// practice, and it must not be quoted as such (CLAUDE.md §12).
contract BlueprintCorrectedTest is EscrowFixture {
    bytes32 internal constant SALT = keccak256("seller salt");

    /// @notice A2 (replay), at the layer the chain can actually defend.
    /// @dev    The blueprint's `test_A2_ReplayedNonce` funded twice with one nonce and
    ///         called the revert a defence against HTTP replay. It is not: the nonce
    ///         stops a second *payment*, and the published A2 result (248 grants for
    ///         one settlement) is about a seller serving one payment many times. That
    ///         is the claim store's job, tested in API-005, and measured in SEC-003.
    ///         What this test pins is the narrower, real property.
    function test_A2_ReplayedNonceRejected() public {
        _fund(NONCE);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ReplayedNonce.selector, buyer, NONCE));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());

        // One payment, one job, one escrowed balance.
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
    }

    /// @notice A3 (cross-resource substitution): a payment for request X can never
    ///         settle request Y, because the request is inside the job identity.
    /// @dev    The blueprint had no on-chain test for this at all — its `quotedMax`
    ///         was caller-supplied and authenticated nothing (DF-04).
    function test_A3_ResourceHashMismatchIsNotReleasable() public {
        bytes32 jobId = _fund(NONCE);

        // The same seller, same price, a different request body.
        AgentTrustEscrow.ResourceRef memory other =
            AgentTrustEscrow.ResourceRef({methodHash: METHOD_HASH, uriHash: URI_HASH, bodyHash: keccak256("something else")});
        bytes32 otherResource = escrow.previewResourceHash(other, PRICE, address(usdc));
        assertTrue(otherResource != escrow.jobs(jobId).resourceHash);

        // A validation request derived from the substituted resource does not bind.
        bytes32 wrongHash = keccak256(
            abi.encode(
                keccak256("AgentTrustValidation(uint256 chainId,address escrow,bytes32 jobId,bytes32 resourceHash,bytes32 salt)"),
                block.chainid,
                address(escrow),
                jobId,
                otherResource,
                SALT
            )
        );
        vm.prank(seller);
        validation.validationRequest(validator, sellerAgentId, "", wrongHash);
        _attest(wrongHash, 100);

        // The job binds the hash derived from its *own* resource, so a passing
        // attestation filed against the substituted one is invisible to it.
        bytes32 boundHash = _bind(jobId, SALT);
        assertTrue(boundHash != wrongHash);
        assertFalse(escrow.isReleasable(jobId));

        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotValidated.selector, jobId));
        escrow.release(jobId);

        // Only an attestation on the bound hash pays.
        _attest(boundHash, 100);
        assertTrue(escrow.isReleasable(jobId));
    }

    /// @notice A different price for the same request is a different job, so a cheap
    ///         quote cannot be spent against an expensive resource.
    function test_A3_PriceSubstitutionProducesADifferentJob() public {
        bytes32 cheap = escrow.previewResourceHash(_resource(), PRICE, address(usdc));
        bytes32 dear = escrow.previewResourceHash(_resource(), PRICE * 10, address(usdc));
        assertTrue(cheap != dear);

        bytes32 jobId = _fund(NONCE);
        assertEq(escrow.jobs(jobId).resourceHash, cheap);
        assertTrue(escrow.previewJobId(buyer, seller, dear, NONCE) != jobId);
    }

    /// @notice A6 (Sybil): the same ring of addresses, run against both gates.
    /// @dev    This is the comparison the blueprint's own numbers could not survive.
    ///         Its gate — "at least 3 distinct attesters and at least 5 feedback
    ///         entries" — is satisfied by five addresses that endorse each other at no
    ///         cost. The trust-anchored gate is not, because none of them is anyone the
    ///         buyer has dealt with.
    ///
    ///         `distinctClientsUnfiltered` is a mock-only helper: the real ERC-8004 ABI
    ///         cannot compute the blueprint's gate at all, since `getSummary` requires a
    ///         non-empty client list and returns no distinct-attester count (V-96).
    ///         That is a finding in its own right, not a limitation of this test.
    function test_A6_SybilRingUnderTrustAnchoredGateIsRefused() public {
        address[] memory ring = new address[](5);
        for (uint256 i; i < 5; i++) {
            ring[i] = makeAddr(string.concat("sybil", vm.toString(i)));
            vm.prank(ring[i]);
            reputation.giveFeedback(sellerAgentId, 10000, 2, FEEDBACK_TAG, "", "", "", bytes32(0));
        }

        // Gate v1, the blueprint's: distinct >= 3 and count >= 5. Admitted.
        assertGe(reputation.distinctClientsUnfiltered(sellerAgentId), 3);
        address[] memory allOfThem = ring;
        (uint64 v1Count,,) = reputation.getSummary(sellerAgentId, allOfThem, FEEDBACK_TAG, "");
        assertGe(v1Count, 5);

        // Gate v2, this project's: the buyer's own trusted clients. Refused.
        address[] memory trusted = new address[](2);
        trusted[0] = makeAddr("alice");
        trusted[1] = makeAddr("bob");
        AgentTrustEscrow.GatePolicy memory gate =
            AgentTrustEscrow.GatePolicy({trustedClients: trusted, minDistinct: 1, minCount: 1, minAvgValue: 0});

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(0), int256(1)
            )
        );
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, gate);
    }

    /// @notice And the cost of that gate, stated as a test rather than only in prose:
    ///         an honest seller with no shared history is refused exactly as a Sybil is.
    ///         DOC-004 has to say this; SEC-007 measures how often it happens.
    function test_A6_AnHonestNewcomerIsRefusedForTheSameReason() public {
        vm.prank(stranger);
        uint256 newcomer = identity.register("https://newcomer.example/agent.json");

        address[] memory trusted = new address[](1);
        trusted[0] = makeAddr("alice");
        AgentTrustEscrow.GatePolicy memory gate =
            AgentTrustEscrow.GatePolicy({trustedClients: trusted, minDistinct: 1, minCount: 1, minAvgValue: 0});

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(0), int256(1)
            )
        );
        escrow.fund(newcomer, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, gate);
    }

    /// @notice Refund cannot take a job that was delivered and attested in time.
    /// @dev    The blueprint's `test_RefundAfterDeadline` only advanced the clock and
    ///         refunded; it never looked at the attestation, so it would have passed
    ///         against a contract that let the buyer take back paid-for work (DF-05).
    function test_RefundBlockedByTimelyPass() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.warp(uint256(escrow.jobs(jobId).deadline) - 1);
        _attest(requestHash, 100);

        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ValidationExists.selector, jobId));
        escrow.refund(jobId);

        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    /// @notice The boundary the grace period exists for, at one-second resolution.
    function test_BoundaryMatrixAroundDeadlineAndGrace() public {
        bytes32 jobId = _fund(NONCE);
        uint64 deadline = escrow.jobs(jobId).deadline;

        vm.warp(deadline - 1);
        assertFalse(escrow.isRefundable(jobId));
        vm.warp(deadline);
        assertFalse(escrow.isRefundable(jobId));
        vm.warp(uint256(deadline) + GRACE);
        assertFalse(escrow.isRefundable(jobId));
        vm.warp(uint256(deadline) + GRACE + 1);
        assertTrue(escrow.isRefundable(jobId));
    }

    /// @notice An attestation exactly on the deadline is timely; one second later is not.
    function test_AttestationTimelinessIsInclusiveOfTheDeadline() public {
        bytes32 jobA = _fund(NONCE);
        bytes32 hashA = _bind(jobA, SALT);
        uint64 deadline = escrow.jobs(jobA).deadline;

        vm.warp(deadline);
        _attest(hashA, 100);
        assertTrue(escrow.isReleasable(jobA));

        bytes32 jobB = _fund(bytes32(uint256(2)));
        bytes32 hashB = _bind(jobB, keccak256("salt b"));
        vm.warp(uint256(escrow.jobs(jobB).deadline) + 1);
        _attest(hashB, 100);
        assertFalse(escrow.isReleasable(jobB));
    }

    /// @notice Release and refund contend in the same block; exactly one may win, and
    ///         which one is decided by the attestation, not by ordering.
    function test_ReleaseAndRefundCannotBothSucceedInTheSameBlock() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);

        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);
        assertTrue(escrow.isReleasable(jobId));
        assertFalse(escrow.isRefundable(jobId));

        escrow.release(jobId);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.BadState.selector, jobId, AgentTrustEscrow.State.Released)
        );
        escrow.refund(jobId);
    }

    /// @notice A funded job where the agent's wallet is not the NFT owner still pays
    ///         the wallet, and still pays it after the NFT moves.
    function test_PaymentFollowsTheSnapshottedWalletNotTheCurrentOwner() public {
        (address wallet, uint256 walletKey) = makeAddrAndKey("agentWallet");
        _setSellerAgentWallet(wallet, walletKey);

        bytes32 jobId = _fund(NONCE);
        assertEq(escrow.jobs(jobId).payee, wallet);

        vm.prank(seller);
        identity.transferFrom(seller, stranger, sellerAgentId);

        // Binding is by the snapshotted payee, so the new NFT owner cannot take over
        // a job that is already funded.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotPayee.selector, stranger, wallet));
        escrow.bindValidation(jobId, SALT);

        bytes32 requestHash = escrow.previewRequestHash(jobId, SALT);
        vm.prank(stranger); // still the agent's owner, so the registry lets it file
        validation.validationRequest(validator, sellerAgentId, "", requestHash);
        vm.prank(wallet);
        escrow.bindValidation(jobId, SALT);
        _attest(requestHash, 100);
        escrow.release(jobId);

        assertEq(usdc.balanceOf(wallet), PRICE);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function _setSellerAgentWallet(address wallet, uint256 walletKey) internal {
        uint256 deadline = vm.getBlockTimestamp() + 60;
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(identity)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"),
                sellerAgentId,
                wallet,
                seller,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(walletKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        vm.prank(seller);
        identity.setAgentWallet(sellerAgentId, wallet, deadline, abi.encodePacked(r, s, v));
    }
}
